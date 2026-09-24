package model

import (
	"time"

	"github.com/google/uuid"
)

type Conversation struct {
	ID        uuid.UUID   `json:"id"`
	Title     string      `json:"title"`
	IsGroup   bool        `json:"is_group"`
	Members   []uuid.UUID `json:"members,omitempty"`
	CreatedAt time.Time   `json:"created_at"`
	UpdatedAt time.Time   `json:"updated_at"`
}

type ConversationMember struct {
	ConversationID uuid.UUID `json:"conversation_id"`
	UserID         uuid.UUID `json:"user_id"`
	Role           string    `json:"role"`
	JoinedAt       time.Time `json:"joined_at"`
}

type Message struct {
	ID              uuid.UUID `json:"id"`
	ConversationID  uuid.UUID `json:"conversation_id"`
	SenderID        uuid.UUID `json:"sender_id"`
	ClientMessageID uuid.UUID `json:"client_message_id"`
	Content         string    `json:"content"`
	CreatedAt       time.Time `json:"created_at"`
}

type KafkaEvent struct {
	EventID      string         `json:"event_id"`
	EventType    string         `json:"event_type"`
	AggregateKey string         `json:"aggregate_key"`
	AggregateID  string         `json:"aggregate_id"`
	CreatedAt    time.Time      `json:"created_at"`
	Data         map[string]any `json:"data"`
}
