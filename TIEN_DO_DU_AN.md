# BÁO CÁO TIẾN ĐỘ DỰ ÁN HỆ THỐNG TUYỂN DỤNG

> Ngày cập nhật: 25/08/2026
> Nhánh đối chiếu chính: `develop` tại commit `be3da01`
> Nhánh đang làm việc: `feature/application-service/application-evaluation`

## Phạm vi và quy ước đánh giá

Báo cáo được tổng hợp từ tài liệu phân công, tài liệu nghiệp vụ, tài liệu kiến trúc, lịch sử Git và mã nguồn thực tế. Một thư mục có Dockerfile hoặc endpoint health chỉ được xem là **scaffold**, chưa được xem là hoàn thành nghiệp vụ.

| Ký hiệu | Ý nghĩa |
| --- | --- |
| ✅ Hoàn thành | Đã có nghiệp vụ, test/build tương ứng và đã merge vào `develop` |
| 🟡 Một phần | Đã hoàn thành một số luồng hoặc đã code nhưng chưa merge/chưa kiểm thử tích hợp |
| ⏳ Pending | Mới có scaffold hoặc chưa có nghiệp vụ |

### Tóm tắt trạng thái

| Nhóm task | Người phụ trách | Trạng thái hiện tại |
| --- | --- | --- |
| Auth Service | Người 1 | ⏳ Scaffold |
| User/Profile Service | Người 1 | ⏳ Scaffold |
| File/Media Service | Người 1 | ⏳ Scaffold |
| Admin & Statistics Service | Người 1 | ⏳ Scaffold |
| Company Service | Người 2 | ✅ Nghiệp vụ chính đã merge |
| Job & Search Service | Người 2 | 🟡 Phần cốt lõi đã merge; AI recommendation và tích hợp thật còn thiếu |
| Application Service | Người 2 | 🟡 Submission, Bookmark, Tracking, Pipeline và quyền MEMBER/OWNER đã merge; Evaluation hoàn thành trên nhánh hiện tại, chưa merge |
| AI Service | Người 2 | ⏳ Scaffold |
| Interview & Video Call Service | Người 3 | ⏳ Scaffold |
| Chat Service | Người 3 | ⏳ Prototype realtime |
| Notification Service | Người 3 | ⏳ Scaffold |
| Hạ tầng dùng chung | Người 3 | 🟡 Docker Compose, Nginx, database và Kafka base đã có |
| Frontend | Phối hợp cả nhóm | ⏳ Trang khởi tạo |
| Tích hợp, kiểm thử và vận hành | Phối hợp cả nhóm | ⏳ Chưa chạy end-to-end |

---

# 1. Tổng hợp tất cả task hiện có

## T01 — Auth Service

- **Mục tiêu:** service duy nhất đăng ký, xác thực người dùng và phát hành JWT RS256 cho Candidate, Recruiter và Admin.
- **Công nghệ:** Spring Boot 3, Java 21, Spring Security, Spring Data JPA, PostgreSQL, Redis, Spring Mail, Google OAuth2.
- **Luồng hoạt động:** đăng ký và OTP email; đăng nhập email/mật khẩu; Google OAuth2; refresh-token rotation; quên/đặt lại mật khẩu; cung cấp public key.
- **Chức năng chính:** quản lý tài khoản, role, trạng thái khóa; access/refresh token; thu hồi phiên; OTP có hạn dùng; public-key endpoint; API nội bộ khóa/mở khóa tài khoản.
- **Phụ thuộc:** PostgreSQL, Redis, SMTP và Google OAuth. Tất cả service còn lại phụ thuộc hợp đồng JWT của task này.
- **Trạng thái:** mới có Spring Boot application, SecurityConfig và health; SecurityConfig hiện vẫn cho phép mọi request, chưa có nghiệp vụ xác thực thật.

## T02 — User/Profile Service

- **Mục tiêu:** quản lý hồ sơ Candidate và toàn bộ CV được dùng khi ứng tuyển hoặc tính embedding.
- **Công nghệ:** NestJS, TypeScript, Prisma, PostgreSQL, Kafka.
- **Luồng hoạt động:** hoàn thiện hồ sơ; upload CV PDF; tạo CV online; đặt CV mặc định; xem/xóa CV; phục vụ CV cho Application Service; phát `cv-events`.
- **Chức năng chính:** CRUD hồ sơ cá nhân, kỹ năng, học vấn, kinh nghiệm, chứng chỉ; quản lý nhiều CV; soft delete CV đã được sử dụng; API `GET /profile/cv?user_id=` và `GET /profile/cv/:id`.
- **Phụ thuộc:** Auth Service và File/Media Service; AI và Application phụ thuộc dữ liệu của service này.
- **Trạng thái:** chỉ có health endpoint và package/schema base; chưa có controller/service nghiệp vụ.

