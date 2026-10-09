package repository

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"chat-service/internal/model"

	"github.com/google/uuid"
)

var ErrClientMessageIDConflict = errors.New("client_message_id already used by another member")

type MessageRepository struct {
	db *sql.DB
}

func NewMessageRepository(db *sql.DB) *MessageRepository {
	return &MessageRepository{db: db}
}

func (r *MessageRepository) Create(ctx context.Context, convID, senderID, clientMsgID uuid.UUID, content string) (*model.Message, bool, error) {
	insertQuery := `
		INSERT INTO messages (id, conversation_id, sender_id, client_message_id, content, created_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (conversation_id, client_message_id) DO NOTHING
		RETURNING id, conversation_id, sender_id, client_message_id, content, created_at
	`
	newID := uuid.New()
	now := time.Now()

	var msg model.Message
	err := r.db.QueryRowContext(ctx, insertQuery, newID, convID, senderID, clientMsgID, content, now).Scan(
		&msg.ID,
		&msg.ConversationID,
		&msg.SenderID,
		&msg.ClientMessageID,
		&msg.Content,
		&msg.CreatedAt,
	)

	if err == nil {
		// Update conversation updated_at
		_, _ = r.db.ExecContext(ctx, `UPDATE conversations SET updated_at = $1 WHERE id = $2`, now, convID)
		return &msg, true, nil // newly inserted
	}

	if errors.Is(err, sql.ErrNoRows) {
		// Duplicated client_message_id -> fetch existing message
		selectQuery := `
			SELECT id, conversation_id, sender_id, client_message_id, content, created_at
			FROM messages
			WHERE conversation_id = $1 AND client_message_id = $2
		`
		err = r.db.QueryRowContext(ctx, selectQuery, convID, clientMsgID).Scan(
			&msg.ID,
			&msg.ConversationID,
			&msg.SenderID,
			&msg.ClientMessageID,
			&msg.Content,
			&msg.CreatedAt,
		)
		if err != nil {
			return nil, false, err
		}
		if msg.SenderID != senderID {
			return nil, false, ErrClientMessageIDConflict
		}
		return &msg, false, nil // existing
	}

	return nil, false, err
}

func (r *MessageRepository) List(ctx context.Context, convID uuid.UUID, limit int, before time.Time) ([]*model.Message, error) {
	query := `
		SELECT id, conversation_id, sender_id, client_message_id, content, created_at
		FROM messages
		WHERE conversation_id = $1 AND created_at < $2
		ORDER BY created_at DESC
		LIMIT $3
	`
	if before.IsZero() {
		before = time.Now()
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}

	rows, err := r.db.QueryContext(ctx, query, convID, before, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var messages []*model.Message
	for rows.Next() {
		var m model.Message
		if err := rows.Scan(&m.ID, &m.ConversationID, &m.SenderID, &m.ClientMessageID, &m.Content, &m.CreatedAt); err != nil {
			return nil, err
		}
		messages = append(messages, &m)
	}

	// Reverse to chronological order (oldest to newest)
	for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
		messages[i], messages[j] = messages[j], messages[i]
	}

	return messages, rows.Err()
}
