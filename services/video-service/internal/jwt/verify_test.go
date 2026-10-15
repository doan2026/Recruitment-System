package jwt

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

func TestCanonicalAccessToken(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "public.pem")
	if err := os.WriteFile(path, pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der}), 0600); err != nil {
		t.Fatal(err)
	}
	kid := keyID(&key.PublicKey)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"keys": []any{map[string]any{
			"kty": "RSA", "use": "sig", "alg": "RS256", "kid": kid,
			"n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()),
			"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes()),
		}}})
	}))
	defer server.Close()
	for _, mode := range []string{"PEM", "JWKS"} {
		t.Run(mode, func(t *testing.T) {
			uri := ""
			if mode == "JWKS" {
				uri = server.URL
			}
			v, err := NewVerifier(uri, path, "https://auth.recruitment.local", "recruitment-api")
			if err != nil {
				t.Fatal(err)
			}
			cases := []struct {
				name   string
				change func(jwt.MapClaims, map[string]any)
				valid  bool
			}{
				{"valid_candidate", func(c jwt.MapClaims, h map[string]any) {}, true},
				{"valid_recruiter", func(c jwt.MapClaims, h map[string]any) { c["role"] = "RECRUITER" }, true},
				{"valid_admin", func(c jwt.MapClaims, h map[string]any) { c["role"] = "ADMIN" }, true},
				{"wrong_issuer", func(c jwt.MapClaims, h map[string]any) { c["iss"] = "https://other.test" }, false},
				{"missing_issuer", func(c jwt.MapClaims, h map[string]any) { delete(c, "iss") }, false},
				{"wrong_audience", func(c jwt.MapClaims, h map[string]any) { c["aud"] = "other-api" }, false},
				{"missing_audience", func(c jwt.MapClaims, h map[string]any) { delete(c, "aud") }, false},
				{"missing_subject", func(c jwt.MapClaims, h map[string]any) { delete(c, "sub") }, false},
				{"nil_subject", func(c jwt.MapClaims, h map[string]any) { c["sub"] = uuid.Nil.String() }, false},
				{"invalid_subject", func(c jwt.MapClaims, h map[string]any) { c["sub"] = "not-a-user" }, false},
				{"missing_role", func(c jwt.MapClaims, h map[string]any) { delete(c, "role") }, false},
				{"invalid_role", func(c jwt.MapClaims, h map[string]any) { c["role"] = "OWNER" }, false},
				{"missing_iat", func(c jwt.MapClaims, h map[string]any) { delete(c, "iat") }, false},
				{"future_iat", func(c jwt.MapClaims, h map[string]any) { c["iat"] = time.Now().Add(5 * time.Minute).Unix() }, false},
				{"missing_exp", func(c jwt.MapClaims, h map[string]any) { delete(c, "exp") }, false},
				{"expired", func(c jwt.MapClaims, h map[string]any) { c["exp"] = time.Now().Add(-time.Minute).Unix() }, false},
				{"invalid_lifetime", func(c jwt.MapClaims, h map[string]any) {
					c["iat"] = time.Now().Add(30 * time.Second).Unix()
					c["exp"] = time.Now().Add(10 * time.Second).Unix()
				}, false},
				{"missing_jti", func(c jwt.MapClaims, h map[string]any) { delete(c, "jti") }, false},
				{"invalid_jti", func(c jwt.MapClaims, h map[string]any) { c["jti"] = "invalid" }, false},
				{"missing_kid", func(c jwt.MapClaims, h map[string]any) { delete(h, "kid") }, false},
				{"wrong_kid", func(c jwt.MapClaims, h map[string]any) { h["kid"] = "other" }, false},
				{"wrong_type", func(c jwt.MapClaims, h map[string]any) { h["typ"] = "refresh" }, false},
			}
			for _, tc := range cases {
				t.Run(tc.name, func(t *testing.T) {
					uid := uuid.New()
					c := jwt.MapClaims{"sub": uid.String(), "iss": "https://auth.recruitment.local", "aud": "recruitment-api", "role": "CANDIDATE", "iat": time.Now().Unix(), "exp": time.Now().Add(time.Hour).Unix(), "jti": uuid.New().String()}
					token := jwt.NewWithClaims(jwt.SigningMethodRS256, c)
					token.Header["kid"] = kid
					tc.change(c, token.Header)
					signed, err := token.SignedString(key)
					if err != nil {
						t.Fatal(err)
					}
					claims, err := v.VerifyToken(signed)
					if !tc.valid {
						if err == nil {
							t.Fatal("invalid token accepted")
						}
						return
					}
					if err != nil {
						t.Fatal(err)
					}
					if claims.UserID != uid || claims.Subject != uid.String() {
						t.Fatal("subject was not mapped to user identity")
					}
				})
			}
			t.Run("wrong_signature", func(t *testing.T) {
				other, err := rsa.GenerateKey(rand.Reader, 2048)
				if err != nil {
					t.Fatal(err)
				}
				token := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{"sub": uuid.NewString()})
				token.Header["kid"] = kid
				signed, err := token.SignedString(other)
				if err != nil {
					t.Fatal(err)
				}
				if _, err := v.VerifyToken(signed); err == nil {
					t.Fatal("wrong signature accepted")
				}
			})
		})
	}
}