## T03 — File/Media Service

- **Mục tiêu:** nơi duy nhất giữ Cloudinary secret và quản lý metadata file của toàn hệ thống.
- **Công nghệ:** NestJS, TypeScript, Prisma, PostgreSQL, Cloudinary Node SDK.
- **Luồng hoạt động:** sinh signed upload; client upload trực tiếp lên Cloudinary; xác nhận metadata; xóa file đúng quyền; dọn file rác định kỳ.
- **Chức năng chính:** `POST /files/signature`, `POST /files`, `DELETE /files/:id`, xác minh MIME/dung lượng/thư mục, ownership và trạng thái file.
- **Phụ thuộc:** Auth; được Profile, Company, Chat, Interview và Application/Offer sử dụng.
- **Trạng thái:** chỉ có health endpoint, package và Prisma schema base.

## T04 — Admin & Statistics Service

- **Mục tiêu:** cổng quản trị, duyệt nội dung và tổng hợp số liệu toàn hệ thống mà không truy cập trái phép database của service khác.
- **Công nghệ:** Spring Boot 3, Java 21, Spring Data JPA, Spring Kafka, Scheduler, Apache POI, PostgreSQL.
- **Luồng hoạt động:** duyệt công ty; duyệt tin; khóa/mở người dùng; xử lý báo cáo vi phạm; consume sự kiện thống kê; xuất Excel/CSV.
- **Chức năng chính:** dashboard tổng quan; hàng đợi duyệt; quản lý report; snapshot thống kê; gọi REST Auth/Company/Job; consume `job-events` và `application-events`.
- **Phụ thuộc:** Auth, Company, Job & Search, Kafka.
- **Trạng thái:** chỉ có Spring Boot application và application.yml.

## T05 — Company Service

- **Mục tiêu:** quản lý hồ sơ doanh nghiệp, quy trình xác minh và recruiter thuộc công ty.
- **Công nghệ:** NestJS, TypeScript, Prisma, PostgreSQL, JWT RS256, Swagger.
- **Luồng hoạt động:** tạo hồ sơ công ty; cập nhật; gửi duyệt và Admin xác minh; hiển thị trang công khai; mời, chấp nhận, xóa và chuyển quyền thành viên.
- **Chức năng chính:** profile CRUD, trạng thái `PENDING/VERIFIED/REJECTED`, ownership, invitation token, public company page và endpoint tra cứu membership cho service khác.
- **Phụ thuộc:** Auth, File/Media và Admin.
- **Trạng thái:** nghiệp vụ chính đã merge vào `develop` qua ba feature branch.

## T06 — Job & Search Service

- **Mục tiêu:** nguồn dữ liệu gốc của tin tuyển dụng và công cụ tìm kiếm việc làm.
- **Công nghệ:** NestJS, TypeScript, Prisma, PostgreSQL, Elasticsearch, BullMQ, Redis, KafkaJS.
- **Luồng hoạt động:** recruiter tạo/sửa tin nháp; gửi duyệt; Admin duyệt/từ chối; đóng/hết hạn tin; tìm kiếm và lọc; đồng bộ Elasticsearch; phát `job-events`; lấy gợi ý từ AI.
- **Chức năng chính:** Job CRUD, state machine `DRAFT → PENDING_APPROVAL → PUBLISHED/REJECTED → CLOSED/EXPIRED`, tìm kiếm full-text và filter, reindex, PostgreSQL fallback, endpoint kiểm tra job còn nhận hồ sơ.
- **Phụ thuộc:** Auth, Company, Admin, Elasticsearch, Redis, Kafka và AI.
- **Trạng thái:** CRUD, publishing, search, indexing/event và availability đã merge; recommendation từ AI chưa có.

## T07 — Application Service

- **Mục tiêu:** quản lý toàn bộ vòng đời ứng tuyển từ lúc Candidate nộp đơn đến khi tuyển hoặc bị loại.
- **Công nghệ:** Spring Boot 3, Java 21, Spring Security Resource Server, Spring Data JPA, Flyway, PostgreSQL, Spring Kafka, transactional outbox.
- **Luồng hoạt động:** nộp đơn; Bookmark; Candidate theo dõi timeline; HR lọc và quản lý hồ sơ; state machine; đánh giá nội bộ; gửi/phản hồi Offer; thống kê recruiter.
- **Chức năng chính:** Application, ApplicationHistory, Evaluation, Offer, Bookmark; optimistic locking; phân quyền theo Candidate/công ty; phát `application-events`.
- **Phụ thuộc:** Auth, Profile, Job, Company, AI, File/Media và Notification qua Kafka.
- **Trạng thái:** submission, Bookmark, tracking, pipeline và quyền MEMBER/OWNER đã merge; Evaluation hoàn thành trên nhánh hiện tại nhưng chưa merge; Offer và stats chưa làm.

