package jwt

import (
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"os"
	"strings"
	"time"

	"github.com/MicahParks/keyfunc/v2"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

type CustomClaims struct {
	UserID   uuid.UUID `json:"-"`
	Email    string    `json:"email"`
	FullName string    `json:"full_name"`
	Role     string    `json:"role"`
	jwt.RegisteredClaims
}

type Verifier struct {
	publicKey *rsa.PublicKey
	jwks      *keyfunc.JWKS
	issuer    string
	audience  string
}

func NewVerifier(jwksURI, keyPath, issuer, audience string) (*Verifier, error) {
	if strings.TrimSpace(issuer) == "" || strings.TrimSpace(audience) == "" {
		return nil, errors.New("JWT issuer and audience are required")
	}
	v := &Verifier{issuer: issuer, audience: audience}
	if jwksURI != "" {
		jwks, err := keyfunc.Get(jwksURI, keyfunc.Options{})
		if err != nil {
			return nil, err
		}
		v.jwks = jwks
		return v, nil
	}
	keyBytes, err := os.ReadFile(keyPath)
	if err != nil {
		return nil, err
	}
	block, _ := pem.Decode(keyBytes)
	if block == nil {
		return nil, errors.New("failed to parse public key PEM")
	}
	parsedKey, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	rsaKey, ok := parsedKey.(*rsa.PublicKey)
	if !ok || rsaKey.N.BitLen() < 2048 {
		return nil, errors.New("JWT key must be RSA with at least 2048 bits")
	}
	v.publicKey = rsaKey
	return v, nil
}

// Auth publishes the RFC 7638 SHA-256 thumbprint as its key ID.
func keyID(key *rsa.PublicKey) string {
	e := base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes())
	n := base64.RawURLEncoding.EncodeToString(key.N.Bytes())
	digest := sha256.Sum256([]byte(fmt.Sprintf(`{"e":"%s","kty":"RSA","n":"%s"}`, e, n)))
	return base64.RawURLEncoding.EncodeToString(digest[:])
}

func (v *Verifier) VerifyToken(tokenString string) (*CustomClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &CustomClaims{}, func(t *jwt.Token) (any, error) {
		kid, ok := t.Header["kid"].(string)
		if t.Header["typ"] != "JWT" || !ok || kid == "" {
			return nil, errors.New("invalid JWT header")
		}
		var key any = v.publicKey
		if v.jwks != nil {
			var err error
			key, err = v.jwks.Keyfunc(t)
			if err != nil {
				return nil, err
			}
		}
		rsaKey, ok := key.(*rsa.PublicKey)
		if !ok || rsaKey == nil || rsaKey.N.BitLen() < 2048 || kid != keyID(rsaKey) {
			return nil, errors.New("invalid JWT signing key")
		}
		return rsaKey, nil
	}, jwt.WithExpirationRequired(), jwt.WithValidMethods([]string{"RS256"}), jwt.WithIssuer(v.issuer), jwt.WithAudience(v.audience))
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(*CustomClaims)
	if !ok || !token.Valid {
		return nil, errors.New("invalid token")
	}
	userID, err := uuid.Parse(claims.Subject)
	if err != nil || userID.Version() != 4 || userID.Variant() != uuid.RFC4122 {
		return nil, errors.New("invalid JWT subject")
	}
	id, err := uuid.Parse(claims.ID)
	if err != nil || id.Version() != 4 || id.Variant() != uuid.RFC4122 {
		return nil, errors.New("invalid JWT ID")
	}
	if claims.Role != "CANDIDATE" && claims.Role != "RECRUITER" && claims.Role != "ADMIN" {
		return nil, errors.New("invalid JWT role")
	}
	if claims.IssuedAt == nil || claims.ExpiresAt == nil || claims.IssuedAt.After(time.Now().Add(time.Minute)) || !claims.ExpiresAt.After(claims.IssuedAt.Time) {
		return nil, errors.New("invalid JWT temporal claims")
	}
	claims.UserID = userID
	return claims, nil
}
