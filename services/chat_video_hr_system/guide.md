# Realtime Interview System — Hướng dẫn triển khai DEMO

> Bản này bám theo kiến trúc gốc (`realtime-interview-architecture-full.md`), đã vá các kẽ hở
> phát hiện được và chốt công nghệ cụ thể để bạn code theo, không phải suy nghĩ thêm.
> Phạm vi: chạy toàn bộ bằng `docker compose up` trên máy dev.

---

## 0. Các kẽ hở đã vá so với bản gốc

| # | Vấn đề trong bản gốc | Cách vá trong bản demo này |
|---|---|---|
| 1 | WebSocket không gắn được header `Authorization` khi handshake | Client connect WS trước, **frame đầu tiên** gửi `{"type":"auth","token":"<JWT>"}`. Server chờ tối đa 5s, không nhận được → đóng connection. Không dùng query param (tránh lộ JWT trong access log của Nginx). |
| 2 | Access token stateless nhưng có `/auth/logout` — revoke cái gì? | Access token TTL ngắn (15 phút), **không** thể revoke sớm — chấp nhận rủi ro trong khung 15 phút. `/auth/logout` chỉ revoke **refresh token** (set `revoked_at`). Ghi rõ trade-off này trong README. |
| 3 | Refresh token lưu ở đâu tại frontend? | Trả về qua **httpOnly, Secure, SameSite=Strict cookie** (`refresh_token`), KHÔNG trả trong JSON body, KHÔNG lưu localStorage. Access token trả trong JSON body, frontend giữ trong memory (JS variable), không localStorage. |
| 4 | SSE qua Nginx bị buffer/timeout mặc định | `proxy_buffering off; proxy_read_timeout 3600s; chunked_transfer_encoding off;` cho riêng route `/api/notifications/stream`. |
| 5 | Client gửi trùng message khi mất kết nối & retry | Client tự sinh `client_message_id` (UUID) gửi kèm; `messages` table có `UNIQUE(conversation_id, client_message_id)`; insert dùng `ON CONFLICT DO NOTHING` rồi trả lại `message_id` đã tồn tại nếu trùng. |
| 6 | Field JSON `"key"` trong Kafka event trùng tên với khái niệm Kafka partition key | Đổi tên field trong payload thành `"aggregate_key"`, không dùng chữ `key` trơ trọi để tránh nhầm với Kafka message key (được set ở header khi produce, không nằm trong payload). |
| 7 | Kafka bản chuẩn (JVM) nặng cho demo | Dùng **Redpanda** — 1 container, không JVM, không Zookeeper, tương thích Kafka wire protocol 100%, code Go dùng lib `segmentio/kafka-go` như bình thường. |
| 8 | LiveKit self-host cần mở UDP range + TURN | Dùng **LiveKit Cloud** (free tier) — bỏ hẳn container SFU, Video Service chỉ gọi LiveKit Server SDK (Go) trỏ tới `LIVEKIT_URL` cloud. |
| 9 | Chưa chọn Go framework / migration tool | `net/http` chuẩn + router `go-chi/chi` (nhẹ, không lock-in). Migration bằng `golang-migrate/migrate` (file `.up.sql` / `.down.sql`). |
| 10 | Chưa có rate limit cụ thể | Nginx: `limit_req_zone` theo IP cho `/api/auth/*` (chống brute-force login), theo `user_id` (qua JWT, xử lý ở middleware Go) cho gửi message. |
| 11 | CORS chưa cấu hình | Middleware CORS ở từng Go service, whitelist origin từ env `ALLOWED_ORIGINS`, không dùng `*` khi có credentials/cookie. |
| 12 | FCM cần Firebase service account thật, không có sẵn khi demo | Đánh dấu **optional** — Notification Service chạy được đầy đủ qua SSE mà không cần FCM; FCM chỉ bật khi có `FCM_CREDENTIALS_JSON` trong `.env`. |

---

## 1. Cây thư mục repo

