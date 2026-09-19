package sse

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"notification-service/internal/middleware"
	"notification-service/internal/model"

	"github.com/google/uuid"
)

type Hub struct {
	sync.RWMutex
	clients map[uuid.UUID]map[chan *model.Notification]bool
}

func NewHub() *Hub {
	return &Hub{
		clients: make(map[uuid.UUID]map[chan *model.Notification]bool),
	}
}

func (h *Hub) Register(userID uuid.UUID, ch chan *model.Notification) {
	h.Lock()
	defer h.Unlock()

	if _, exists := h.clients[userID]; !exists {
		h.clients[userID] = make(map[chan *model.Notification]bool)
	}
	h.clients[userID][ch] = true
	log.Printf("[SSE Hub] User %s connected to SSE (total clients: %d)", userID, len(h.clients[userID]))
}

func (h *Hub) Unregister(userID uuid.UUID, ch chan *model.Notification) {
	h.Lock()
	defer h.Unlock()

	if userClients, exists := h.clients[userID]; exists {
		delete(userClients, ch)
		close(ch)
		if len(userClients) == 0 {
			delete(h.clients, userID)
		}
	}
	log.Printf("[SSE Hub] User %s disconnected from SSE", userID)
}

func (h *Hub) Dispatch(userID uuid.UUID, notif *model.Notification) {
	h.RLock()
	defer h.RUnlock()

	if userClients, exists := h.clients[userID]; exists {
		for ch := range userClients {
			select {
			case ch <- notif:
			default:
				log.Printf("[SSE Hub] Buffer full for user %s, skipping frame", userID)
			}
		}
	}
}

func (h *Hub) ServeStream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
		return
	}

	userID, ok := middleware.GetUserID(r.Context())
	if !ok {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	messageChan := make(chan *model.Notification, 64)
	h.Register(userID, messageChan)
	defer h.Unregister(userID, messageChan)

	// Send initial connected event
	_, _ = fmt.Fprintf(w, "event: connected\ndata: {\"status\":\"connected\",\"user_id\":\"%s\"}\n\n", userID)
	flusher.Flush()

	heartbeatTicker := time.NewTicker(15 * time.Second)
	defer heartbeatTicker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return

		case <-heartbeatTicker.C:
			_, _ = fmt.Fprint(w, ": ping\n\n")
			flusher.Flush()

		case notif, ok := <-messageChan:
			if !ok {
				return
			}
			dataBytes, err := json.Marshal(notif)
			if err != nil {
				continue
			}

			_, _ = fmt.Fprintf(w, "id: %s\nevent: notification\ndata: %s\n\n", notif.ID, string(dataBytes))
			flusher.Flush()
		}
	}
}
