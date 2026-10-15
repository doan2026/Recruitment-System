package middleware

import (
	"context"
	"log"
	"net/http"
	"strings"

	"notification-service/internal/jwt"

	"github.com/google/uuid"
)

type userContextKey string

const (
	UserIDKey    userContextKey = "user_id"
	UserEmailKey userContextKey = "user_email"
)

func Auth(verifier *jwt.Verifier) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var tokenString string

			authHeader := r.Header.Get("Authorization")
			if authHeader != "" {
				parts := strings.Split(authHeader, " ")
				if len(parts) == 2 && strings.ToLower(parts[0]) == "bearer" {
					tokenString = parts[1]
				}
			}

			// Fallback to query param for EventSource SSE
			if tokenString == "" && strings.HasSuffix(r.URL.Path, "/stream") {
				tokenString = r.URL.Query().Get("token")
			}

			if tokenString == "" {
				http.Error(w, `{"error":"authorization token required"}`, http.StatusUnauthorized)
				return
			}

			claims, err := verifier.VerifyToken(tokenString)
			if err != nil {
				log.Println("[Auth Middleware] Token verification failed: ", err.Error())
				http.Error(w, `{"error":"invalid or expired token"}`, http.StatusUnauthorized)
				return
			}

			ctx := context.WithValue(r.Context(), UserIDKey, claims.UserID)
			ctx = context.WithValue(ctx, UserEmailKey, claims.Email)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func GetUserID(ctx context.Context) (uuid.UUID, bool) {
	val, ok := ctx.Value(UserIDKey).(uuid.UUID)
	return val, ok
}
