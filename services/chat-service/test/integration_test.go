package test

import (
	"context"
	"testing"
	"time"
	"strings"

	"chat-service/internal/db"
	"chat-service/internal/kafka"
	"chat-service/internal/repository"
	"chat-service/internal/service"
	"chat-service/migrations"

	"github.com/google/uuid"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/modules/redpanda"
	"github.com/testcontainers/testcontainers-go/wait"
)

func TestChatServiceIntegration(t *testing.T) {
	ctx := context.Background()

	// 1. Start PostgreSQL Container
	pgContainer, err := postgres.Run(ctx, "postgres:15-alpine",
		postgres.WithDatabase("chat_db"),
		postgres.WithUsername("chat_user"),
		postgres.WithPassword("chat_secure_pass_123"),
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
	convRepo := repository.NewConversationRepository(database)
	msgRepo := repository.NewMessageRepository(database)
	chatSvc := service.NewChatService(convRepo, msgRepo, producer)

	// 6. Execute Test Cases
	t.Run("Create and Get Conversation", func(t *testing.T) {
		creatorID := uuid.New()
		member2ID := uuid.New()

		conv, err := chatSvc.CreateConversation(ctx, creatorID, "Test Group", []uuid.UUID{member2ID}, true)
		if err != nil {
			t.Fatalf("failed to create conversation: %v", err)
		}

		if conv.Title != "Test Group" {
			t.Errorf("expected title 'Test Group', got '%s'", conv.Title)
		}

		// List user conversations
		convs, err := chatSvc.ListUserConversations(ctx, creatorID)
		if err != nil {
			t.Fatalf("failed to list conversations: %v", err)
		}
		if len(convs) != 1 {
			t.Errorf("expected 1 conversation, got %d", len(convs))
		}

		// Send Message
		msg, _, err := chatSvc.SendMessage(ctx, conv.ID, creatorID, uuid.New(), "Hello World")
		if err != nil {
			t.Fatalf("failed to send message: %v", err)
		}

		if msg.Content != "Hello World" {
			t.Errorf("expected 'Hello World', got '%s'", msg.Content)
		}
	})
}
