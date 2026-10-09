# Chat Service

This service handles real-time chat functionality using WebSockets.

## Requirements
- Go 1.23+
- PostgreSQL
- Redpanda/Kafka

## Environment Variables
- `DATABASE_URL`: PostgreSQL connection string
- `KAFKA_BROKERS`: Comma-separated list of Kafka brokers
- `JWT_PUBLIC_KEY`: Path to the JWT public key (or use `JWT_JWKS_URI`)
- `JWT_JWKS_URI`: URI for JWKS to verify tokens
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
