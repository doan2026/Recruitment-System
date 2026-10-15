package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"chat-service/internal/middleware"
	"chat-service/internal/model"
	"chat-service/internal/service"
	"chat-service/internal/ws"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type MessageHandler struct {
	chatService *service.ChatService
	hub         *ws.Hub
}

func NewMessageHandler(chatService *service.ChatService, hub *ws.Hub) *MessageHandler {
	return &MessageHandler{chatService: chatService, hub: hub}
}

type SendMessageRequest struct {
	ClientMessageID uuid.UUID `json:"client_message_id"`
	Content         string    `json:"content"`
}

func (h *MessageHandler) SendMessage(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		writeError(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	convIDStr := chi.URLParam(r, "conversation_id")
	convID, err := uuid.Parse(convIDStr)
	if err != nil {
		writeError(w, "invalid conversation_id", http.StatusBadRequest)
		return
	}

	var req SendMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if req.ClientMessageID == uuid.Nil {
		req.ClientMessageID = uuid.New()
	}

	msg, memberIDs, err := h.chatService.SendMessage(r.Context(), convID, userID, req.ClientMessageID, req.Content)
	if err != nil {
		writeServiceError(w, err)
		return
	}

	// Also broadcast to active WS clients
	if h.hub != nil && len(memberIDs) > 0 {
		h.hub.BroadcastToUsers(memberIDs, map[string]any{
			"type":    "new_message",
			"message": msg,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(ApiEnvelope{Data: msg})
}

func (h *MessageHandler) ListMessages(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		writeError(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	convIDStr := chi.URLParam(r, "conversation_id")
	convID, err := uuid.Parse(convIDStr)
	if err != nil {
		writeError(w, "invalid conversation_id", http.StatusBadRequest)
		return
	}

	limit := 50
	if l, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && l > 0 && l <= 100 {
		limit = l
	}

	var before time.Time
	if cursor := r.URL.Query().Get("cursor"); cursor != "" {
		if t, err := time.Parse(time.RFC3339, cursor); err == nil {
			before = t
		}
	}

	messages, err := h.chatService.ListMessages(r.Context(), convID, userID, limit, before)
	if err != nil {
		writeServiceError(w, err)
		return
	}

	if messages == nil {
		messages = make([]*model.Message, 0)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(ApiEnvelope{Data: messages})
}

func (h *MessageHandler) MarkRead(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(ApiEnvelope{Data: map[string]bool{"success": true}})
}
