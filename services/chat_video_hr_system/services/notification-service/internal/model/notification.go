package model

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

type Notification struct {
	ID        uuid.UUID       `json:"id"`
	UserID    uuid.UUID       `json:"user_id"`
	Type      string          `json:"type"`
	Title     string          `json:"title"`
	Body      string          `json:"body"`
	Metadata  json.RawMessage `json:"metadata"`
	IsRead    bool            `json:"is_read"`
	CreatedAt time.Time       `json:"created_at"`
}

type ProcessedEvent struct {
	EventID     string    `json:"event_id"`
	EventType   string    `json:"event_type"`
	ProcessedAt time.Time `json:"processed_at"`
}

type KafkaEvent struct {
	EventID      string         `json:"event_id"`
	EventType    string         `json:"event_type"`
	AggregateKey string         `json:"aggregate_key"`
	AggregateID  string         `json:"aggregate_id"`
	CreatedAt    time.Time      `json:"created_at"`
	Data         map[string]any `json:"data"`
}
