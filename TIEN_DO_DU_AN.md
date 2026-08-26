# BÁO CÁO TIẾN ĐỘ DỰ ÁN HỆ THỐNG TUYỂN DỤNG

> Ngày cập nhật: 27/08/2026
> Nhánh đối chiếu chính: `develop`
> Nhánh triển khai lần cập nhật: `feature/media-service/signed-upload-ownership`

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
| Auth Service | Người 1 | ✅ Core Auth đã hoàn thành gồm đăng ký/OTP, password login, Google OIDC, JWT/JWKS, refresh rotation, logout, reset password, `/auth/me` và Admin account control; account-link Google chỉ còn là hạng mục tùy chọn nếu sản phẩm yêu cầu |
| User/Profile Service | Người 1 | 🟡 Persistence và Candidate CRUD/completion/auth/Swagger đã hoàn thành; Media, CV APIs/events và recruiter-related read còn pending |
| File/Media Service | Người 1 | 🟡 Core signed upload/confirm, ownership, reference, private delivery, migration và PostgreSQL test đã hoàn thành; scheduler/reconciliation, live Cloudinary, Offer letter và wiring consumer còn pending |
| Admin & Statistics Service | Người 1 | ⏳ Scaffold |
| Company Service | Người 2 | ✅ Nghiệp vụ chính đã merge |
| Job & Search Service | Người 2 | 🟡 CRUD/search, transactional `job-events` và Redis/BullMQ/Elasticsearch integration đã hoàn thành; AI recommendation còn thiếu |
| Application Service | Người 2 | 🟡 Các luồng từ Submission đến AI Match phía consumer đã merge; filter kỹ năng còn thiếu |
| AI Service | Người 2 | 🟡 Provider `/match` và consumer `job-events` đã hoàn thành; consumer CV/recommend/chat còn thiếu |
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
- **Trạng thái:** core Auth đã hoàn thành gồm persistence, đăng ký/OTP, password login, Google OIDC, JWT RS256/JWKS, refresh rotation, logout, reset password, `/auth/me` và API nội bộ Admin khóa/mở tài khoản. Account-link Google có re-auth chỉ làm nếu sản phẩm yêu cầu; strict JWT contract của từng consumer tiếp tục theo backlog tích hợp liên service.

## T02 — User/Profile Service

- **Mục tiêu:** quản lý hồ sơ Candidate và toàn bộ CV được dùng khi ứng tuyển hoặc tính embedding.
- **Công nghệ:** NestJS, TypeScript, Prisma, PostgreSQL, Kafka.
- **Luồng hoạt động:** hoàn thiện hồ sơ; upload CV PDF; tạo CV online; đặt CV mặc định; xem/xóa CV; phục vụ CV cho Application Service; phát `cv-events`.
- **Chức năng chính:** CRUD hồ sơ cá nhân, kỹ năng, học vấn, kinh nghiệm, chứng chỉ, dự án; quản lý nhiều CV; soft delete CV đã được sử dụng; API `GET /profile/cv?user_id=` và `GET /profile/cv/:id`.
- **Phụ thuộc:** Auth Service và File/Media Service; AI và Application phụ thuộc dữ liệu của service này.
- **Trạng thái:** Persistence cùng Candidate Profile CRUD, completion v1, JWT/role guard, validation và Swagger đã hoàn thành/verify trên PostgreSQL 16; Media, quản lý/CV Builder/internal CV APIs, recruiter-related read và event publisher còn pending.

## T03 — File/Media Service

- **Mục tiêu:** nơi duy nhất giữ Cloudinary secret và quản lý metadata file của toàn hệ thống.
- **Công nghệ:** NestJS, TypeScript, Prisma, PostgreSQL, Cloudinary Node SDK.
- **Luồng hoạt động:** sinh signed upload; client upload trực tiếp lên Cloudinary; xác nhận metadata; xóa file đúng quyền; dọn file rác định kỳ.
- **Chức năng chính:** `POST /files/signature`, `POST /files`, `DELETE /files/:id`, xác minh MIME/dung lượng/thư mục, ownership và trạng thái file.
- **Phụ thuộc:** Auth; được Profile, Company, Chat, Interview và Application/Offer sử dụng.
- **Trạng thái:** core signed upload/confirm, canonical provider verification, ownership, reference binding, private delivery, soft delete, migration và PostgreSQL test đã hoàn thành; scheduler/reconciliation, live Cloudinary, malware/deep parser, Offer letter và wiring consumer còn pending.

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
- **Trạng thái:** CRUD, publishing, search, durable Elasticsearch indexing, availability, thống kê job active và `job-events` v1 qua transactional outbox đã hoàn thành; recommendation từ AI còn thiếu.

## T07 — Application Service

- **Mục tiêu:** quản lý toàn bộ vòng đời ứng tuyển từ lúc Candidate nộp đơn đến khi tuyển hoặc bị loại.
- **Công nghệ:** Spring Boot 3, Java 21, Spring Security Resource Server, Spring Data JPA, Flyway, PostgreSQL, Spring Kafka, transactional outbox.
- **Luồng hoạt động:** nộp đơn; Bookmark; Candidate theo dõi timeline; HR lọc và quản lý hồ sơ; state machine; đánh giá nội bộ; gửi/phản hồi Offer; thống kê recruiter; tính lại điểm AI theo yêu cầu.
- **Chức năng chính:** Application, ApplicationHistory, Evaluation, Offer, Bookmark; optimistic locking; phân quyền theo Candidate/công ty; refresh `match_score`; phát `application-events`.
- **Phụ thuộc:** Auth, Profile, Job, Company, AI, File/Media và Notification qua Kafka.
- **Trạng thái:** các luồng đến Recruiter Dashboard và AI Match phía Application đã merge; filter kỹ năng chưa làm.

## T08 — AI Service

- **Mục tiêu:** tạo embedding CV/Job, chấm điểm tương đồng, gợi ý việc và chatbot hỗ trợ Candidate.
- **Công nghệ theo tài liệu:** Python, FastAPI, sentence-transformers `all-MiniLM-L6-v2`, pgvector, Redis, Kafka và Anthropic Claude.
- **Công nghệ hiện tại:** FastAPI, Psycopg 3, Alembic, PostgreSQL/pgvector, confluent-kafka và sentence-transformers CPU với model/revision bất biến; `google-genai` được tách riêng cho task chatbot.
- **Luồng hoạt động:** consume `cv-events`; consume `job-events`; cập nhật/xóa vector; cosine similarity; recommend jobs/CVs; match CV-job; chatbot có lịch sử ngắn hạn.
- **Chức năng chính:** `/ai/recommend/jobs`, `/ai/recommend/candidates`, `/ai/match`, `/ai/chat` và consumer idempotent.
- **Phụ thuộc:** schema `cv-events`, `job-events`, Kafka, PostgreSQL pgvector và Redis.
- **Trạng thái:** đã có vector store/migration, internal auth, readiness, provider `/match` và worker sinh Job embedding từ `job-events`; consumer CV, recommendation và chatbot còn pending.

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
- **Trạng thái:** đã có unit/integration test tập trung ở Company, Job/Search, Application, AI và Profile; Profile đạt 1 migration-upgrade check + 8 unit + 23 integration test Docker với PostgreSQL 16.15 sạch, Job/Search đạt 57 unit test và 13 integration test Docker với PostgreSQL 16, Kafka 3.8, Redis 7 và Elasticsearch 8.14.3, Application đạt 173 unit test và 35 integration test, AI đạt 188 test với PostgreSQL 16/pgvector cùng Kafka 3.8 thật; chưa có E2E toàn hệ thống.

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
- PR #8 đưa vào payload flat snake_case ban đầu với Kafka key `job_id` và `event_id`.
- BullMQ chịu trách nhiệm đồng bộ Elasticsearch; phần phát Kafka đã được thay thế bởi transactional outbox ở task bên dưới.

### Transactional Job Event Outbox — PR #26

- Mọi create/update/publish/approve/reject/close/expire ghi `Job` và immutable outbox trong cùng PostgreSQL transaction; `aggregate_version` tăng đơn điệu bằng compare-and-set.
- `job-events` v1 dùng Kafka key `job_id` và đúng 16 trường: `event_id`, `action`, `job_id`, `company_id`, `title`, `description`, `skills`, `location`, `status`, `occurred_at`, `schema_version`, `aggregate_version`, `requirements`, `salary_min`, `salary_max`, `job_type`.
- Publisher claim bằng `FOR UPDATE SKIP LOCKED`, chặn version sau khi version trước chưa publish, retry hữu hạn, gia hạn lease bằng heartbeat và phát at-least-once với `event_id` ổn định; consumer vẫn phải idempotent vì có thể nhận duplicate.
- BullMQ chỉ đồng bộ Elasticsearch; reindex không phát domain event giả và không phụ thuộc Kafka.
- Đã verify 39 unit test + 1 Docker integration test của Job Service với PostgreSQL 16/Kafka 3.8 thật; AI Service đạt 188 test và salary đã đồng bộ `NUMERIC(15,2)`.
- Rollout không tự backfill: database đã có Job cần một baseline/replay được review riêng trước khi bật producer mới. Retention cleanup của outbox chưa tự động hóa và cần chốt chính sách lưu giữ.