```text
interview-platform/
├── docker-compose.yml
├── .env.example
├── README.md
│
├── infrastructure/
│   └── nginx/
│       ├── nginx.conf
│       └── conf.d/
│           └── default.conf
│
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   ├── .env.example
│   └── src/
│       ├── api/
│       │   ├── auth.ts
│       │   ├── chat.ts
│       │   ├── video.ts
│       │   └── notification.ts
│       ├── auth/
│       │   ├── AuthProvider.tsx
│       │   ├── LoginPage.tsx
│       │   └── RegisterPage.tsx
│       ├── chat/
│       │   ├── ChatList.tsx
│       │   ├── ChatWindow.tsx
│       │   ├── MessageList.tsx
│       │   └── useChatSocket.ts
│       ├── video/
│       │   ├── VideoRoom.tsx
│       │   └── useLiveKitRoom.ts
│       ├── notification/
│       │   ├── NotificationBell.tsx
│       │   ├── NotificationList.tsx
│       │   └── useNotificationSSE.ts
│       └── router/
│           └── index.tsx
│
└── services/
    ├── auth-service/
    │   ├── Dockerfile
    │   ├── go.mod
    │   ├── go.sum
    │   ├── .env.example
    │   ├── cmd/server/main.go
    │   ├── migrations/
    │   │   ├── 0001_create_users.up.sql
    │   │   ├── 0001_create_users.down.sql
    │   │   ├── 0002_create_refresh_tokens.up.sql
    │   │   └── 0002_create_refresh_tokens.down.sql
    │   └── internal/
    │       ├── handler/
    │       │   ├── register.go
    │       │   ├── login.go
    │       │   ├── refresh.go
    │       │   ├── logout.go
    │       │   └── me.go
    │       ├── service/auth_service.go
    │       ├── repository/
    │       │   ├── user_repo.go
    │       │   └── refresh_token_repo.go
    │       ├── model/user.go
    │       ├── jwt/
    │       │   ├── sign.go
    │       │   └── verify.go
    │       ├── password/hash.go
    │       └── middleware/
    │           ├── cors.go
    │           ├── request_id.go
    │           └── rate_limit.go
    │
    ├── chat-service/
    │   ├── Dockerfile
    │   ├── go.mod
    │   ├── .env.example
    │   ├── cmd/server/main.go
    │   ├── migrations/
    │   │   ├── 0001_create_conversations.up.sql
    │   │   ├── 0002_create_conversation_members.up.sql
    │   │   └── 0003_create_messages.up.sql
    │   └── internal/
    │       ├── handler/
    │       │   ├── create_conversation.go
    │       │   ├── list_conversations.go
    │       │   ├── send_message.go
    │       │   ├── list_messages.go
    │       │   └── mark_read.go
    │       ├── ws/
    │       │   ├── hub.go              # quản lý map user_id -> connection
    │       │   ├── client.go
    │       │   └── auth_handshake.go   # xử lý frame auth đầu tiên
    │       ├── service/chat_service.go
    │       ├── repository/
    │       │   ├── conversation_repo.go
    │       │   └── message_repo.go
    │       ├── model/
    │       ├── kafka/producer.go
    │       ├── jwt/verify.go           # chỉ verify bằng public key
    │       └── middleware/
    │
    ├── video-service/
    │   ├── Dockerfile
    │   ├── go.mod
    │   ├── .env.example
    │   ├── cmd/server/main.go
    │   ├── migrations/
    │   │   ├── 0001_create_video_calls.up.sql
    │   │   └── 0002_create_video_call_participants.up.sql
    │   └── internal/
    │       ├── handler/
    │       │   ├── create_call.go
    │       │   ├── join_call.go
    │       │   └── end_call.go
    │       ├── service/video_service.go
    │       ├── repository/video_repo.go
    │       ├── livekit/
    │       │   └── token_issuer.go     # gọi LiveKit Server SDK, cấp media token
    │       ├── kafka/producer.go
    │       ├── jwt/verify.go
    │       └── middleware/
    │
    └── notification-service/
        ├── Dockerfile
        ├── go.mod
        ├── .env.example
        ├── cmd/server/main.go
        ├── migrations/
        │   ├── 0001_create_notifications.up.sql
        │   ├── 0002_create_push_tokens.up.sql
        │   └── 0003_create_processed_events.up.sql
        └── internal/
            ├── handler/
            │   ├── list_notifications.go
            │   ├── unread_count.go
            │   ├── mark_read.go
            │   └── register_push_token.go
            ├── sse/
            │   └── hub.go              # map user_id -> SSE writer
            ├── service/notification_service.go
            ├── repository/
            │   ├── notification_repo.go
            │   └── processed_event_repo.go
            ├── kafka/consumer.go       # có retry + DLQ
            ├── fcm/push.go             # optional, chỉ chạy nếu có credential
            ├── jwt/verify.go
            └── middleware/
```

