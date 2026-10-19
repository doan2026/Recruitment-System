package ws

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"chat-service/internal/jwt"
	"chat-service/internal/service"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 65536
)

// allowedOrigins is the WebSocket origin allowlist. Empty means only
// same-origin / non-browser clients (no Origin header) are accepted.
var allowedOrigins = map[string]bool{}

// SetAllowedOrigins configures which browser origins may open a WebSocket.
func SetAllowedOrigins(origins []string) {
	m := make(map[string]bool, len(origins))
	for _, o := range origins {
		if o = strings.TrimSpace(o); o != "" {
			m[o] = true
		}
	}
	allowedOrigins = m
}

func checkOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true // non-browser client
	}
	if allowedOrigins[origin] {
		return true
	}
	if isLoopbackOrigin(origin) {
		return true
	}
	log.Printf("[WS Upgrade] Origin not allowed: %s", origin)
	return false
}

// isLoopbackOrigin returns true when the origin URL points to a loopback
// address (localhost, 127.0.0.1 or [::1]). This is used as a dev-mode
// convenience so that local browser windows can open WebSocket connections
// without needing an explicit ALLOWED_ORIGINS entry.
func isLoopbackOrigin(origin string) bool {
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	h := strings.ToLower(u.Hostname())
	return h == "localhost" || h == "127.0.0.1" || h == "::1"
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin:     checkOrigin,
}

type ClientMessage struct {
	Type            string    `json:"type"`
	ConversationID  uuid.UUID `json:"conversation_id"`
	ClientMessageID uuid.UUID `json:"client_message_id"`
	Content         string    `json:"content"`
}

type Client struct {
	Hub         *Hub
	Conn        *websocket.Conn
	Send        chan []byte
	UserID      uuid.UUID
	Email       string
	chatService *service.ChatService
}

func (c *Client) ReadPump() {
	defer func() {
		c.Hub.Unregister(c)
		_ = c.Conn.Close()
	}()

	c.Conn.SetReadLimit(maxMessageSize)
	_ = c.Conn.SetReadDeadline(time.Now().Add(pongWait))
	c.Conn.SetPongHandler(func(string) error {
		_ = c.Conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, message, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("[WS Client] Read error: %v", err)
			}
			break
		}

		var in ClientMessage
		if err := json.Unmarshal(message, &in); err != nil {
			log.Printf("[WS Client] Malformed json from user %s: %v", c.UserID, err)
			continue
		}

		switch in.Type {
		case "ping":
			select {
			case c.Send <- []byte(`{"type":"pong"}`):
			default:
			}

		case "chat_message":
			if in.ConversationID == uuid.Nil || in.Content == "" {
				continue
			}
			if in.ClientMessageID == uuid.Nil {
				in.ClientMessageID = uuid.New()
			}

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			savedMsg, memberIDs, err := c.chatService.SendMessage(ctx, in.ConversationID, c.UserID, in.ClientMessageID, in.Content)
			cancel()

			if err != nil {
				log.Printf("[WS Client] SendMessage error for user %s: %v", c.UserID, err)
				errResp := map[string]any{
					"type":  "error",
					"error": err.Error(),
				}
				if b, e := json.Marshal(errResp); e == nil {
					select {
					case c.Send <- b:
					default:
					}
				}
				continue
			}

			// Broadcast saved message to all conversation members
			broadcastPayload := map[string]any{
				"type":    "new_message",
				"message": savedMsg,
			}
			c.Hub.BroadcastToUsers(memberIDs, broadcastPayload)
		}
	}
}

func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		_ = c.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.Send:
			_ = c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				_ = c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			// One JSON document per frame so clients can JSON.parse each frame.
			if err := c.Conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}

		case <-ticker.C:
			_ = c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func ServeWS(hub *Hub, chatSvc *service.ChatService, verifier *jwt.Verifier, w http.ResponseWriter, r *http.Request) {
	var tokenStr string
	if authHeader := r.Header.Get("Authorization"); strings.HasPrefix(authHeader, "Bearer ") {
		tokenStr = strings.TrimPrefix(authHeader, "Bearer ")
	} else if cookie, err := r.Cookie("careerhub_token"); err == nil {
		tokenStr = cookie.Value
	} else if tokenParam := r.URL.Query().Get("token"); tokenParam != "" {
		tokenStr = tokenParam
	}

	if tokenStr == "" {
		log.Printf("[WS Upgrade] No authentication token found")
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	claims, err := verifier.VerifyToken(tokenStr)
	if err != nil {
		log.Printf("[WS Upgrade] Invalid token: %v", err)
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[WS Upgrade] Upgrade failed: %v", err)
		return
	}

	userID := claims.UserID
	email := claims.Email


	client := &Client{
		Hub:         hub,
		Conn:        conn,
		Send:        make(chan []byte, 256),
		UserID:      userID,
		Email:       email,
		chatService: chatSvc,
	}

	hub.Register(client)

	go client.WritePump()
	go client.ReadPump()
}