### Durable Elasticsearch Index Sync — PR #27

- Mọi mutation ghi thêm desired index state trong cùng PostgreSQL transaction; dispatcher lease/`SKIP LOCKED` chuyển intent sang BullMQ nên Redis lỗi không làm mất cập nhật.
- Bản PR #27 ban đầu dùng `aggregate_version` với Elasticsearch `external_gte`; Job không còn searchable được giữ dưới dạng tombstone tối thiểu và bị loại bằng `searchable=true`.
- Reindex quét mọi trạng thái Job, tăng generation và hội tụ idempotent; monotonic UPSERT chặn snapshot reindex cũ hạ version mới và không phát Kafka event giả.
- BullMQ retry exponential; producer Redis fail-fast, tự tạo lại kết nối và giữ durable intent khi cold outage. Lỗi cuối được lưu bằng `failed_at`, attempt count và mã lỗi an toàn; Admin có endpoint xem/replay dead letter.
- PR #27 dùng index versioned `job_index_v2`, kiểm tra mapping version trước khi ghi và tái tạo strict mapping/analyzer tiếng Việt sau khi index bị xóa.
- Tại thời điểm merge PR #27, Docker suite đạt 39/39 unit test và 10/10 integration test (9 indexing/search/reindex/retry/outage + 1 Kafka outbox).
- Database đã có dữ liệu phải migrate khi dừng old writer, chạy `POST /jobs/reindex`, chờ hết pending/failed rồi mới mở traffic. Các regression và giới hạn của thiết kế ban đầu được sửa trong task hiện tại bên dưới.

### Job Availability — PR #9

- Endpoint nội bộ `GET /jobs/:id/exists` dùng shared API key.
- Trả trạng thái tồn tại, còn nhận hồ sơ, lý do, company/recruiter/job metadata và deadline.
- Application Service đã sử dụng hợp đồng này khi Candidate nộp đơn hoặc Bookmark.
- Số liệu suite Job/Search hiện tại được tổng hợp ở task bulk detail và hardening ngay bên dưới.

### Bulk Job Detail cho Bookmark và hardening durable indexing — task hiện tại

- Bổ sung endpoint nội bộ `POST /jobs/details/bulk`, nhận tối đa 100 `jobIds` UUID duy nhất và trả projection chi tiết công khai an toàn trong một truy vấn PostgreSQL; `PUBLISHED`, `CLOSED`, `EXPIRED` vẫn có thể trả chi tiết, còn Job không tồn tại hoặc ở trạng thái nội bộ được gom vào `unavailableJobIds` mà không làm lộ dữ liệu duyệt tin.
- Application Bookmark lấy chi tiết theo lô, chia chunk tối đa 100 ID, giữ nguyên thứ tự bookmark từ database và loại bỏ N+1 call sang Job Service. Client kiểm tra nghiêm ngặt coverage, thứ tự, ID lạ/trùng/overlap và dữ liệu bắt buộc trong response.
- Danh sách Bookmark fail-soft ở cấp toàn bộ request: Job Service lỗi, timeout hoặc trả contract sai thì bookmark vẫn được trả theo đúng thứ tự nhưng `job=null`; luồng tạo Bookmark tiếp tục dùng endpoint availability đơn lẻ để chặn Job không còn nhận hồ sơ.
- Sửa regression của PR #27: Elasticsearch cập nhật nguyên tử theo cặp thứ tự từ điển (`aggregateVersion`, `indexGeneration`) bằng scripted update nên generation cũ không thể ghi đè generation mới khi cùng aggregate version; reindex dùng một set-based UPSERT cho mỗi page 200 Job thay vì transaction gồm nhiều câu lệnh tuần tự.
- Dispatcher chặn claim trước shutdown và release intent nếu shutdown xảy ra ngay sau claim; cold Redis integration khởi động worker thật để kiểm chứng fail-fast/recovery. `job_index_v3` có field `indexGeneration`, validator kiểm tra đầy đủ field/analyzer bắt buộc và từ chối alias trỏ nhiều concrete index.
- Baseline Elasticsearch dùng cặp marker bền vững `mappings._meta.baselineVersion=3` và `baselineIndexUuid=<UUID>`, tự resume sau restart cho cả index tương thích đã tồn tại nhưng thiếu/sai marker. Trước khi hoàn tất, search bắt buộc fallback PostgreSQL và health ở `DEGRADED`; sau khi mọi intent hoàn tất, service refresh concrete index, ghi marker kèm UUID rồi revalidate tên index, UUID vật lý và marker. Chỉ khi lần kiểm tra sau ghi này khớp mới bật Elasticsearch search và trả `UP`; index thay thế mang UUID khác không thể dùng marker gắn với UUID cũ.
- Đã verify Job/Search **57/57 unit test + 13/13 integration test** với PostgreSQL 16, Kafka 3.8, Redis 7 có auth và Elasticsearch 8.14.3 thật; Application **173/173 unit test + 35/35 integration test** với PostgreSQL/Kafka/Testcontainers.

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
- Tại mốc bàn giao riêng Pipeline, suite khi đó đạt 40/40 unit test và 7/7 integration test với PostgreSQL/Kafka; kết quả Application Service hiện tại được cập nhật ở mục Offer bên dưới.

## 2.5 Application Evaluation — đã merge vào `develop`

> Việc merge P02 vào `develop` đã được người dùng xác nhận; báo cáo không ghi thêm commit hash khi chưa có dữ liệu đối chiếu mới.

- Flyway V3 tạo bảng `evaluations` với `criteria_json JSONB`, khóa ngoại cascade về Application, check constraint và index theo application/time.
- Endpoint `POST /applications/:id/evaluation` chỉ dành cho recruiter; cả MEMBER và OWNER được đánh giá application cùng công ty, recruiter công ty khác bị chặn `403`.
- Validate score và từng điểm tiêu chí trong khoảng `0–100`, tối đa hai chữ số thập phân; criteria có `1–20` tên duy nhất; note tối đa 2.000 ký tự.
- `evaluator_id` lấy từ JWT subject và `created_at` lấy từ clock phía server; client không thể giả mạo người đánh giá hoặc thời gian.
- Unique constraint `(application_id, evaluator_id)` kết hợp precheck và xử lý race condition, trả `409` khi cùng recruiter đánh giá lặp.
- Evaluation là dữ liệu nội bộ: API Candidate, chi tiết đơn và timeline không trả dữ liệu đánh giá.
- Full verify đạt 67/67 unit test và 14/14 integration test; `BUILD SUCCESS` với PostgreSQL/Kafka qua Testcontainers.

## 2.6 Application Offer — đã merge vào `develop`

- Flyway V4 tạo bảng `offers`, unique một Offer/Application, khóa ngoại cascade, check constraint dữ liệu/phản hồi và partial index cho Offer `SENT` chờ hết hạn.
- `POST /applications/:id/offer` dành cho MEMBER/OWNER cùng công ty, chỉ nhận Application `INTERVIEW`; `PATCH /offers/:id/respond` chỉ dành cho đúng Candidate.
- Validate salary dương tối đa hai chữ số thập phân, start date không ở quá khứ, position/note, cặp `file_id/file_url`, URL HTTP(S), thời hạn và expected version.
- Gửi Offer chuyển Application sang `OFFER`; chấp nhận chuyển Offer/Application sang `ACCEPTED/HIRED`; từ chối bắt buộc lý do và chuyển sang `DECLINED/REJECTED`.
- Atomic update và transaction chung bảo vệ phản hồi lặp, hết hạn, concurrency, history và outbox; lỗi giữa transaction không để lại dữ liệu một phần.
- `OFFER_SENT` và `STATUS_CHANGED` bổ sung `actor_id`, `offer_id`, `offer_status`, `offer_version`; event không chứa salary, note, lý do phản hồi hoặc file reference.
- Nginx đã có route độc lập `/offers/` giữ nguyên prefix; route `/applications/` tiếp tục strip prefix khi forward.
- File reference đã được kiểm tra cấu trúc; xác minh canonical metadata và ownership nội bộ còn phụ thuộc contract File/Media ở P09.
- Full verify đạt 100/100 unit test và 23/23 integration test; PostgreSQL/Flyway/JPA, authorization, expiry, rollback và concurrent response đều đạt.

