package middleware

import (
	"context"
	"net/http"
	"strings"

	"chat-service/internal/jwt"

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

			// Fallback to query param for WebSocket
			if tokenString == "" && strings.HasPrefix(r.URL.Path, "/ws/chat") {
				tokenString = r.URL.Query().Get("token")
			}

			// Fallback to cookie
			if tokenString == "" {
				if cookie, err := r.Cookie("careerhub_token"); err == nil {
					tokenString = cookie.Value
				}
			}

			if tokenString == "" {
				http.Error(w, `{"error":"authorization token required"}`, http.StatusUnauthorized)
				return
			}

			claims, err := verifier.VerifyToken(tokenString)
			if err != nil {
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
