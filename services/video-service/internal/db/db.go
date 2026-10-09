package db

import (
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	_ "github.com/lib/pq"
)

func ConnectWithRetry(databaseURL string, maxRetries int, retryInterval time.Duration) (*sql.DB, error) {
	var db *sql.DB
	var err error

	for i := 1; i <= maxRetries; i++ {
		log.Printf("[DB] Connecting to video database (attempt %d/%d)...", i, maxRetries)
		db, err = sql.Open("postgres", databaseURL)
		if err == nil {
			err = db.Ping()
			if err == nil {
				log.Println("[DB] Video database connected successfully!")
				db.SetMaxOpenConns(25)
				db.SetMaxIdleConns(10)
				db.SetConnMaxLifetime(5 * time.Minute)
				return db, nil
			}
			_ = db.Close()
		}

		log.Printf("[DB] Ping failed: %v. Retrying in %v...", err, retryInterval)
		time.Sleep(retryInterval)
	}

	return nil, fmt.Errorf("could not connect to video database after %d attempts: %w", maxRetries, err)
}

func RunMigrations(db *sql.DB, migrationsFS embed.FS) error {
	log.Println("[Migration] Running auto-migrations for video-service...")
	d, err := iofs.New(migrationsFS, ".")
	if err != nil {
		return fmt.Errorf("failed to create iofs driver: %w", err)
	}

	driver, err := postgres.WithInstance(db, &postgres.Config{
		MigrationsTable: "video_schema_migrations",
	})
	if err != nil {
		return fmt.Errorf("failed to create postgres driver: %w", err)
	}

	m, err := migrate.NewWithInstance("iofs", d, "postgres", driver)
	if err != nil {
		return fmt.Errorf("failed to initialize migrate: %w", err)
	}

	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("migration up failed: %w", err)
	}

	log.Println("[Migration] Video database migrations applied successfully!")
	return nil
}
