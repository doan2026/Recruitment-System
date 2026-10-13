package test

import (
	"context"
	"strings"
	"testing"
	"time"

	"video-service/internal/db"
	"video-service/internal/kafka"
	"video-service/internal/livekit"
	"video-service/internal/repository"
	"video-service/internal/service"
	"video-service/migrations"

	"github.com/google/uuid"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/modules/redpanda"
	"github.com/testcontainers/testcontainers-go/wait"
)

// MockTokenIssuer implements livekit token issuer interface for testing
type MockTokenIssuer struct{}

func (m *MockTokenIssuer) IssueToken(roomName, identity, name string) (string, error) {
	return "mock-token", nil
}

func TestVideoServiceIntegration(t *testing.T) {
	ctx := context.Background()

	// 1. Start PostgreSQL Container
	pgContainer, err := postgres.Run(ctx, "postgres:15-alpine",
		postgres.WithDatabase("video_db"),
		postgres.WithUsername("video_user"),
		postgres.WithPassword("video_secure_pass_123"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).WithStartupTimeout(60*time.Second),
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

	// 2. Start Redpanda (Kafka) Container
	rpContainer, err := redpanda.Run(ctx, "docker.redpanda.com/redpandadata/redpanda:v23.2.28")
	if err != nil {
		t.Fatalf("failed to start redpanda container: %v", err)
	}
	defer func() {
		if err := rpContainer.Terminate(ctx); err != nil {
			t.Fatalf("failed to terminate redpanda container: %v", err)
		}
	}()

	kafkaBrokersStr, err := rpContainer.KafkaSeedBroker(ctx)
	if err != nil {
		t.Fatalf("failed to get kafka broker: %v", err)
	}

	// 3. Connect to Database and Run Migrations
	database, err := db.ConnectWithRetry(dbURL, 5, 2*time.Second)
	if err != nil {
		t.Fatalf("DB connection failed: %v", err)
	}
	defer database.Close()

	if err := db.RunMigrations(database, migrations.FS); err != nil {
		t.Fatalf("DB migration failed: %v", err)
	}

	// 4. Initialize Kafka Producer
	kafkaBrokers := strings.Split(kafkaBrokersStr, ",")
	producer := kafka.NewProducer(kafkaBrokers)
	defer producer.Close()

	// 5. Initialize Repositories and Service
	videoRepo := repository.NewVideoRepository(database)
	tokenIssuer := livekit.NewTokenIssuer("ws://localhost:7880", "devkey", "secret")
	videoSvc := service.NewVideoService(videoRepo, tokenIssuer, producer)

	// 6. Execute Test Cases
	t.Run("Create and Join Call", func(t *testing.T) {
		callerID := uuid.New()
		participantID := uuid.New()

		conversationID := uuid.New().String()
		call, err := videoSvc.CreateCall(ctx, callerID, "Test Call", []uuid.UUID{participantID}, conversationID)
		if err != nil {
			t.Fatalf("failed to create call: %v", err)
		}

		if call.Status != "waiting" && call.Status != "initiating" {
			t.Errorf("unexpected status: %s", call.Status)
		}

		stored, err := videoRepo.FindByID(ctx, call.ID)
		if err != nil || stored.ConversationID != conversationID {
			t.Fatalf("conversation link was not persisted: %v, %v", stored, err)
		}

		// Join Call
		res, err := videoSvc.JoinCall(ctx, call.ID, callerID, "Caller Name")
		if err != nil {
			t.Fatalf("failed to join call: %v", err)
		}
		if res.Token == "" {
			t.Errorf("expected token to not be empty")
		}

		// Uninvited user tries to join
		uninvitedID := uuid.New()
		_, err = videoSvc.JoinCall(ctx, call.ID, uninvitedID, "Hacker")
		if err == nil {
			t.Errorf("expected error when uninvited user tries to join, got nil")
		} else if err.Error() != "user is not invited to this call" {
			t.Errorf("expected error 'user is not invited to this call', got %v", err)
		}
	})
}
