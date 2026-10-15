package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strconv"
	"time"

	"notification-service/internal/model"

	"github.com/google/uuid"
)

type NotificationRepository struct {
	db *sql.DB
}

func NewNotificationRepository(db *sql.DB) *NotificationRepository {
	return &NotificationRepository{db: db}
}

func (r *NotificationRepository) Create(ctx context.Context, n *model.Notification) error {
	query := `
		INSERT INTO notifications (id, user_id, type, title, body, metadata, is_read, created_at, source_topic, source_event_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`
	if n.ID == uuid.Nil {
		n.ID = uuid.New()
	}
	if n.CreatedAt.IsZero() {
		n.CreatedAt = time.Now()
	}
	if len(n.Metadata) == 0 {
		n.Metadata = json.RawMessage(`{}`)
	}

	_, err := r.db.ExecContext(ctx, query, n.ID, n.UserID, n.Type, n.Title, n.Body, n.Metadata, n.IsRead, n.CreatedAt, n.SourceTopic, n.SourceEventID)
	return err
}

func (r *NotificationRepository) UpsertChatMessageNotification(ctx context.Context, n *model.Notification, convID string) (*model.Notification, error) {
	// PostgreSQL UPSERT (ON CONFLICT) cannot be easily used here because we don't have a unique constraint on (user_id, conversation_id, is_read=false).
	// Instead, we can do an UPDATE. If rows affected == 0, we do INSERT.
	
	updateQuery := `
		UPDATE notifications
		SET body = $1, created_at = $2, source_event_id = $3
		WHERE user_id = $4 AND type = $5 AND is_read = false AND metadata->>'conversation_id' = $6
		RETURNING id, title, metadata, created_at, source_topic
	`
	var updated model.Notification
	err := r.db.QueryRowContext(ctx, updateQuery, n.Body, n.CreatedAt, n.SourceEventID, n.UserID, n.Type, convID).Scan(
		&updated.ID, &updated.Title, &updated.Metadata, &updated.CreatedAt, &updated.SourceTopic,
	)
	
	if err == nil {
		// Update successful
		n.ID = updated.ID
		n.Title = updated.Title
		n.Metadata = updated.Metadata
		n.CreatedAt = updated.CreatedAt
		n.SourceTopic = updated.SourceTopic
		return n, nil
	}

	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}

	// Not found, do insert
	if n.ID == uuid.Nil {
		n.ID = uuid.New()
	}
	if n.CreatedAt.IsZero() {
		n.CreatedAt = time.Now()
	}
	if len(n.Metadata) == 0 {
		n.Metadata = json.RawMessage(`{}`)
	}

	insertQuery := `
		INSERT INTO notifications (id, user_id, type, title, body, metadata, is_read, created_at, source_topic, source_event_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`
	_, err = r.db.ExecContext(ctx, insertQuery, n.ID, n.UserID, n.Type, n.Title, n.Body, n.Metadata, n.IsRead, n.CreatedAt, n.SourceTopic, n.SourceEventID)
	if err != nil {
		return nil, err
	}
	
	return n, nil
}

func (r *NotificationRepository) ListByUserID(ctx context.Context, userID uuid.UUID, notifType *string, limit int, cursorCreatedAt time.Time, cursorID string) ([]*model.Notification, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}

	query := `
		SELECT id, user_id, type, title, body, metadata, is_read, created_at, read_at, source_topic, source_event_id
		FROM notifications
		WHERE user_id = $1
	`
	args := []any{userID}
	argIdx := 2

	if notifType != nil {
		query += ` AND type = $` + strconv.Itoa(argIdx)
		args = append(args, *notifType)
		argIdx++
	}

	if !cursorCreatedAt.IsZero() && cursorID != "" {
		query += ` AND (created_at < $` + strconv.Itoa(argIdx) + ` OR (created_at = $` + strconv.Itoa(argIdx) + ` AND id < $` + strconv.Itoa(argIdx+1) + `))`
		args = append(args, cursorCreatedAt, cursorID)
		argIdx += 2
	}

	query += ` ORDER BY created_at DESC, id DESC LIMIT $` + strconv.Itoa(argIdx)
	args = append(args, limit+1)

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var notifs []*model.Notification
	for rows.Next() {
		var n model.Notification
		if err := rows.Scan(&n.ID, &n.UserID, &n.Type, &n.Title, &n.Body, &n.Metadata, &n.IsRead, &n.CreatedAt, &n.ReadAt, &n.SourceTopic, &n.SourceEventID); err != nil {
			return nil, err
		}
		notifs = append(notifs, &n)
	}

	return notifs, rows.Err()
}

func (r *NotificationRepository) CountUnread(ctx context.Context, userID uuid.UUID) (int, error) {
	query := `
		SELECT COUNT(*)
		FROM notifications
		WHERE user_id = $1 AND is_read = FALSE
	`
	var count int
	err := r.db.QueryRowContext(ctx, query, userID).Scan(&count)
	return count, err
}

func (r *NotificationRepository) MarkAsRead(ctx context.Context, notifID, userID uuid.UUID) error {
	query := `
		UPDATE notifications
		SET is_read = TRUE, read_at = CURRENT_TIMESTAMP
		WHERE id = $1 AND user_id = $2 AND is_read = FALSE
	`
	res, err := r.db.ExecContext(ctx, query, notifID, userID)
	if err != nil {
		return err
	}
	rowsAffected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return errors.New("notification not found or already read")
	}
	return nil
}

func (r *NotificationRepository) MarkAllAsRead(ctx context.Context, userID uuid.UUID) error {
	query := `
		UPDATE notifications
		SET is_read = TRUE, read_at = CURRENT_TIMESTAMP
		WHERE user_id = $1 AND is_read = FALSE
	`
	_, err := r.db.ExecContext(ctx, query, userID)
	return err
}
