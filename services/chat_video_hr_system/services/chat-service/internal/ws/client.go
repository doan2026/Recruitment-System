package ws

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
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

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
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
			c.Send <- []byte(`{"type":"pong"}`)

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
					c.Send <- b
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

			w, err := c.Conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			_, _ = w.Write(message)

			n := len(c.Send)
			for i := 0; i < n; i++ {
				_, _ = w.Write([]byte{'\n'})
				_, _ = w.Write(<-c.Send)
			}

			if err := w.Close(); err != nil {
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
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[WS Upgrade] Upgrade failed: %v", err)
		return
	}

	userID, email, err := PerformAuthHandshake(conn, verifier)
	if err != nil {
		log.Printf("[WS Handshake] Auth failed: %v. Closing connection.", err)
		_ = conn.WriteControl(
			websocket.CloseMessage,
			websocket.FormatCloseMessage(4001, "Authentication failed or timed out"),
			time.Now().Add(time.Second),
		)
		_ = conn.Close()
		return
	}

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
