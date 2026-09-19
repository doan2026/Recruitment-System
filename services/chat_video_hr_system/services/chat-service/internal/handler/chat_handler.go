package handler

import (
	"encoding/json"
	"net/http"

	"chat-service/internal/middleware"
	"chat-service/internal/model"
	"chat-service/internal/service"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type ChatHandler struct {
	chatService *service.ChatService
}

func NewChatHandler(chatService *service.ChatService) *ChatHandler {
	return &ChatHandler{chatService: chatService}
}

type CreateConversationRequest struct {
	Title     string      `json:"title"`
	MemberIDs []uuid.UUID `json:"member_ids"`
	IsGroup   bool        `json:"is_group"`
}

func (h *ChatHandler) CreateConversation(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	var req CreateConversationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	conv, err := h.chatService.CreateConversation(r.Context(), userID, req.Title, req.MemberIDs, req.IsGroup)
	if err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(conv)
}

func (h *ChatHandler) ListConversations(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	convs, err := h.chatService.ListUserConversations(r.Context(), userID)
	if err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}

	if convs == nil {
		convs = make([]*model.Conversation, 0)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(convs)
}

func (h *ChatHandler) GetConversation(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	convIDStr := chi.URLParam(r, "conversation_id")
	convID, err := uuid.Parse(convIDStr)
	if err != nil {
		http.Error(w, `{"error":"invalid conversation_id"}`, http.StatusBadRequest)
		return
	}

	conv, err := h.chatService.GetConversation(r.Context(), convID, userID)
	if err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(conv)
}