## T08 — AI Service

- **Mục tiêu:** tạo embedding CV/Job, chấm điểm tương đồng, gợi ý việc và chatbot hỗ trợ Candidate.
- **Công nghệ theo tài liệu:** Python, FastAPI, sentence-transformers `all-MiniLM-L6-v2`, pgvector, Redis, Kafka và Anthropic Claude.
- **Công nghệ scaffold hiện tại:** FastAPI, sentence-transformers, PostgreSQL/pgvector và `google-genai`/Gemini.
- **Luồng hoạt động:** consume `cv-events`; consume `job-events`; cập nhật/xóa vector; cosine similarity; recommend jobs/CVs; match CV-job; chatbot có lịch sử ngắn hạn.
- **Chức năng chính:** `/ai/recommend/jobs`, `/ai/recommend/candidates`, `/ai/match`, `/ai/chat` và consumer idempotent.
- **Phụ thuộc:** schema `cv-events`, `job-events`, Kafka, PostgreSQL pgvector và Redis.
- **Trạng thái:** có health và chat placeholder; chưa có embedding, consumer, vector store hoặc gọi mô hình thật.

## T09 — Interview & Video Call Service

- **Mục tiêu:** quản lý lịch phỏng vấn và phòng video Jitsi.
- **Công nghệ:** Spring Boot 3, Java 21, Spring Data JPA, WebClient, Spring Kafka, PostgreSQL, Jitsi.
- **Luồng hoạt động:** HR đặt lịch; Candidate xác nhận/đề nghị đổi lịch; vào phòng video; đánh giá sau phỏng vấn; hủy/no-show; xem lịch.
- **Chức năng chính:** kiểm tra quyền theo application; chống trùng lịch; vòng phỏng vấn; feedback; room URL/token; phát `interview-events`.
- **Phụ thuộc:** Auth, Application, Notification và Jitsi.
- **Trạng thái:** mới có Spring Boot application và cấu hình base.

## T10 — Chat Service

- **Mục tiêu:** nhắn tin realtime 1-1 giữa Candidate và Recruiter theo ngữ cảnh job/application.
- **Công nghệ:** Node.js, Express, Socket.IO, Mongoose, MongoDB, Redis Adapter, KafkaJS.
- **Luồng hoạt động:** xác thực socket; tạo conversation; gửi/nhận tin; file đính kèm; typing/seen; phân trang lịch sử.
- **Chức năng chính:** conversation và message persistence, quyền participant, unread count, reconnect, multi-instance Socket.IO, phát `chat-events`.
- **Phụ thuộc:** Auth public key, File/Media, Redis, MongoDB, Kafka và Notification.
- **Trạng thái:** có prototype broadcast cho typing/message/seen và health; JWT verification còn TODO, chưa lưu MongoDB và chưa tích hợp Redis/Kafka.

## T11 — Notification Service

- **Mục tiêu:** trung tâm duy nhất gửi thông báo in-app, push và email.
- **Công nghệ:** NestJS, TypeScript, Prisma, PostgreSQL, KafkaJS, BullMQ, Redis, Firebase Admin, Nodemailer.
- **Luồng hoạt động:** consume event; chống trùng; đưa job vào queue; worker gửi theo kênh; retry; quản lý notification/device; nhắc lịch.
- **Chức năng chính:** consume `application-events`, `interview-events`, `chat-events`; in-app inbox; read/read-all; FCM token; SMTP; log gửi thất bại.
- **Phụ thuộc:** Kafka, Redis, FCM và SMTP.
- **Trạng thái:** chỉ có health endpoint và dependency base.

## T12 — Hạ tầng dùng chung

- **Mục tiêu:** chạy toàn bộ hệ thống bằng Docker Compose và định tuyến qua một API Gateway.
- **Công nghệ:** Docker Compose, Nginx, PostgreSQL/pgvector, MongoDB, Redis, Kafka KRaft, Elasticsearch và Jitsi.
- **Luồng hoạt động:** khởi động database/broker; tạo schema và Kafka topic; build 11 service; gateway route; health check; lưu volume; dựng Jitsi.
- **Chức năng chính:** mạng nội bộ, env/secrets, service dependency, topic initialization, persistent volumes, gateway HTTP/WebSocket.
- **Trạng thái:** Compose, Nginx base, schema PostgreSQL, Kafka topics, Redis/MongoDB/Elasticsearch và volumes đã có; Jitsi và hardening còn thiếu.

## T13 — Frontend Web

