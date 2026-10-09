package model

// ApplicationEvent represents an event from the application-events Kafka topic.
// Matches the contract: application-events.v1.schema.json
type ApplicationEvent struct {
	SchemaVersion    int     `json:"schema_version"`
	EventID          string  `json:"event_id"`
	Action           string  `json:"action"` // "STATUS_CHANGED" | "OFFER_SENT"
	ApplicationID    string  `json:"application_id"`
	JobID            string  `json:"job_id"`
	JobTitle         string  `json:"job_title"`
	CandidateID      string  `json:"candidate_id"`
	RecruiterID      string  `json:"recruiter_id"`
	ActorID          *string `json:"actor_id"`
	FromStatus       *string `json:"from_status"`
	ToStatus         string  `json:"to_status"`
	AggregateVersion int     `json:"aggregate_version"`
	OccurredAt       string  `json:"occurred_at"`
	OfferID          *string `json:"offer_id,omitempty"`
	OfferStatus      *string `json:"offer_status,omitempty"`
	OfferVersion     *int    `json:"offer_version,omitempty"`
}

// InterviewEvent represents an event from the interview-events Kafka topic.
// Matches the contract: interview-events.v1.schema.json
type InterviewEvent struct {
	SchemaVersion    int    `json:"schema_version"`
	EventID          string `json:"event_id"`
	Action           string `json:"action"` // "SCHEDULED"
	InterviewID      string `json:"interview_id"`
	ApplicationID    string `json:"application_id"`
	CandidateID      string `json:"candidate_id"`
	InterviewerID    string `json:"interviewer_id"`
	ActorID          string `json:"actor_id"`
	RoundNumber      int    `json:"round_number"`
	ScheduleRevision int    `json:"schedule_revision"`
	ScheduledStartAt string `json:"scheduled_start_at"`
	ScheduledEndAt   string `json:"scheduled_end_at"`
	Status           string `json:"status"`
	AggregateVersion int    `json:"aggregate_version"`
	OccurredAt       string `json:"occurred_at"`
}
