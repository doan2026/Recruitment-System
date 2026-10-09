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

func (r *ConversationRepository) FindDirectConversation(ctx context.Context, u1, u2 uuid.UUID) (*model.Conversation, error) {
	query := `
		SELECT c.id, c.title, c.is_group, c.created_at, c.updated_at
		FROM conversations c
		JOIN conversation_members cm1 ON c.id = cm1.conversation_id
		JOIN conversation_members cm2 ON c.id = cm2.conversation_id
		WHERE c.is_group = false 
		  AND cm1.user_id = $1 
		  AND cm2.user_id = $2
	`
	var c model.Conversation
	err := r.db.QueryRowContext(ctx, query, u1, u2).Scan(&c.ID, &c.Title, &c.IsGroup, &c.CreatedAt, &c.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	members, err := r.GetMemberIDs(ctx, c.ID)
	if err == nil {
		c.Members = members
	}

	return &c, nil
}

func (r *ConversationRepository) FindByID(ctx context.Context, convID uuid.UUID, currentUserID uuid.UUID) (*model.Conversation, error) {
	query := `
		SELECT c.id, c.is_group, c.created_at, c.updated_at,
		       CASE WHEN c.is_group THEN c.title 
		            ELSE COALESCE(p2.full_name, SPLIT_PART(u2.email, '@', 1), 'Đối tác') 
		       END as title,
		       p2.avatar_url
		FROM conversations c
		JOIN conversation_members cm ON c.id = cm.conversation_id
		LEFT JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id != $2 AND NOT c.is_group
		LEFT JOIN profile.profiles p2 ON p2.user_id = cm2.user_id
		LEFT JOIN auth.users u2 ON u2.id = cm2.user_id
		WHERE c.id = $1 AND cm.user_id = $2
	`
	var c model.Conversation
	var avatarURL sql.NullString
	err := r.db.QueryRowContext(ctx, query, convID, currentUserID).Scan(&c.ID, &c.IsGroup, &c.CreatedAt, &c.UpdatedAt, &c.Title, &avatarURL)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrConversationNotFound
	}
	if err != nil {
		return nil, err
	}
	if avatarURL.Valid {
		c.AvatarURL = avatarURL.String
	}

	members, err := r.GetMemberIDs(ctx, convID)
	if err == nil {
		c.Members = members
	}

	return &c, nil
}

func (r *ConversationRepository) ListByUserID(ctx context.Context, userID uuid.UUID) ([]*model.Conversation, error) {
	query := `
		SELECT c.id, c.is_group, c.created_at, c.updated_at,
		       CASE WHEN c.is_group THEN c.title 
		            ELSE COALESCE(p2.full_name, SPLIT_PART(u2.email, '@', 1), 'Đối tác') 
		       END as title,
		       p2.avatar_url
		FROM conversations c
		JOIN conversation_members cm ON c.id = cm.conversation_id
		LEFT JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id != $1 AND NOT c.is_group
		LEFT JOIN profile.profiles p2 ON p2.user_id = cm2.user_id
		LEFT JOIN auth.users u2 ON u2.id = cm2.user_id
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
		var avatarURL sql.NullString
		if err := rows.Scan(&c.ID, &c.IsGroup, &c.CreatedAt, &c.UpdatedAt, &c.Title, &avatarURL); err != nil {
			return nil, err
		}
		if avatarURL.Valid {
			c.AvatarURL = avatarURL.String
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
