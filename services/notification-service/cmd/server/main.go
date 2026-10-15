package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"notification-service/internal/cursor"
	"notification-service/internal/db"
	"notification-service/internal/handler"
	"notification-service/internal/jwt"
	"notification-service/internal/kafka"
	"notification-service/internal/middleware"
	"notification-service/internal/repository"
	"notification-service/internal/service"
	"notification-service/internal/sse"
	"notification-service/migrations"

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
	log.Println("[Notification Service] Starting up...")

	dbURL := getEnv("DATABASE_URL", "postgres://notification_user:notif_secure_pass_123@localhost:5432/notification_db?sslmode=disable")
	kafkaBrokersStr := getEnv("KAFKA_BROKERS", "redpanda:9092")
	jwtPublicKeyPath := getEnv("JWT_PUBLIC_KEY", "/run/secrets/jwt-public.pem")
	jwtJwksURI := getEnv("JWT_JWKS_URI", "")
	allowedOriginsStr := getEnv("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173,http://localhost:8080")
	cursorHmacKey := getEnv("CURSOR_HMAC_KEY", "default_secret_hmac_key_for_cursor_pagination")
	port := getEnv("PORT", "8080")

	// Connect to Database with Retry
	database, err := db.ConnectWithRetry(dbURL, 15, 2*time.Second)
	if err != nil {
		log.Fatalf("[Notification Service] DB connection failed: %v", err)
	}
	defer database.Close()

	// Run auto-migrations
	if err := db.RunMigrations(database, migrations.FS); err != nil {
		log.Fatalf("[Notification Service] DB migration failed: %v", err)
	}

	// Initialize JWT Verifier
	verifier, err := jwt.NewVerifier(jwtJwksURI, jwtPublicKeyPath,
		getEnv("JWT_ISSUER", "https://auth.recruitment.local"), getEnv("JWT_AUDIENCE", "recruitment-api"))
	if err != nil {
		log.Fatalf("[Notification Service] Failed to initialize JWT verifier: %v", err)
	}

	// Repositories & Services
	notifRepo := repository.NewNotificationRepository(database)
	eventRepo := repository.NewProcessedEventRepository(database)
	notifSvc := service.NewNotificationService(notifRepo)

	// SSE Hub
	sseHub := sse.NewHub()

	// Kafka Consumer (chat-events, video.call.started)
	kafkaBrokers := strings.Split(kafkaBrokersStr, ",")
	topics := []string{"chat-events", "video.call.started", "video.call.ended", "application-events", "interview-events"}
	consumer := kafka.NewConsumer(kafkaBrokers, "notification-service-group", topics, notifRepo, eventRepo, sseHub)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go consumer.Start(ctx)

	// Handlers
	cursorSvc := cursor.NewCursorService(cursorHmacKey)
	notifHandler := handler.NewNotificationHandler(notifSvc, sseHub, cursorSvc)
	healthHandler := handler.NewHealthHandler(database)

	// Router setup
	r := chi.NewRouter()

	allowedOrigins := strings.Split(allowedOriginsStr, ",")
	r.Use(chimiddleware.Recoverer)
	r.Use(middleware.RequestID)
	r.Use(middleware.CORS(allowedOrigins))

	// Health routes
	r.Get("/health/live", healthHandler.Live)
	r.Get("/health/ready", healthHandler.Ready)
	r.Get("/api/health/live", healthHandler.Live)
	r.Get("/api/health/ready", healthHandler.Ready)

	// Notification routes
	registerNotifRoutes := func(mux chi.Router) {
		mux.Use(middleware.Auth(verifier))

		mux.Get("/stream", notifHandler.Stream)
		mux.Get("/online-status", notifHandler.OnlineStatus)
		mux.Get("/", notifHandler.List)
		mux.Get("/unread-count", notifHandler.UnreadCount)
		mux.Patch("/read-all", notifHandler.MarkAllRead)
		mux.Patch("/{notification_id}/read", notifHandler.MarkRead)
		mux.Post("/push-tokens", notifHandler.RegisterPushToken)
	}

	r.Route("/api/notifications", registerNotifRoutes)
	r.Route("/notifications", registerNotifRoutes)

	serverAddr := fmt.Sprintf(":%s", port)
	log.Printf("[Notification Service] Server listening on %s", serverAddr)
	if err := http.ListenAndServe(serverAddr, r); err != nil {
		log.Fatalf("[Notification Service] Server terminated: %v", err)
	}
}
