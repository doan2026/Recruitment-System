package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"auth-service/internal/service"
)

type RegisterRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	FullName string `json:"full_name"`
}

type AuthHandler struct {
	authService *service.AuthService
	refreshTTL  time.Duration
}

func NewAuthHandler(authService *service.AuthService, refreshTTL time.Duration) *AuthHandler {
	return &AuthHandler{
		authService: authService,
		refreshTTL:  refreshTTL,
	}
}

func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var req RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	result, err := h.authService.Register(r.Context(), req.Email, req.Password, req.FullName)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	SetRefreshTokenCookie(w, r, result.RefreshToken, h.refreshTTL)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(result)
}
