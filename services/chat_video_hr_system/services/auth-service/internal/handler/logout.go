package handler

import (
	"encoding/json"
	"net/http"
)

func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	var rawRefreshToken string

	cookie, err := r.Cookie(RefreshCookieName)
	if err == nil && cookie.Value != "" {
		rawRefreshToken = cookie.Value
	} else {
		var body struct {
			RefreshToken string `json:"refresh_token"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		rawRefreshToken = body.RefreshToken
	}

	if rawRefreshToken != "" {
		_ = h.authService.Logout(r.Context(), rawRefreshToken)
	}

	ClearRefreshTokenCookie(w)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"message": "logged out successfully",
	})
}
