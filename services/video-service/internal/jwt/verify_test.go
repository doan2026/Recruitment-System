package jwt

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"os"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

func generateTestKey() (*rsa.PrivateKey, string, error) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, "", err
	}

	publicKeyBytes, err := x509.MarshalPKIXPublicKey(&privateKey.PublicKey)
	if err != nil {
		return nil, "", err
	}

	pemBlock := &pem.Block{
		Type:  "PUBLIC KEY",
		Bytes: publicKeyBytes,
	}

	f, err := os.CreateTemp("", "jwt_public_key*.pem")
	if err != nil {
		return nil, "", err
	}
	defer f.Close()

	if err := pem.Encode(f, pemBlock); err != nil {
		return nil, "", err
	}

	return privateKey, f.Name(), nil
}

func TestVerifyToken(t *testing.T) {
	privateKey, pubKeyPath, err := generateTestKey()
	if err != nil {
		t.Fatalf("Failed to generate test key: %v", err)
	}
	defer os.Remove(pubKeyPath)

	verifier, err := NewVerifier("", pubKeyPath)
	if err != nil {
		t.Fatalf("Failed to create verifier: %v", err)
	}

	userID := uuid.New()
	claims := CustomClaims{
		UserID:   userID,
		Email:    "test@example.com",
		FullName: "Test User",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	tokenString, err := token.SignedString(privateKey)
	if err != nil {
		t.Fatalf("Failed to sign token: %v", err)
	}

	parsedClaims, err := verifier.VerifyToken(tokenString)
	if err != nil {
		t.Fatalf("Failed to verify token: %v", err)
	}

	if parsedClaims.UserID != userID {
		t.Errorf("Expected UserID %v, got %v", userID, parsedClaims.UserID)
	}
	if parsedClaims.Email != "test@example.com" {
		t.Errorf("Expected Email test@example.com, got %v", parsedClaims.Email)
	}
}
