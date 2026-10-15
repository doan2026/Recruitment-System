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

func (r *VideoRepository) CreateCall(ctx context.Context, call *model.VideoCall, participantIDs []uuid.UUID) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	query := `
		INSERT INTO video_calls (id, room_name, host_id, title, status, started_at, created_at, conversation_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`
	if call.ID == uuid.Nil {
		call.ID = uuid.New()
	}
	now := time.Now()
	call.StartedAt = now
	call.CreatedAt = now

	// Ensure conversation_id is valid UUID before insert, or use NULL. Here we assume it's valid string or we can store it as string if the DB is UUID
	// Wait, the DB column `conversation_id` is UUID. 
	convUUID, err := uuid.Parse(call.ConversationID)
	var convIDArg interface{}
	if err != nil {
		convIDArg = nil
	} else {
		convIDArg = convUUID
	}

	_, err = tx.ExecContext(ctx, query, call.ID, call.RoomName, call.HostID, call.Title, call.Status, call.StartedAt, call.CreatedAt, convIDArg)
	if err != nil {
		return err
	}

	uniqueParticipants := make(map[uuid.UUID]bool)
	uniqueParticipants[call.HostID] = true
	for _, pid := range participantIDs {
		uniqueParticipants[pid] = true
	}

	partQuery := `
		INSERT INTO video_call_participants (call_id, user_id, joined_at)
		VALUES ($1, $2, NULL)
	`
	for pid := range uniqueParticipants {
		_, err = tx.ExecContext(ctx, partQuery, call.ID, pid)
		if err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (r *VideoRepository) FindByID(ctx context.Context, callID uuid.UUID) (*model.VideoCall, error) {
	query := `
		SELECT id, room_name, host_id, title, status, started_at, ended_at, created_at, COALESCE(conversation_id, '00000000-0000-0000-0000-000000000000') as conversation_id
		FROM video_calls
		WHERE id = $1
	`
	var c model.VideoCall
	err := r.db.QueryRowContext(ctx, query, callID).Scan(
		&c.ID, &c.RoomName, &c.HostID, &c.Title, &c.Status, &c.StartedAt, &c.EndedAt, &c.CreatedAt, &c.ConversationID,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrCallNotFound
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (r *VideoRepository) ListActiveCalls(ctx context.Context, userID uuid.UUID) ([]*model.VideoCall, error) {
	query := `
		SELECT c.id, c.room_name, c.host_id, c.title, c.status, c.started_at, c.ended_at, c.created_at, COALESCE(c.conversation_id, '00000000-0000-0000-0000-000000000000') as conversation_id
		FROM video_calls c
		JOIN video_call_participants p ON c.id = p.call_id
		WHERE c.status != 'ended' AND p.user_id = $1
		ORDER BY c.started_at DESC
		LIMIT 50
	`
	rows, err := r.db.QueryContext(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var calls []*model.VideoCall
	for rows.Next() {
		var c model.VideoCall
		if err := rows.Scan(&c.ID, &c.RoomName, &c.HostID, &c.Title, &c.Status, &c.StartedAt, &c.EndedAt, &c.CreatedAt, &c.ConversationID); err != nil {
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
	res, err := r.db.ExecContext(ctx, query, time.Now(), callID)
	if err != nil {
		return err
	}
	rowsAffected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return ErrCallNotFound
	}
	return nil
}

func (r *VideoRepository) RejectCall(ctx context.Context, callID uuid.UUID) error {
	query := `
		UPDATE video_calls
		SET status = 'rejected', ended_at = $1
		WHERE id = $2 AND status = 'waiting'
	`
	res, err := r.db.ExecContext(ctx, query, time.Now(), callID)
	if err != nil {
		return err
	}
	rowsAffected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return ErrCallNotFound
	}
	return nil
}

func (r *VideoRepository) AddParticipant(ctx context.Context, callID, userID uuid.UUID) error {
	query := `
		UPDATE video_call_participants
		SET joined_at = $1, left_at = NULL
		WHERE call_id = $2 AND user_id = $3
	`
	res, err := r.db.ExecContext(ctx, query, time.Now(), callID, userID)
	if err != nil {
		return err
	}
	rowsAffected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return errors.New("user is not invited to this call")
	}

	// Update call status to active if it was waiting
	_, _ = r.db.ExecContext(ctx, `UPDATE video_calls SET status = 'active' WHERE id = $1 AND status = 'waiting'`, callID)

	return nil
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
