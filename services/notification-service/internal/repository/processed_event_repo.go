package repository

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

type ProcessedEventRepository struct {
	db *sql.DB
}

func NewProcessedEventRepository(db *sql.DB) *ProcessedEventRepository {
	return &ProcessedEventRepository{db: db}
}

func (r *ProcessedEventRepository) IsProcessed(ctx context.Context, eventID string) (bool, error) {
	query := `SELECT 1 FROM processed_events WHERE event_id = $1`
	var dummy int
	err := r.db.QueryRowContext(ctx, query, eventID).Scan(&dummy)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

func (r *ProcessedEventRepository) MarkProcessed(ctx context.Context, eventID, eventType string) error {
	query := `
		INSERT INTO processed_events (event_id, event_type, processed_at)
		VALUES ($1, $2, $3)
		ON CONFLICT (event_id) DO NOTHING
	`
	_, err := r.db.ExecContext(ctx, query, eventID, eventType, time.Now())
	return err
}

func (r *ProcessedEventRepository) MarkProcessedWithHash(ctx context.Context, eventID, topic, eventKey, payloadHash string) error {
	query := `
		INSERT INTO processed_events (event_id, event_type, processed_at, topic, event_key, payload_sha256, schema_version)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT DO NOTHING
	`
	_, err := r.db.ExecContext(ctx, query, eventID, "generic", time.Now(), topic, eventKey, payloadHash, 1)
	return err
}
