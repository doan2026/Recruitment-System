package model

import (
	"time"

	"github.com/google/uuid"
)

type VideoCall struct {
	ID        uuid.UUID  `json:"id"`
	RoomName  string     `json:"room_name"`
	HostID    uuid.UUID  `json:"host_id"`
	Title     string     `json:"title"`
	Status    string     `json:"status"` // waiting, active, ended
	StartedAt time.Time  `json:"started_at"`
	EndedAt   *time.Time `json:"ended_at,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
}

type VideoCallParticipant struct {
	CallID   uuid.UUID  `json:"call_id"`
	UserID   uuid.UUID  `json:"user_id"`
	JoinedAt time.Time  `json:"joined_at"`
	LeftAt   *time.Time `json:"left_at,omitempty"`
}

type KafkaEvent struct {
	EventID      string         `json:"event_id"`
	EventType    string         `json:"event_type"`
	AggregateKey string         `json:"aggregate_key"`
	AggregateID  string         `json:"aggregate_id"`
	CreatedAt    time.Time      `json:"created_at"`
	Data         map[string]any `json:"data"`
}