- **Mục tiêu:** giao diện Candidate, Recruiter và Admin cho các luồng end-to-end.
- **Công nghệ:** Next.js 14, React 18, TypeScript.
- **Chức năng chính:** auth UI; hồ sơ/CV; công ty; job search/detail; apply/bookmark; recruiter pipeline/offer/dashboard; interview/video/chat/notification; admin console.
- **Phụ thuộc:** API Gateway và hợp đồng API của toàn bộ backend.
- **Trạng thái:** mới có layout và trang “Platform base is running”.

## T14 — Tích hợp, kiểm thử và vận hành

- **Mục tiêu:** chứng minh các luồng xuyên service chạy thật, ổn định và có thể triển khai.
- **Công nghệ/công cụ:** unit/integration/E2E test, Docker Compose, CI/CD, Swagger/OpenAPI, logging/metrics/tracing.
- **Đầu ra:** test contract REST/Kafka; migration sạch; test concurrency/idempotency; security test; smoke test; tài liệu môi trường; backup/restore; monitoring.
- **Trạng thái:** đã có unit test tập trung ở Company, Job/Search và Application; Application Pipeline đã có integration test với PostgreSQL 16 và Apache Kafka 3.8 thật qua Testcontainers; chưa có E2E toàn hệ thống.

---

# 2. Danh sách task ĐÃ làm được

## 2.1 Company Service — đã merge vào `develop`

### Company Profile — PR #1

- Tạo công ty và OWNER membership trong một transaction.
- Chặn một recruiter sở hữu/tham gia nhiều công ty.
- Xem công ty của recruiter, danh sách công ty và trang công ty công khai.
- Cập nhật profile theo quyền OWNER; quản lý logo/media reference và thông tin doanh nghiệp.
- JWT RS256 guard, role guard, validation, response envelope, Swagger và Prisma.

### Company Verification — PR #2

- Recruiter gửi hồ sơ xác minh.
- Admin lấy danh sách chờ duyệt và approve/reject.
- Lưu trạng thái, lý do từ chối và thông tin người duyệt.
- Cho phép resubmit theo state machine; ngăn thao tác không hợp lệ.

### Company Members — PR #3

- OWNER tạo hoặc làm mới lời mời thành viên.
- Recruiter chấp nhận invitation có thời hạn.
- Liệt kê và xóa MEMBER; không cho xóa OWNER hiện tại.
- Chuyển quyền OWNER an toàn trong transaction.
- Endpoint `by-user/:userId` phục vụ kiểm tra quyền liên service.
- Mã nguồn hiện có 32 ca unit test cho JWT, profile, verification và membership.

## 2.2 Job & Search Service — đã merge vào `develop`

### Job CRUD — PR #4

- Recruiter thuộc công ty VERIFIED tạo job ở trạng thái DRAFT.
- Xem danh sách job được phép quản lý, xem job công khai và cập nhật job.
- Kiểm tra ownership/member role, salary, deadline, skills và các trường nghiệp vụ.
- Prisma schema/migration, JWT/role guard, Swagger và chuẩn response/error.

### Job Publishing Lifecycle — PR #6

- Gửi DRAFT sang `PENDING_APPROVAL`.
- Admin lấy danh sách pending, approve hoặc reject kèm lý do.
- Recruiter đóng tin; scheduler chuyển tin quá hạn sang `EXPIRED`.
- Chặn sửa/đăng/đóng ở trạng thái không hợp lệ.

### Job Search — PR #7

- Tìm kiếm job PUBLISHED theo từ khóa và bộ lọc.
- Hỗ trợ pagination/sort và Elasticsearch.
- Có PostgreSQL fallback khi Elasticsearch không khả dụng.

### Elasticsearch Indexing và Job Events — PR #8

- Đồng bộ create/update/status/delete sang Elasticsearch.
- Có reindex endpoint và hàng đợi xử lý.
- Phát `job-events` cho AI/Admin, dùng event ID để consumer có thể deduplicate.
- Có retry/fallback khi hạ tầng tìm kiếm hoặc Kafka gặp lỗi.

### Job Availability — PR #9

- Endpoint nội bộ `GET /jobs/:id/exists` dùng shared API key.
- Trả trạng thái tồn tại, còn nhận hồ sơ, lý do, company/recruiter/job metadata và deadline.
- Application Service đã sử dụng hợp đồng này khi Candidate nộp đơn hoặc Bookmark.
- Mã nguồn Job/Search hiện có 15 ca unit test.

## 2.3 Application Service — phần đã merge vào `develop`

### Application Submission — PR #11

