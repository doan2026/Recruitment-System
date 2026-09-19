package kafka

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"chat-service/internal/model"

	"github.com/google/uuid"
	"github.com/segmentio/kafka-go"
)

type Producer struct {
	writer *kafka.Writer
}

func NewProducer(brokers []string) *Producer {
	writer := &kafka.Writer{
		Addr:         kafka.TCP(brokers...),
		Topic:        "message.created",
		Balancer:     &kafka.LeastBytes{},
		WriteTimeout: 5 * time.Second,
		RequiredAcks: kafka.RequireOne,
	}

	return &Producer{writer: writer}
}

func (p *Producer) Close() error {
	return p.writer.Close()
}

func (p *Producer) PublishMessageCreated(ctx context.Context, msg *model.Message, memberIDs []uuid.UUID) error {
	memberStrs := make([]string, len(memberIDs))
	for i, m := range memberIDs {
		memberStrs[i] = m.String()
	}

	event := model.KafkaEvent{
		EventID:      fmt.Sprintf("evt_%s", uuid.New().String()),
		EventType:    "message.created",
		AggregateKey: msg.ID.String(),
		AggregateID:  msg.ConversationID.String(),
		CreatedAt:    time.Now().UTC(),
		Data: map[string]any{
			"message_id":        msg.ID.String(),
			"conversation_id":   msg.ConversationID.String(),
			"sender_id":         msg.SenderID.String(),
			"client_message_id": msg.ClientMessageID.String(),
			"content":           msg.Content,
			"created_at":        msg.CreatedAt.Format(time.RFC3339),
			"member_ids":        memberStrs,
		},
	}

	payload, err := json.Marshal(event)
	if err != nil {
		return err
	}

	kafkaMsg := kafka.Message{
		Topic: "message.created",
		Key:   []byte(msg.ConversationID.String()),
		Value: payload,
		Headers: []kafka.Header{
			{Key: "event_type", Value: []byte("message.created")},
		},
	}

	err = p.writer.WriteMessages(ctx, kafkaMsg)
	if err != nil {
		log.Printf("[Kafka Producer] Warning: failed to produce message.created event: %v", err)
		return err
	}

	log.Printf("[Kafka Producer] Published message.created event %s for conversation %s", event.EventID, msg.ConversationID)
	return nil
}
