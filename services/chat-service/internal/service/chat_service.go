package service

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"chat-service/internal/kafka"
	"chat-service/internal/model"
	"chat-service/internal/repository"

	"github.com/google/uuid"
)

var (
	ErrNotMember      = errors.New("user is not a member of this conversation")
	ErrInvalidContent = errors.New("message content must be 1-4000 characters")
	ErrInvalidMembers = errors.New("conversation requires at least one other valid member")
)

const maxMessageRunes = 4000

type ChatService struct {
	convRepo   *repository.ConversationRepository
	msgRepo    *repository.MessageRepository
	producer   *kafka.Producer
	identities *ConversationIdentityResolver
}

func NewChatService(
	convRepo *repository.ConversationRepository,
	msgRepo *repository.MessageRepository,
	producer *kafka.Producer,
	identities ...*ConversationIdentityResolver,
) *ChatService {
	svc := &ChatService{
		convRepo: convRepo,
		msgRepo:  msgRepo,
		producer: producer,
	}
	if len(identities) > 0 {
		svc.identities = identities[0]
	}
	return svc
}

func (s *ChatService) enrich(ctx context.Context, viewer uuid.UUID, conversations ...*model.Conversation) {
	if s.identities != nil {
		s.identities.Enrich(ctx, viewer, conversations)
	}
}

func (s *ChatService) CreateConversation(ctx context.Context, creatorID uuid.UUID, title string, memberIDs []uuid.UUID, isGroup bool) (*model.Conversation, error) {
	// Dedupe, drop nil IDs, and ensure creator is a member.
	seen := map[uuid.UUID]bool{creatorID: true}
	unique := []uuid.UUID{creatorID}
	for _, m := range memberIDs {
		if m == uuid.Nil || seen[m] {
			continue
		}
		seen[m] = true
		unique = append(unique, m)
	}
	if len(unique) < 2 {
		return nil, ErrInvalidMembers
	}

	// Check existing 1-on-1 conversation
	if !isGroup && len(unique) == 2 {
		existing, err := s.convRepo.FindDirectConversation(ctx, unique[0], unique[1])
		if err == nil && existing != nil {
			s.enrich(ctx, creatorID, existing)
			return existing, nil
		}
	}

	conversation, err := s.convRepo.Create(ctx, strings.TrimSpace(title), isGroup, unique)
	if err == nil {
		s.enrich(ctx, creatorID, conversation)
	}
	return conversation, err
}

func (s *ChatService) GetConversation(ctx context.Context, convID, userID uuid.UUID) (*model.Conversation, error) {
	isMember, err := s.convRepo.IsMember(ctx, convID, userID)
	if err != nil {
		return nil, err
	}
	if !isMember {
		return nil, ErrNotMember
	}

	conversation, err := s.convRepo.FindByID(ctx, convID, userID)
	if err == nil {
		s.enrich(ctx, userID, conversation)
	}
	return conversation, err
}

func (s *ChatService) ListUserConversations(ctx context.Context, userID uuid.UUID) ([]*model.Conversation, error) {
	conversations, err := s.convRepo.ListByUserID(ctx, userID)
	if err == nil {
		s.enrich(ctx, userID, conversations...)
	}
	return conversations, err
}

func (s *ChatService) SendMessage(ctx context.Context, convID, senderID, clientMsgID uuid.UUID, content string) (*model.Message, []uuid.UUID, error) {
	if strings.TrimSpace(content) == "" || utf8.RuneCountInString(content) > maxMessageRunes {
		return nil, nil, ErrInvalidContent
	}

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