---

## 2. `docker-compose.yml`

```yaml
version: "3.9"

services:
  nginx:
    image: nginx:1.27-alpine
    ports:
      - "8080:80"
    volumes:
      - ./infrastructure/nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./infrastructure/nginx/conf.d:/etc/nginx/conf.d:ro
    depends_on:
      - auth-service
      - chat-service
      - video-service
      - notification-service
    networks: [edge, backend]

  # ---------- Databases (mỗi service 1 DB riêng) ----------
  auth-db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: auth_db
      POSTGRES_USER: auth_user
      POSTGRES_PASSWORD: ${AUTH_DB_PASSWORD}
    volumes: [auth_db_data:/var/lib/postgresql/data]
    networks: [backend]

  chat-db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: chat_db
      POSTGRES_USER: chat_user
      POSTGRES_PASSWORD: ${CHAT_DB_PASSWORD}
    volumes: [chat_db_data:/var/lib/postgresql/data]
    networks: [backend]

  video-db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: video_db
      POSTGRES_USER: video_user
      POSTGRES_PASSWORD: ${VIDEO_DB_PASSWORD}
    volumes: [video_db_data:/var/lib/postgresql/data]
    networks: [backend]

  notification-db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: notification_db
      POSTGRES_USER: notification_user
      POSTGRES_PASSWORD: ${NOTIFICATION_DB_PASSWORD}
    volumes: [notification_db_data:/var/lib/postgresql/data]
    networks: [backend]

  # ---------- Event bus (Kafka-compatible, nhẹ) ----------
  redpanda:
    image: docker.redpanda.com/redpandadata/redpanda:v24.2.7
    command:
      - redpanda start
      - --smp 1
      - --memory 512M
      - --overprovisioned
      - --node-id 0
      - --kafka-addr PLAINTEXT://0.0.0.0:9092
      - --advertise-kafka-addr PLAINTEXT://redpanda:9092
    ports:
      - "9092:9092"
    networks: [backend]

  # ---------- Services ----------
  auth-service:
    build: ./services/auth-service
    env_file: ./services/auth-service/.env
    depends_on: [auth-db]
    networks: [backend]

  chat-service:
    build: ./services/chat-service
    env_file: ./services/chat-service/.env
    depends_on: [chat-db, redpanda]
    networks: [backend]

  video-service:
    build: ./services/video-service
    env_file: ./services/video-service/.env
    depends_on: [video-db, redpanda]
    networks: [backend]

  notification-service:
    build: ./services/notification-service
    env_file: ./services/notification-service/.env
    depends_on: [notification-db, redpanda]
    networks: [backend]

  frontend:
    build: ./frontend
    env_file: ./frontend/.env
    ports:
      - "5173:5173"
    networks: [edge]

networks:
  edge:
  backend:

volumes:
  auth_db_data:
  chat_db_data:
  video_db_data:
  notification_db_data:
```

**Ghi chú quan trọng:** các DB và Redpanda chỉ nằm trong network `backend`, **không** expose port ra `edge`/host trong bản production thật (ở đây để `9092`/DB port publish tạm cho bạn debug bằng tool ngoài khi demo — khi lên production hãy bỏ các dòng `ports:` của DB và Redpanda).

---

## 3. Nginx (`infrastructure/nginx/conf.d/default.conf`)

```nginx
upstream auth_service { server auth-service:8080; }
upstream chat_service { server chat-service:8080; }
upstream video_service { server video-service:8080; }
upstream notification_service { server notification-service:8080; }

limit_req_zone $binary_remote_addr zone=auth_limit:10m rate=5r/s;

server {
    listen 80;

    location /api/auth/ {
        limit_req zone=auth_limit burst=10 nodelay;
        proxy_pass http://auth_service/;
        proxy_set_header X-Request-ID $request_id;
    }

    location /api/chat/ {
        proxy_pass http://chat_service/api/;
        proxy_set_header X-Request-ID $request_id;
    }

    # WebSocket chat
    location /ws/chat {
        proxy_pass http://chat_service/ws/chat;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }

    location /api/video/ {
        proxy_pass http://video_service/api/;
        proxy_set_header X-Request-ID $request_id;
    }

    location /api/notifications/stream {
        proxy_pass http://notification_service/api/notifications/stream;
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;
        proxy_read_timeout 3600s;
        proxy_set_header Connection '';
        proxy_http_version 1.1;
    }

    location /api/notifications/ {
        proxy_pass http://notification_service/api/notifications/;
        proxy_set_header X-Request-ID $request_id;
    }
}
```