- Candidate nộp đơn với `jobId`, `cvId`, cover letter và source.
- Xác minh JWT role CANDIDATE và subject UUID.
- Gọi Job Service kiểm tra tin còn nhận hồ sơ.
- Gọi Profile Service kiểm tra CV thuộc Candidate.
- Chặn một đơn active cho cùng Candidate/job; cho nộp lại sau 30 ngày kể từ REJECTED.
- Tạo Application `APPLIED`, ApplicationHistory đầu tiên và outbox trong một transaction.
- Partial unique index chống submit trùng khi concurrent; `@Version` cho optimistic locking.
- Outbox publisher phát `application-events` và retry có backoff.

### Bookmark — PR #12

- Candidate lưu job active, xem danh sách và bỏ lưu idempotent.
- Chặn bookmark trùng bằng unique constraint.
- Job đã lưu vẫn được giữ khi CLOSED/EXPIRED; phản hồi kèm availability metadata.
- Khi Job Service tạm lỗi, dữ liệu Bookmark gốc vẫn có thể được trả về.

### Application Tracking — PR #13

- Candidate xem danh sách đơn của chính mình.
- Candidate hoặc recruiter liên quan xem chi tiết và timeline.
- Recruiter được xác minh membership qua Company Service và so khớp `companyId`.
- Chặn Candidate khác/recruiter công ty khác; trả lỗi 403/404 phù hợp.
- Timeline được sắp xếp tăng dần và không trộn Evaluation nội bộ.
- Phần đã merge có 17 unit test.

## 2.4 Application Pipeline — đã merge vào `develop`

> Pipeline đã được merge qua PR #14 tại merge commit `08cb887`; commit tính năng `c0f5a0c` đã có trong lịch sử `develop`.

- Recruiter lọc hồ sơ theo company, job, status và khoảng thời gian; có pagination và sort theo ngày/điểm match.
- Recruiter chuyển `APPLIED → REVIEWING → INTERVIEW` hoặc chuyển đơn active sang `REJECTED`.
- Bắt buộc có lý do khi REJECTED.
- Candidate rút đơn active sang `WITHDRAWN`.
- Dùng `expectedVersion` và atomic update để phát hiện hai thao tác đồng thời.
- Mỗi lần chuyển trạng thái ghi history và outbox `STATUS_CHANGED` trong transaction.
- Contract Company Service được kiểm tra fail-closed với `companyId` và `memberRole`.
- Cả MEMBER và OWNER được xem, lọc và xử lý hồ sơ của mọi job cùng công ty; recruiter công ty khác bị chặn.
- Toàn bộ Application Service chạy đạt 40/40 unit test và 7/7 integration test với PostgreSQL/Kafka; build JAR thành công.

## 2.5 Application Evaluation — hoàn thành trên nhánh hiện tại (chưa merge)

- Flyway V3 tạo bảng `evaluations` với `criteria_json JSONB`, khóa ngoại cascade về Application, check constraint và index theo application/time.
- Endpoint `POST /applications/:id/evaluation` chỉ dành cho recruiter; cả MEMBER và OWNER được đánh giá application cùng công ty, recruiter công ty khác bị chặn `403`.
- Validate score và từng điểm tiêu chí trong khoảng `0–100`, tối đa hai chữ số thập phân; criteria có `1–20` tên duy nhất; note tối đa 2.000 ký tự.
- `evaluator_id` lấy từ JWT subject và `created_at` lấy từ clock phía server; client không thể giả mạo người đánh giá hoặc thời gian.
- Unique constraint `(application_id, evaluator_id)` kết hợp precheck và xử lý race condition, trả `409` khi cùng recruiter đánh giá lặp.
- Evaluation là dữ liệu nội bộ: API Candidate, chi tiết đơn và timeline không trả dữ liệu đánh giá.
- Full verify đạt 67/67 unit test và 14/14 integration test; `BUILD SUCCESS` với PostgreSQL/Kafka qua Testcontainers.

## 2.6 Hạ tầng nền đã có

- Monorepo tách 11 service, frontend, Dockerfile và `.env.example`.
- Docker Compose định nghĩa API Gateway, PostgreSQL/pgvector, MongoDB, Redis, Kafka KRaft, Elasticsearch, 11 backend service và frontend.
- PostgreSQL khởi tạo schema riêng cho từng service.
- Kafka-init tạo năm topic: `job-events`, `cv-events`, `application-events`, `interview-events`, `chat-events`.
- Nginx có upstream và route cơ bản cho Auth, Profile, Company, Job, Application, Interview, Notification, Media, Admin, AI và Chat WebSocket.
- Có volume cho PostgreSQL, MongoDB, Redis, Kafka và Elasticsearch.

---

# 3. Danh sách task CHƯA làm (Pending)

## P01 — Hoàn tất và bàn giao Application Pipeline

