package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"notification-service/internal/cursor"
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
	cursorSvc    *cursor.CursorService
}

func NewNotificationHandler(notifService *service.NotificationService, sseHub *sse.Hub, cursorSvc *cursor.CursorService) *NotificationHandler {
	return &NotificationHandler{
		notifService: notifService,
		sseHub:       sseHub,
		cursorSvc:    cursorSvc,
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

	cursorStr := r.URL.Query().Get("cursor")
	var notifType *string
	if t := r.URL.Query().Get("type"); t != "" {
		notifType = &t
	}

	decodedCursor, err := h.cursorSvc.Decode(cursorStr, userID, notifType)
	if err != nil {
		http.Error(w, `{"error":"invalid cursor"}`, http.StatusBadRequest)
		return
	}

	var cursorCreatedAt time.Time
	var cursorID string
	if decodedCursor != nil {
		cursorCreatedAt = decodedCursor.CreatedAt
		cursorID = decodedCursor.ID
	}

	notifs, err := h.notifService.List(r.Context(), userID, notifType, limit, cursorCreatedAt, cursorID)
	if err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}

	if notifs == nil {
		notifs = make([]*model.Notification, 0)
	}

	var nextCursor *string
	if len(notifs) > limit {
		// we have a next page
		lastItem := notifs[limit-1]
		encoded := h.cursorSvc.Encode(userID, notifType, cursor.NotificationCursor{
			CreatedAt: lastItem.CreatedAt,
			ID:        lastItem.ID.String(),
		})
		nextCursor = &encoded
		notifs = notifs[:limit]
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"data": notifs,
		"meta": map[string]any{
			"nextCursor": nextCursor,
			"limit":      limit,
		},
	})
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
	_ = json.NewEncoder(w).Encode(map[string]any{
		"data": map[string]int{"unread_count": count},
	})
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
	_ = json.NewEncoder(w).Encode(map[string]any{
		"data": map[string]bool{"success": true},
	})
}

func (h *NotificationHandler) MarkAllRead(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	if err := h.notifService.MarkAllAsRead(r.Context(), userID); err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"data": map[string]bool{"success": true},
	})
}

func (h *NotificationHandler) RegisterPushToken(w http.ResponseWriter, r *http.Request) {
	// Optional push token registration endpoint
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"data": map[string]string{"message": "push token registered (stub)"},
	})
}

func (h *NotificationHandler) OnlineStatus(w http.ResponseWriter, r *http.Request) {
	userIDStr := r.URL.Query().Get("user_id")
	if userIDStr == "" {
		http.Error(w, `{"error":"user_id is required"}`, http.StatusBadRequest)
		return
	}

	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		http.Error(w, `{"error":"invalid user_id format"}`, http.StatusBadRequest)
		return
	}

	isOnline := h.sseHub.IsUserConnected(userID)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"data": map[string]bool{"online": isOnline},
	})
}