---

## 4. `.env.example` (root, chỉ để tham khảo — mỗi service có `.env` riêng)

```env
# Postgres passwords
AUTH_DB_PASSWORD=changeme
CHAT_DB_PASSWORD=changeme
VIDEO_DB_PASSWORD=changeme
NOTIFICATION_DB_PASSWORD=changeme
```

### `services/auth-service/.env.example`
```env
DATABASE_URL=postgres://auth_user:changeme@auth-db:5432/auth_db?sslmode=disable
JWT_PRIVATE_KEY=/run/secrets/jwt_private_key.pem   # nạp qua Docker secret hoặc mount file, KHÔNG hard-code
JWT_PUBLIC_KEY=/run/secrets/jwt_public_key.pem
JWT_ISSUER=interview-platform
JWT_AUDIENCE=interview-client
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=720h
ALLOWED_ORIGINS=http://localhost:5173
PORT=8080
```

### `services/chat-service/.env.example`
```env
DATABASE_URL=postgres://chat_user:changeme@chat-db:5432/chat_db?sslmode=disable
KAFKA_BROKERS=redpanda:9092
JWT_PUBLIC_KEY=/run/secrets/jwt_public_key.pem
ALLOWED_ORIGINS=http://localhost:5173
PORT=8080
```

### `services/video-service/.env.example`
```env
DATABASE_URL=postgres://video_user:changeme@video-db:5432/video_db?sslmode=disable
KAFKA_BROKERS=redpanda:9092
JWT_PUBLIC_KEY=/run/secrets/jwt_public_key.pem
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=...        # lấy từ LiveKit Cloud dashboard
LIVEKIT_API_SECRET=...     # KHÔNG gửi cho frontend
PORT=8080
```

### `services/notification-service/.env.example`
```env
DATABASE_URL=postgres://notification_user:changeme@notification-db:5432/notification_db?sslmode=disable
KAFKA_BROKERS=redpanda:9092
JWT_PUBLIC_KEY=/run/secrets/jwt_public_key.pem
FCM_CREDENTIALS_JSON=       # để trống ở demo -> service tự tắt tính năng FCM, chỉ SSE
PORT=8080
```

### `frontend/.env.example`
```env
VITE_API_BASE_URL=http://localhost:8080/api
VITE_WS_URL=ws://localhost:8080/ws/chat
VITE_LIVEKIT_URL=wss://your-project.livekit.cloud
```

> `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY`: sinh cặp key bằng
> `openssl genrsa -out jwt_private_key.pem 2048 && openssl rsa -in jwt_private_key.pem -pubout -out jwt_public_key.pem`,
> mount vào container qua `secrets:` của Docker Compose, không để trong `.env` dạng text ở production.

---

## 5. Dockerfile (dùng chung mẫu cho cả 4 Go service — nhẹ nhất có thể)

```dockerfile
FROM golang:1.23-alpine AS builder
WORKDIR /app
RUN apk add --no-cache git
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o server ./cmd/server

FROM scratch
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /app/server /server
EXPOSE 8080
ENTRYPOINT ["/server"]
```

`FROM scratch` cho image cuối chỉ vài MB (không có shell — nếu cần debug bằng `docker exec`, đổi `scratch` → `alpine:3.20` cho image dev, dùng `scratch` khi build production).

