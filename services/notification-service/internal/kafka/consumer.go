package kafka

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
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
		MinBytes:       1,    // Changed from 10KB to 1 byte to prevent delay
		MaxBytes:       10e6, // 10MB
		MaxWait:        50 * time.Millisecond, // Max wait time for a batch
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
				if dlqErr := c.sendToDLQ(ctx, msg); dlqErr != nil {
					log.Printf("[Kafka Consumer] DLQ write failed, not committing offset")
					time.Sleep(5 * time.Second)
					continue
				}
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
	topic := msg.Topic

	switch topic {
	case "application-events":
		return c.handleApplicationEvent(ctx, msg)
	case "interview-events":
		return c.handleInterviewEvent(ctx, msg)
	default:
		// Legacy: parse as generic KafkaEvent for chat/video topics
		return c.processGenericMessage(ctx, msg)
	}
}

// processGenericMessage handles the existing message.created and video.call.started events.
func (c *Consumer) processGenericMessage(ctx context.Context, msg kafka.Message) error {
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
	case "video.call.ended":
		err = c.handleVideoCallEnded(ctx, event)
	default:
		log.Printf("[Kafka Consumer] Unknown event type: %s", event.EventType)
	}

	if err != nil {
		return err
	}

	// Mark event as processed
	return c.eventRepo.MarkProcessed(ctx, event.EventID, event.EventType)
}

// handleApplicationEvent processes events from the application-events topic.
func (c *Consumer) handleApplicationEvent(ctx context.Context, msg kafka.Message) error {
	var event model.ApplicationEvent
	if err := json.Unmarshal(msg.Value, &event); err != nil {
		return fmt.Errorf("malformed application event json: %w", err)
	}

	if event.EventID == "" {
		return nil
	}

	// Idempotency check with hash
	payloadHash := hashSHA256(msg.Value)
	alreadyProcessed, err := c.eventRepo.IsProcessed(ctx, event.EventID)
	if err != nil {
		return err
	}
	if alreadyProcessed {
		log.Printf("[Kafka Consumer] Application event %s already processed (idempotent skip)", event.EventID)
		return nil
	}

	draft := mapApplicationEvent(event)
	if draft != nil {
		notif := &model.Notification{
			ID:            uuid.New(),
			UserID:        draft.UserID,
			Type:          draft.Type,
			Title:         draft.Title,
			Body:          draft.Body,
			Metadata:      draft.Metadata,
			IsRead:        false,
			CreatedAt:     time.Now(),
			SourceTopic:   strPtr("application-events"),
			SourceEventID: strPtr(event.EventID),
		}

		if err := c.notifRepo.Create(ctx, notif); err != nil {
			log.Printf("[Kafka Consumer] Error saving application notification: %v", err)
			return err
		}

		// Dispatch via SSE
		c.sseHub.Dispatch(draft.UserID, notif)
	}

	// Mark event as processed with hash
	return c.eventRepo.MarkProcessedWithHash(ctx, event.EventID, "application-events", event.ApplicationID, payloadHash)
}

// handleInterviewEvent processes events from the interview-events topic.
func (c *Consumer) handleInterviewEvent(ctx context.Context, msg kafka.Message) error {
	var event model.InterviewEvent
	if err := json.Unmarshal(msg.Value, &event); err != nil {
		return fmt.Errorf("malformed interview event json: %w", err)
	}

	if event.EventID == "" {
		return nil
	}

	// Idempotency check with hash
	payloadHash := hashSHA256(msg.Value)
	alreadyProcessed, err := c.eventRepo.IsProcessed(ctx, event.EventID)
	if err != nil {
		return err
	}
	if alreadyProcessed {
		log.Printf("[Kafka Consumer] Interview event %s already processed (idempotent skip)", event.EventID)
		return nil
	}

	draft := mapInterviewEvent(event)
	if draft != nil {
		notif := &model.Notification{
			ID:            uuid.New(),
			UserID:        draft.UserID,
			Type:          draft.Type,
			Title:         draft.Title,
			Body:          draft.Body,
			Metadata:      draft.Metadata,
			IsRead:        false,
			CreatedAt:     time.Now(),
			SourceTopic:   strPtr("interview-events"),
			SourceEventID: strPtr(event.EventID),
		}

		if err := c.notifRepo.Create(ctx, notif); err != nil {
			log.Printf("[Kafka Consumer] Error saving interview notification: %v", err)
			return err
		}

		// Dispatch via SSE
		c.sseHub.Dispatch(draft.UserID, notif)
	}

	return c.eventRepo.MarkProcessedWithHash(ctx, event.EventID, "interview-events", event.InterviewID, payloadHash)
}

