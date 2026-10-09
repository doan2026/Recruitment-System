package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"video-service/internal/db"
	"video-service/internal/handler"
	"video-service/internal/jwt"
	"video-service/internal/kafka"
	"video-service/internal/livekit"
	"video-service/internal/middleware"
	"video-service/internal/repository"
	"video-service/internal/service"
	"video-service/migrations"

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
	log.Println("[Video Service] Starting up...")

	dbURL := getEnv("DATABASE_URL", "postgres://video_user:video_secure_pass_123@localhost:5432/video_db?sslmode=disable")
	kafkaBrokersStr := getEnv("KAFKA_BROKERS", "redpanda:9092")
	jwtPublicKeyPath := getEnv("JWT_PUBLIC_KEY", "/run/secrets/jwt_public_key")
	jwtJwksURI := getEnv("JWT_JWKS_URI", "")
	livekitURL := getEnv("LIVEKIT_URL", "wss://your-project.livekit.cloud")
	livekitAPIKey := getEnv("LIVEKIT_API_KEY", "devkey")
	livekitAPISecret := getEnv("LIVEKIT_API_SECRET", "secret01234567890123456789012345")
	allowedOriginsStr := getEnv("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:8080")
	port := getEnv("PORT", "8080")

	// Connect to Database with Retry
	database, err := db.ConnectWithRetry(dbURL, 15, 2*time.Second)
	if err != nil {
		log.Fatalf("[Video Service] DB connection failed: %v", err)
	}
	defer database.Close()

	// Run auto-migrations
	if err := db.RunMigrations(database, migrations.FS); err != nil {
		log.Fatalf("[Video Service] DB migration failed: %v", err)
	}

	// Initialize JWT Verifier
	verifier, err := jwt.NewVerifier(jwtJwksURI, jwtPublicKeyPath)
	if err != nil {
		log.Fatalf("[Video Service] Failed to initialize JWT verifier: %v", err)
	}

	// Initialize Kafka Producer
	kafkaBrokers := strings.Split(kafkaBrokersStr, ",")
	producer := kafka.NewProducer(kafkaBrokers)
	defer producer.Close()

	// Initialize LiveKit Token Issuer
	tokenIssuer := livekit.NewTokenIssuer(livekitURL, livekitAPIKey, livekitAPISecret)

	// Repositories & Services
	videoRepo := repository.NewVideoRepository(database)
	videoSvc := service.NewVideoService(videoRepo, tokenIssuer, producer)

	// Handlers
	videoHandler := handler.NewVideoHandler(videoSvc)
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

	// Video API routes
	registerVideoRoutes := func(mux chi.Router) {
		mux.Use(middleware.Auth(verifier))

		mux.Post("/calls", videoHandler.CreateCall)
		mux.Get("/calls", videoHandler.ListCalls)
		mux.Post("/calls/{call_id}/join", videoHandler.JoinCall)
		mux.Post("/calls/{call_id}/end", videoHandler.EndCall)
		mux.Post("/calls/{call_id}/reject", videoHandler.RejectCall)
	}

	r.Group(registerVideoRoutes)
	r.Route("/api", registerVideoRoutes)
	r.Route("/api/video", registerVideoRoutes)

	serverAddr := fmt.Sprintf(":%s", port)
	log.Printf("[Video Service] Server listening on %s", serverAddr)
	if err := http.ListenAndServe(serverAddr, r); err != nil {
		log.Fatalf("[Video Service] Server terminated: %v", err)
	}
}
