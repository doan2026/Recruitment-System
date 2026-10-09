package ws

import (
	"encoding/json"
	"errors"
	"log"
	"time"

	"chat-service/internal/jwt"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

type AuthFrame struct {
	Type  string `json:"type"`
	Token string `json:"token"`
}

func PerformAuthHandshake(conn *websocket.Conn, verifier *jwt.Verifier) (uuid.UUID, string, error) {
	// 5-second deadline for auth frame
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))

	messageType, p, err := conn.ReadMessage()
	if err != nil {
		return uuid.Nil, "", err
	}

	if messageType != websocket.TextMessage {
		return uuid.Nil, "", errors.New("expected text frame for auth")
	}

	var authFrame AuthFrame
	if err := json.Unmarshal(p, &authFrame); err != nil {
		return uuid.Nil, "", errors.New("malformed auth frame")
	}

	if authFrame.Type != "auth" || authFrame.Token == "" {
		return uuid.Nil, "", errors.New("first frame must be type 'auth' with non-empty token")
	}

	claims, err := verifier.VerifyToken(authFrame.Token)
	if err != nil {
		return uuid.Nil, "", err
	}

	// Reset read deadline to default for normal operation
	_ = conn.SetReadDeadline(time.Time{})

	// Acknowledge auth success
	ack := map[string]any{
		"type":      "auth_success",
		"user_id":   claims.UserID,
		"email":     claims.Email,
		"full_name": claims.FullName,
	}
	ackBytes, _ := json.Marshal(ack)
	if err := conn.WriteMessage(websocket.TextMessage, ackBytes); err != nil {
		log.Printf("[WS Handshake] Failed to send auth ack: %v", err)
	}

	return claims.UserID, claims.Email, nil
}