## 2.7 Application Recruiter Dashboard — đã merge vào `develop`

- `GET /applications/stats?company_id=` dành cho MEMBER/OWNER đúng công ty; từ chối khác công ty trước khi đọc Application DB hoặc gọi Job Service.
- Cohort lọc theo `applied_at` trong khoảng `[from,to)` tối đa 366 ngày; mặc định 30 ngày lịch địa phương gồm hôm nay.
- Tổng hợp current status/source/per-job, conversion funnel từ các stage từng đạt và time series zero-fill theo `DAY/WEEK/MONTH`.
- Timezone phải là IANA zone được cả Java và PostgreSQL hỗ trợ; đã kiểm tra ranh giới tuần/tháng và ngày DST 23 giờ.
- Job Service có endpoint nội bộ `GET /stats/active?company_id=` đếm trực tiếp job `PUBLISHED` còn hạn; timeout/5xx/429 fallback có warning, còn lỗi 4xx/contract trả 502.
- Flyway V5 bổ sung index `applications(company_id, applied_at)` và `application_history(application_id, to_status)`.
- Application Service full verify đạt 126/126 unit test và 29/29 integration test; Job Service đạt 16/16 test và build thành công.

## 2.8 Hạ tầng nền đã có

- Monorepo tách 11 service, frontend, Dockerfile và `.env.example`.
- Docker Compose định nghĩa API Gateway, PostgreSQL/pgvector, MongoDB, Redis, Kafka KRaft, Elasticsearch, 11 backend service và frontend.
- PostgreSQL khởi tạo schema riêng cho từng service.
- Kafka-init tạo năm topic: `job-events`, `cv-events`, `application-events`, `interview-events`, `chat-events`.
- Nginx có upstream và route cơ bản cho Auth, Profile, Company, Job, Application, Interview, Notification, Media, Admin, AI và Chat WebSocket.
- Có volume cho PostgreSQL, MongoDB, Redis, Kafka và Elasticsearch.

## 2.9 Auth Persistence Foundation — đã merge vào `develop`

- Flyway V1 tự tạo/validate schema `auth` trên PostgreSQL sạch với ba bảng `users`, `refresh_sessions`, `oauth_accounts`; Hibernate chạy `ddl-auto=validate` và mặc định UTC.
- Email được chuẩn hóa Unicode NFC + lowercase bằng Java, lưu riêng `normalized_email` và unique trực tiếp; self-registration chỉ nhận `CANDIDATE`/`RECRUITER`, Google mặc định `CANDIDATE`, còn `ADMIN` phải qua provisioning nội bộ. Trạng thái verify/lock đi cùng timestamp và User dùng optimistic `version`.
- Password local chỉ nhận modular bcrypt cost 10 ở cả domain và CHECK constraint PostgreSQL; plaintext, hash sai thuật toán hoặc sai cost đều bị từ chối.
- Refresh token chỉ lưu SHA-256 hex. Mỗi generation là một row có `family_id`, `parent_session_id`, `consumed_at`, revoke state và version; unique parent cùng composite FK `(parent_session_id,user_id,family_id)` chặn fork/cross-user/cross-family rotation. Repository có pessimistic aggregate lock theo `user_id` để task refresh sau này tuần tự hóa rotate/reuse/revoke toàn bộ phiên.
- OAuth dùng Google `provider_subject` làm định danh, yêu cầu email claim đã verified, chặn trùng subject và chặn một User liên kết hai tài khoản cùng provider; không lưu Google access/refresh token.
- OTP/reset token tiếp tục là dữ liệu tạm Redis theo kiến trúc (`otp:*` TTL 5 phút, `auth:password-reset:*` TTL 15 phút), không tạo bảng PostgreSQL và không lưu secret thô.
- Đã verify **15/15 unit test + 5/5 integration test** với PostgreSQL 16/Testcontainers: migration sạch, Hibernate mapping, normalized email, role/lock checks, FK/unique OAuth, optimistic locking và refresh lineage đều đạt.

## 2.10 Auth Registration và OTP Verification — đã merge vào `develop` qua PR #30

- Bổ sung public API `POST /auth/register`, `POST /auth/otp/resend` và `POST /auth/otp/verify` với response envelope thống nhất; self-registration chỉ nhận `CANDIDATE`/`RECRUITER`, mật khẩu tối thiểu tám ký tự Unicode, có chữ/số, không vượt 72 byte UTF-8 và chỉ lưu bcrypt cost 10.
- Mỗi pre-registration có `registrationId` bắt buộc cho resend/verify. Đăng ký lại một email đang pending tạo flow mới và thay đồng thời password/role/`registrationId`; flow/OTP cũ bị vô hiệu nên không thể giữ lại credential do người khác tạo. Email đã verified trả `409`; resend flow không tồn tại/cũ trả `202` chung để hạn chế enumeration.
- Flyway V2 thêm `registration_id`, sequence/column `registration_fence` và CHECK/unique index. Mỗi flow nhận fence tăng đơn điệu; PostgreSQL upsert chỉ nhận fence mới hơn nên stale writer không thể ghi đè credential mới dù Redis dispatch lease đã hết hạn.
- OTP sáu chữ số có TTL 5 phút; raw OTP không được lưu ở PostgreSQL/Redis và không ghi log. Redis chỉ giữ HMAC-SHA-256 challenge gắn với purpose, User ID, `registrationId`, canonical email và random generation; tên key dùng HMAC email nên không lộ PII.
- Lua atomically quản lý install, claim/finalize, cleanup, failure block và rolling resend reservation. Sai lần thứ năm xóa challenge và khóa 15 phút; initial email không tính quota, tối đa ba resend trong một giờ. Claim 30 giây bảo đảm hai verify đồng thời chỉ có một winner.
- Dispatch registration/resend có Redis lease theo email, renew/recheck ownership quanh DB/SMTP; DB fence là lớp bảo vệ bền vững khi lease hết hạn. Verify khóa pessimistic và kiểm tra lại User ID, `registrationId`, fence trước khi kích hoạt tài khoản, sau đó clear `registrationId`.
- SMTP gửi đồng bộ với connect/read/write timeout 3 giây và cleanup có CAS khi lỗi. Không tuyên bố exactly-once vì SMTP ACK/timeout vẫn có thể tạo email trễ hoặc trùng; production bắt buộc bật cả `SMTP_STARTTLS=true` và `SMTP_STARTTLS_REQUIRED=true` cùng SMTP auth/secret phù hợp.
- Security chuyển sang stateless, public đúng health/registration/OTP và `denyAll` cho endpoint chưa triển khai. `/health`, `/auth/health` phản ánh Actuator thật và trả `503` khi `DOWN/OUT_OF_SERVICE`; Nginx giữ nguyên prefix `/auth` và route health trực tiếp tới Actuator.
- Đã verify **77/77 unit test + 16/16 integration test (93/93 tổng)** với PostgreSQL 16.15, Redis 7 có mật khẩu và Testcontainers 1.21.4: validation, privacy, TTL/rate limit, supersession, stale fence, actual persisted User ID và concurrency đều đạt.

## 2.11 Auth Login, Google OIDC, JWT/JWKS và Refresh — đã merge vào `develop` qua PR #31

