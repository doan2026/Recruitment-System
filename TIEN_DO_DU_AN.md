# BÁO CÁO TIẾN ĐỘ DỰ ÁN HỆ THỐNG TUYỂN DỤNG

> Ngày cập nhật: 26/08/2026
> Nhánh đối chiếu chính: `develop`
> Nhánh triển khai lần cập nhật: `feature/auth-service/registration-otp-verification`

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
| Auth Service | Người 1 | 🟡 Persistence và đăng ký Candidate/Recruiter bằng OTP email đã hoàn thành; login/JWT còn thiếu |
| User/Profile Service | Người 1 | ⏳ Scaffold |
| File/Media Service | Người 1 | ⏳ Scaffold |
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
- **Trạng thái:** persistence Flyway/JPA và đăng ký Candidate/Recruiter bằng bcrypt cost 10 + OTP Redis/SMTP đã hoàn thành, đạt 77 unit + 16 integration test. Security đã stateless, chỉ public health/registration/OTP và deny các request khác; login, Google OAuth2, JWT/JWKS, refresh, reset password và Admin account control vẫn pending.

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
- **Trạng thái:** đã có unit test tập trung ở Company, Job/Search, Application và AI; Job/Search đạt 57 unit test và 13 integration test Docker với PostgreSQL 16, Kafka 3.8, Redis 7 và Elasticsearch 8.14.3, Application đạt 173 unit test và 35 integration test, AI đạt 188 test với PostgreSQL 16/pgvector cùng Kafka 3.8 thật; chưa có E2E toàn hệ thống.

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
- OTP/reset token tiếp tục là dữ liệu tạm Redis theo kiến trúc (`otp:*` TTL 5 phút, `reset:*` TTL 15 phút), không tạo bảng PostgreSQL và không lưu secret thô.
- Đã verify **15/15 unit test + 5/5 integration test** với PostgreSQL 16/Testcontainers: migration sạch, Hibernate mapping, normalized email, role/lock checks, FK/unique OAuth, optimistic locking và refresh lineage đều đạt.

## 2.10 Auth Registration và OTP Verification — task hiện tại

