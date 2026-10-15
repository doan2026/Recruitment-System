package test

import (
	"context"
	"testing"
	"time"

	"notification-service/internal/db"
	"notification-service/internal/model"
	"notification-service/internal/repository"
	"notification-service/internal/service"
	"notification-service/migrations"

	"github.com/google/uuid"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

func TestNotificationServiceIntegration(t *testing.T) {
	ctx := context.Background()

	// 1. Start PostgreSQL Container
	pgContainer, err := postgres.Run(ctx, "postgres:15-alpine",
		postgres.WithDatabase("notification_db"),
		postgres.WithUsername("notification_user"),
		postgres.WithPassword("notif_secure_pass_123"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).WithStartupTimeout(10*time.Second),
		),
	)
	if err != nil {
		t.Fatalf("failed to start postgres container: %v", err)
	}
	defer func() {
		if err := pgContainer.Terminate(ctx); err != nil {
			t.Fatalf("failed to terminate pg container: %v", err)
		}
	}()

	dbURL, err := pgContainer.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("failed to get connection string: %v", err)
	}

	// 2. Connect to Database and Run Migrations
	database, err := db.ConnectWithRetry(dbURL, 5, 2*time.Second)
	if err != nil {
		t.Fatalf("DB connection failed: %v", err)
	}
	defer database.Close()

	if err := db.RunMigrations(database, migrations.FS); err != nil {
		t.Fatalf("DB migration failed: %v", err)
	}

	// 3. Initialize Repositories and Service
	notifRepo := repository.NewNotificationRepository(database)
	notifSvc := service.NewNotificationService(notifRepo)

	// 4. Execute Test Cases
	t.Run("Create and List Notification", func(t *testing.T) {
		userID := uuid.New()

		// Manually create a notification (simulate Kafka event handling)
		notif := &model.Notification{
			ID:        uuid.New(),
			UserID:    userID,
			Type:      "chat_message",
			Title:     "New Message",
			Body:      "You have a new message",
			CreatedAt: time.Now(),
		}
		err := notifRepo.Create(ctx, notif)
		if err != nil {
			t.Fatalf("failed to create notification: %v", err)
		}

		// List notifications
		notifs, err := notifSvc.List(ctx, userID, nil, 10, time.Now(), "")
		if err != nil {
			t.Fatalf("failed to list notifications: %v", err)
		}
		if len(notifs) != 1 {
			t.Fatalf("expected 1 notification, got %d", len(notifs))
		}

		if notifs[0].Title != "New Message" {
			t.Errorf("expected 'New Message', got '%s'", notifs[0].Title)
		}

		// Mark as read
		err = notifSvc.MarkAsRead(ctx, notifs[0].ID, userID)
		if err != nil {
			t.Fatalf("failed to mark read: %v", err)
		}

		count, err := notifSvc.GetUnreadCount(ctx, userID)
		if err != nil {
			t.Fatalf("failed to get unread count: %v", err)
		}
		if count != 0 {
			t.Errorf("expected 0 unread, got %d", count)
		}
	})
}