- `POST /auth/login` chuẩn hóa email, dùng bcrypt cost 10 và dummy bcrypt cho email không tồn tại/OAuth-only để giảm enumeration. Redis Lua theo dõi lỗi bằng HMAC key không chứa PII; lần sai thứ năm chặn 15 phút, có `Retry-After`, đăng nhập đúng xóa failure state và Redis lỗi thì fail-closed `503`.
- Google OIDC dùng Spring Security, state + nonce + PKCE S256 và authorization request JSON có TTL trong Redis; không dùng `HttpSession`, không lưu token Google. Callback chỉ chuyển one-time exchange code trong URL fragment cùng HttpOnly binder cookie; exchange đúng cặp được consume exactly-once rồi mới phát token nội bộ.
- Google `sub` là định danh bền vững. Subject đã link đăng nhập đúng User; subject mới + email mới tạo OAuth-only User và cho chọn `CANDIDATE/RECRUITER` đúng một lần. Email đã tồn tại nhưng chưa link trả `ACCOUNT_LINK_REQUIRED`, không auto-link theo email; account-link có re-auth là task riêng.
- Access JWT dùng RS256, header chuẩn `typ=JWT`, thumbprint `kid`, TTL 15 phút và chỉ có `iss/sub/aud/role/iat/exp/jti`; không nhúng email/profile. Decoder Auth khóa thuật toán/type/kid/issuer/audience/UUID/role; JWKS chỉ công bố public fields của active + previous key. `GET /auth/me` xác thực JWT rồi kiểm tra lại User verified/unlocked trong PostgreSQL.
- OTP verify, password login và Google exchange đều phát cùng token response. Raw refresh token 256-bit có prefix `rt1_`; PostgreSQL chỉ lưu SHA-256. Refresh khóa pessimistic theo User, rotate một child, giữ absolute family expiry bảy ngày và replay token còn hiệu lực sẽ revoke toàn bộ phiên active của User.
- Expiry được kiểm tra trước reuse nên replay row cũ sau family lifetime không thể DoS/revoke family mới. Concurrent refresh cùng token có đúng một winner; request thua phát hiện reuse và revoke cả child vừa thắng. Logout revoke token hiện tại; mọi lỗi refresh dùng contract generic.
- Security tiếp tục stateless/deny-by-default, bổ sung CORS exact-origin có credentials cho frontend và `no-store` cho response nhạy cảm. Binder `SameSite=Lax` yêu cầu frontend/Auth production cùng schemeful site; `CORS_ORIGINS` không cho wildcard và HTTP chỉ cho loopback.
- Docker Compose dùng file-backed secrets: private key chỉ mount vào Auth, public key mount vào các service verify JWT. Script RSA-3072 PKCS#8/X.509 từ chối ghi đè; previous public key hỗ trợ overlap khi rotate.
- Hai quyết định bảo mật chủ ý khác tài liệu ban đầu: không trả raw `locked_reason` nội bộ khi login bị khóa và không auto-link Google theo email. Nếu sản phẩm cần lý do hiển thị hoặc link account, phải thêm field/re-auth flow riêng đã sanitize.
- Full `clean verify` đạt **156/156 unit test + 27/27 integration test (183/183 tổng)** với PostgreSQL 16.15, Redis 7 có mật khẩu và Testcontainers 1.21.4; bao phủ OTP, password throttle/fail-closed, Google Redis exchange, JWT/JWKS/`/auth/me`, rotation/reuse/expiry/concurrency và CORS full filter chain.

## 2.12 Auth Forgot/Reset Password — đã merge vào `develop` qua PR #32

- Bổ sung public API `POST /auth/forgot-password` và `POST /auth/reset-password`. Forgot trả cùng response `202 RESET_EMAIL_SENT_IF_ELIGIBLE` cho email hợp lệ ở tầng service; tài khoản không tồn tại, pending, OAuth-only, request vượt quota và lỗi cài challenge theo account đều không làm lộ eligibility. Initial quota-store hoặc account database outage trả `503` trước/sát bước quyết định cho mọi account.
- Token `pr1_` có 256 bit ngẫu nhiên, TTL 15 phút và newest-accepted-wins; request khi token đang được claim là generic no-op. Raw token không được trả qua API, persist hoặc log; Redis chỉ giữ HMAC digest trong key/value không PII. Challenge gắn User ID + optimistic version, claim/finalize/recover dùng Lua CAS nên replay, token cũ và hai reset đồng thời không thể đổi mật khẩu hai lần.
- Rolling quota ba request/email/giờ dùng HMAC email key và reservation member riêng; lỗi DB/install/executor trước khi nhận delivery hoàn lại đúng reservation bằng Lua atomic. SMTP chạy trên bounded executor; link cố định dùng fragment `#token=`, và lỗi gửi CAS-discard challenge mà vẫn giữ response forgot chung.
- Password update và revoke mọi refresh session đang active chạy cùng một PostgreSQL transaction với User-first pessimistic lock; row `ROTATED`, `LOGOUT` hoặc đã hết hạn được giữ làm audit. Reset thành công xóa login failure/block best-effort; access JWT stateless đã phát có thể còn hiệu lực tối đa 15 phút.
- Nginx giới hạn riêng recovery `POST` theo client IP 10 request/phút (burst 5) và theo gateway instance 20 request/giây (burst 40), bỏ qua `OPTIONS`/method khác, trả JSON `429` có `Retry-After`, no-store và CORS allowlist. Compose chỉ publish gateway; môi trường có LB/CDN hoặc nhiều gateway replica vẫn phải cấu hình trusted Real IP, đồng bộ gateway allowlist với `CORS_ORIGINS` và dùng distributed ingress/WAF limiter.
- `clean verify -Pintegration-test` đạt **195/195 unit + 35/35 integration test (230/230 tổng)** với PostgreSQL 16.15, Redis 7 có mật khẩu và Testcontainers 1.21.4. Riêng phần mới thêm 39 unit + 8 integration test, bao phủ privacy, TTL, supersession, quota/rollback Lua thật, bcrypt, revoke đa family, locked account, claim recovery, replay, concurrent reset/refresh và xóa login block. Cấu hình gateway đồng thời đạt `nginx -t`.

## 2.13 Auth Admin Account Control — đã merge vào `develop` qua PR #33

- Bổ sung `PATCH /auth/users/{userId}/lock`: khóa nhận `{"locked":true,"reason":"..."}` với reason NFC, bỏ Unicode whitespace ở hai đầu, cấm control/format character và giới hạn 1–500 ký tự; mở khóa nhận `{"locked":false}` và cấm reason khác blank. Response chỉ có User ID, trạng thái, thời điểm khóa, optimistic version và số session vừa revoke; không trả email hoặc moderation reason.
- Spring Security yêu cầu access JWT role `ADMIN`, sau đó transaction kiểm tra lại actor theo JWT `sub` vẫn tồn tại, verified, unlocked và có durable role `ADMIN`. Self-control trả `409`; toàn bộ target role Admin tạm bị cấm cho đến khi có chính sách hierarchy/break-glass; target không tồn tại chỉ được lộ sau khi actor đã qua durable authorization.
- Actor và target User được pessimistic-lock theo UUID, nhờ đó serialize login/refresh issuance của target. Clock chỉ được đọc sau khi giữ User locks, sửa race trong đó refresh thắng trước có thể tạo child sau timestamp capture của request khóa.
- Chuyển `is_locked` và một versioned bulk update revoke mọi refresh session chưa revoke/chưa hết hạn bằng `ADMIN_LOCK` nằm trong cùng transaction, không materialize lượng session do attacker kiểm soát. Lock lặp giữ nguyên reason/timestamp nhưng vẫn sửa invariant session; unlock không hồi sinh refresh token đã revoke; row `ROTATED`, `LOGOUT`, `REUSE_DETECTED`, `PASSWORD_RESET` và expired được bảo toàn làm audit.
- Nginx trả `404` cho đường dẫn này ở public gateway và CORS cố ý không mở `PATCH`; P10 Admin Service phải gọi trực tiếp `auth-service:8080` trong mạng Compose, forward JWT Admin và ghi append-only AuditLog. Auth không publish `user-events` vì topic này chưa được nhóm chốt.
- Access JWT stateless đã phát cho service khác vẫn có thể sống tối đa 15 phút. Production còn phải có quy trình provisioning/bootstrap Admin được kiểm soát; task này không giả định shared internal API key là danh tính Admin.
- Full `clean verify -Pintegration-test` đạt **215/215 unit + 40/40 integration test (255/255 tổng)** với PostgreSQL 16.15, Redis 7 và Testcontainers 1.21.4. Riêng task mới thêm 20 unit/security + 5 PostgreSQL/HTTP integration test, bao phủ privacy/validation, Unicode/control-character safety, durable role, stale Admin JWT, idempotency, session audit, login/`/auth/me`/refresh sau khóa, unlock, concurrent lock-vs-refresh, fanout 20.000 session, rollback cưỡng bức và matrix-path hardening. Cấu hình gateway đạt `nginx -t`.

## 2.14 Profile Persistence Foundation — đã merge vào `develop` qua PR #34

- Prisma quản lý `Profile`, `Education`, `Experience`, `Skill`, `Certificate`, `Project` và `Cv` trong schema PostgreSQL `profile`; `Profile.user_id` là external UUID unique từ Auth, không tạo foreign key xuyên service.
- Năm bảng con Education, Experience, Skill, Certificate và Project thuộc Profile dùng `ON DELETE CASCADE`; CV tham chiếu `Profile.user_id` bằng `ON DELETE/UPDATE RESTRICT`. Trigger khóa bất biến identity/ownership của Profile/CV để không đổi `cv_id` hoặc chuyển CV đã nộp sang Candidate khác.
- CV phân biệt `UPLOAD/ONLINE`, có `file_id/file_url`, builder JSON + schema version, aggregate version, default/deleted/first-used state và giới hạn JSON 1 MiB. Partial unique index bảo đảm **tối đa một** CV mặc định đang hoạt động; database chưa tuyên bố quy tắc tối đa năm hoặc bắt buộc luôn có một default.
- Nội dung/file của CV trở thành bất biến khi đặt `first_used_at`; update vừa thay file vừa đánh dấu đã dùng bị chặn. CV Online chưa dùng được sửa tại chỗ; chỉnh sửa CV đã dùng phải clone content sang revision/`cv_id` mới để Application tiếp tục trỏ đúng bản đã nộp. Vì Application chưa có usage callback authoritative, mọi hard delete hiện fail-closed và chỉ soft delete được phép ở task API tiếp theo.
- Migration được bọc transaction, có CHECK/FK/index/trigger; Compose thêm one-shot `profile-migrate` trước runtime. Image Node 20/NestJS 11 dùng lockfile, `npm ci`, non-root user và audit production dependency đạt 0 vulnerability.
- Đã verify **7/7 integration test** trên PostgreSQL 16 sạch: đủ sáu block hồ sơ, JSONB round-trip, constraint ngày/URL/skill/completion, CV shape/default/delete/identity, cascade/restrict và revision immutability. `prisma migrate deploy` lần hai không có migration pending, migration diff không có drift; image runtime non-root trả `/health` UP.
- `CvEventOutbox` cố ý chưa tạo: tài liệu hiện dùng `file_url`, trong khi hướng an toàn cần chốt `file_id` + Media fetch. Contract/event intent/publisher chỉ triển khai sau khi Profile–Media–AI thống nhất payload versioned, tránh khóa sớm contract mâu thuẫn.

