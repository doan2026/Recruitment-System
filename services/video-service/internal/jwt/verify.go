package jwt

import (
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"os"

	"github.com/MicahParks/keyfunc/v2"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

type CustomClaims struct {
	UserID   uuid.UUID `json:"sub"`
	Email    string    `json:"email"`
	FullName string    `json:"full_name"`
	jwt.RegisteredClaims
}

type Verifier struct {
	publicKey *rsa.PublicKey
	jwks      *keyfunc.JWKS
}

func NewVerifier(jwksURI string, keyPath string) (*Verifier, error) {
	if jwksURI != "" {
		jwks, err := keyfunc.Get(jwksURI, keyfunc.Options{})
		if err != nil {
			return nil, err
		}
		return &Verifier{jwks: jwks}, nil
	}

	keyBytes, err := os.ReadFile(keyPath)
	if err != nil {
		return nil, err
	}

	block, _ := pem.Decode(keyBytes)
	if block == nil {
		return nil, errors.New("failed to parse PEM block containing public key")
	}

	parsedKey, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, err
	}

	rsaKey, ok := parsedKey.(*rsa.PublicKey)
	if !ok {
		return nil, errors.New("key is not RSA public key")
	}

	return &Verifier{publicKey: rsaKey}, nil
}

func (v *Verifier) VerifyToken(tokenString string) (*CustomClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &CustomClaims{}, func(t *jwt.Token) (any, error) {
		// JWKS mode: keyfunc handles key lookup and algorithm validation.
		if v.jwks != nil {
			return v.jwks.Keyfunc(t)
		}
		// Static PEM mode: enforce RSA manually.
		if _, ok := t.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return v.publicKey, nil
	}, jwt.WithExpirationRequired(), jwt.WithValidMethods([]string{"RS256"}))

	if err != nil {
		return nil, err
	}

	claims, ok := token.Claims.(*CustomClaims)
	if !ok || !token.Valid {
		return nil, errors.New("invalid token")
	}

	return claims, nil
}
