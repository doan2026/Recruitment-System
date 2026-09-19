package jwt

import (
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

type CustomClaims struct {
	UserID   uuid.UUID `json:"sub"`
	Email    string    `json:"email"`
	FullName string    `json:"full_name"`
	jwt.RegisteredClaims
}

type Signer struct {
	privateKey *rsa.PrivateKey
	issuer     string
	audience   string
	accessTTL  time.Duration
}

func NewSigner(keyPath, issuer, audience string, ttl time.Duration) (*Signer, error) {
	keyBytes, err := os.ReadFile(keyPath)
	if err != nil {
		return nil, err
	}

	block, _ := pem.Decode(keyBytes)
	if block == nil {
		return nil, errors.New("failed to parse PEM block containing private key")
	}

	var parsedKey any
	if key, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
		parsedKey = key
	} else if key, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		parsedKey = key
	} else {
		return nil, errors.New("failed to parse private key")
	}

	rsaKey, ok := parsedKey.(*rsa.PrivateKey)
	if !ok {
		return nil, errors.New("key is not RSA private key")
	}

	return &Signer{
		privateKey: rsaKey,
		issuer:     issuer,
		audience:   audience,
		accessTTL:  ttl,
	}, nil
}

func (s *Signer) GenerateAccessToken(userID uuid.UUID, email, fullName string) (string, error) {
	now := time.Now()
	claims := CustomClaims{
		UserID:   userID,
		Email:    email,
		FullName: fullName,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    s.issuer,
			Audience:  jwt.ClaimStrings{s.audience},
			ExpiresAt: jwt.NewNumericDate(now.Add(s.accessTTL)),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	return token.SignedString(s.privateKey)
}
