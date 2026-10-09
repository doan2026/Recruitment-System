package cursor

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
)

type NotificationCursor struct {
	CreatedAt time.Time
	ID        string
}

type cursorPayload struct {
	V int       `json:"v"`
	U string    `json:"u"`
	T *string   `json:"t"`
	C string    `json:"c"`
	I string    `json:"i"`
}

type CursorService struct {
	key []byte
}

func NewCursorService(key string) *CursorService {
	return &CursorService{
		key: []byte(key),
	}
}

func (s *CursorService) Encode(userID uuid.UUID, notifType *string, cursor NotificationCursor) string {
	payload := cursorPayload{
		V: 1,
		U: userID.String(),
		T: notifType,
		C: cursor.CreatedAt.Format(time.RFC3339Nano),
		I: cursor.ID,
	}

	payloadJSON, _ := json.Marshal(payload)
	encodedPayload := base64.RawURLEncoding.EncodeToString(payloadJSON)
	signature := s.sign(encodedPayload)

	return encodedPayload + "." + signature
}

func (s *CursorService) Decode(encoded string, userID uuid.UUID, notifType *string) (*NotificationCursor, error) {
	if encoded == "" {
		return nil, nil
	}
	if len(encoded) > 1024 {
		return nil, errors.New("cursor too long")
	}

	parts := strings.Split(encoded, ".")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return nil, errors.New("invalid cursor format")
	}

	expectedSignature := s.sign(parts[0])
	if !hmac.Equal([]byte(parts[1]), []byte(expectedSignature)) {
		return nil, errors.New("cursor signature mismatch")
	}

	payloadJSON, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, errors.New("invalid cursor payload encoding")
	}

	var payload cursorPayload
	if err := json.Unmarshal(payloadJSON, &payload); err != nil {
		return nil, errors.New("invalid cursor payload json")
	}

	if payload.V != 1 || payload.U != userID.String() {
		return nil, errors.New("cursor scope mismatch")
	}
	if payload.T == nil && notifType != nil || payload.T != nil && notifType == nil || (payload.T != nil && notifType != nil && *payload.T != *notifType) {
		return nil, errors.New("cursor type mismatch")
	}

	createdAt, err := time.Parse(time.RFC3339Nano, payload.C)
	if err != nil {
		return nil, errors.New("invalid cursor created_at")
	}

	return &NotificationCursor{
		CreatedAt: createdAt,
		ID:        payload.I,
	}, nil
}

func (s *CursorService) sign(value string) string {
	h := hmac.New(sha256.New, s.key)
	h.Write([]byte(value))
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}
