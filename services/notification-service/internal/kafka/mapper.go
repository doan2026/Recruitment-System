package kafka

import (
	"encoding/json"
	"fmt"

	"notification-service/internal/model"

	"github.com/google/uuid"
)

// notificationDraft holds the data needed to create a notification from an event.
type notificationDraft struct {
	UserID   uuid.UUID
	Type     string
	Title    string
	Body     string
	Metadata json.RawMessage
}

// mapApplicationEvent converts an ApplicationEvent into a notification draft.
// Returns nil when no notification should be created (e.g. actor is recipient).
func mapApplicationEvent(event model.ApplicationEvent) *notificationDraft {
	initialSubmission := event.Action == "STATUS_CHANGED" &&
		event.FromStatus == nil &&
		event.ToStatus == "APPLIED"

	actorIsCandidate := event.ActorID != nil && *event.ActorID == event.CandidateID
	candidateWithdrawal := event.ToStatus == "WITHDRAWN"
	candidateOfferResponse := event.OfferStatus != nil &&
		(*event.OfferStatus == "ACCEPTED" || *event.OfferStatus == "DECLINED")

	// Determine recipient
	var recipientIDStr string
	if initialSubmission || actorIsCandidate || candidateWithdrawal || candidateOfferResponse {
		recipientIDStr = event.RecruiterID
	} else {
		recipientIDStr = event.CandidateID
	}

	// Don't notify the actor themselves
	if event.ActorID != nil && *event.ActorID == recipientIDStr {
		return nil
	}

	recipientID, err := uuid.Parse(recipientIDStr)
	if err != nil {
		return nil
	}

	var notifType, title, body string

	switch {
	case event.Action == "OFFER_SENT":
		notifType = model.TypeOfferReceived
		title = "New offer received"
		body = fmt.Sprintf("You received an offer for %s.", event.JobTitle)

	case initialSubmission:
		notifType = model.TypeApplicationReceived
		title = "New application received"
		body = fmt.Sprintf("A candidate applied for %s.", event.JobTitle)

	case event.OfferStatus != nil && *event.OfferStatus == "ACCEPTED":
		notifType = model.TypeOfferAccepted
		title = "Offer accepted"
		body = fmt.Sprintf("The candidate accepted the offer for %s.", event.JobTitle)

	case event.OfferStatus != nil && *event.OfferStatus == "DECLINED":
		notifType = model.TypeOfferDeclined
		title = "Offer declined"
		body = fmt.Sprintf("The candidate declined the offer for %s.", event.JobTitle)

	default:
		notifType = model.TypeApplicationStatusChanged
		title = "Application status updated"
		body = fmt.Sprintf("The application for %s is now %s.", event.JobTitle, event.ToStatus)
	}

	metadata := map[string]string{
		"application_id": event.ApplicationID,
		"job_id":         event.JobID,
		"to_status":      event.ToStatus,
		"deep_link":      fmt.Sprintf("/applications/%s", event.ApplicationID),
	}
	if event.OfferID != nil {
		metadata["offer_id"] = *event.OfferID
	}
	metadataJSON, _ := json.Marshal(metadata)

	return &notificationDraft{
		UserID:   recipientID,
		Type:     notifType,
		Title:    title,
		Body:     body,
		Metadata: metadataJSON,
	}
}

// mapInterviewEvent converts an InterviewEvent into notification drafts.
// Returns nil when no notification should be created.
func mapInterviewEvent(event model.InterviewEvent) *notificationDraft {
	// Don't notify if the actor is the candidate
	if event.ActorID == event.CandidateID {
		return nil
	}

	candidateID, err := uuid.Parse(event.CandidateID)
	if err != nil {
		return nil
	}

	metadata := map[string]string{
		"interview_id":    event.InterviewID,
		"application_id":  event.ApplicationID,
		"action":          event.Action,
		"scheduled_start": event.ScheduledStartAt,
		"scheduled_end":   event.ScheduledEndAt,
		"deep_link":       fmt.Sprintf("/interviews/%s", event.InterviewID),
	}
	metadataJSON, _ := json.Marshal(metadata)

	return &notificationDraft{
		UserID:   candidateID,
		Type:     model.TypeInterviewScheduled,
		Title:    "Interview scheduled",
		Body:     "A new interview has been scheduled. Open the app for details.",
		Metadata: metadataJSON,
	}
}
