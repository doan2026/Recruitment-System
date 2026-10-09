package livekit

import (
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/livekit/protocol/auth"
)

type TokenIssuer struct {
	livekitURL string
	apiKey     string
	apiSecret  string
}

func NewTokenIssuer(url, apiKey, apiSecret string) *TokenIssuer {
	if strings.Contains(apiKey, "placeholder") || apiKey == "" {
		log.Println("[LiveKit] NOTICE: Running with placeholder credentials. When ready for actual video/audio streams, update LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET in .env.")
	}
	return &TokenIssuer{
		livekitURL: url,
		apiKey:     apiKey,
		apiSecret:  apiSecret,
	}
}

func (ti *TokenIssuer) LiveKitURL() string {
	return ti.livekitURL
}

func (ti *TokenIssuer) GenerateJoinToken(roomName, identity, name string) (string, error) {
	apiKey := ti.apiKey
	apiSecret := ti.apiSecret

	if apiKey == "" || strings.Contains(apiKey, "placeholder") {
		return "", fmt.Errorf("LiveKit API key is not configured")
	}

	at := auth.NewAccessToken(apiKey, apiSecret)
	grant := &auth.VideoGrant{
		RoomJoin: true,
		Room:     roomName,
	}

	at.AddGrant(grant).
		SetIdentity(identity).
		SetName(name).
		SetValidFor(2 * time.Hour)

	jwtToken, err := at.ToJWT()
	if err != nil {
		return "", fmt.Errorf("failed to generate livekit token: %w", err)
	}

	return jwtToken, nil
}
