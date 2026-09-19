package service

import (
	"context"

	"notification-service/internal/model"
	"notification-service/internal/repository"

	"github.com/google/uuid"
)

type NotificationService struct {
	notifRepo *repository.NotificationRepository
}

func NewNotificationService(notifRepo *repository.NotificationRepository) *NotificationService {
	return &NotificationService{notifRepo: notifRepo}
}

func (s *NotificationService) List(ctx context.Context, userID uuid.UUID, limit, offset int) ([]*model.Notification, error) {
	return s.notifRepo.ListByUserID(ctx, userID, limit, offset)
}

func (s *NotificationService) GetUnreadCount(ctx context.Context, userID uuid.UUID) (int, error) {
	return s.notifRepo.CountUnread(ctx, userID)
}

func (s *NotificationService) MarkAsRead(ctx context.Context, notifID, userID uuid.UUID) error {
	return s.notifRepo.MarkAsRead(ctx, notifID, userID)
}

func (s *NotificationService) MarkAllAsRead(ctx context.Context, userID uuid.UUID) error {
	return s.notifRepo.MarkAllAsRead(ctx, userID)
}