- [x] Tạo Pull Request vào `develop`, review và merge qua PR #14 (`08cb887`).
- [x] Xác nhận commit `c0f5a0c` đã có trong lịch sử `develop`.
- [x] Chạy Flyway/JPA với PostgreSQL 16 thật; kiểm tra JPQL atomic update, history và transactional outbox bằng Testcontainers.
- [x] Chạy Apache Kafka 3.8 thật: consumer probe nhận đúng `STATUS_CHANGED`; outbox được đánh dấu đã publish và lần chạy publisher kế tiếp không phát lại event.
- [x] Test hai recruiter đổi trạng thái cùng lúc: đúng một request thành công và request còn lại nhận lỗi concurrent `409`.
- [x] Chốt quyền MEMBER/OWNER: cả hai role được xem và xử lý hồ sơ của toàn bộ job cùng công ty; recruiter công ty khác nhận `403`.

## P02 — Application Evaluation

> Đã hoàn thành và verify trên nhánh `feature/application-service/application-evaluation`; chưa merge vào `develop`.

- [x] Tạo nhánh `feature/application-service/application-evaluation` từ `develop` mới nhất.
- [x] Thêm bảng/entity/repository `Evaluation`.
- [x] Implement `POST /applications/:id/evaluation` cho recruiter cùng công ty.
- [x] Validate score, criteria JSON và note; lưu evaluator/time.
- [x] Bảo đảm Candidate không bao giờ nhận Evaluation trong API của mình.
- [x] Bổ sung unit/integration test và Swagger.

## P03 — Application Offer

- [ ] Tạo bảng `Offer` và trạng thái `SENT/ACCEPTED/DECLINED`.
- [ ] Implement `POST /applications/:id/offer`, chỉ cho phép từ `INTERVIEW`.
- [ ] Lưu salary, start date, position, note và `file_url/file_id` từ File Service.
- [ ] Chuyển Application sang `OFFER` bằng optimistic locking.
- [ ] Phát event `OFFER_SENT` qua transactional outbox.
- [ ] Implement `PATCH /offers/:id/respond` cho đúng Candidate.
- [ ] ACCEPTED chuyển Application sang `HIRED`; DECLINED chuyển `REJECTED` và lưu lý do.
- [ ] Chặn phản hồi lặp, offer hết hạn và concurrent response.

## P04 — Application Recruiter Dashboard và AI Match

- [ ] Implement `GET /applications/stats?company_id=`.
- [ ] Tổng hợp số đơn theo job/status, tỷ lệ chuyển đổi, biểu đồ thời gian và nguồn Candidate.
- [ ] Tích hợp Job Service để lấy tổng số tin đang tuyển.
- [ ] Gọi AI `/ai/match` khi cần và lưu/cập nhật `match_score`.
- [ ] Bổ sung filter theo kỹ năng sau khi Profile/AI contract sẵn sàng.
- [ ] Test dữ liệu rỗng, timezone, range lớn và quyền theo công ty.

## P05 — Hoàn thiện Job & Search

- [ ] Tích hợp `GET /jobs/recommended` với AI Service và CV mặc định.
- [ ] Fallback sang job mới nhất/lĩnh vực quan tâm khi AI lỗi hoặc Candidate chưa có CV.
- [ ] Chạy integration test với PostgreSQL, Redis/BullMQ, Elasticsearch và Kafka thật.
- [ ] Kiểm tra reindex idempotent, retry, dead-letter strategy và event ordering.
- [ ] Bổ sung bulk/detail contract để Bookmark có thể hiển thị đầy đủ cả job đã hết hạn.
- [ ] Kiểm tra load test cho search, pagination sâu và index mapping tiếng Việt.

## P06 — Hoàn thiện Company Service

- [ ] Chạy integration test với Auth/Admin/File Service thật.
- [ ] Xác minh ownership của logo, ảnh và video qua File/Media thay vì chỉ nhận reference.
- [ ] Chạy Prisma migration trên database sạch và kiểm tra rollback/backup.
- [ ] Bổ sung audit log cho duyệt công ty và thay đổi OWNER nếu yêu cầu nghiệm thu.
- [ ] Kiểm tra phân trang/tìm kiếm trang công ty công khai ở tải lớn.

## P07 — Auth Service

- [ ] Thiết kế migration cho User, RefreshSession, OTP/ResetToken và OAuthAccount.
- [ ] Đăng ký Candidate/Recruiter, hash mật khẩu và xác minh OTP email.
- [ ] Đăng nhập email/password và Google OAuth2.
- [ ] Phát JWT RS256 với `sub`, `role`, `iat`, `exp`; cung cấp public key/JWKS.
- [ ] Refresh token rotation, revoke session và phát hiện token reuse.
- [ ] Quên/đặt lại mật khẩu; rate limit OTP/login.
- [ ] API Admin khóa/mở tài khoản và vô hiệu hóa phiên hiện tại.
- [ ] Unit/integration/security test; bỏ cấu hình `anyRequest().permitAll()`.

