package kafka

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"notification-service/internal/model"
	"notification-service/internal/repository"
	"notification-service/internal/sse"

	"github.com/google/uuid"
	"github.com/segmentio/kafka-go"
)

type Consumer struct {
	reader       *kafka.Reader
	dlqWriter    *kafka.Writer
	notifRepo    *repository.NotificationRepository
	eventRepo    *repository.ProcessedEventRepository
	sseHub       *sse.Hub
	kafkaBrokers []string
}

func NewConsumer(
	brokers []string,
	groupID string,
	topics []string,
	notifRepo *repository.NotificationRepository,
	eventRepo *repository.ProcessedEventRepository,
	sseHub *sse.Hub,
) *Consumer {
	reader := kafka.NewReader(kafka.ReaderConfig{
		Brokers:        brokers,
		GroupID:        groupID,
		GroupTopics:    topics,
		MinBytes:       10e3, // 10KB
		MaxBytes:       10e6, // 10MB
		CommitInterval: time.Second,
		StartOffset:    kafka.FirstOffset,
	})

	dlqWriter := &kafka.Writer{
		Addr:         kafka.TCP(brokers...),
		Balancer:     &kafka.LeastBytes{},
		WriteTimeout: 5 * time.Second,
	}

	return &Consumer{
		reader:       reader,
		dlqWriter:    dlqWriter,
		notifRepo:    notifRepo,
		eventRepo:    eventRepo,
		sseHub:       sseHub,
		kafkaBrokers: brokers,
	}
}

func (c *Consumer) Start(ctx context.Context) {
	log.Println("[Kafka Consumer] Starting notification event consumer loop...")
	for {
		select {
		case <-ctx.Done():
			log.Println("[Kafka Consumer] Stopping consumer...")
			_ = c.reader.Close()
			_ = c.dlqWriter.Close()
			return
		default:
			msg, err := c.reader.FetchMessage(ctx)
			if err != nil {
				if ctx.Err() != nil {
					return
				}
				log.Printf("[Kafka Consumer] Error fetching message: %v. Retrying...", err)
				time.Sleep(time.Second)
				continue
			}

			if err := c.handleMessageWithRetry(ctx, msg, 3); err != nil {
				log.Printf("[Kafka Consumer] Failed to process message %s after 3 retries: %v. Forwarding to DLQ.", string(msg.Key), err)
				c.sendToDLQ(ctx, msg)
			}

			if err := c.reader.CommitMessages(ctx, msg); err != nil {
				log.Printf("[Kafka Consumer] Failed to commit message offset: %v", err)
			}
		}
	}
}

func (c *Consumer) handleMessageWithRetry(ctx context.Context, msg kafka.Message, maxRetries int) error {
	var lastErr error
	for attempt := 1; attempt <= maxRetries; attempt++ {
		err := c.processMessage(ctx, msg)
		if err == nil {
			return nil
		}
		lastErr = err
		log.Printf("[Kafka Consumer] Attempt %d/%d failed: %v", attempt, maxRetries, err)
		time.Sleep(time.Duration(attempt) * 500 * time.Millisecond)
	}
	return lastErr
}

func (c *Consumer) processMessage(ctx context.Context, msg kafka.Message) error {
	var event model.KafkaEvent
	if err := json.Unmarshal(msg.Value, &event); err != nil {
		return fmt.Errorf("malformed event json: %w", err)
	}

	if event.EventID == "" {
		return nil
	}

	// Idempotency check
	alreadyProcessed, err := c.eventRepo.IsProcessed(ctx, event.EventID)
	if err != nil {
		return err
	}
	if alreadyProcessed {
		log.Printf("[Kafka Consumer] Event %s already processed (idempotent skip)", event.EventID)
		return nil
	}

	switch event.EventType {
	case "message.created":
		err = c.handleMessageCreated(ctx, event)
	case "video.call.started":
		err = c.handleVideoCallStarted(ctx, event)
	default:
		log.Printf("[Kafka Consumer] Unknown event type: %s", event.EventType)
	}

	if err != nil {
		return err
	}

	// Mark event as processed
	return c.eventRepo.MarkProcessed(ctx, event.EventID, event.EventType)
}

