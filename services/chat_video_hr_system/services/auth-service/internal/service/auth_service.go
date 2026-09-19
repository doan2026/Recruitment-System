package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"auth-service/internal/jwt"
	"auth-service/internal/model"
	"auth-service/internal/password"
	"auth-service/internal/repository"

	"github.com/google/uuid"
)

var (
	ErrEmailAlreadyExists = errors.New("email already registered")
	ErrInvalidCredentials = errors.New("invalid email or password")
	ErrTokenExpired       = errors.New("token expired")
	ErrTokenRevoked       = errors.New("token revoked")
	ErrInvalidToken       = errors.New("invalid token")
)

type AuthService struct {
	userRepo   *repository.UserRepository
	tokenRepo  *repository.RefreshTokenRepository
	jwtSigner  *jwt.Signer
	refreshTTL time.Duration
}

func NewAuthService(
	userRepo *repository.UserRepository,
	tokenRepo *repository.RefreshTokenRepository,
	jwtSigner *jwt.Signer,
	refreshTTL time.Duration,
) *AuthService {
	return &AuthService{
		userRepo:   userRepo,
		tokenRepo:  tokenRepo,
		jwtSigner:  jwtSigner,
		refreshTTL: refreshTTL,
	}
}

type AuthResult struct {
	User         *model.User `json:"user"`
	AccessToken  string      `json:"access_token"`
	RefreshToken string      `json:"-"` // Not serialized to JSON body, sent via cookie
}

func hashToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func generateRandomToken() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

func (s *AuthService) Register(ctx context.Context, email, rawPassword, fullName string) (*AuthResult, error) {
	email = strings.TrimSpace(strings.ToLower(email))
	fullName = strings.TrimSpace(fullName)

	if email == "" || rawPassword == "" || fullName == "" {
		return nil, errors.New("all fields are required")
	}

	existing, err := s.userRepo.FindByEmail(ctx, email)
	if err == nil && existing != nil {
		return nil, ErrEmailAlreadyExists
	}

	pwdHash, err := password.Hash(rawPassword)
	if err != nil {
		return nil, err
	}

	user := &model.User{
		ID:           uuid.New(),
		Email:        email,
		PasswordHash: pwdHash,
		FullName:     fullName,
	}

	if err := s.userRepo.Create(ctx, user); err != nil {
		return nil, err
	}

	accessToken, err := s.jwtSigner.GenerateAccessToken(user.ID, user.Email, user.FullName)
	if err != nil {
		return nil, err
	}

	rawRefreshToken, err := generateRandomToken()
	if err != nil {
		return nil, err
	}

	tokenRecord := &model.RefreshToken{
		ID:        uuid.New(),
		UserID:    user.ID,
		TokenHash: hashToken(rawRefreshToken),
		ExpiresAt: time.Now().Add(s.refreshTTL),
	}

	if err := s.tokenRepo.Create(ctx, tokenRecord); err != nil {
		return nil, err
	}

	return &AuthResult{
		User:         user,
		AccessToken:  accessToken,
		RefreshToken: rawRefreshToken,
	}, nil
}

func (s *AuthService) Login(ctx context.Context, email, rawPassword string) (*AuthResult, error) {
	email = strings.TrimSpace(strings.ToLower(email))
	user, err := s.userRepo.FindByEmail(ctx, email)
	if err != nil {
		return nil, ErrInvalidCredentials
	}

	if !password.Check(rawPassword, user.PasswordHash) {
		return nil, ErrInvalidCredentials
	}

	accessToken, err := s.jwtSigner.GenerateAccessToken(user.ID, user.Email, user.FullName)
	if err != nil {
		return nil, err
	}

	rawRefreshToken, err := generateRandomToken()
	if err != nil {
		return nil, err
	}

	tokenRecord := &model.RefreshToken{
		ID:        uuid.New(),
		UserID:    user.ID,
		TokenHash: hashToken(rawRefreshToken),
		ExpiresAt: time.Now().Add(s.refreshTTL),
	}

	if err := s.tokenRepo.Create(ctx, tokenRecord); err != nil {
		return nil, err
	}

	return &AuthResult{
		User:         user,
		AccessToken:  accessToken,
		RefreshToken: rawRefreshToken,
	}, nil
}

func (s *AuthService) Refresh(ctx context.Context, rawRefreshToken string) (string, error) {
	if rawRefreshToken == "" {
		return "", ErrInvalidToken
	}

	tokenHash := hashToken(rawRefreshToken)
	record, err := s.tokenRepo.FindByHash(ctx, tokenHash)
	if err != nil {
		return "", ErrInvalidToken
	}

	if record.RevokedAt != nil {
		return "", ErrTokenRevoked
	}

	if time.Now().After(record.ExpiresAt) {
		return "", ErrTokenExpired
	}

	user, err := s.userRepo.FindByID(ctx, record.UserID)
	if err != nil {
		return "", err
	}

	return s.jwtSigner.GenerateAccessToken(user.ID, user.Email, user.FullName)
}

func (s *AuthService) Logout(ctx context.Context, rawRefreshToken string) error {
	if rawRefreshToken == "" {
		return nil
	}
	tokenHash := hashToken(rawRefreshToken)
	return s.tokenRepo.RevokeByTokenHash(ctx, tokenHash)
}

func (s *AuthService) GetProfile(ctx context.Context, userID uuid.UUID) (*model.User, error) {
	return s.userRepo.FindByID(ctx, userID)
}

func (s *AuthService) ListUsers(ctx context.Context, limit, offset int) ([]*model.User, error) {
	return s.userRepo.List(ctx, limit, offset)
}
