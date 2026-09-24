package service

import (
	"context"
	"fmt"
	"strings"

	"video-service/internal/kafka"
	"video-service/internal/livekit"
	"video-service/internal/model"
	"video-service/internal/repository"

	"github.com/google/uuid"
)

type VideoService struct {
	repo        *repository.VideoRepository
	tokenIssuer *livekit.TokenIssuer
	producer    *kafka.Producer
}

func NewVideoService(
	repo *repository.VideoRepository,
	tokenIssuer *livekit.TokenIssuer,
	producer *kafka.Producer,
) *VideoService {
	return &VideoService{
		repo:        repo,
		tokenIssuer: tokenIssuer,
		producer:    producer,
	}
}

func (s *VideoService) CreateCall(ctx context.Context, hostID uuid.UUID, title string, participantIDs []uuid.UUID) (*model.VideoCall, error) {
	if strings.TrimSpace(title) == "" {
		title = "Cuộc phỏng vấn mới"
	}

	roomName := fmt.Sprintf("interview_%s", uuid.New().String()[:8])
	call := &model.VideoCall{
		ID:       uuid.New(),
		RoomName: roomName,
		HostID:   hostID,
		Title:    title,
		Status:   "waiting",
	}

	if err := s.repo.CreateCall(ctx, call); err != nil {
		return nil, err
	}

	// Produce Kafka event
	if s.producer != nil {
		_ = s.producer.PublishCallStarted(ctx, call, participantIDs)
	}

	return call, nil
}

type JoinCallResult struct {
	Token      string           `json:"token"`
	RoomName   string           `json:"room_name"`
	LiveKitURL string           `json:"livekit_url"`
	Call       *model.VideoCall `json:"call"`
}

func (s *VideoService) JoinCall(ctx context.Context, callID, userID uuid.UUID, userName string) (*JoinCallResult, error) {
	call, err := s.repo.FindByID(ctx, callID)
	if err != nil {
		return nil, err
	}

	if call.Status == "ended" {
		return nil, fmt.Errorf("this video call has ended")
	}

	if err := s.repo.AddParticipant(ctx, callID, userID); err != nil {
		return nil, err
	}

	token, err := s.tokenIssuer.GenerateJoinToken(call.RoomName, userID.String(), userName)
	if err != nil {
		return nil, err
	}

	return &JoinCallResult{
		Token:      token,
		RoomName:   call.RoomName,
		LiveKitURL: s.tokenIssuer.LiveKitURL(),
		Call:       call,
	}, nil
}

func (s *VideoService) EndCall(ctx context.Context, callID, userID uuid.UUID) error {
	call, err := s.repo.FindByID(ctx, callID)
	if err != nil {
		return err
	}

	if call.HostID != userID {
		return fmt.Errorf("only host can end the call")
	}

	if err := s.repo.EndCall(ctx, callID); err != nil {
		return err
	}

	if s.producer != nil {
		_ = s.producer.PublishCallEnded(ctx, callID)
	}

	return nil
}

func (s *VideoService) ListCalls(ctx context.Context) ([]*model.VideoCall, error) {
	return s.repo.ListActiveCalls(ctx)
}
