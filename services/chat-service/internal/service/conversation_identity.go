package service

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"chat-service/internal/model"
	"github.com/google/uuid"
)

type identityRecord struct {
	UserID    uuid.UUID `json:"userId"`
	CompanyID uuid.UUID `json:"companyId"`
	Name      string    `json:"name"`
	AvatarURL string    `json:"avatarUrl"`
}

type ConversationIdentityResolver struct {
	companyURL, companyKey, profileURL, profileKey string
	client                                         *http.Client
}

func NewConversationIdentityResolver(companyURL, companyKey, profileURL, profileKey string) *ConversationIdentityResolver {
	return &ConversationIdentityResolver{
		companyURL: strings.TrimRight(companyURL, "/"), companyKey: companyKey,
		profileURL: strings.TrimRight(profileURL, "/"), profileKey: profileKey,
		client: &http.Client{Timeout: 1500 * time.Millisecond, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }},
	}
}

// Enrich only records that Chat has already authorized for the viewer. Batch
// non-self direct peers, never enumerate profiles from caller-supplied user IDs.
func (r *ConversationIdentityResolver) Enrich(ctx context.Context, viewer uuid.UUID, conversations []*model.Conversation) {
	peers := map[uuid.UUID]bool{}
	for _, conversation := range conversations {
		if conversation != nil {
			conversation.Counterpart = nil
		}
		if peer, ok := directPeer(viewer, conversation); ok {
			peers[peer] = true
		}
	}
	if len(peers) == 0 {
		return
	}
	ids := make([]uuid.UUID, 0, len(peers))
	for id := range peers {
		ids = append(ids, id)
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	var companies, profiles map[uuid.UUID]identityRecord
	var wait sync.WaitGroup
	wait.Add(2)
	go func() { defer wait.Done(); companies = r.lookup(ctx, r.companyURL, r.companyKey, ids, "company") }()
	go func() { defer wait.Done(); profiles = r.lookup(ctx, r.profileURL, r.profileKey, ids, "profile") }()
	wait.Wait()
	for _, conversation := range conversations {
		peer, ok := directPeer(viewer, conversation)
		if !ok {
			continue
		}
		if company, found := companies[peer]; found && company.CompanyID != uuid.Nil && strings.TrimSpace(company.Name) != "" {
			conversation.Counterpart = &model.ConversationIdentity{UserID: peer, Kind: "COMPANY", DisplayName: company.Name, AvatarURL: company.AvatarURL, CompanyID: &company.CompanyID}
		} else if profile, found := profiles[peer]; found {
			name := strings.TrimSpace(profile.Name)
			if name == "" {
				name = "Ứng viên chưa cập nhật tên"
			}
			conversation.Counterpart = &model.ConversationIdentity{UserID: peer, Kind: "CANDIDATE", DisplayName: name, AvatarURL: profile.AvatarURL}
		}
	}
}

func directPeer(viewer uuid.UUID, conversation *model.Conversation) (uuid.UUID, bool) {
	if conversation == nil || conversation.IsGroup || len(conversation.Members) != 2 {
		return uuid.Nil, false
	}
	if conversation.Members[0] == viewer && conversation.Members[1] != viewer && conversation.Members[1] != uuid.Nil {
		return conversation.Members[1], true
	}
	if conversation.Members[1] == viewer && conversation.Members[0] != viewer && conversation.Members[0] != uuid.Nil {
		return conversation.Members[0], true
	}
	return uuid.Nil, false
}

func (r *ConversationIdentityResolver) lookup(ctx context.Context, base, key string, ids []uuid.UUID, source string) map[uuid.UUID]identityRecord {
	result := map[uuid.UUID]identityRecord{}
	u, err := url.Parse(base)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || len(key) < 32 {
		return result
	}
	for start := 0; start < len(ids); start += 100 {
		if ctx.Err() != nil {
			break
		}
		end := start + 100
		if end > len(ids) {
			end = len(ids)
		}
		batch := ids[start:end]
		body, _ := json.Marshal(map[string]any{"userIds": batch})
		request, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/internal/v1/chat-identities", bytes.NewReader(body))
		if err != nil {
			break
		}
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("X-Internal-Service", "chat-service")
		request.Header.Set("X-Internal-Api-Key", key)
		response, err := r.client.Do(request)
		if err != nil {
			log.Printf("[Chat] %s identity lookup unavailable", source)
			break
		}
		var envelope struct {
			Data []identityRecord `json:"data"`
		}
		err = json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&envelope)
		response.Body.Close()
		if response.StatusCode != http.StatusOK || err != nil {
			log.Printf("[Chat] %s identity lookup unavailable", source)
			break
		}
		requested := map[uuid.UUID]bool{}
		for _, id := range batch {
			requested[id] = true
		}
		for _, record := range envelope.Data {
			if requested[record.UserID] {
				result[record.UserID] = record
			}
		}
	}
	return result
}
