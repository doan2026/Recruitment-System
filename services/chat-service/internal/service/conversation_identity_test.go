package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"chat-service/internal/model"
	"github.com/google/uuid"
)

func TestConversationIdentityIsViewerSpecificAndScoped(t *testing.T) {
	candidate, recruiter, outsider, companyID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	var lock sync.Mutex
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.Header.Get("X-Internal-Service") != "chat-service" || req.Header.Get("X-Internal-Api-Key") != "chat-contract-key-00000000000000001" || req.Header.Get("Authorization") != "" {
			t.Error("invalid internal authentication or forwarded bearer")
		}
		var body struct {
			UserIDs []uuid.UUID `json:"userIds"`
		}
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		for _, id := range body.UserIDs {
			if id == outsider {
				t.Error("unrelated member was enumerated")
			}
		}
		lock.Lock()
		requests++
		lock.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]any{"data": []identityRecord{
			{UserID: recruiter, CompanyID: companyID, Name: "Công ty An Việt", AvatarURL: "https://example.test/logo.png"},
			{UserID: candidate, Name: "Nguyễn Minh Anh", AvatarURL: "https://example.test/avatar.png"},
			{UserID: outsider, Name: "Never expose this unrelated person"},
		}})
	}))
	defer server.Close()
	resolver := NewConversationIdentityResolver(server.URL, "chat-contract-key-00000000000000001", server.URL, "chat-contract-key-00000000000000001")
	direct := &model.Conversation{Title: "Chat với Nhà tuyển dụng", Members: []uuid.UUID{candidate, recruiter}}
	group := &model.Conversation{Title: "Nhóm dự án", IsGroup: true, Members: []uuid.UUID{candidate, outsider}}
	foreign := &model.Conversation{Title: "Unrelated", Members: []uuid.UUID{recruiter, outsider}}
	resolver.Enrich(context.Background(), candidate, []*model.Conversation{direct, group, foreign})
	if direct.Counterpart == nil || direct.Counterpart.UserID != recruiter || direct.Counterpart.DisplayName != "Công ty An Việt" || direct.Counterpart.Kind != "COMPANY" || direct.Counterpart.CompanyID == nil || *direct.Counterpart.CompanyID != companyID {
		t.Fatalf("wrong candidate view: %#v", direct.Counterpart)
	}
	if group.Counterpart != nil || foreign.Counterpart != nil {
		t.Fatal("group or unrelated conversation identity was rewritten")
	}
	resolver.Enrich(context.Background(), recruiter, []*model.Conversation{direct})
	if direct.Counterpart == nil || direct.Counterpart.UserID != candidate || direct.Counterpart.DisplayName != "Nguyễn Minh Anh" || direct.Counterpart.Kind != "CANDIDATE" || direct.Counterpart.CompanyID != nil {
		t.Fatalf("wrong recruiter view: %#v", direct.Counterpart)
	}
	if direct.Title != "Chat với Nhà tuyển dụng" {
		t.Fatal("shared title was persisted as another viewer's identity")
	}
	lock.Lock()
	defer lock.Unlock()
	if requests != 4 {
		t.Fatalf("expected two batched lookups per viewer, got %d", requests)
	}
}

func TestIdentityLookupFailurePreservesConversation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) { w.WriteHeader(http.StatusServiceUnavailable) }))
	defer server.Close()
	viewer, peer := uuid.New(), uuid.New()
	conversation := &model.Conversation{Title: "Existing chat", Members: []uuid.UUID{viewer, peer}}
	resolver := NewConversationIdentityResolver(server.URL, "chat-contract-key-00000000000000001", server.URL, "chat-contract-key-00000000000000001")
	resolver.Enrich(context.Background(), viewer, []*model.Conversation{conversation})
	if conversation.Title != "Existing chat" || conversation.Counterpart != nil || len(conversation.Members) != 2 {
		t.Fatal("identity outage broke the conversation")
	}
}
