package repository

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"video-service/internal/model"

	"github.com/google/uuid"
)

var ErrCallNotFound = errors.New("video call not found")

type VideoRepository struct {
	db *sql.DB
}

func NewVideoRepository(db *sql.DB) *VideoRepository {
	return &VideoRepository{db: db}
}

func (r *VideoRepository) CreateCall(ctx context.Context, call *model.VideoCall) error {
	query := `
		INSERT INTO video_calls (id, room_name, host_id, title, status, started_at, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`
	if call.ID == uuid.Nil {
		call.ID = uuid.New()
	}
	now := time.Now()
	call.StartedAt = now
	call.CreatedAt = now

	_, err := r.db.ExecContext(ctx, query, call.ID, call.RoomName, call.HostID, call.Title, call.Status, call.StartedAt, call.CreatedAt)
	return err
}

func (r *VideoRepository) FindByID(ctx context.Context, callID uuid.UUID) (*model.VideoCall, error) {
	query := `
		SELECT id, room_name, host_id, title, status, started_at, ended_at, created_at
		FROM video_calls
		WHERE id = $1
	`
	var c model.VideoCall
	err := r.db.QueryRowContext(ctx, query, callID).Scan(
		&c.ID, &c.RoomName, &c.HostID, &c.Title, &c.Status, &c.StartedAt, &c.EndedAt, &c.CreatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrCallNotFound
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (r *VideoRepository) ListActiveCalls(ctx context.Context) ([]*model.VideoCall, error) {
	query := `
		SELECT id, room_name, host_id, title, status, started_at, ended_at, created_at
		FROM video_calls
		WHERE status != 'ended'
		ORDER BY started_at DESC
		LIMIT 50
	`
	rows, err := r.db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var calls []*model.VideoCall
	for rows.Next() {
		var c model.VideoCall
		if err := rows.Scan(&c.ID, &c.RoomName, &c.HostID, &c.Title, &c.Status, &c.StartedAt, &c.EndedAt, &c.CreatedAt); err != nil {
			return nil, err
		}
		calls = append(calls, &c)
	}

	return calls, rows.Err()
}

func (r *VideoRepository) EndCall(ctx context.Context, callID uuid.UUID) error {
	query := `
		UPDATE video_calls
		SET status = 'ended', ended_at = $1
		WHERE id = $2 AND status != 'ended'
	`
	_, err := r.db.ExecContext(ctx, query, time.Now(), callID)
	return err
}

func (r *VideoRepository) AddParticipant(ctx context.Context, callID, userID uuid.UUID) error {
	query := `
		INSERT INTO video_call_participants (call_id, user_id, joined_at)
		VALUES ($1, $2, $3)
		ON CONFLICT (call_id, user_id) DO UPDATE SET joined_at = $3, left_at = NULL
	`
	_, err := r.db.ExecContext(ctx, query, callID, userID, time.Now())
	return err
}

func (r *VideoRepository) RemoveParticipant(ctx context.Context, callID, userID uuid.UUID) error {
	query := `
		UPDATE video_call_participants
		SET left_at = $1
		WHERE call_id = $2 AND user_id = $3
	`
	_, err := r.db.ExecContext(ctx, query, time.Now(), callID, userID)
	return err
}
