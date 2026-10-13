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

Conversation reads use only Chat tables. Titles come from the conversation, with `Đối tác` as the empty-title fallback; participant IDs remain available. Profile names/avatars require a future owned projection or Profile API integration.