## 2.15 Candidate Profile CRUD & Completion — đã hoàn thành và verify

- Hoàn thiện `GET/PUT /profile/:userId` và CRUD độc lập cho Education, Experience, Skill, Certificate, Project. Route plural là canonical, route singular được giữ làm alias tương thích; `PUT` là merge-update và lần ghi đầu tự tạo Profile. Giới hạn transactionally theo Profile là 20 Education, 30 Experience, 100 Skill, 50 Certificate và 50 Project.
- Candidate chỉ được đọc/sửa hồ sơ của chính mình; child lookup luôn ghép child ID với Profile của JWT subject để chặn IDOR. Recruiter read cố ý fail-closed cho tới khi có contract chứng minh Candidate đã ứng tuyển vào đúng công ty.
- Completion rule v1 cố định: full name 10, headline 5, summary 5, phone 5, address 5, ít nhất một external link 5, Education 15, Experience 20, Skill 20, Certificate 5 và Project 5. Mỗi tiêu chí chỉ cộng một lần, tổng tối đa 100; warning chỉ bật khi dưới 50%.
- Response trả `completionPercent`, `completionRuleVersion=1`, `missingSections` và `aggregateVersion`. Avatar chưa tính điểm vì còn chờ Media xác minh ownership/type/status; migration mới backfill transactionally điểm của Profile cũ trước khi gắn rule v1.
- Mọi mutation chạy Serializable, khóa row Profile, ghi block + completion + version trong một transaction và retry tối đa tám lần với exponential jitter cho Prisma `P2034`, race unique lần tạo đầu lẫn raw-query SQLSTATE `40001`. GET aggregate dùng snapshot Repeatable Read.
- JWT consumer enforce RS256, `typ=JWT`, RFC 7638 `kid`, issuer/audience, UUID v4 `sub/jti`, role hợp lệ, `iat/exp` nguyên, `exp > iat`, expiry và `iat` không vượt quá 60 giây trong tương lai; global guard deny-by-default, exact-origin CORS, response `no-store`, DTO whitelist/forbid unknown field và HTTPS URL canonicalization. JWKS mặc định bắt buộc HTTPS và cấm redirect; HTTP chỉ được bật rõ ràng cho development network.
- Root Compose local trỏ tới Auth JWKS và tiêu thụ active/previous keys khi Auth được cấu hình rotation; verifier có cache + refresh cooldown chống unknown-`kid` amplification. Static public PEM là nguồn cấu hình thay thế khi không dùng JWKS, không phải failover khi JWKS lỗi. `/health` kiểm PostgreSQL + JWT source; Swagger mô tả success/error contract và tự tắt ở production trừ khi opt-in.
- Swagger có ở `/profile/docs` qua gateway (`/docs` trực tiếp) trong môi trường được bật. Docker PostgreSQL 16.15 sạch đạt **1/1 migration-upgrade check + 8/8 unit test + 23/23 integration test**, gồm safety guard chống test nhầm database, backfill whitespace legacy, migration lặp, completion/rollback, route alias, JWT/JWKS negative kể cả future-`iat`, validation, OpenAPI, IDOR đủ năm collection, Unicode skill, collection cap, 12 vòng race lần ghi đầu, burst sáu writer trên Profile đã tồn tại và duplicate skill concurrent.
- Phần chưa hoàn thành của P08 vẫn là Media/avatar/CV upload, quản lý/CV Builder/internal CV APIs, recruiter-related read contract và transactional `cv-events` cho AI.

## 2.16 File/Media Service Core — đã hoàn thành và verify

- Hoàn thiện signed upload intent 10 phút và confirm chỉ bằng `fileId`; service tự đọc metadata canonical từ Cloudinary, không tin MIME, size, URL hoặc metadata do client gửi. Policy v1 fail-closed có đúng sáu type `CV`, `AVATAR`, `COMPANY_LOGO`, `COMPANY_IMAGE`, `COMPANY_VIDEO`, `CHAT_ATTACHMENT`; `OFFER_LETTER` chưa được đưa vào để tránh dùng sai policy.
- Public API dùng strict JWT RS256/role/owner; internal API dùng sáu key riêng, ràng buộc đúng danh tính Profile/Company/Application/Chat/Interview/AI và so sánh constant-time. Gateway công khai route `/files`, xóa internal headers và trả `404` cho mọi biến thể `/files/internal`.
- Prisma/PostgreSQL quản lý intent, canonical metadata, trạng thái, audit và immutable reference. Idempotency, tối đa 20 intent còn hạn/requester/type, atomic 60 intent/requester/giờ, quota công ty, advisory/row lock, lease 5 phút và `aggregateVersion` fencing bảo vệ confirm/delete đồng thời; quota được kiểm tra lại khi finalize để chặn race vượt TTL.
- Confirm kiểm tra exact public ID/folder/context, resource/delivery type, format, timestamp, byte size, kích thước ảnh, thời lượng video và tối đa 8 KiB magic bytes cho RAW. CV/attachment dùng private authenticated delivery; file đang được tham chiếu không thể xóa; provider outage có cooldown tăng dần và delete failure có trạng thái retry rõ ràng.
- Docker Node 24 chạy non-root, fail-fast trước khi listen; root Compose có one-shot `media-migrate`, dependency và biến bắt buộc. Đã verify **12/12 unit + 18/18 TAP integration test** trên PostgreSQL 16.15, migration deploy lần hai không còn pending, schema diff không drift, runtime image/fail-fast và Nginx 1.30.4 `nginx -t` đều đạt; production dependency audit báo 0 vulnerability.
- Phần chưa hoàn thành của P09 là scheduled cleanup/reconciliation, live smoke với sáu Cloudinary preset thật, malware/deep PDF/DOC/DOCX parser, staging/promote public asset, distributed confirm limiter/active-byte quota/retention, Offer letter, wiring các consumer và tách migrator/runtime credential cùng secret rotation/mTLS.

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

> Đã hoàn thành, verify và merge vào `develop` theo xác nhận của người dùng.

- [x] Tạo nhánh `feature/application-service/application-evaluation` từ `develop` mới nhất.
- [x] Thêm bảng/entity/repository `Evaluation`.
- [x] Implement `POST /applications/:id/evaluation` cho recruiter cùng công ty.
- [x] Validate score, criteria JSON và note; lưu evaluator/time.
- [x] Bảo đảm Candidate không bao giờ nhận Evaluation trong API của mình.
- [x] Bổ sung unit/integration test và Swagger.

## P03 — Application Offer

> Đã hoàn thành, verify và merge vào `develop` theo xác nhận của người dùng.

- [x] Tạo bảng `Offer` và trạng thái `SENT/ACCEPTED/DECLINED`.
- [x] Implement `POST /applications/:id/offer`, chỉ cho phép từ `INTERVIEW`.
- [x] Lưu salary, start date, position, note và cặp reference `file_url/file_id`; xác minh ownership/canonical file chờ P09.
- [x] Chuyển Application sang `OFFER` bằng optimistic locking.
- [x] Phát event `OFFER_SENT` qua transactional outbox.
- [x] Implement `PATCH /offers/:id/respond` cho đúng Candidate.
- [x] ACCEPTED chuyển Application sang `HIRED`; DECLINED chuyển `REJECTED` và lưu lý do.
- [x] Chặn phản hồi lặp, offer hết hạn và concurrent response.

## P04 — Application Recruiter Dashboard và AI Match

> Recruiter Dashboard và AI Match phía Application đã merge vào `develop`. Provider `/ai/match`, schema/migration pgvector đã hoàn thành trong P11; consumer sinh embedding vẫn pending, còn filter kỹ năng chờ Profile/AI contract.

