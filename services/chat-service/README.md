# Chat Service

This service handles real-time chat functionality using WebSockets.

## Requirements
- Go 1.25+
- PostgreSQL
- Redpanda/Kafka

## Environment Variables
- `DATABASE_URL`: PostgreSQL connection string
- `KAFKA_BROKERS`: Comma-separated list of Kafka brokers
- `JWT_PUBLIC_KEY`: Path to the JWT public key (or use `JWT_JWKS_URI`)
- `JWT_JWKS_URI`: URI for JWKS to verify tokens
- `JWT_ISSUER`: Expected issuer (default: `https://auth.recruitment.local`)
- `JWT_AUDIENCE`: Expected audience (default: `recruitment-api`)
- `ALLOWED_ORIGINS`: Comma-separated list of allowed CORS origins
- `PORT`: Service port (default: 8080)

## Running
```bash
go run cmd/server/main.go
```

## Testing
```bash
go test ./...
```

JWT access tokens must use RS256, `typ=JWT`, an Auth RFC 7638 key thumbprint in `kid`, UUIDv4 `sub`/`jti`, a system role, `iat` and `exp`. Email and display name are optional; Auth does not include them in canonical access tokens.

Conversation reads use only Chat tables. After membership authorization, direct
conversation responses include a viewer-specific optional `counterpart`:
`{user_id, kind: COMPANY|CANDIDATE, display_name, avatar_url?, company_id?}`.
Candidate viewers see the current recruiter's company name/logo; recruiter
viewers see the candidate's current name/avatar. Group titles remain unchanged.
The persisted shared title is never overwritten with one viewer's peer name.

Chat batches only direct peer IDs from authorized conversations (100 per request)
to hidden Company/Profile `POST /internal/v1/chat-identities` APIs. Configure
`COMPANY_SERVICE_URL`, `COMPANY_INTERNAL_API_KEY`, `PROFILE_SERVICE_URL`, and
`PROFILE_INTERNAL_API_KEY`; each target requires its own distinct Chat key and
`X-Internal-Service: chat-service`. No user bearer is forwarded. No cross-service
database join or public user-directory endpoint is used. The metadata lookups
run in parallel, with a two-second total budget and no redirects; missing profiles
or upstream failures leave chat/history/send available with a title fallback.
Responses containing viewer-specific identity use `Cache-Control: private, no-store`.
