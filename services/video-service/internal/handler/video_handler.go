package handler

import (
	"encoding/json"
	"net/http"

	"video-service/internal/middleware"
	"video-service/internal/model"
	"video-service/internal/repository"
	"video-service/internal/service"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

func sendError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

type VideoHandler struct {
	videoService *service.VideoService
}

func NewVideoHandler(videoService *service.VideoService) *VideoHandler {
	return &VideoHandler{videoService: videoService}
}

type CreateCallRequest struct {
	Title          string      `json:"title"`
	ConversationID string      `json:"conversation_id"`
	ParticipantIDs []uuid.UUID `json:"participant_ids"`
}

func (h *VideoHandler) CreateCall(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		sendError(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var req CreateCallRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	call, err := h.videoService.CreateCall(r.Context(), userID, req.Title, req.ParticipantIDs, req.ConversationID)
	if err != nil {
		sendError(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]any{"data": call})
}

func (h *VideoHandler) JoinCall(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		sendError(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	userName := middleware.GetUserName(r.Context())

	callIDStr := chi.URLParam(r, "call_id")
	callID, err := uuid.Parse(callIDStr)
	if err != nil {
		sendError(w, "invalid call_id", http.StatusBadRequest)
		return
	}

	result, err := h.videoService.JoinCall(r.Context(), callID, userID, userName)
	if err != nil {
		if err == repository.ErrCallNotFound {
			sendError(w, err.Error(), http.StatusNotFound)
		} else {
			sendError(w, err.Error(), http.StatusBadRequest)
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"data": result})
}

func (h *VideoHandler) EndCall(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		sendError(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	callIDStr := chi.URLParam(r, "call_id")
	callID, err := uuid.Parse(callIDStr)
	if err != nil {
		sendError(w, "invalid call_id", http.StatusBadRequest)
		return
	}

	if err := h.videoService.EndCall(r.Context(), callID, userID); err != nil {
		if err == repository.ErrCallNotFound {
			sendError(w, err.Error(), http.StatusNotFound)
		} else if err.Error() == "only host can end the call" {
			sendError(w, err.Error(), http.StatusForbidden)
		} else {
			sendError(w, err.Error(), http.StatusBadRequest)
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]bool{"success": true}})
}

func (h *VideoHandler) RejectCall(w http.ResponseWriter, r *http.Request) {
	_, ok := middleware.GetUserID(r.Context())
	if !ok {
		sendError(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	callIDStr := chi.URLParam(r, "call_id")
	callID, err := uuid.Parse(callIDStr)
	if err != nil {
		sendError(w, "invalid call_id", http.StatusBadRequest)
		return
	}

	if err := h.videoService.RejectCall(r.Context(), callID); err != nil {
		if err == repository.ErrCallNotFound {
			sendError(w, err.Error(), http.StatusNotFound)
		} else {
			sendError(w, err.Error(), http.StatusBadRequest)
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]bool{"success": true}})
}

func (h *VideoHandler) ListCalls(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		sendError(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	calls, err := h.videoService.ListCalls(r.Context(), userID)
	if err != nil {
		sendError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if calls == nil {
		calls = make([]*model.VideoCall, 0)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"data": calls})
}
