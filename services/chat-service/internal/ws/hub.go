package ws

import (
	"encoding/json"
	"log"
	"sync"

	"github.com/google/uuid"
)

type Hub struct {
	sync.RWMutex
	// Map userID -> set of active client connections
	clients map[uuid.UUID]map[*Client]bool
}

func NewHub() *Hub {
	return &Hub{
		clients: make(map[uuid.UUID]map[*Client]bool),
	}
}

func (h *Hub) Register(c *Client) {
	h.Lock()
	defer h.Unlock()

	if _, exists := h.clients[c.UserID]; !exists {
		h.clients[c.UserID] = make(map[*Client]bool)
	}
	h.clients[c.UserID][c] = true
	log.Printf("[WS Hub] User %s connected (active connections: %d)", c.UserID, len(h.clients[c.UserID]))
}

func (h *Hub) Unregister(c *Client) {
	h.Lock()
	defer h.Unlock()

	if userConns, exists := h.clients[c.UserID]; exists {
		if _, ok := userConns[c]; ok {
			delete(userConns, c)
			close(c.Send)
		}
		if len(userConns) == 0 {
			delete(h.clients, c.UserID)
		}
	}
	log.Printf("[WS Hub] User %s disconnected", c.UserID)
}

func (h *Hub) BroadcastToUsers(userIDs []uuid.UUID, payload any) {
	data, err := json.Marshal(payload)
	if err != nil {
		log.Printf("[WS Hub] Error marshaling broadcast: %v", err)
		return
	}

	h.RLock()
	defer h.RUnlock()

	for _, uid := range userIDs {
		if conns, exists := h.clients[uid]; exists {
			for client := range conns {
				select {
				case client.Send <- data:
				default:
					log.Printf("[WS Hub] Dropping message to buffer-full client of user %s", uid)
				}
			}
		}
	}
}