- Bổ sung public API `POST /auth/register`, `POST /auth/otp/resend` và `POST /auth/otp/verify` với response envelope thống nhất; self-registration chỉ nhận `CANDIDATE`/`RECRUITER`, mật khẩu tối thiểu tám ký tự Unicode, có chữ/số, không vượt 72 byte UTF-8 và chỉ lưu bcrypt cost 10.
- Mỗi pre-registration có `registrationId` bắt buộc cho resend/verify. Đăng ký lại một email đang pending tạo flow mới và thay đồng thời password/role/`registrationId`; flow/OTP cũ bị vô hiệu nên không thể giữ lại credential do người khác tạo. Email đã verified trả `409`; resend flow không tồn tại/cũ trả `202` chung để hạn chế enumeration.
- Flyway V2 thêm `registration_id`, sequence/column `registration_fence` và CHECK/unique index. Mỗi flow nhận fence tăng đơn điệu; PostgreSQL upsert chỉ nhận fence mới hơn nên stale writer không thể ghi đè credential mới dù Redis dispatch lease đã hết hạn.
- OTP sáu chữ số có TTL 5 phút; raw OTP không được lưu ở PostgreSQL/Redis và không ghi log. Redis chỉ giữ HMAC-SHA-256 challenge gắn với purpose, User ID, `registrationId`, canonical email và random generation; tên key dùng HMAC email nên không lộ PII.
- Lua atomically quản lý install, claim/finalize, cleanup, failure block và rolling resend reservation. Sai lần thứ năm xóa challenge và khóa 15 phút; initial email không tính quota, tối đa ba resend trong một giờ. Claim 30 giây bảo đảm hai verify đồng thời chỉ có một winner.
- Dispatch registration/resend có Redis lease theo email, renew/recheck ownership quanh DB/SMTP; DB fence là lớp bảo vệ bền vững khi lease hết hạn. Verify khóa pessimistic và kiểm tra lại User ID, `registrationId`, fence trước khi kích hoạt tài khoản, sau đó clear `registrationId`.
- SMTP gửi đồng bộ với connect/read/write timeout 3 giây và cleanup có CAS khi lỗi. Không tuyên bố exactly-once vì SMTP ACK/timeout vẫn có thể tạo email trễ hoặc trùng; production bắt buộc bật cả `SMTP_STARTTLS=true` và `SMTP_STARTTLS_REQUIRED=true` cùng SMTP auth/secret phù hợp.
- Security chuyển sang stateless, public đúng health/registration/OTP và `denyAll` cho endpoint chưa triển khai. `/health`, `/auth/health` phản ánh Actuator thật và trả `503` khi `DOWN/OUT_OF_SERVICE`; Nginx giữ nguyên prefix `/auth` và route health trực tiếp tới Actuator.
- Đã verify **77/77 unit test + 16/16 integration test (93/93 tổng)** với PostgreSQL 16.15, Redis 7 có mật khẩu và Testcontainers 1.21.4: validation, privacy, TTL/rate limit, supersession, stale fence, actual persisted User ID và concurrency đều đạt.

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
- [ ] Đăng nhập email/password và Google OAuth2.
- [ ] Phát JWT RS256 với `sub`, `role`, `iat`, `exp`; cung cấp public key/JWKS.
- [ ] Refresh token rotation, revoke session và phát hiện token reuse.
- [ ] Quên/đặt lại mật khẩu; rate limit OTP/login.
- [ ] API Admin khóa/mở tài khoản và vô hiệu hóa phiên hiện tại.
- [x] Bỏ cấu hình `anyRequest().permitAll()`; security stateless chỉ public health/registration/OTP và deny endpoint chưa triển khai.
- [ ] Hoàn thiện unit/integration/security test cho login, JWT/refresh, reset password và Admin account control khi các luồng đó được triển khai.

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
- [ ] Bổ sung route chính thức `/bookmarks`; hiện Bookmark đi qua `/applications/bookmarks`.
- [ ] Xử lý cả URL có và không có dấu `/` cuối, ví dụ `/applications` và `/applications/`.
- [ ] Thêm healthcheck cho từng service và `depends_on` theo trạng thái healthy.
  - [x] Auth Service có health Actuator thật, trả `503` khi dependency `DOWN/OUT_OF_SERVICE`; Redis có healthcheck/auth và Auth chờ Redis healthy trong Compose.
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

1. Hoàn thiện Auth và Profile vì đang chặn xác thực/nộp đơn end-to-end.
2. Hoàn thiện File/Media để mở khóa CV, logo, attachment và Offer letter.
3. Hoàn thiện Profile/File + contract `cv-events` để triển khai CV consumer; phần Redis/BullMQ/Elasticsearch và reindex hardening của Job Service đã hoàn thành.
4. Implement recommendation jobs/candidates, nối `GET /jobs/recommended`, rồi bổ sung filter kỹ năng của Application.
5. Làm Interview, Notification và Chat theo hợp đồng event đã chốt.
6. Hoàn thiện Admin, Frontend, Jitsi và kiểm thử end-to-end.

## Rủi ro và điểm cần chốt ngay

