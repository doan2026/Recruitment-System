package handler

import (
	"encoding/json"
	"net/http"

	"video-service/internal/middleware"
	"video-service/internal/model"
	"video-service/internal/service"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type VideoHandler struct {
	videoService *service.VideoService
}

func NewVideoHandler(videoService *service.VideoService) *VideoHandler {
	return &VideoHandler{videoService: videoService}
}

type CreateCallRequest struct {
	Title          string      `json:"title"`
	ParticipantIDs []uuid.UUID `json:"participant_ids"`
}

func (h *VideoHandler) CreateCall(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	var req CreateCallRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	call, err := h.videoService.CreateCall(r.Context(), userID, req.Title, req.ParticipantIDs)
	if err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(call)
}

func (h *VideoHandler) JoinCall(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	userName := middleware.GetUserName(r.Context())

	callIDStr := chi.URLParam(r, "call_id")
	callID, err := uuid.Parse(callIDStr)
	if err != nil {
		http.Error(w, `{"error":"invalid call_id"}`, http.StatusBadRequest)
		return
	}

	result, err := h.videoService.JoinCall(r.Context(), callID, userID, userName)
	if err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(result)
}

func (h *VideoHandler) EndCall(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	callIDStr := chi.URLParam(r, "call_id")
	callID, err := uuid.Parse(callIDStr)
	if err != nil {
		http.Error(w, `{"error":"invalid call_id"}`, http.StatusBadRequest)
		return
	}

	if err := h.videoService.EndCall(r.Context(), callID, userID); err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

func (h *VideoHandler) ListCalls(w http.ResponseWriter, r *http.Request) {
	calls, err := h.videoService.ListCalls(r.Context())
	if err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}

	if calls == nil {
		calls = make([]*model.VideoCall, 0)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(calls)
}
