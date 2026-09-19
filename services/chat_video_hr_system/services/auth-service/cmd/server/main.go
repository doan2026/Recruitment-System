package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"auth-service/internal/db"
	"auth-service/internal/handler"
	"auth-service/internal/jwt"
	"auth-service/internal/middleware"
	"auth-service/internal/repository"
	"auth-service/internal/service"
	"auth-service/migrations"

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
	log.Println("[Auth Service] Starting up...")

	dbURL := getEnv("DATABASE_URL", "postgres://auth_user:auth_secure_pass_123@localhost:5432/auth_db?sslmode=disable")
	jwtPrivateKeyPath := getEnv("JWT_PRIVATE_KEY", "/run/secrets/jwt_private_key")
	jwtPublicKeyPath := getEnv("JWT_PUBLIC_KEY", "/run/secrets/jwt_public_key")
	jwtIssuer := getEnv("JWT_ISSUER", "interview-platform")
	jwtAudience := getEnv("JWT_AUDIENCE", "interview-client")
	allowedOriginsStr := getEnv("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:8080")
	port := getEnv("PORT", "8080")

	accessTTLStr := getEnv("JWT_ACCESS_TTL", "15m")
	accessTTL, err := time.ParseDuration(accessTTLStr)
	if err != nil {
		accessTTL = 15 * time.Minute
	}

	refreshTTLStr := getEnv("JWT_REFRESH_TTL", "720h")
	refreshTTL, err := time.ParseDuration(refreshTTLStr)
	if err != nil {
		refreshTTL = 720 * time.Hour
	}

	// Connect to Database with Retry
	database, err := db.ConnectWithRetry(dbURL, 15, 2*time.Second)
	if err != nil {
		log.Fatalf("[Auth Service] DB connection failed: %v", err)
	}
	defer database.Close()

	// Run embedded migrations
	if err := db.RunMigrations(database, migrations.FS); err != nil {
		log.Fatalf("[Auth Service] DB migration failed: %v", err)
	}

	// Initialize JWT Signer & Verifier
	signer, err := jwt.NewSigner(jwtPrivateKeyPath, jwtIssuer, jwtAudience, accessTTL)
	if err != nil {
		log.Fatalf("[Auth Service] Failed to initialize JWT signer: %v", err)
	}

	verifier, err := jwt.NewVerifier(jwtPublicKeyPath, jwtIssuer, jwtAudience)
	if err != nil {
		log.Fatalf("[Auth Service] Failed to initialize JWT verifier: %v", err)
	}

	// Repositories & Services
	userRepo := repository.NewUserRepository(database)
	tokenRepo := repository.NewRefreshTokenRepository(database)
	authSvc := service.NewAuthService(userRepo, tokenRepo, signer, refreshTTL)

	// Handlers
	authHandler := handler.NewAuthHandler(authSvc, refreshTTL)
	userHandler := handler.NewUserHandler(authSvc)
	healthHandler := handler.NewHealthHandler(database)

	// Router setup
	r := chi.NewRouter()

	allowedOrigins := strings.Split(allowedOriginsStr, ",")
	r.Use(chimiddleware.Recoverer)
	r.Use(middleware.RequestID)
	r.Use(middleware.CORS(allowedOrigins))

	limiter := middleware.NewRateLimiter(60, time.Minute)
	r.Use(limiter.Limit)

	// Setup route registration helper
	setupRoutes := func(mux chi.Router) {
		mux.Get("/health/live", healthHandler.Live)
		mux.Get("/health/ready", healthHandler.Ready)

		mux.Post("/register", authHandler.Register)
		mux.Post("/login", authHandler.Login)
		mux.Post("/refresh", authHandler.Refresh)
		mux.Post("/logout", authHandler.Logout)

		// Protected routes
		mux.Group(func(protected chi.Router) {
			protected.Use(middleware.Auth(verifier))
			protected.Get("/me", userHandler.Me)
			protected.Get("/users", userHandler.ListUsers)
		})
	}

	// Register at root and with /auth and /api/auth prefix for transparent routing
	setupRoutes(r)
	r.Route("/auth", setupRoutes)
	r.Route("/api/auth", setupRoutes)

	serverAddr := fmt.Sprintf(":%s", port)
	log.Printf("[Auth Service] Server listening on %s", serverAddr)
	if err := http.ListenAndServe(serverAddr, r); err != nil {
		log.Fatalf("[Auth Service] Server terminated: %v", err)
	}
}