## P08 — User/Profile Service

- [ ] Tạo Prisma models/migrations đầy đủ cho profile, education, experience, skill, certificate và CV.
- [ ] CRUD hồ sơ Candidate và tính phần trăm hoàn thiện.
- [ ] Tích hợp Media signed upload cho avatar/CV PDF.
- [ ] Quản lý nhiều CV, CV mặc định, soft/hard delete đúng quy tắc tham chiếu.
- [ ] Implement CV Builder và dữ liệu JSON có version.
- [ ] Implement `GET /profile/cv?user_id=` và `GET /profile/cv/:id` đúng contract cho Application.
- [ ] Publish `cv-events` idempotent cho AI.
- [ ] Bổ sung JWT/role guard, validation, Swagger và test.

## P09 — File/Media Service

- [ ] Tạo migration metadata file và trạng thái upload.
- [ ] Implement signed upload, confirm upload và delete theo ownership.
- [ ] Kiểm tra MIME, kích thước, loại tài nguyên và thư mục Cloudinary.
- [ ] Scheduled cleanup cho upload chưa được xác nhận/file rác.
- [ ] API nội bộ xác minh `file_id` cho Profile, Company, Offer, Chat và Interview.
- [ ] Test chữ ký hết hạn, file giả mạo, delete đang được tham chiếu và Cloudinary failure.

## P10 — Admin & Statistics Service

- [ ] Implement queue/API duyệt công ty và gọi Company Service.
- [ ] Implement queue/API duyệt job và gọi Job Service.
- [ ] Implement quản lý user, gọi Auth khóa/mở tài khoản.
- [ ] Tạo Report workflow, bằng chứng, trạng thái và audit log.
- [ ] Consume `job-events` và `application-events` idempotent.
- [ ] Tạo snapshot/dashboard toàn hệ thống.
- [ ] Xuất Excel/CSV bằng Apache POI và bảo vệ dữ liệu nhạy cảm.
- [ ] Integration test lỗi liên service, retry và eventual consistency.

## P11 — AI Service

- [ ] Chốt nhà cung cấp LLM: tài liệu ghi Claude nhưng code hiện khai báo Gemini.
- [ ] Tạo schema pgvector, migration và index vector phù hợp.
- [ ] Consumer `cv-events` và `job-events`, download/parse nội dung rồi upsert/delete embedding.
- [ ] Idempotency theo `event_id` và xử lý event đến sai thứ tự.
- [ ] Implement recommend jobs, recommend candidates và match score.
- [ ] Implement chatbot có prompt an toàn, Redis history, timeout và rate limit.
- [ ] Không lưu nội dung CV/job gốc quá phạm vi cho phép.
- [ ] Test chất lượng gợi ý, latency, fallback và dữ liệu tiếng Việt.

## P12 — Interview & Video Call Service

- [ ] Tạo migration Interview và InterviewFeedback.
- [ ] Gọi Application Service xác minh application/quyền công ty.
- [ ] Đặt lịch, chống trùng interviewer/candidate và quản lý interview round.
- [ ] Candidate confirm/reschedule; HR accept/reject đề nghị đổi lịch.
- [ ] Cancel/no-show và giới hạn số lần đổi lịch.
- [ ] Sinh Jitsi room URL/token có hạn dùng; bảo vệ người không liên quan.
- [ ] Feedback sau phỏng vấn và gợi ý chuyển application status.
- [ ] Publish `interview-events`, scheduler reminder và test timezone/concurrency.

## P13 — Chat Service

- [ ] Verify JWT RS256 ở Socket.IO handshake; bỏ TODO bypass hiện tại.
- [ ] Tạo MongoDB models/indexes cho Conversation và Message.
- [ ] Kiểm tra participant và ngữ cảnh application/job trước khi tạo conversation.
- [ ] Persist message, phân trang lịch sử, unread count và read receipt.
- [ ] Tích hợp File/Media cho attachment.
- [ ] Redis Adapter cho nhiều instance, reconnect và delivery semantics.
- [ ] Publish `chat-events` cho Notification.
- [ ] Test giả mạo conversation, message ordering, duplicate/reconnect và tải đồng thời.

## P14 — Notification Service

- [ ] Tạo Prisma migration cho Notification, DeviceToken và NotificationLog.
- [ ] Consumer ba topic application/interview/chat với idempotency.
- [ ] BullMQ worker, retry/backoff và lưu lỗi cuối.
- [ ] In-app inbox, unread count, read/read-all và pagination.
- [ ] Đăng ký/xóa FCM device token.
- [ ] Template email/push, FCM và SMTP integration.
- [ ] Scheduler reminder không gửi trùng.
- [ ] Contract/integration test với event thật từ Application/Interview/Chat.