`frontend/Dockerfile` (dev):
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host"]
```

---

## 6. Danh sách endpoint đầy đủ

### Auth Service (public qua `/api/auth/*`)
```
POST /auth/register
POST /auth/login        -> trả access_token (JSON) + set-cookie refresh_token (httpOnly)
POST /auth/refresh      -> đọc cookie refresh_token, trả access_token mới
POST /auth/logout       -> revoke refresh_token (set revoked_at)
GET  /auth/me
GET  /health/live
GET  /health/ready
```

### Chat Service (qua `/api/chat/*` + `/ws/chat`)
```
POST   /api/chats
GET    /api/chats
GET    /api/chats/:conversation_id
POST   /api/chats/:conversation_id/messages     (fallback REST, không khuyến khích dùng thay WS)
GET    /api/chats/:conversation_id/messages?cursor=&limit=
PATCH  /api/messages/:message_id/read
WS     /ws/chat                                  (frame đầu: {"type":"auth","token":"..."})
GET    /health/live
GET    /health/ready
```

### Video Service (qua `/api/video/*`)
```
POST /api/video/calls
POST /api/video/calls/:call_id/join   -> trả LiveKit media token (ngắn hạn)
POST /api/video/calls/:call_id/end
GET  /api/video/calls
GET  /health/live
GET  /health/ready
```

### Notification Service (qua `/api/notifications/*`)
```
GET   /api/notifications
GET   /api/notifications/unread-count
GET   /api/notifications/stream        (SSE, hỗ trợ Last-Event-ID)
PATCH /api/notifications/:notification_id/read
POST  /api/notifications/push-tokens   (đăng ký FCM token, optional)
GET   /health/live
GET   /health/ready
```

---

## 7. Kafka (Redpanda) topics

```
message.created        key = conversation_id
message.read            key = conversation_id
video.call.started      key = call_id
video.call.ended        key = call_id
user.created             key = user_id
```

Payload chuẩn (đã đổi field `key` → `aggregate_key` để hết nhầm lẫn với Kafka message key):
```json
{
  "event_id": "evt_...",
  "event_type": "message.created",
  "aggregate_key": "msg_...",
  "aggregate_id": "conv_...",
  "created_at": "2026-09-18T09:00:00Z",
  "data": { "...": "..." }
}
```

Notification Service consumer bắt buộc check bảng `processed_events (event_id PK)` trước khi xử lý (idempotency), có retry 3 lần rồi đẩy sang topic `*.dlq` khi fail.

---

## 8. Thứ tự build cho demo (map theo repo ở trên)

1. **Auth Service** — chạy độc lập trước, test được `register/login/refresh/me` bằng curl/Postman, có cặp key RSA thật.
2. **Chat Service** — thêm `chat-db`, REST endpoints trước, sau đó thêm WebSocket + auth handshake bằng frame đầu tiên.
3. **Redpanda** — bật lên, Chat Service publish `message.created` sau khi lưu DB thành công.
4. **Notification Service** — consume `message.created`, lưu `notifications`, bật SSE. FCM để trống ở bước này.
5. **Video Service** — tạo project LiveKit Cloud, lấy `LIVEKIT_API_KEY/SECRET`, code `join_call` cấp token qua LiveKit Server SDK cho Go.
6. **Nginx + Frontend** — ghép toàn bộ, test luồng thật qua trình duyệt hai tab (giả lập 2 user).
7. **Hardening (sau demo)**: bật Docker secrets cho JWT keys thay vì mount file trực tiếp, thêm Prometheus/Grafana/Loki nếu cần quan sát, thêm Redis pub/sub nếu scale nhiều instance Notification Service.

---

## 9. Checklist trước khi coi demo là "xong"

- [ ] Không service nào tự ý `SELECT`/`UPDATE` DB của service khác (kiểm bằng cách mỗi service chỉ có 1 `DATABASE_URL` trỏ đúng DB mình)
- [ ] `JWT_PRIVATE_KEY` chỉ tồn tại trong container `auth-service`
- [ ] Refresh token cookie có `HttpOnly; Secure; SameSite=Strict` (kiểm bằng DevTools > Application > Cookies)
- [ ] WS handshake reject nếu frame đầu không phải `{"type":"auth",...}` hợp lệ trong 5s
- [ ] Mọi request có `request_id` xuyên suốt log (test bằng cách gửi `X-Request-ID` từ Postman, xem log 2-3 service có cùng ID không)
- [ ] Kafka consumer test bằng cách publish trùng `event_id` 2 lần — Notification chỉ tạo 1 notification
- [ ] Gửi trùng `client_message_id` 2 lần qua WS — Chat DB chỉ có 1 message
- [ ] `docker compose config` không có secret nào bị hard-code trực tiếp trong `docker-compose.yml`