package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"chat-service/internal/db"
	"chat-service/internal/handler"
	"chat-service/internal/jwt"
	"chat-service/internal/kafka"
	"chat-service/internal/middleware"
	"chat-service/internal/repository"
	"chat-service/internal/service"
	"chat-service/internal/ws"
	"chat-service/migrations"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
)

func getEnv(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

func main() {
	log.Println("[Chat Service] Starting up...")

	dbURL := getEnv("DATABASE_URL", "postgres://chat_user:chat_secure_pass_123@localhost:5432/chat_db?sslmode=disable")
	kafkaBrokersStr := getEnv("KAFKA_BROKERS", "redpanda:9092")
	jwtPublicKeyPath := getEnv("JWT_PUBLIC_KEY", "/run/secrets/jwt_public_key")
	allowedOriginsStr := getEnv("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:8080")
	port := getEnv("PORT", "8080")

	// Connect to Database with Retry
	database, err := db.ConnectWithRetry(dbURL, 15, 2*time.Second)
	if err != nil {
		log.Fatalf("[Chat Service] DB connection failed: %v", err)
	}
	defer database.Close()

	// Run auto-migrations
	if err := db.RunMigrations(database, migrations.FS); err != nil {
		log.Fatalf("[Chat Service] DB migration failed: %v", err)
	}

	// Initialize JWT Verifier
	verifier, err := jwt.NewVerifier(jwtPublicKeyPath)
	if err != nil {
		log.Fatalf("[Chat Service] Failed to initialize JWT verifier: %v", err)
	}

	// Initialize Kafka Producer
	kafkaBrokers := strings.Split(kafkaBrokersStr, ",")
	producer := kafka.NewProducer(kafkaBrokers)
	defer producer.Close()

	// Repositories & Services
	convRepo := repository.NewConversationRepository(database)
	msgRepo := repository.NewMessageRepository(database)
	chatSvc := service.NewChatService(convRepo, msgRepo, producer)

	// WebSocket Hub
	hub := ws.NewHub()

	// Handlers
	chatHandler := handler.NewChatHandler(chatSvc)
	msgHandler := handler.NewMessageHandler(chatSvc, hub)
	healthHandler := handler.NewHealthHandler(database)

	// Router setup
	r := chi.NewRouter()

	allowedOrigins := strings.Split(allowedOriginsStr, ",")
	r.Use(chimiddleware.Recoverer)
	r.Use(middleware.RequestID)
	r.Use(middleware.CORS(allowedOrigins))

	// WebSocket route
	r.HandleFunc("/ws/chat", func(w http.ResponseWriter, req *http.Request) {
		ws.ServeWS(hub, chatSvc, verifier, w, req)
	})

	// Health routes
	r.Get("/health/live", healthHandler.Live)
	r.Get("/health/ready", healthHandler.Ready)
	r.Get("/api/health/live", healthHandler.Live)
	r.Get("/api/health/ready", healthHandler.Ready)

	// REST API Routes
	registerAPIRoutes := func(mux chi.Router) {
		mux.Use(middleware.Auth(verifier))

		mux.Post("/chats", chatHandler.CreateConversation)
		mux.Get("/chats", chatHandler.ListConversations)
		mux.Get("/chats/{conversation_id}", chatHandler.GetConversation)

		mux.Post("/chats/{conversation_id}/messages", msgHandler.SendMessage)
		mux.Get("/chats/{conversation_id}/messages", msgHandler.ListMessages)

		mux.Patch("/messages/{message_id}/read", msgHandler.MarkRead)
	}

	// Support both with and without /api prefix
	r.Group(registerAPIRoutes)
	r.Route("/api", registerAPIRoutes)

	serverAddr := fmt.Sprintf(":%s", port)
	log.Printf("[Chat Service] Server listening on %s", serverAddr)
	if err := http.ListenAndServe(serverAddr, r); err != nil {
		log.Fatalf("[Chat Service] Server terminated: %v", err)
	}
}