## P15 — Hạ tầng và API Gateway

- [ ] Bổ sung route chính thức `/bookmarks` và `/offers`; hiện Bookmark đi qua `/applications/bookmarks`.
- [ ] Xử lý cả URL có và không có dấu `/` cuối, ví dụ `/applications` và `/applications/`.
- [ ] Thêm healthcheck cho từng service và `depends_on` theo trạng thái healthy.
- [ ] Dựng Jitsi self-host đầy đủ: web, Prosody, Jicofo, JVB, domain và TLS.
- [ ] Quản lý secrets an toàn cho JWT private key, Cloudinary, FCM, SMTP và LLM key.
- [ ] Cấu hình CORS, rate limit, request ID, timeout và WebSocket upgrade nhất quán.
- [ ] Thêm logging tập trung, metrics, tracing và cảnh báo.
- [ ] Backup/restore volume và migration strategy.
- [ ] Chạy `docker compose up --build` và smoke test toàn bộ route; lần kiểm tra hiện tại chưa thực hiện được vì Docker daemon chưa chạy.

## P16 — Frontend

- [ ] Thiết kế layout, design system, route guard và API client.
- [ ] Màn đăng ký/OTP/đăng nhập/quên mật khẩu.
- [ ] Candidate profile, CV manager/builder, search/detail, bookmark, apply, tracking và offer response.
- [ ] Recruiter company/verification/member, job management, applicant pipeline, evaluation, offer và dashboard.
- [ ] Interview calendar/Jitsi, realtime chat và notification center.
- [ ] Admin dashboard, company/job approval, user/report management và export.
- [ ] Loading/error/empty state, responsive UI, accessibility và E2E test.

## P17 — Kiểm thử tích hợp, bảo mật và phát hành

- [ ] Chốt schema JWT và payload Kafka duy nhất giữa các thành viên; xử lý khác biệt `snake_case` và `camelCase` trong tài liệu hiện tại.
- [ ] Contract test REST giữa Auth/Profile/Company/Job/Application/Interview.
- [ ] Contract test Kafka với producer/consumer thật và duplicate event.
- [ ] E2E Candidate: đăng ký → hồ sơ/CV → tìm việc → bookmark/apply → interview → offer → hired.
- [ ] E2E Recruiter: công ty → xác minh → job → duyệt → nhận hồ sơ → interview → offer.
- [ ] E2E Admin: duyệt, khóa user, report và dashboard.
- [ ] Security test JWT giả/hết hạn/sai role, IDOR, injection, file upload và secret leakage.
- [ ] Load test search, chat socket, notification worker và application concurrency.
- [ ] CI chạy lint, unit test, build, migration check và container scan cho từng Pull Request.
- [ ] Chuẩn hóa README, OpenAPI, `.env.example`, runbook và checklist release.

---

## Thứ tự ưu tiên đề xuất

1. Hoàn thiện Auth và Profile vì đang chặn xác thực/nộp đơn end-to-end.
2. Hoàn thiện File/Media để mở khóa CV, logo, attachment và Offer letter.
3. Làm Application Offer và Dashboard.
4. Làm AI embedding/recommendation rồi nối Job/Application.
5. Làm Interview, Notification và Chat theo hợp đồng event đã chốt.
6. Hoàn thiện Admin, Frontend, Jitsi và kiểm thử end-to-end.

## Rủi ro và điểm cần chốt ngay

- Auth chưa phát JWT thật nên các service đã verify JWT chưa thể chạy end-to-end.
- Profile chưa có API CV nên Application Submission sẽ lỗi tích hợp dù unit test đã đạt.
- AI provider chưa thống nhất giữa tài liệu (Claude) và dependency hiện tại (Gemini).
- Event envelope trong `docs/architecture.md` dùng `camelCase`, trong implementation Application/Job có trường `snake_case`; `recruiter_id` hiện là người tạo job thay vì người thực hiện transition. Cần thống nhất trước khi Notification/Admin/AI consume.
- Pipeline, Kafka và hợp đồng quyền MEMBER/OWNER đã được kiểm chứng; Application Pipeline dùng quyền toàn công ty, còn quyền sửa/xóa Job vẫn do Job Service kiểm soát.
- Application Evaluation đã được kiểm chứng với JSONB trên PostgreSQL thật, gồm quyền công ty, validation, chống đánh giá trùng và Candidate privacy; tính năng vẫn chưa merge vào `develop`.
- Docker daemon và Testcontainers đã hoạt động; Docker Compose toàn hệ thống vẫn chưa được kiểm chứng và hiện thiếu file môi trường runtime của một số service.
- Nginx chưa có route độc lập cho Bookmark/Offer và exact path không có dấu `/` cuối.
