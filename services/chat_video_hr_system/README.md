# Realtime Interview System (Microservices Demo)

Hệ thống phỏng vấn trực tuyến phân tán (Distributed Realtime Interview System) được xây dựng theo kiến trúc Microservices hiện đại, hỗ trợ:
- **Authentication**: JWT RSA256 stateless access token + HttpOnly SameSite=Strict refresh token cookie.
- **Realtime Chat**: WebSocket Hub với handshake bảo mật bằng frame đầu tiên, lưu trữ Postgres với cơ chế Idempotency chống gửi trùng.
- **Event-Driven Streaming**: Redpanda (Kafka-compatible) điều phối sự kiện giữa các microservices.
- **Realtime Notification**: Server-Sent Events (SSE) với buffer off, retry, idempotency và Dead Letter Queue (DLQ).
- **Video Conference**: LiveKit Server SDK cấp media token ngắn hạn cho phòng phỏng vấn WebRTC.
- **API Gateway**: Nginx điều hướng reverse proxy, rate limiting, SSE streaming và WebSocket upgrade.
- **Frontend**: React 18 + Vite + TypeScript + Tailwind CSS.

---

## 1. Cấu trúc Dự án

```text
chat_video_hr_system/
├── docker-compose.yml              # Quản lý 10 containers (4 Postgres, 1 Redpanda, 4 Go services, 1 Nginx, 1 Frontend)
├── .env                            # Biến môi trường hệ thống
├── secrets/
│   ├── jwt_private_key.pem         # Khóa RSA256 private (chỉ mount vào auth-service)
│   └── jwt_public_key.pem          # Khóa RSA256 public (mount vào các services để verify)
├── scripts/
│   ├── generate_keys.js            # Tự động sinh khóa RSA
│   └── generate_keys.sh
├── infrastructure/
│   └── nginx/
│       ├── nginx.conf
│       └── conf.d/default.conf     # Gateway routing, WebSocket upgrade, SSE tuning
├── services/
│   ├── auth-service/               # Go Chi + Postgres auth_db (Port 8080)
│   ├── chat-service/               # Go Chi + WS Hub + Postgres chat_db + Kafka Producer (Port 8080)
│   ├── notification-service/       # Go Chi + SSE Hub + Postgres notification_db + Kafka Consumer + DLQ (Port 8080)
│   └── video-service/              # Go Chi + LiveKit SDK + Postgres video_db + Kafka Producer (Port 8080)
└── frontend/                       # React 18 + Vite + TypeScript + Tailwind CSS (Port 5173)
```

---

## 2. Hướng dẫn Khởi chạy (Chỉ với 1 lệnh)

### Bước 1: Khởi động hệ thống
Mở terminal tại thư mục gốc dự án và chạy:

```bash
docker compose up --build
```

> **Lưu ý:**
> - Toàn bộ 4 database PostgreSQL sẽ **tự động chạy migration** ngay khi khởi động.
> - Dữ liệu được lưu trong **Docker Named Volumes**, không bị mất khi restart hay rebuild container.
> - Cặp khóa RSA trong thư mục `secrets/` đã được tạo sẵn.

---

## 3. Trải nghiệm & Kiểm thử (End-to-End Test)

### Bước 1: Mở 2 Tab Trình duyệt
- **Tab 1 (Thường):** Truy cập `http://localhost:5173`
  - Đăng ký tài khoản: `alice@example.com` / `Alice Nguyen` / `password123`
- **Tab 2 (Ẩn danh / Incognito):** Truy cập `http://localhost:5173`
  - Đăng ký tài khoản: `bob@example.com` / `Bob Tran` / `password123`

### Bước 2: Kiểm tra Chat & WebSocket
1. Ở **Tab 1 (Alice)**: Bấm icon **+** (Tạo hội thoại mới), chọn **Bob Tran** và đặt tên phòng (ví dụ: *Phỏng vấn Backend Go*).
2. Alice gửi tin nhắn: *"Chào Bob, bạn đã sẵn sàng phỏng vấn chưa?"*
3. Quan sát:
   - WebSocket gửi frame đầu tiên `auth` xác thực thành công.
   - Tin nhắn lưu vào `chat-db` kèm `client_message_id` chống trùng lặp.
   - Tin nhắn hiển thị tức thì trên cả 2 màn hình.

### Bước 3: Kiểm tra Kafka & Notification SSE
1. Ở **Tab 2 (Bob)**: Chuông thông báo ở thanh Navbar góc trên bên phải sẽ tự động nhảy số thông báo mới qua kết nối Server-Sent Events (SSE).
2. Bấm vào chuông để xem danh sách thông báo và đánh dấu đã đọc.

### Bước 4: Kiểm tra Video Call
1. Tại hộp chat hoặc chuyển sang tab **Phỏng vấn Video**:
2. Bấm nút **Tạo phòng** hoặc **Phòng Video Call**.
3. Hệ thống sẽ tạo phòng phỏng vấn và chuyển vào giao diện video:
   - Hiển thị preview camera, trạng thái Micro/Camera.
   - Nút bật/tắt Mic, bật/tắt Cam, Rời phòng.
   - Notification Service gửi thông báo tới các ứng viên.

---

## 4. Cấu hình LiveKit Cloud (Tùy chọn)

Khi bạn muốn kết nối WebRTC truyền hình ảnh và âm thanh thực tế giữa nhiều máy khác nhau qua internet:
1. Đăng ký tài khoản miễn phí tại [LiveKit Cloud](https://cloud.livekit.io).
2. Tạo project và lấy:
   - `LIVEKIT_URL` (ví dụ: `wss://your-project.livekit.cloud`)
   - `LIVEKIT_API_KEY`
   - `LIVEKIT_API_SECRET`
3. Cập nhật các giá trị này vào file `.env` và `services/video-service/.env`, `frontend/.env`.
4. Chạy lại `docker compose up -d video-service frontend`.

---

## 5. Danh sách API Gateway (qua Port 8080)

| Service | Đường dẫn | Chức năng |
|---|---|---|
| **Auth** | `POST /api/auth/register` | Đăng ký tài khoản |
| **Auth** | `POST /api/auth/login` | Đăng nhập (trả Access Token, set Cookie Refresh Token) |
| **Auth** | `POST /api/auth/refresh` | Cấp mới Access Token bằng Refresh Cookie |
| **Auth** | `POST /api/auth/logout` | Revoke Refresh Token |
| **Auth** | `GET /api/auth/me` | Lấy thông tin user hiện tại |
| **Auth** | `GET /api/auth/users` | Danh sách người dùng để kết nối chat |
| **Chat** | `GET, POST /api/chat/chats` | Danh sách và tạo mới hội thoại |
| **Chat** | `POST /api/chat/chats/{id}/messages` | Gửi tin nhắn (REST fallback) |
| **Chat** | `GET /api/chat/chats/{id}/messages` | Lịch sử tin nhắn |
| **Chat** | `WS /ws/chat` | WebSocket kết nối thời gian thực |
| **Notification** | `GET /api/notifications/stream` | SSE Stream thông báo tức thì |
| **Notification** | `GET /api/notifications` | Danh sách thông báo |
| **Notification** | `GET /api/notifications/unread-count`| Số thông báo chưa đọc |
| **Video** | `GET, POST /api/video/calls` | Danh sách và tạo cuộc gọi |
| **Video** | `POST /api/video/calls/{id}/join` | Tham gia và nhận LiveKit token |
| **Video** | `POST /api/video/calls/{id}/end` | Kết thúc cuộc gọi |
