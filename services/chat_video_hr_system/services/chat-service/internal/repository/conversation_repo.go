package repository

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"chat-service/internal/model"

	"github.com/google/uuid"
)

var ErrConversationNotFound = errors.New("conversation not found")

type ConversationRepository struct {
	db *sql.DB
}

func NewConversationRepository(db *sql.DB) *ConversationRepository {
	return &ConversationRepository{db: db}
}

func (r *ConversationRepository) Create(ctx context.Context, title string, isGroup bool, memberIDs []uuid.UUID) (*model.Conversation, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	conv := &model.Conversation{
		ID:        uuid.New(),
		Title:     title,
		IsGroup:   isGroup,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	insertConv := `
		INSERT INTO conversations (id, title, is_group, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5)
	`
	_, err = tx.ExecContext(ctx, insertConv, conv.ID, conv.Title, conv.IsGroup, conv.CreatedAt, conv.UpdatedAt)
	if err != nil {
		return nil, err
	}

	insertMember := `
		INSERT INTO conversation_members (conversation_id, user_id, role, joined_at)
		VALUES ($1, $2, $3, $4)
	`
	for _, mID := range memberIDs {
		_, err = tx.ExecContext(ctx, insertMember, conv.ID, mID, "member", time.Now())
		if err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	conv.Members = memberIDs
	return conv, nil
}

func (r *ConversationRepository) FindByID(ctx context.Context, convID uuid.UUID) (*model.Conversation, error) {
	query := `
		SELECT id, title, is_group, created_at, updated_at
		FROM conversations
		WHERE id = $1
	`
	var c model.Conversation
	err := r.db.QueryRowContext(ctx, query, convID).Scan(&c.ID, &c.Title, &c.IsGroup, &c.CreatedAt, &c.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrConversationNotFound
	}
	if err != nil {
		return nil, err
	}

	members, err := r.GetMemberIDs(ctx, convID)
	if err == nil {
		c.Members = members
	}

	return &c, nil
}

func (r *ConversationRepository) ListByUserID(ctx context.Context, userID uuid.UUID) ([]*model.Conversation, error) {
	query := `
		SELECT c.id, c.title, c.is_group, c.created_at, c.updated_at
		FROM conversations c
		JOIN conversation_members cm ON c.id = cm.conversation_id
		WHERE cm.user_id = $1
		ORDER BY c.updated_at DESC
	`
	rows, err := r.db.QueryContext(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var convs []*model.Conversation
	for rows.Next() {
		var c model.Conversation
		if err := rows.Scan(&c.ID, &c.Title, &c.IsGroup, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		convs = append(convs, &c)
	}

	for _, c := range convs {
		members, err := r.GetMemberIDs(ctx, c.ID)
		if err == nil {
			c.Members = members
		}
	}

	return convs, rows.Err()
}

func (r *ConversationRepository) GetMemberIDs(ctx context.Context, convID uuid.UUID) ([]uuid.UUID, error) {
	query := `
		SELECT user_id
		FROM conversation_members
		WHERE conversation_id = $1
	`
	rows, err := r.db.QueryContext(ctx, query, convID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []uuid.UUID
	for rows.Next() {
		var uid uuid.UUID
		if err := rows.Scan(&uid); err != nil {
			return nil, err
		}
		ids = append(ids, uid)
	}
	return ids, rows.Err()
}

func (r *ConversationRepository) IsMember(ctx context.Context, convID, userID uuid.UUID) (bool, error) {
	query := `
		SELECT 1
		FROM conversation_members
		WHERE conversation_id = $1 AND user_id = $2
	`
	var dummy int
	err := r.db.QueryRowContext(ctx, query, convID, userID).Scan(&dummy)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}