func (c *Consumer) handleMessageCreated(ctx context.Context, event model.KafkaEvent) error {
	data := event.Data
	senderIDStr, _ := data["sender_id"].(string)
	content, _ := data["content"].(string)
	convIDStr, _ := data["conversation_id"].(string)

	rawMembers, ok := data["member_ids"].([]any)
	if !ok {
		return nil
	}

	senderID, _ := uuid.Parse(senderIDStr)

	metadataJSON, _ := json.Marshal(map[string]string{
		"conversation_id": convIDStr,
		"sender_id":       senderIDStr,
	})

	for _, m := range rawMembers {
		mStr, ok := m.(string)
		if !ok {
			continue
		}
		recipientID, err := uuid.Parse(mStr)
		if err != nil || recipientID == senderID {
			continue // Do not notify the sender
		}

		bodyPreview := content
		if len(bodyPreview) > 100 {
			bodyPreview = bodyPreview[:97] + "..."
		}

		notif := &model.Notification{
			ID:        uuid.New(),
			UserID:    recipientID,
			Type:      "new_message",
			Title:     "Tin nhắn mới",
			Body:      bodyPreview,
			Metadata:  metadataJSON,
			IsRead:    false,
			CreatedAt: time.Now(),
		}

		if err := c.notifRepo.Create(ctx, notif); err != nil {
			log.Printf("[Kafka Consumer] Error saving notification for user %s: %v", recipientID, err)
			return err
		}

		// Dispatch via SSE
		c.sseHub.Dispatch(recipientID, notif)
	}

	return nil
}

func (c *Consumer) handleVideoCallStarted(ctx context.Context, event model.KafkaEvent) error {
	data := event.Data
	hostIDStr, _ := data["host_id"].(string)
	roomName, _ := data["room_name"].(string)
	callIDStr, _ := data["call_id"].(string)

	hostID, _ := uuid.Parse(hostIDStr)
	metadataJSON, _ := json.Marshal(map[string]string{
		"call_id":   callIDStr,
		"room_name": roomName,
	})

	rawMembers, ok := data["participant_ids"].([]any)
	if !ok {
		return nil
	}

	for _, m := range rawMembers {
		mStr, ok := m.(string)
		if !ok {
			continue
		}
		pID, err := uuid.Parse(mStr)
		if err != nil || pID == hostID {
			continue
		}

		notif := &model.Notification{
			ID:        uuid.New(),
			UserID:    pID,
			Type:      "video_call",
			Title:     "Cuộc gọi phỏng vấn mới",
			Body:      fmt.Sprintf("Bạn có lời mời tham gia phỏng vấn phòng '%s'", roomName),
			Metadata:  metadataJSON,
			IsRead:    false,
			CreatedAt: time.Now(),
		}

		if err := c.notifRepo.Create(ctx, notif); err != nil {
			return err
		}
		c.sseHub.Dispatch(pID, notif)
	}

	return nil
}

func (c *Consumer) sendToDLQ(ctx context.Context, msg kafka.Message) {
	dlqTopic := fmt.Sprintf("%s.dlq", msg.Topic)
	err := c.dlqWriter.WriteMessages(ctx, kafka.Message{
		Topic: dlqTopic,
		Key:   msg.Key,
		Value: msg.Value,
		Headers: append(msg.Headers, kafka.Header{
			Key:   "dlq_timestamp",
			Value: []byte(time.Now().Format(time.RFC3339)),
		}),
	})
	if err != nil {
		log.Printf("[Kafka DLQ] Error sending message to DLQ %s: %v", dlqTopic, err)
	} else {
		log.Printf("[Kafka DLQ] Successfully moved failed message to %s", dlqTopic)
	}
}
