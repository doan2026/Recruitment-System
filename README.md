# Recruitment System

Nền tảng monorepo cho hệ thống tuyển dụng gồm Candidate, Recruiter, Company và Admin. Base này triển khai đúng ranh giới 11 service và hạ tầng trong tài liệu kiến trúc: Spring Boot 3/Java 21, NestJS/Node 20, Socket.IO, FastAPI, PostgreSQL/pgvector, MongoDB, Redis, Kafka (KRaft), Cloudinary và Elasticsearch.

## 11 service độc lập

| Service | Công nghệ base |
| --- | --- |
| Auth, Application, Interview, Admin | Java 21 + Spring Boot 3 + JPA |
| Profile, Company, Job & Search, Notification, Media | Node 20 + NestJS + Prisma |
| Chat | Node 20 + Socket.IO + MongoDB |
| AI | Python 3.11 + FastAPI + sentence-transformers |

## Chạy cục bộ

1. Chạy `.\scripts\init-env.ps1` để tạo `.env` gốc và `.env` riêng cho frontend/từng service từ các file mẫu. Sau đó điền toàn bộ mật khẩu, API key và URL theo môi trường. `.env`, private key (`*.pem`), thư mục `secrets/` và Firebase service account đã được Git bỏ qua.
2. Chạy `docker compose up --build`.
3. Gateway sẵn sàng tại `http://localhost:8080`; ví dụ `http://localhost:8080/auth/health`.

Frontend ở `http://localhost:3000`. Mỗi service hiện cung cấp `/health` để xác nhận khả dụng; đây là lớp nền chạy được, chưa bao gồm nghiệp vụ CRUD.

## Quy ước quan trọng

- PostgreSQL dùng một cluster/database `recruitment`, tách schema theo service; không truy cập bảng của service khác. Chỉ Admin đọc qua view đã được phê duyệt.
- Service chỉ nhận JWT RS256 có public key. Private key chỉ được mount vào Auth Service khi hiện thực phát hành token.
- Event liên service chỉ dùng các topic được định nghĩa trong `docs/architecture.md`; payload phải có `eventId`, `occurredAt`, `version` để consumer idempotent.
- Định nghĩa `INTERNAL_API_KEY` một lần trong `.env` gốc và dùng chung giá trị đó cho Application, Job & Search và AI Service khi gọi API nội bộ.
- File/media dùng Cloudinary. Điền `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` và `CLOUDINARY_API_SECRET` trong `.env` trước khi dùng upload hoặc presigned upload.

## Cấu trúc

- Mỗi service có source và Dockerfile riêng trong `services/<service-name>`.
- `services/chat-service`, `services/ai-service`, `frontend`: các runtime riêng.
- Mỗi service có `.env.example` mô tả riêng các biến runtime mà Docker Compose nạp qua `env_file`; không ghi credential trực tiếp trong Compose.
- `infra`: Nginx và khởi tạo PostgreSQL.
- `docs`: contract kiến trúc và event.

Mỗi service đã tách độc lập để bắt đầu nghiệp vụ. Với 5 service NestJS, khai báo model/migration Prisma trong `services/<service>/prisma/schema.prisma`.

`JITSI_BASE_URL` được cấu hình trong `.env`. Trước khi production, đặt URL Jitsi self-host và deploy cụm Jitsi riêng (web, prosody, jicofo và jvb) theo domain/TLS của môi trường.