func (c *Consumer) handleMessageCreated(ctx context.Context, event model.KafkaEvent) error {
	log.Printf("[Kafka Consumer] Processing message.created event %s", event.EventID)
	data := event.Data
	senderIDStr, _ := data["sender_id"].(string)
	content, _ := data["content"].(string)
	convIDStr, _ := data["conversation_id"].(string)

	rawMembers, ok := data["member_ids"].([]any)
	if !ok {
		log.Printf("[Kafka Consumer] Warning: member_ids is not []any. Type is %T", data["member_ids"])
		return nil
	}

	senderID, _ := uuid.Parse(senderIDStr)
	log.Printf("[Kafka Consumer] Sender: %s, Members: %d", senderID, len(rawMembers))

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
		runes := []rune(bodyPreview)
		if len(runes) > 100 {
			bodyPreview = string(runes[:97]) + "..."
		}

		notif := &model.Notification{
			ID:        uuid.New(),
			UserID:    recipientID,
			Type:      model.TypeNewMessage,
			Title:     "Tin nhắn mới",
			Body:      bodyPreview,
			Metadata:  metadataJSON,
			IsRead:    false,
			CreatedAt: time.Now(),
		}

		savedNotif, err := c.notifRepo.UpsertChatMessageNotification(ctx, notif, convIDStr)
		if err != nil {
			log.Printf("[Kafka Consumer] Error upserting notification for user %s: %v", recipientID, err)
			return err
		}

		// Dispatch via SSE
		c.sseHub.Dispatch(recipientID, savedNotif)
	}

	return nil
}

func (c *Consumer) handleVideoCallStarted(ctx context.Context, event model.KafkaEvent) error {
	data := event.Data
	hostIDStr, _ := data["host_id"].(string)
	roomName, _ := data["room_name"].(string)
	callIDStr, _ := data["call_id"].(string)
	convIDStr, _ := data["conversation_id"].(string)

	hostID, _ := uuid.Parse(hostIDStr)
	metadataJSON, _ := json.Marshal(map[string]string{
		"call_id":         callIDStr,
		"room_name":       roomName,
		"conversation_id": convIDStr,
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
			Type:      model.TypeVideoCall,
			Title:     "Cuộc gọi phỏng vấn mới",
			Body:      fmt.Sprintf("Bạn có lời mời tham gia phỏng vấn phòng '%s'", roomName),
			Metadata:  metadataJSON,
			IsRead:    false,
			CreatedAt: time.Now(),
		}

		if err := c.notifRepo.Create(ctx, notif); err != nil {
			return err
		}

		if c.sseHub.IsUserConnected(pID) {
			c.sseHub.Dispatch(pID, notif)
		} else {
			// Notify caller that receiver is offline
			offlineNotif := &model.Notification{
				ID:        uuid.New(),
				UserID:    hostID,
				Type:      "VIDEO_CALL_OFFLINE",
				Title:     "Người dùng không trực tuyến",
				Body:      "Người nhận hiện không online để nhận cuộc gọi.",
				Metadata:  metadataJSON,
				IsRead:    false,
				CreatedAt: time.Now(),
			}
			c.sseHub.Dispatch(hostID, offlineNotif)
		}
	}

	return nil
}

func (c *Consumer) handleVideoCallEnded(ctx context.Context, event model.KafkaEvent) error {
	// Data not needed since we don't have participant IDs.

	// Wait, we don't know the participant IDs to dispatch to!
	// If we don't know the participant IDs, we can't use sseHub.Dispatch(userID).
	// But wait, the frontend is listening to 'VIDEO_CALL_ENDED' globally?
	// The sseHub maps userID -> connection.
	// We need participant_ids in the event!
	return nil
}

func (c *Consumer) sendToDLQ(ctx context.Context, msg kafka.Message) error {
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
		return err
	} else {
		log.Printf("[Kafka DLQ] Successfully moved failed message to %s", dlqTopic)
		return nil
	}
}

func hashSHA256(data []byte) string {
	h := sha256.Sum256(data)
	return hex.EncodeToString(h[:])
}

func strPtr(s string) *string {
	return &s
}