- [x] Implement `GET /applications/stats?company_id=`.
- [x] Tổng hợp số đơn theo job/status, tỷ lệ chuyển đổi, biểu đồ thời gian và nguồn Candidate.
- [x] Tích hợp Job Service để lấy tổng số tin đang tuyển.
- [x] Gọi AI `/ai/match` khi cần và lưu/cập nhật `match_score`.
  - [x] Thêm `POST /applications/:id/match-score/refresh`, chỉ MEMBER/OWNER đúng công ty và lấy `cv_id/job_id` từ Application.
  - [x] Chốt contract nội bộ, kiểm tra echoed IDs/score `0..1`, đổi sang phần trăm và làm tròn 2 chữ số; phân loại not-ready/unavailable/invalid response; cấu hình connect timeout 1 giây và read timeout 3 giây.
  - [x] Ghi điểm bằng `expectedVersion`/atomic compare-and-set; lỗi giữ nguyên điểm, không đổi status/`updated_at`, không ghi history hoặc outbox.
- [ ] Bổ sung filter theo kỹ năng sau khi Profile/AI contract sẵn sàng.
- [x] Test dữ liệu rỗng, range thiếu/sai/quá 366 ngày, quyền công ty, timezone PostgreSQL, `DAY/WEEK/MONTH` và DST.
- [x] Verify AI Match đạt tổng cộng 162 unit test và 35 integration test PostgreSQL/Kafka; riêng task mới bổ sung 36 unit test và 6 integration test.

## P05 — Hoàn thiện Job & Search

- [ ] Tích hợp `GET /jobs/recommended` với AI Service và CV mặc định.
- [ ] Fallback sang job mới nhất/lĩnh vực quan tâm khi AI lỗi hoặc Candidate chưa có CV.
- [x] Chạy integration transactional outbox với PostgreSQL 16 và Kafka 3.8 thật: migration sạch, rollback atomic, CAS cạnh tranh, thứ tự version và publish đủ event.
- [x] Bổ sung Redis 7 có auth, BullMQ và Elasticsearch 8.14.3 tắt auto-create vào integration suite Docker thật.
- [x] Kiểm tra outbox claim `SKIP LOCKED`, retry/backoff, lease heartbeat hai publisher, stable `event_id` và thứ tự theo `aggregate_version`.
- [x] Kiểm tra reindex idempotent, Elasticsearch retry và failed-job/dead-letter strategy.
  - [x] Durable PostgreSQL index-sync intent chống mất cập nhật khi Redis lỗi; claim bằng lease/`SKIP LOCKED` và tự reconcile queue state.
  - [x] Scripted update so sánh nguyên tử (`aggregateVersion`, `indexGeneration`) chống stale write; reindex mọi trạng thái bằng generation, set-based monotonic UPSERT và tombstone không searchable.
  - [x] Retry hữu hạn, Redis cold-outage fail-fast/recovery bằng worker thật, lưu lỗi cuối/attempt count và endpoint Admin xem/replay dead letter; shutdown được kiểm tra cả trước/sau claim và release intent nếu race xảy ra.
  - [x] Rollout `job_index_v3` với full field/analyzer validation; alias phải trỏ đúng một concrete index, alias nhiều target bị từ chối.
  - [x] Cặp marker `mappings._meta.baselineVersion=3` và `baselineIndexUuid` restart-safe cho cả index mới và index tương thích đã tồn tại; search fallback PostgreSQL và health `DEGRADED` cho tới khi baseline hoàn tất.
- [x] Bổ sung bulk/detail contract để Bookmark hiển thị đầy đủ cả Job đã hết hạn/đóng: tối đa 100 ID mỗi request, Application chunk 100, không N+1, strict response validation và fail-soft `job=null`.
- [ ] Kiểm tra load test cho search, pagination sâu và index mapping tiếng Việt.

## P06 — Hoàn thiện Company Service

- [ ] Chạy integration test với Auth/Admin/File Service thật.
- [ ] Xác minh ownership của logo, ảnh và video qua File/Media thay vì chỉ nhận reference.
- [ ] Chạy Prisma migration trên database sạch và kiểm tra rollback/backup.
- [ ] Bổ sung audit log cho duyệt công ty và thay đổi OWNER nếu yêu cầu nghiệm thu.
- [ ] Kiểm tra phân trang/tìm kiếm trang công ty công khai ở tải lớn.

## P07 — Auth Service

- [x] Tạo Flyway/JPA persistence cho User, RefreshSession và OAuthAccount; chốt OTP/ResetToken là secret tạm Redis thay vì bảng PostgreSQL; verify 15 unit + 5 integration test PostgreSQL 16.
- [x] Đăng ký Candidate/Recruiter, bcrypt cost 10 và xác minh OTP email với `registrationId`, Redis HMAC challenge, rolling rate limit, DB fence chống stale writer và SMTP đồng bộ; verify 77 unit + 16 integration test.
- [x] Đăng nhập email/password và Google OIDC stateless cho subject mới hoặc đã liên kết.
- [ ] Account-link Google có re-auth cho email local đã tồn tại nếu sản phẩm yêu cầu.
- [x] Phát JWT RS256 chuẩn `typ=JWT` với `iss/sub/aud/role/iat/exp/jti`; cung cấp active/previous public key qua JWKS.
- [x] Refresh rotation với absolute family TTL bảy ngày, logout, user-wide revoke khi reuse và chống concurrent fork.
- [x] Quên/đặt lại mật khẩu bằng token 256-bit TTL 15 phút, newest-accepted-wins, Redis HMAC state không PII, transaction đổi password + revoke active refresh session và generic anti-enumeration response.
- [x] Rate limit OTP/login/reset bằng Redis Lua, HMAC key không PII và fail-closed khi store lỗi; gateway thêm giới hạn recovery theo IP/instance.
- [x] API nội bộ Admin khóa/mở tài khoản, durable Admin recheck và vô hiệu hóa atomically mọi refresh session còn active.
- [x] Security stateless/deny-by-default, CORS exact-origin có credentials và no-store cho response nhạy cảm; chỉ public các endpoint health/registration/login/token/password-recovery/Google cần thiết.
- [x] Docker file-backed secret và script RSA-3072: private key chỉ vào Auth, public key vào các JWT consumer.
- [x] Unit/integration/security test cho password login, Google Redis flow, JWT/JWKS, `/auth/me`, rotation/reuse/concurrency, CORS và PostgreSQL/Redis thật.
- [x] Unit/integration/security test cho reset password với PostgreSQL/Redis thật, gồm privacy, quota, TTL, supersession, transaction, session revocation, replay và concurrency.
- [x] Unit/integration/security test cho Admin account control; full Auth verify đạt 215 unit + 40 integration test với PostgreSQL/Redis thật.

## P08 — User/Profile Service

- [x] Tạo Prisma models/migration đầy đủ cho profile, education, experience, skill, certificate, project và CV; verify 7/7 integration test với PostgreSQL 16 sạch, migration deploy lặp và runtime smoke.
- [x] CRUD hồ sơ Candidate và completion rule v1 (10/5/5/5/5/5/15/20/20/5/5), persist score/version transactionally và trả `missingSections`.
- [ ] Tích hợp Media signed upload cho avatar/CV PDF.
- [ ] Quản lý nhiều CV, CV mặc định, soft/hard delete đúng quy tắc tham chiếu.
- [ ] Implement CV Builder và dữ liệu JSON có version.
- [ ] Implement `GET /profile/cv?user_id=` và `GET /profile/cv/:id` đúng contract cho Application.
- [ ] Publish `cv-events` idempotent cho AI.
- [x] Bổ sung strict JWT/role guard, validation, Swagger, PostgreSQL/concurrency/security test cho phạm vi Candidate CRUD; recruiter-related read và internal CV authorization vẫn pending.

## P09 — File/Media Service

- [x] Tạo Prisma migration cho metadata, upload intent, trạng thái, audit và immutable reference; kiểm tra migration lặp và schema drift.
- [x] Implement signed upload, confirm chỉ bằng `fileId`, owner-scoped metadata/download và soft delete theo ownership; có idempotency, quota, rate limit, lease recovery và fencing.
- [x] Kiểm tra canonical format/MIME policy, byte size, image dimensions, video duration, resource/delivery type, public ID/folder/context và RAW magic bytes; deep parser/malware scan vẫn pending.
- [ ] Scheduled cleanup cho upload chưa được xác nhận/file rác.
- [x] API nội bộ xác minh `file_id`, cấp private download và bind/release reference cho Profile, Company, Application, Chat, Interview và AI theo scope riêng.
- [ ] Bổ sung media type/contract riêng cho Offer letter; không dùng tạm type khác.
- [x] Test intent hết hạn, file giả mạo, exact size boundary đủ sáu type, provider outage, delete đang được tham chiếu/failure, stale lease/fencing, rate/quota concurrency trên PostgreSQL 16.
- [ ] Chạy live smoke với tài khoản Cloudinary và sáu signed preset thật; test hiện dùng fake provider deterministic và Cloudinary SDK/fetch mock.

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

