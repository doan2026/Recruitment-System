# Recruitment System

Nền tảng tuyển dụng gồm các cổng Candidate, Recruiter và Admin, với 12 API service độc lập. Runtime hiện tại sử dụng Spring Boot/Java 21, NestJS/Node, Go, FastAPI, PostgreSQL/pgvector, Redis, Kafka, Cloudinary, LiveKit và Elasticsearch.

## 12 service độc lập

| Service | Công nghệ base |
| --- | --- |
| Auth, Application, Interview, Admin | Java 21 + Spring Boot 3; JPA/JDBC theo service |
| Profile, Company, Job & Search, Media | NestJS + Prisma/PostgreSQL |
| Chat, Notification, Video | Go 1.25 + PostgreSQL + Kafka; WebSocket/SSE/LiveKit |
| AI | Python 3.11 + FastAPI + sentence-transformers |

## Chạy cục bộ

1. Chạy `.\scripts\init-env.ps1` để tạo `.env` gốc và `.env` riêng cho frontend/từng service từ các file mẫu. Sau đó điền toàn bộ mật khẩu, API key và URL theo môi trường. `.env`, private key (`*.pem`), thư mục `secrets/` và Firebase service account đã được Git bỏ qua.
2. Trên Linux/macOS, chạy `./scripts/generate-jwt-keys.sh` để tạo cặp khóa RSA 3072 bit dạng PKCS#8/X.509 trong `secrets/`. Script sẽ từ chối ghi đè khóa đã tồn tại.
3. Chạy `docker compose up --build`.
4. Gateway sẵn sàng tại `http://localhost:8080`; ví dụ `http://localhost:8080/auth/health`.

Frontend ở `http://localhost:3000`: Candidate `/login`, Recruiter `/recruiter/login`, Admin `/admin/login`. Compose khai báo healthcheck đúng endpoint của từng runtime; dùng `docker compose ps` để kiểm tra. Các cổng API trực tiếp được publish trên loopback từ 8081 đến 8092; trình duyệt gọi `/api` cùng origin, frontend chuyển tiếp qua gateway.

Luồng đã kiểm chứng trên Docker thật được ghi tại [báo cáo kiểm thử hệ thống 16/10/2026](docs/system-regression-2026-10-16.md), gồm các chức năng đã chạy và giới hạn hiện tại.

## Quy ước quan trọng

- PostgreSQL dùng chung cluster/database, tách schema theo service. Chat/Notification/Video hiện dùng các bảng riêng trong `public` và bảng theo dõi migration riêng. Giao tiếp nghiệp vụ liên service qua API hoặc Kafka; không truy cập chéo bảng.
- Service chỉ nhận JWT RS256 có public key. Docker Compose mount public key vào các service xác thực JWT, còn private key chỉ được mount vào Auth Service. Không đưa nội dung khóa vào `.env` hoặc Git.
- Event liên service chỉ dùng các topic được định nghĩa trong `docs/architecture.md`; contract được khóa theo từng topic, không có envelope camelCase dùng chung. Riêng `job-events` v1 là payload snake_case đúng 16 trường, dùng `event_id` ổn định để idempotent và `aggregate_version` tăng đơn điệu để sắp thứ tự.
- Định nghĩa `INTERNAL_API_KEY` một lần trong `.env` gốc và dùng chung giá trị đó cho Application, Job & Search và AI Service khi gọi API nội bộ.
- File/media dùng Cloudinary. Điền `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` và `CLOUDINARY_API_SECRET` trong `.env` trước khi dùng upload hoặc presigned upload.

Job & Search ghi thay đổi Job và event vào transactional outbox trong cùng giao
dịch PostgreSQL. Publisher Kafka chạy độc lập với BullMQ/Elasticsearch, giao
event theo cơ chế at-least-once với lease heartbeat và giới hạn timeout/retry
cho từng lần gửi; `POST /jobs/reindex` chỉ cập nhật Elasticsearch. Salary của
Job và projection AI cùng dùng `NUMERIC(15,2)`.

Migration outbox cố ý không tự backfill event lịch sử. Với database đã có dữ
liệu, phải review baseline/replay trước khi bật producer mới. Cleanup/retention
cho các outbox row đã publish hiện chưa được tự động hóa.

## Cấu trúc

- Mỗi service có source và Dockerfile riêng trong `services/<service-name>`.
- Chat/Notification/Video chạy Go; AI và hai worker embedding chạy Python; frontend chạy Next.js.
- Mỗi service có `.env.example` mô tả riêng các biến runtime mà Docker Compose nạp qua `env_file`; không ghi credential trực tiếp trong Compose.
- `infra`: Nginx và khởi tạo PostgreSQL.
- `docs`: contract kiến trúc và event.

Profile/Company/Job/Media quản lý migration Prisma trong từng service. Các job `*-migrate` chạy một lần và thoát mã 0 trước khi API phụ thuộc khởi động; không phải API cần mở cổng.

Video call trong Tin nhắn dùng `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`. Interview hiện hỗ trợ lịch gặp trực tiếp; lịch phỏng vấn ONLINE chưa có hợp đồng cấp phòng/token và trả `INTERVIEW_ONLINE_NOT_READY`. Biến Jitsi cũ không bật được chức năng này.

Hai worker embedding sử dụng model sentence-transformers đã ghim revision và volume `ai-model-cache`. Lần đầu cần `EMBEDDING_MODEL_LOCAL_FILES_ONLY=false` để tải model. Khi cache đã đầy đủ, có thể đặt `true` trong `.env` gốc để khởi động bằng model local, tránh chờ kiểm tra mạng. Gợi ý/matching không cần key chatbot. `CHAT_ENABLED=false` chỉ tắt AI Assistant, không tắt gợi ý/matching. Email local hiện dùng SMTP Gmail thật; Compose không còn MailHog.
