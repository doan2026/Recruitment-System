package model

// Notification type constants used across the system.
const (
	// Chat & Video (existing)
	TypeNewMessage = "new_message"
	TypeVideoCall  = "video_call"

	// Recruitment workflow (new)
	TypeApplicationReceived      = "APPLICATION_RECEIVED"
	TypeApplicationStatusChanged = "APPLICATION_STATUS_CHANGED"
	TypeOfferReceived            = "OFFER_RECEIVED"
	TypeOfferAccepted            = "OFFER_ACCEPTED"
	TypeOfferDeclined            = "OFFER_DECLINED"
	TypeInterviewScheduled       = "INTERVIEW_SCHEDULED"
)