- Auth đã có persistence và đăng ký Candidate/Recruiter với bcrypt/OTP Redis-email, nhưng vẫn chưa phát JWT thật nên các service đã verify JWT chưa thể chạy end-to-end; task tiếp theo là login email/password, Google OAuth2 và JWT RS256/JWKS.
- Profile chưa có API CV nên Application Submission sẽ lỗi tích hợp dù unit test đã đạt.
- Nhà cung cấp LLM chưa thống nhất giữa tài liệu (Claude) và dependency tùy chọn hiện tại (Gemini); khác biệt này không ảnh hưởng provider `/match` thuần pgvector.
- `job-events` v1 đã được khóa theo implementation thật với key `job_id`, 16 trường versioned và salary decimal string hai chữ số hoặc `null`. Các topic khác vẫn phải chốt riêng; Event Offer đã bổ sung `actor_id`, `offer_id`, `offer_status`, `offer_version`, còn `recruiter_id` là recruiter gắn với Application/job.
- Pipeline, Kafka và hợp đồng quyền MEMBER/OWNER đã được kiểm chứng; Application Pipeline dùng quyền toàn công ty, còn quyền sửa/xóa Job vẫn do Job Service kiểm soát.
- Application Evaluation đã được kiểm chứng với JSONB trên PostgreSQL thật, gồm quyền công ty, validation, chống đánh giá trùng và Candidate privacy; P02 đã merge vào `develop` theo xác nhận của người dùng.
- Application Offer đã verify đạt 100 unit test và 23 integration test. Event không lộ salary/note/file, nhưng xác minh canonical file metadata và ownership vẫn chờ API nội bộ của File/Media ở P09.
- Application hiện đạt 173 unit + 35 integration test sau khi bổ sung Bookmark bulk detail; AI Service đạt 159 unit + 29 integration test. Job embedding đã chạy qua Kafka/PostgreSQL thật và model pin thật, nhưng chấm điểm end-to-end vẫn chờ Profile/File + CV consumer.
- Publisher `job-events` dùng at-least-once: nếu broker đã ACK nhưng process dừng trước khi ghi `published_at`, cùng `event_id` có thể được phát lại; consumer bắt buộc dedupe theo `event_id`/`aggregate_version`.
- Migration outbox Kafka không tự tạo historical `job-events` cho Job cũ; nếu AI/Statistics cần lịch sử thì vẫn phải có baseline/replay được review riêng trước khi bật producer mới. Riêng Elasticsearch `job_index_v3` dùng cặp marker bền vững `mappings._meta.baselineVersion=3` và `baselineIndexUuid`, tự enqueue/resume baseline cho cả index mới và index tương thích đã tồn tại sau restart. Khi marker chưa hoàn tất, search chuyển sang PostgreSQL và health ở `DEGRADED`; cần theo dõi tải fallback, pending/failed intent và chỉ coi rollout hoàn tất khi health trở lại `UP`.
- Cấu hình Elasticsearch sai field/type/analyzer hoặc alias trỏ nhiều concrete index hiện bị từ chối trước khi ghi; checklist rollout phải kiểm tra mapping/alias. Graceful shutdown đã release intent nếu gặp race ngay sau claim, nhưng deployment vẫn cần dành thời gian drain dispatcher/worker thay vì kill cưỡng bức.
- Outbox chưa có job retention tự động; payload chứa cả description/requirements. Các FK từ outbox và `job_index_sync` tới Job đang là `RESTRICT`, nên hard-delete Job sẽ bị chặn; cần chốt soft-delete hoặc thiết kế tombstone intent độc lập trước khi triển khai xóa cứng, không được đổi sang `CASCADE` khi chưa bảo đảm sự kiện/index xóa vẫn được phát.
- Pipeline chung vẫn cho phép Application ở `OFFER` chuyển thẳng sang `REJECTED` hoặc `WITHDRAWN`; khi đó bản ghi Offer có thể còn `SENT` dù phản hồi tiếp theo đã bị chặn. Cần chốt quy tắc đồng bộ/hủy Offer trong task lifecycle tiếp theo.
- Docker daemon/Testcontainers đã hoạt động; AI API/worker đã verify migration, non-root, readiness, Kafka 3.8, PostgreSQL 16/pgvector và model thật. Docker Compose toàn hệ thống vẫn chưa được kiểm chứng và hiện thiếu file môi trường runtime của một số service.
- Nginx đã có route độc lập `/offers/`; route `/bookmarks` và exact path không có dấu `/` cuối vẫn còn pending.
