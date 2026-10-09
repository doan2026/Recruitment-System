package handler

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"

	"chat-service/internal/repository"
	"chat-service/internal/service"
)

// writeError writes a JSON error body safely (no string concatenation into JSON).
func writeError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// writeServiceError maps known domain errors to HTTP status codes and hides
// internal error details from clients.
func writeServiceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, service.ErrNotMember):
		writeError(w, err.Error(), http.StatusForbidden)
	case errors.Is(err, repository.ErrConversationNotFound):
		writeError(w, err.Error(), http.StatusNotFound)
	case errors.Is(err, service.ErrInvalidContent), errors.Is(err, service.ErrInvalidMembers):
		writeError(w, err.Error(), http.StatusBadRequest)
	case errors.Is(err, repository.ErrClientMessageIDConflict):
		writeError(w, err.Error(), http.StatusConflict)
	default:
		log.Printf("[Chat Handler] internal error: %v", err)
		writeError(w, "internal server error", http.StatusInternalServerError)
	}
}