> Hai vertical slice pgvector/provider `/match` và consumer Job embedding đã hoàn thành. Bộ AI Service hiện đạt 159 unit test + 29 integration test PostgreSQL/Kafka (188 tổng cộng); production worker cũng đã chạy smoke test model thật.

- [ ] Chốt nhà cung cấp LLM: tài liệu ghi Claude nhưng dependency tùy chọn hiện khai báo Gemini.
- [x] Tạo schema pgvector và migration cho provider `/match`.
  - [x] Alembic quản lý `ai.cv_embeddings`, `ai.job_embeddings`, `vector(384)` và partial HNSW cosine index.
  - [x] Alembic `20260826_03` nâng `salary_min`/`salary_max` của Job embedding lên `NUMERIC(15,2)` để khớp producer.
  - [x] Migration chạy trước Uvicorn; readiness kiểm tra extension và cả hai bảng.
- [ ] Bổ sung CV nearest-neighbor index và benchmark index/filter khi làm recommendation candidates.
- [ ] Hoàn thiện toàn bộ consumer `cv-events` và `job-events`.
  - [x] Consumer `job-events` kiểm tra key/payload flat snake_case, chuẩn hóa nội dung, sinh vector và upsert/deactivate Job embedding.
  - [x] Chỉ `PUBLISHED` active; `/match` bỏ qua Job inactive. Các trạng thái `DRAFT/PENDING_APPROVAL/CLOSED/EXPIRED` tạo tombstone/deactivate.
  - [x] Worker non-root dùng model CPU 384 chiều với commit SHA bất biến, warm-up trước khi consume và cache riêng trong Docker volume.
  - [ ] Consumer `cv-events`, download/parse CV và upsert/delete CV embedding; đang chờ Profile/File cung cấp contract canonical.
- [x] Idempotency/order cho Job theo `event_id`, ledger và aggregate cursor; event v1 hiện dùng `aggregate_version`, còn fallback `occurred_at + partition + offset` chỉ dành cho payload legacy.
  - [x] Lookup event trước inference, transaction atomic cho embedding/cursor/ledger và hash-only DLQ; commit Kafka đồng bộ chỉ sau durable terminal outcome.
  - [x] Job producer dùng `aggregate_version` đơn điệu, compare-and-set và transactional outbox; publisher có bounded Kafka retry, lease heartbeat và chặn version sau khi version trước chưa publish.
- [x] `job-events` v1 phát đủ `requirements`, `salary_min`, `salary_max` và `job_type`; salary là decimal string hai chữ số hoặc `null`.
- [ ] Implement recommend jobs và recommend candidates.
- [x] Implement provider `POST /ai/match` cho Application Service.
  - [x] Bảo vệ bằng shared `X-Internal-Api-Key`, so sánh constant-time; request UUID snake_case và response envelope echo IDs.
  - [x] Chuẩn hóa cosine `[-1,1]` thành score `[0,1]` bằng `(cosine_similarity + 1) / 2`, không clamp.
  - [x] Thiếu embedding/model mismatch trả reason ổn định; lỗi vector store trả 503 và không lộ vector/nội dung gốc.
  - [x] Job đã deactivate được coi như không có embedding và trả `JOB_EMBEDDING_NOT_FOUND`.
- [ ] Implement chatbot có prompt an toàn, Redis history, timeout và rate limit.
- [x] Vector store, ledger và dead-letter chỉ lưu vector/hash/provenance/metadata tối thiểu; không lưu raw Kafka payload/key hoặc nội dung CV/job gốc.
- [x] Test auth/validation/error contract, migration lặp, privacy schema, vector 384 chiều, cosine biên, readiness, runtime non-root, Job ordering/idempotency/retry/DLQ và Kafka commit.
  - [x] Integration thật publish Kafka → worker → PostgreSQL/pgvector; kiểm tra duplicate không inference lại, malformed event vào hash-only DLQ và offset được commit.
  - [x] Production worker image sinh thành công vector chuẩn hóa 384 chiều bằng đúng model revision đã pin.
- [ ] Test chất lượng recommendation, latency tải thật, fallback và dữ liệu tiếng Việt sau khi consumer/model hoàn thành.

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

- [x] Bổ sung route chính thức `/offers/`, giữ nguyên prefix khi forward tới Application Service.
- [x] Bổ sung route `/files`, chặn case-insensitive internal Media path và xóa internal identity headers tại public gateway; cấu hình Nginx đã qua `nginx -t`.
- [ ] Bổ sung route chính thức `/bookmarks`; hiện Bookmark đi qua `/applications/bookmarks`.
- [ ] Xử lý cả URL có và không có dấu `/` cuối, ví dụ `/applications` và `/applications/`.
- [ ] Thêm healthcheck cho từng service và `depends_on` theo trạng thái healthy.
  - [x] Auth Service có health Actuator thật, trả `503` khi dependency `DOWN/OUT_OF_SERVICE`; Redis có healthcheck/auth và Auth chờ Redis healthy trong Compose.
  - [x] Profile image có healthcheck non-root; Compose chạy `profile-migrate` one-shot và chỉ khởi động Profile sau khi migration thành công.
  - [x] Media image Node 24 chạy non-root và fail-fast; Compose chạy `media-migrate` one-shot trước runtime, nhưng full Compose toàn hệ thống vẫn chưa smoke test.
- [ ] Dựng Jitsi self-host đầy đủ: web, Prosody, Jicofo, JVB, domain và TLS.
- [ ] Quản lý secrets an toàn cho JWT private key, Cloudinary, FCM, SMTP và LLM key.
- [ ] Cấu hình CORS, rate limit, request ID, timeout và WebSocket upgrade nhất quán.
- [ ] Thêm logging tập trung, metrics, tracing và cảnh báo.
- [ ] Backup/restore volume và migration strategy.
- [ ] Chạy `docker compose up --build` và smoke test toàn bộ route; Docker daemon/Testcontainers đã hoạt động nhưng Compose/smoke toàn hệ thống chưa được chạy.

## P16 — Frontend

- [ ] Thiết kế layout, design system, route guard và API client.
- [ ] Màn đăng ký/OTP/đăng nhập/quên mật khẩu.
- [ ] Candidate profile, CV manager/builder, search/detail, bookmark, apply, tracking và offer response.
- [ ] Recruiter company/verification/member, job management, applicant pipeline, evaluation, offer và dashboard.
- [ ] Interview calendar/Jitsi, realtime chat và notification center.
- [ ] Admin dashboard, company/job approval, user/report management và export.
- [ ] Loading/error/empty state, responsive UI, accessibility và E2E test.

## P17 — Kiểm thử tích hợp, bảo mật và phát hành

- [ ] Chốt schema JWT và toàn bộ payload Kafka giữa các thành viên; riêng `job-events` v1 đã khóa Kafka key `job_id` và đúng 16 trường versioned được liệt kê ở mục Transactional Job Event Outbox.
- [ ] Contract test REST giữa Auth/Profile/Company/Job/Application/Interview.
- [ ] Hoàn thiện contract test Kafka cho tất cả producer/consumer thật và duplicate event.
  - [x] AI Job consumer đã được kiểm tra với payload đúng shape Job producer, broker Kafka thật, duplicate event, DLQ và commit offset.
  - [x] Job producer đã được kiểm tra từ PostgreSQL transaction/outbox tới Kafka thật: rollback khi outbox lỗi, concurrent CAS, version `1/2/3`, salary biên, Kafka key/payload và trạng thái published.
- [ ] E2E Candidate: đăng ký → hồ sơ/CV → tìm việc → bookmark/apply → interview → offer → hired.
- [ ] E2E Recruiter: công ty → xác minh → job → duyệt → nhận hồ sơ → interview → offer.
- [ ] E2E Admin: duyệt, khóa user, report và dashboard.
- [ ] Security test JWT giả/hết hạn/sai role, IDOR, injection, file upload và secret leakage.
- [ ] Load test search, chat socket, notification worker và application concurrency.
- [ ] CI chạy lint, unit test, build, migration check và container scan cho từng Pull Request.
- [ ] Chuẩn hóa README, OpenAPI, `.env.example`, runbook và checklist release.

---

## Thứ tự ưu tiên đề xuất

