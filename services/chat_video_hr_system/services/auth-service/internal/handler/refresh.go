package handler

import (
	"encoding/json"
	"net/http"
)

func (h *AuthHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	var rawRefreshToken string

	cookie, err := r.Cookie(RefreshCookieName)
	if err == nil && cookie.Value != "" {
		rawRefreshToken = cookie.Value
	} else {
		// Optional fallback: body
		var body struct {
			RefreshToken string `json:"refresh_token"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		rawRefreshToken = body.RefreshToken
	}

	if rawRefreshToken == "" {
		http.Error(w, `{"error":"refresh token not provided"}`, http.StatusUnauthorized)
		return
	}

	newAccessToken, err := h.authService.Refresh(r.Context(), rawRefreshToken)
	if err != nil {
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"access_token": newAccessToken,
	})
}
