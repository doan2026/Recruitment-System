package kafka

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"video-service/internal/model"

	"github.com/google/uuid"
	"github.com/segmentio/kafka-go"
)

type Producer struct {
	writer *kafka.Writer
}

func NewProducer(brokers []string) *Producer {
	writer := &kafka.Writer{
		Addr:         kafka.TCP(brokers...),
		Balancer:     &kafka.LeastBytes{},
		WriteTimeout: 5 * time.Second,
	}

	return &Producer{writer: writer}
}

func (p *Producer) Close() error {
	return p.writer.Close()
}

func (p *Producer) PublishCallStarted(ctx context.Context, call *model.VideoCall, participantIDs []uuid.UUID, conversationID string) error {
	pIDs := make([]string, len(participantIDs))
	for i, id := range participantIDs {
		pIDs[i] = id.String()
	}

	event := model.KafkaEvent{
		EventID:      fmt.Sprintf("evt_%s", uuid.New().String()),
		EventType:    "video.call.started",
		AggregateKey: call.ID.String(),
		AggregateID:  call.ID.String(),
		CreatedAt:    time.Now().UTC(),
		Data: map[string]any{
			"call_id":         call.ID.String(),
			"room_name":       call.RoomName,
			"title":           call.Title,
			"host_id":         call.HostID.String(),
			"started_at":      call.StartedAt.Format(time.RFC3339),
			"participant_ids": pIDs,
			"conversation_id": conversationID,
		},
	}

	payload, err := json.Marshal(event)
	if err != nil {
		return err
	}

	msg := kafka.Message{
		Topic: "video.call.started",
		Key:   []byte(call.ID.String()),
		Value: payload,
	}

	err = p.writer.WriteMessages(ctx, msg)
	if err != nil {
		log.Printf("[Video Kafka Producer] Warning: failed to produce video.call.started: %v", err)
		return err
	}

	log.Printf("[Video Kafka Producer] Published video.call.started for call %s", call.ID)
	return nil
}

func (p *Producer) PublishCallEnded(ctx context.Context, call *model.VideoCall) error {
	event := model.KafkaEvent{
		EventID:      fmt.Sprintf("evt_%s", uuid.New().String()),
		EventType:    "video.call.ended",
		AggregateKey: call.ID.String(),
		AggregateID:  call.ID.String(),
		CreatedAt:    time.Now().UTC(),
		Data: map[string]any{
			"call_id":         call.ID.String(),
			"conversation_id": call.ConversationID,
			"host_id":         call.HostID.String(),
			"ended_at":        time.Now().UTC().Format(time.RFC3339),
		},
	}

	payload, err := json.Marshal(event)
	if err != nil {
		return err
	}

	msg := kafka.Message{
		Topic: "video.call.ended",
		Key:   []byte(call.ID.String()),
		Value: payload,
	}

	return p.writer.WriteMessages(ctx, msg)
}