1. Hoàn thiện Media scheduler/reconciliation, live Cloudinary smoke và nối Profile CV/avatar; core signed upload/ownership/reference đã hoàn thành, còn Offer letter cần policy riêng.
2. Hoàn thiện quản lý/CV Builder/internal CV APIs của Profile và tích hợp `fileId`; core Auth và Candidate Profile CRUD đã hoàn thành.
3. Hoàn thiện Profile/File + contract `cv-events` để triển khai CV consumer; phần Redis/BullMQ/Elasticsearch và reindex hardening của Job Service đã hoàn thành.
4. Implement recommendation jobs/candidates, nối `GET /jobs/recommended`, rồi bổ sung filter kỹ năng của Application.
5. Làm Interview, Notification và Chat theo hợp đồng event đã chốt.
6. Hoàn thiện Admin, Frontend, Jitsi và kiểm thử end-to-end.

## Rủi ro và điểm cần chốt ngay

- Core Auth đã hoàn thành qua OTP, password login, Google OIDC, JWT/refresh, forgot/reset password và Admin account control. Account-link Google có re-auth chỉ là hạng mục tùy chọn; production vẫn cần quy trình provisioning/bootstrap Admin được kiểm soát.
- Admin account control bị ẩn khỏi public gateway và chưa có AuditLog vì proxy/audit thuộc P10 Admin Service. Access JWT stateless đã phát cho service khác vẫn có thể dùng tối đa 15 phút; chưa có denylist/introspection để thu hồi tức thời toàn hệ thống. API hiện là set-state idempotent theo last-commit-wins và chưa nhận expected version/`If-Match`; P10 phải serialize command hoặc bổ sung conditional mutation nếu nghiệp vụ cần chặn delayed unlock.
- Password recovery dùng generic response và bounded async SMTP nhưng không cam kết timing tuyệt đối đồng nhất. Rate limit Nginx hiện theo từng gateway instance/client socket; triển khai sau LB/CDN hoặc nhiều replica phải cấu hình trusted Real IP, đồng bộ recovery CORS allowlist và dùng distributed ingress/WAF limiter. Production phải bật SMTP auth cùng STARTTLS bắt buộc.
- JWT `typ=JWT` hiện tương thích decoder mặc định của Application, nhưng Application/Company/Job chưa cùng enforce đầy đủ issuer, audience, UUID `sub/jti`, role/header contract hoặc rollout previous key; P17/cross-service negative contract test vẫn pending và không được coi là hoàn tất trong task Auth này.
- Profile đã có Candidate CRUD/completion/auth, nhưng chưa có API CV nên Application Submission vẫn lỗi tích hợp dù migration/test Profile đã đạt.
- Completion và `aggregate_version` của Candidate Profile đã được transaction hóa. Quy tắc tối đa năm CV, atomic default handover và CV compare-and-set vẫn chờ task quản lý CV; partial index hiện chỉ bảo đảm tối đa một active default.
- Application chưa cung cấp usage callback authoritative, nên Profile database đang chặn mọi hard delete để tránh xóa nhầm CV đã nộp. `cv-events` cũng chưa chốt giữa `file_url` trong tài liệu cũ và `file_id` + Media fetch an toàn; outbox/publisher chưa được tạo chủ ý.
- Quy tắc revision là quyết định an toàn bổ sung: Candidate vẫn có thể mở/chỉnh CV Online, nhưng CV đã dùng sẽ sinh `cv_id` mới thay vì sửa bản Application đã tham chiếu. API/UI clone revision và chuyển default transactionally vẫn pending.
- Media Service đã có API xác minh ownership/type/status, canonical metadata và private delivery, nhưng Profile chưa gọi API này nên `file_url`/avatar hiện vẫn chỉ có constraint HTTPS. PostgreSQL toàn hệ thống vẫn dùng shared role; cần tách migrator/runtime role và chặn service khác đọc PII schema `profile` trước production.
- Candidate Profile đã có cap transactionally cho từng collection; production vẫn cần distributed rate limit theo user/IP và load test các response ở sát giới hạn trước khi chạy nhiều gateway replica.
- Root Compose hiện dùng một PostgreSQL chung và tách bằng schema, khác yêu cầu kiến trúc cố định `profile-db` container/database riêng. Compose local còn opt-in JWKS HTTP; production phải dùng HTTPS/mTLS hoặc static PEM được mount tin cậy. Nhóm phải chính thức chấp nhận schema-per-service hoặc tách database/credential trước production.
- Nhà cung cấp LLM chưa thống nhất giữa tài liệu (Claude) và dependency tùy chọn hiện tại (Gemini); khác biệt này không ảnh hưởng provider `/match` thuần pgvector.
- `job-events` v1 đã được khóa theo implementation thật với key `job_id`, 16 trường versioned và salary decimal string hai chữ số hoặc `null`. Các topic khác vẫn phải chốt riêng; Event Offer đã bổ sung `actor_id`, `offer_id`, `offer_status`, `offer_version`, còn `recruiter_id` là recruiter gắn với Application/job.
- Pipeline, Kafka và hợp đồng quyền MEMBER/OWNER đã được kiểm chứng; Application Pipeline dùng quyền toàn công ty, còn quyền sửa/xóa Job vẫn do Job Service kiểm soát.
- Application Evaluation đã được kiểm chứng với JSONB trên PostgreSQL thật, gồm quyền công ty, validation, chống đánh giá trùng và Candidate privacy; P02 đã merge vào `develop` theo xác nhận của người dùng.
- Application Offer đã verify đạt 100 unit test và 23 integration test. Event không lộ salary/note/file; Media core đã có internal verify nhưng policy v1 chưa có `OFFER_LETTER` và Application chưa được nối, nên Offer vẫn chưa xác minh canonical file metadata/ownership.
- Application hiện đạt 173 unit + 35 integration test sau khi bổ sung Bookmark bulk detail; AI Service đạt 159 unit + 29 integration test. Job embedding đã chạy qua Kafka/PostgreSQL thật và model pin thật, nhưng chấm điểm end-to-end vẫn chờ Profile/File + CV consumer.
- Publisher `job-events` dùng at-least-once: nếu broker đã ACK nhưng process dừng trước khi ghi `published_at`, cùng `event_id` có thể được phát lại; consumer bắt buộc dedupe theo `event_id`/`aggregate_version`.
- Migration outbox Kafka không tự tạo historical `job-events` cho Job cũ; nếu AI/Statistics cần lịch sử thì vẫn phải có baseline/replay được review riêng trước khi bật producer mới. Riêng Elasticsearch `job_index_v3` dùng cặp marker bền vững `mappings._meta.baselineVersion=3` và `baselineIndexUuid`, tự enqueue/resume baseline cho cả index mới và index tương thích đã tồn tại sau restart. Khi marker chưa hoàn tất, search chuyển sang PostgreSQL và health ở `DEGRADED`; cần theo dõi tải fallback, pending/failed intent và chỉ coi rollout hoàn tất khi health trở lại `UP`.
- Cấu hình Elasticsearch sai field/type/analyzer hoặc alias trỏ nhiều concrete index hiện bị từ chối trước khi ghi; checklist rollout phải kiểm tra mapping/alias. Graceful shutdown đã release intent nếu gặp race ngay sau claim, nhưng deployment vẫn cần dành thời gian drain dispatcher/worker thay vì kill cưỡng bức.
- Outbox chưa có job retention tự động; payload chứa cả description/requirements. Các FK từ outbox và `job_index_sync` tới Job đang là `RESTRICT`, nên hard-delete Job sẽ bị chặn; cần chốt soft-delete hoặc thiết kế tombstone intent độc lập trước khi triển khai xóa cứng, không được đổi sang `CASCADE` khi chưa bảo đảm sự kiện/index xóa vẫn được phát.
- Pipeline chung vẫn cho phép Application ở `OFFER` chuyển thẳng sang `REJECTED` hoặc `WITHDRAWN`; khi đó bản ghi Offer có thể còn `SENT` dù phản hồi tiếp theo đã bị chặn. Cần chốt quy tắc đồng bộ/hủy Offer trong task lifecycle tiếp theo.
- Media confirm hiện có per-file exponential cooldown và atomic 60 upload intent/requester/giờ, nhưng chưa có distributed token bucket toàn cục cho Cloudinary Admin API; scheduler/reconciliation, live preset smoke, malware/deep parser và staging/promote public asset vẫn là điều kiện trước production.
- Docker daemon/Testcontainers đã hoạt động; AI API/worker đã verify migration, non-root, readiness, Kafka 3.8, PostgreSQL 16/pgvector và model thật; Media đã verify PostgreSQL 16, runtime image và Nginx riêng. Docker Compose toàn hệ thống vẫn chưa được kiểm chứng và hiện thiếu file môi trường runtime của một số service.
- Nginx đã có route độc lập `/offers/`; route `/bookmarks` và exact path không có dấu `/` cuối vẫn còn pending.
