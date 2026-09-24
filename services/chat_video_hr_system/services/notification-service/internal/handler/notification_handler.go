package handler

import (
	"encoding/json"
	"net/http"
	"strconv"

	"notification-service/internal/middleware"
	"notification-service/internal/model"
	"notification-service/internal/service"
	"notification-service/internal/sse"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type NotificationHandler struct {
	notifService *service.NotificationService
	sseHub       *sse.Hub
}

func NewNotificationHandler(notifService *service.NotificationService, sseHub *sse.Hub) *NotificationHandler {
	return &NotificationHandler{
		notifService: notifService,
		sseHub:       sseHub,
	}
}

func (h *NotificationHandler) Stream(w http.ResponseWriter, r *http.Request) {
	h.sseHub.ServeStream(w, r)
}

func (h *NotificationHandler) List(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	limit := 50
	if l, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && l > 0 && l <= 100 {
		limit = l
	}

	offset := 0
	if o, err := strconv.Atoi(r.URL.Query().Get("offset")); err == nil && o >= 0 {
		offset = o
	}

	notifs, err := h.notifService.List(r.Context(), userID, limit, offset)
	if err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}

	if notifs == nil {
		notifs = make([]*model.Notification, 0)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(notifs)
}

func (h *NotificationHandler) UnreadCount(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	count, err := h.notifService.GetUnreadCount(r.Context(), userID)
	if err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]int{"unread_count": count})
}

func (h *NotificationHandler) MarkRead(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	notifIDStr := chi.URLParam(r, "notification_id")
	notifID, err := uuid.Parse(notifIDStr)
	if err != nil {
		http.Error(w, `{"error":"invalid notification_id"}`, http.StatusBadRequest)
		return
	}

	if err := h.notifService.MarkAsRead(r.Context(), notifID, userID); err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

func (h *NotificationHandler) RegisterPushToken(w http.ResponseWriter, r *http.Request) {
	// Optional push token registration endpoint
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"message": "push token registered (stub)"})
}
