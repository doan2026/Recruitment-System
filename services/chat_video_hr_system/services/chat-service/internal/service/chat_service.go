package service

import (
	"context"
	"errors"
	"time"

	"chat-service/internal/kafka"
	"chat-service/internal/model"
	"chat-service/internal/repository"

	"github.com/google/uuid"
)

var ErrNotMember = errors.New("user is not a member of this conversation")

type ChatService struct {
	convRepo *repository.ConversationRepository
	msgRepo  *repository.MessageRepository
	producer *kafka.Producer
}

func NewChatService(
	convRepo *repository.ConversationRepository,
	msgRepo *repository.MessageRepository,
	producer *kafka.Producer,
) *ChatService {
	return &ChatService{
		convRepo: convRepo,
		msgRepo:  msgRepo,
		producer: producer,
	}
}

func (s *ChatService) CreateConversation(ctx context.Context, creatorID uuid.UUID, title string, memberIDs []uuid.UUID, isGroup bool) (*model.Conversation, error) {
	// Ensure creator is in memberIDs
	hasCreator := false
	for _, m := range memberIDs {
		if m == creatorID {
			hasCreator = true
			break
		}
	}
	if !hasCreator {
		memberIDs = append(memberIDs, creatorID)
	}

	return s.convRepo.Create(ctx, title, isGroup, memberIDs)
}

func (s *ChatService) GetConversation(ctx context.Context, convID, userID uuid.UUID) (*model.Conversation, error) {
	isMember, err := s.convRepo.IsMember(ctx, convID, userID)
	if err != nil {
		return nil, err
	}
	if !isMember {
		return nil, ErrNotMember
	}

	return s.convRepo.FindByID(ctx, convID)
}

func (s *ChatService) ListUserConversations(ctx context.Context, userID uuid.UUID) ([]*model.Conversation, error) {
	return s.convRepo.ListByUserID(ctx, userID)
}

func (s *ChatService) SendMessage(ctx context.Context, convID, senderID, clientMsgID uuid.UUID, content string) (*model.Message, []uuid.UUID, error) {
	isMember, err := s.convRepo.IsMember(ctx, convID, senderID)
	if err != nil {
		return nil, nil, err
	}
	if !isMember {
		return nil, nil, ErrNotMember
	}

	msg, isNew, err := s.msgRepo.Create(ctx, convID, senderID, clientMsgID, content)
	if err != nil {
		return nil, nil, err
	}

	memberIDs, err := s.convRepo.GetMemberIDs(ctx, convID)
	if err != nil {
		return msg, nil, nil
	}

	// Only publish Kafka event if it was newly created (idempotency)
	if isNew && s.producer != nil {
		_ = s.producer.PublishMessageCreated(ctx, msg, memberIDs)
	}

	return msg, memberIDs, nil
}

func (s *ChatService) ListMessages(ctx context.Context, convID, userID uuid.UUID, limit int, before time.Time) ([]*model.Message, error) {
	isMember, err := s.convRepo.IsMember(ctx, convID, userID)
	if err != nil {
		return nil, err
	}
	if !isMember {
		return nil, ErrNotMember
	}

	return s.msgRepo.List(ctx, convID, limit, before)
}
