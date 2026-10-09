# Video Service

This service handles WebRTC video calls using LiveKit.

## Requirements
- Go 1.23+
- PostgreSQL
- Redpanda/Kafka
- LiveKit Server

## Environment Variables
- `DATABASE_URL`: PostgreSQL connection string
- `KAFKA_BROKERS`: Comma-separated list of Kafka brokers
- `JWT_PUBLIC_KEY`: Path to the JWT public key (or use `JWT_JWKS_URI`)
- `JWT_JWKS_URI`: URI for JWKS to verify tokens
- `LIVEKIT_URL`: LiveKit server URL
- `LIVEKIT_API_KEY`: LiveKit API Key
- `LIVEKIT_API_SECRET`: LiveKit API Secret
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
