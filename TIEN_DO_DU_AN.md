# BÁO CÁO TIẾN ĐỘ DỰ ÁN HỆ THỐNG TUYỂN DỤNG

> Ngày cập nhật: 29/08/2026
> Nhánh đối chiếu chính: `develop`
> Pull Request lần cập nhật: PR #67 từ `feature/application-service/offer-lifecycle-consistency` vào `develop`

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
| User/Profile Service | Người 1 | 🟡 Persistence, Candidate CRUD/completion, hai consent aggregate tách biệt cho Job preferences và Recruiter discovery, Media, Application CV contract v1, skill snapshot contract v2, lifecycle, backend Builder, deletion fence, transactional `cv-events` và controlled historical CV baseline đã hoàn thành; baseline chưa execute trên dữ liệu thật, frontend Builder/PDF renderer cùng consent/preferences UI còn pending |
| File/Media Service | Người 1 | 🟡 Core signed upload/confirm, Profile consumer, AI private-download consumer contract, durable cleanup/reconciliation và guarded six-policy Cloudinary smoke runner đã hoàn thành; live staging execution, Offer letter, các consumer khác và production hardening còn pending |
| Admin & Statistics Service | Người 1 | ⏳ Scaffold |
| Company Service | Người 2 | 🟡 **Đã làm:** nghiệp vụ chính, ownership media, migration backup/restore, domain audit, public search/load, Auth–Company identity gate, Company–Media contract integration, metrics/SLO. **Chưa làm:** real Admin approval E2E — chặn vì Admin Service chưa implement; live Cloudinary thuộc P09 |
| Job & Search Service | Người 2 | ✅ **P05 đóng 20/20.** Đã làm: CRUD/search, transactional `job-events`, historical baseline, Redis/BullMQ/Elasticsearch, hai chiều recommendation, load/cursor/Vietnamese gate, strict JWT/JWKS, contract gate với Application, metrics/SLO. **Chưa làm:** deployed E2E/load trên hạ tầng thật |
| Application Service | Người 2 | ✅ **P03 11/11, P04 13/13.** Đã làm: Submission→AI Match, canonical CV contract, usage/deletion gate, skill snapshot, `application-events` v1, strict JWT/JWKS, concurrency gate 10.000 call, Offer terminal-state V9 và auto-expiry V10, contract gate với AI và Job thật, metrics/SLO. **Chưa làm:** deployed E2E và HTTP/multi-replica load trên hạ tầng thật |
| AI Service | Người 2 | 🟡 **Đã làm:** provider `/match`, consumer `job-events`/`cv-events`, hai chiều recommendation, HNSW/exact-allowlist gate, full-target HTTP gate, chatbot Candidate và recommendation tool, distributed limiter, filter-aware ANN đã điều tra và loại trừ, relevance tiếng Việt đo bằng model thật, bất biến và load cross-replica, metrics/SLO. **Chưa làm:** live Claude 10-FAQ (thiếu API key), corpus production quy mô thật, deployed load/monitoring |
| Interview & Video Call Service | Người 3 | 🟡 Scheduling foundation, transactional `SCHEDULED interview-events`, role-aware detail/history/my, Recruiter Company calendar và advisory availability v1 đã hoàn thành; arbitrary interviewer/panel, lifecycle/Jitsi/feedback và các event action còn lại pending |
| Chat Service | Người 3 | ⏳ Prototype realtime |
| Notification Service | Người 3 | 🟡 `application-events` v1 và `SCHEDULED interview-events` v1 → private in-app inbox đã hoàn thành với PostgreSQL/Kafka thật; BullMQ, FCM, SMTP, device/settings API, Chat/remaining Interview lifecycle và reminder còn pending |
| Hạ tầng dùng chung | Người 3 | 🟡 Docker Compose, Nginx, database và Kafka base đã có; Notification có one-shot migration, non-root runtime, readiness DB/Kafka, static JWT PEM và route no-store/query-free; distributed limiter, Kafka TLS/SASL, Jitsi và production hardening còn pending |
| Frontend | Phối hợp cả nhóm | ⏳ Trang khởi tạo |
| Tích hợp, kiểm thử và vận hành | Phối hợp cả nhóm | 🟡 Nhiều service-level PostgreSQL/Kafka/security suite đã có; deployed cross-service E2E, load và release gate toàn hệ thống còn pending |

---

## Trạng thái chốt của Người 2 (cập nhật 30/08/2026)

Bốn service Company, Job & Search, Application và AI. **44/44 checkbox của P03, P04 và P05 đã đóng**; còn sáu checkbox mở ở P06 và P11, trong đó một mục thuộc Người 3.

### Đã làm

| Section | Checkbox | Ghi chú |
| --- | --- | --- |
| P03 Application Offer | **11/11** | Đóng hoàn toàn, kể cả auto-expiry worker |
| P04 Dashboard & AI Match | **13/13** | Đóng hoàn toàn |
| P05 Job & Search | **20/20** | Đóng hoàn toàn |
| P06 Company | 6/8 | Chỉ còn Admin approval E2E |
| P11 AI | 44/48 | Còn live Claude, corpus production, widget của Người 3 |

### Chưa làm, và vì sao

| Mục | Vì sao chưa làm được | Đã chuẩn bị sẵn gì |
| --- | --- | --- |
| Live Claude 10-FAQ quality/staging smoke | Repository không có `ANTHROPIC_API_KEY`. Không thể tuyên bố PASS mà không chạy thật | Runner guarded hoàn chỉnh (PR #74) với 23 offline test; cấp key là chạy được ngay |
| Corpus production quy mô thật + deployed load/capacity + production monitoring/SLO | Cần dữ liệu tuyển dụng thật và hạ tầng triển khai thật, cả hai đều nằm ngoài repository | Relevance đo bằng model thật (#75), bất biến cross-replica (#76), load hai replica (#78), metrics/SLO đủ bốn service (#77, #79, #80, #81) |
| Real Admin approval E2E | **Admin Service chưa tồn tại** — toàn bộ P10 còn trống và thuộc Người 1. Không thể E2E với một service chưa có mã | Company–Media contract integration đã hoàn thành (#70); lát cắt Auth đã PASS trước đó (#60) |
| Frontend chatbot widget | **Thuộc Người 3**, không nằm trong phạm vi backend của Người 2 | — |

### Hai lỗi production được phát hiện trong quá trình làm

- **h2c upgrade** (PR #71): JDK HTTP client mặc định HTTP/2 nên gửi h2c upgrade qua cleartext; uvicorn từ chối, làm **mọi lời gọi `/match` từ Application hỏng trên dây** trong môi trường thật, trong khi toàn bộ unit test vẫn xanh vì `MockRestServiceServer` chặn ở tầng trên transport. Đã sửa bằng cách ghim HTTP/1.1.
- **Race migration khi khởi động nhiều replica** (PR #78): runtime image chạy `alembic upgrade head` trước Uvicorn nên mọi replica đều migrate; khởi động đồng thời thì đua nhau và replica thua **crash-loop suốt một lần rolling deploy**. Đã sửa bằng PostgreSQL advisory lock.

### Một kết luận loại trừ

**Filter-aware ANN không áp dụng được** cho `/recommend/jobs` với hợp đồng phân trang hiện tại (PR #73). Index HNSW chỉ phục vụ khoá khoảng cách đơn thuần; thêm tie-break `job_id` — thứ mà stateless keyset cursor bắt buộc phải có — là index hết dùng được. Áp dụng ANN đồng nghĩa từ bỏ trang cursor đầy đủ và tái lập được, tức đổi hợp đồng phân trang chứ không phải bật một cờ. Một cờ opt-in đã được prototype rồi **gỡ bỏ có chủ đích** vì sẽ là code chết. Kết luận được giữ dưới dạng sáu test chạy được để không mục theo thời gian.


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
- **Chức năng chính:** CRUD hồ sơ cá nhân, kỹ năng, học vấn, kinh nghiệm, chứng chỉ, dự án; quản lý nhiều CV; giữ soft-delete CV đã dùng, hard-delete CV leaf chưa dùng sau atomic fence; Candidate API và versioned internal contract cho Application.
- **Phụ thuộc:** Auth Service và File/Media Service; AI và Application phụ thuộc dữ liệu của service này.
- **Trạng thái:** Persistence, Candidate Profile CRUD/completion, tích hợp Media và canonical Application contract đã merge qua PR #39; lifecycle qua PR #40; backend CV Builder qua PR #41; deletion fence qua PR #42. Transactional `cv-events` producer/outbox và AI CV integration đã hoàn thành qua PR #43; rolling-compatible Application skill snapshot contract v2 qua PR #46; explicit Candidate job preferences qua PR #48; consent Recruiter discovery tách biệt, exact CV binding và safe projection qua PR #49. Frontend Builder/PDF renderer cùng consent/preferences UI còn pending.

## T03 — File/Media Service

- **Mục tiêu:** nơi duy nhất giữ Cloudinary secret và quản lý metadata file của toàn hệ thống.
- **Công nghệ:** NestJS, TypeScript, Prisma, PostgreSQL, Cloudinary Node SDK.
- **Luồng hoạt động:** sinh signed upload; client upload trực tiếp lên Cloudinary; xác nhận metadata; xóa file đúng quyền; dọn file rác định kỳ.
- **Chức năng chính:** `POST /files/signature`, `POST /files`, `DELETE /files/:id`, xác minh MIME/dung lượng/thư mục, ownership và trạng thái file.
- **Phụ thuộc:** Auth; được Profile, Company, Chat, Interview và Application/Offer sử dụng.
- **Trạng thái:** core signed upload/confirm, canonical provider verification, ownership/reference/private delivery, Profile và AI consumer contract cùng durable scheduled cleanup/reconciliation đã hoàn thành ở mức service test; live Cloudinary, malware/deep parser, Offer letter, các consumer còn lại cùng production hardening còn pending.

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
- **Luồng hoạt động:** tạo hồ sơ công ty; OWNER xin chữ ký/confirm upload và gắn media đã xác minh; cập nhật; gửi duyệt và Admin xác minh; hiển thị trang công khai; mời, chấp nhận, xóa và chuyển quyền thành viên.
- **Chức năng chính:** profile CRUD, logo/ảnh/video Media-backed, trạng thái `PENDING/VERIFIED/REJECTED`, ownership, invitation token, public company page và endpoint tra cứu membership cho service khác.
- **Phụ thuộc:** Auth, File/Media và Admin.
- **Trạng thái:** nghiệp vụ chính và Company–Media ownership đã merge vào `develop` qua PR #54; migration backup/restore đã verify qua PR #55; append-only domain audit cho duyệt công ty/chuyển OWNER hoàn thành qua PR #56; public search/load hoàn thành qua PR #57. Real Auth–Company invitation identity gate đã PASS; Company–Media contract integration với PostgreSQL thật và HTTP thật hoàn thành qua PR #70; metrics/SLO surface hoàn thành qua PR #81. **Chưa làm:** real Admin approval E2E — bị chặn vì Admin Service mới ở mức scaffold, và live Cloudinary E2E vẫn thuộc P09.

## T06 — Job & Search Service

- **Mục tiêu:** nguồn dữ liệu gốc của tin tuyển dụng và công cụ tìm kiếm việc làm.
- **Công nghệ:** NestJS, TypeScript, Prisma, PostgreSQL, Elasticsearch, BullMQ, Redis, KafkaJS.
- **Luồng hoạt động:** recruiter tạo/sửa tin nháp; gửi duyệt; Admin duyệt/từ chối; đóng/hết hạn tin; tìm kiếm và lọc; đồng bộ Elasticsearch; phát `job-events`; lấy gợi ý từ AI.
- **Chức năng chính:** Job CRUD, state machine `DRAFT → PENDING_APPROVAL → PUBLISHED/REJECTED → CLOSED/EXPIRED`, tìm kiếm full-text và filter, reindex, PostgreSQL fallback, endpoint kiểm tra job còn nhận hồ sơ.
- **Phụ thuộc:** Auth, Company, Admin, Elasticsearch, Redis, Kafka và AI.
- **Trạng thái:** CRUD, publishing, search, durable Elasticsearch indexing, availability, thống kê job active, `job-events` v1 qua transactional outbox và Candidate job recommendation đã hoàn thành; PR #48 bổ sung explicit-preference fallback deterministic. PR #49 bổ sung Recruiter-only candidate recommendation với Company/Job capability, version binding và post-resolution revalidation. Controlled 100.000-Job search load gate, deep cursor pagination, Vietnamese mapping v4 và strict canonical access-token/JWKS verification ở mức service test đã PASS; CV Candidate index/filter gate hoàn thành ở mục 2.34 và Candidate-facing `/recommend/jobs` full-target HTTP/load gate hoàn thành ở mục 2.41. Application–Job internal contract gate với Job Service thật hoàn thành qua PR #72; metrics/SLO surface hoàn thành qua PR #80. **Chưa làm:** deployed Auth–Job negative E2E và deployed load/capacity trên hạ tầng thật.

## T07 — Application Service

- **Mục tiêu:** quản lý toàn bộ vòng đời ứng tuyển từ lúc Candidate nộp đơn đến khi tuyển hoặc bị loại.
- **Công nghệ:** Spring Boot 3, Java 21, Spring Security Resource Server, Spring Data JPA, Flyway, PostgreSQL, Spring Kafka, transactional outbox.
- **Luồng hoạt động:** nộp đơn; Bookmark; Candidate theo dõi timeline; HR lọc và quản lý hồ sơ; state machine; đánh giá nội bộ; gửi/phản hồi Offer; thống kê recruiter; tính lại điểm AI theo yêu cầu.
- **Chức năng chính:** Application, ApplicationHistory, Evaluation, Offer, Bookmark; optimistic locking; phân quyền theo Candidate/công ty; refresh `match_score`; phát `application-events`.
- **Phụ thuộc:** Auth, Profile, Job, Company, AI, File/Media và Notification qua Kafka.
- **Trạng thái:** các luồng đến Recruiter Dashboard và AI Match phía Application đã merge. Canonical Profile verification, recruiter CV metadata/download và Flyway V6 usage ledger đã merge qua PR #39; Flyway V7 permanent deletion gate và submission serialization qua PR #42; Profile v2 consumer, Flyway V8 snapshot/filter qua PR #47; canonical `application-events` JSON Schema/fixtures và v1 producer cho Submission/Pipeline/Offer hoàn thành qua PR #50; strict canonical JWT/JWKS consumer gate hoàn thành qua PR #64; controlled concurrency/load gate 10.000 call hoàn thành qua PR #65; Offer `SENT` được đồng bộ nguyên tử sang `CANCELLED` khi Application ở `OFFER` bị reject/withdraw và legacy được backfill bằng Flyway V9 qua PR #67. Offer quá hạn được worker chuyển sang terminal `EXPIRED` với Flyway V10 qua PR #68; contract gate với AI Service thật qua PR #71 đã phát hiện và sửa lỗi h2c upgrade làm hỏng mọi lời gọi `/match`; contract gate với Job Service thật qua PR #72; metrics/SLO surface qua PR #79. **Chưa làm:** deployed E2E và HTTP/multi-replica load trên hạ tầng thật.

## T08 — AI Service

- **Mục tiêu:** tạo embedding CV/Job, chấm điểm tương đồng, gợi ý việc và chatbot hỗ trợ Candidate.
- **Công nghệ theo tài liệu:** Python, FastAPI, sentence-transformers `all-MiniLM-L6-v2`, pgvector, Redis, Kafka và Anthropic Claude.
- **Công nghệ hiện tại:** FastAPI, Psycopg 3, Alembic, PostgreSQL/pgvector, confluent-kafka và sentence-transformers CPU với model/revision bất biến; chatbot dùng Anthropic Claude qua `anthropic==0.120.2`, JWT RS256/JWKS qua `PyJWT==2.13.0` và Redis qua `redis==7.4.1`.
- **Luồng hoạt động:** consume `cv-events`; consume `job-events`; cập nhật/xóa vector; cosine similarity; recommend jobs/CVs; match CV-job; chatbot có lịch sử ngắn hạn.
- **Chức năng chính:** đã có `/ai/match`, internal `/recommend/jobs`, internal `/recommend/candidates`, consumer idempotent và Candidate-only `POST /chat`; Job Service public surface cho Recruiter chỉ trả projection Candidate tối thiểu. Chatbot có personalized Job recommendation tool bật độc lập bằng feature flag, chỉ gọi fixed Candidate `/recommended?limit=3` khi Claude trả exact intent không tham số.
- **Phụ thuộc:** schema `cv-events`, `job-events`, Kafka, PostgreSQL pgvector và Redis.
- **Trạng thái:** đã có vector store/migration, internal auth/readiness, provider `/match`, worker Job embedding, dedicated CV embedding worker dùng private Media download, internal `/recommend/jobs`, consent-scoped `/recommend/candidates`, backend chatbot Candidate và personalized Job recommendation tool v1. Chatbot khóa RS256/JWKS, fixed recruitment-only prompt, Redis history HMAC 10 lượt/24 giờ, renewable exact-token session lease/fencing, distributed sliding limit theo user/toàn cục, timeout/output hữu hạn, lỗi làm sạch và `no-store`; token Candidate chỉ được chuyển tạm thời tới fixed Job endpoint sau exact tool intent và không được lưu vào history. Exact Candidate–CV pair, authoritative Job version và HMAC cursor đã được khóa qua PR #49; CV HNSW cùng controlled 100.000-CV index/filter/exact-allowlist gate và Candidate-facing 100.000-Job full-target HTTP/load gate đã PASS. PR #69 bổ sung distributed limiter Redis cho `/recommend/jobs` và `/recommend/candidates`. Filter-aware ANN đã điều tra và **loại trừ** qua PR #73 vì index chỉ phục vụ khoá khoảng cách đơn thuần; guarded live-FAQ runner qua PR #74; relevance tiếng Việt đo bằng model thật qua PR #75 (precision@1 1.0, bỏ dấu 1.0, tách sạch 0.25); bất biến cross-replica qua PR #76; metrics/SLO surface qua PR #77; load hai replica qua PR #78 đã phát hiện và sửa race migration làm replica crash-loop khi rolling deploy. **Chưa làm:** live Claude 10-FAQ (thiếu API key), corpus production quy mô thật và deployed load/monitoring trên hạ tầng thật; frontend chatbot widget và limiter tầng gateway thuộc Người 3.

## T09 — Interview & Video Call Service

- **Mục tiêu:** quản lý lịch phỏng vấn và phòng video Jitsi.
- **Công nghệ:** Spring Boot 3, Java 21, Spring Data JPA, WebClient, Spring Kafka, PostgreSQL, Jitsi.
- **Luồng hoạt động:** HR đặt lịch; Candidate xác nhận/đề nghị đổi lịch; vào phòng video; đánh giá sau phỏng vấn; hủy/no-show; xem lịch.
- **Chức năng chính:** kiểm tra quyền theo application; chống trùng lịch; vòng phỏng vấn; feedback; room URL/token; phát `interview-events`.
- **Phụ thuộc:** Auth, Application, Notification và Jitsi.
- **Trạng thái:** scheduling foundation v1 hoàn thành qua PR #51; transactional `SCHEDULED interview-events` v1 và Notification Candidate projection hoàn thành qua PR #52; role-aware detail/history/my, Recruiter Company calendar và advisory availability v1 hoàn thành qua PR #53. Chọn interviewer khác/panel, confirm/reschedule/cancel/no-show, feedback, Jitsi và lifecycle events/reminder còn pending.

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
- **Trạng thái:** `application-events` v1 và `SCHEDULED interview-events` v1 → in-app inbox đã hoàn thành: Prisma migration, hai dedicated Kafka group/cutoff, durable idempotency/poison ledger, strict JWT, HMAC keyset pagination, unread/read/read-all, Compose/readiness và test PostgreSQL/Kafka thật. Push/email, device/settings API, BullMQ, remaining Interview lifecycle, Chat và reminder chưa làm.

## T12 — Hạ tầng dùng chung

- **Mục tiêu:** chạy toàn bộ hệ thống bằng Docker Compose và định tuyến qua một API Gateway.
- **Công nghệ:** Docker Compose, Nginx, PostgreSQL/pgvector, MongoDB, Redis, Kafka KRaft, Elasticsearch và Jitsi.
- **Luồng hoạt động:** khởi động database/broker; tạo schema và Kafka topic; build 11 service; gateway route; health check; lưu volume; dựng Jitsi.
- **Chức năng chính:** mạng nội bộ, env/secrets, service dependency, topic initialization, persistent volumes, gateway HTTP/WebSocket.
- **Trạng thái:** Compose, Nginx base, schema PostgreSQL, Kafka topics, Redis/MongoDB/Elasticsearch và volumes đã có. Job→AI scoped key, outbound Profile/AI host allowlist, public AI internal-route blocking/header stripping và query-free Candidate-data access log cho Profile/Job/Application đã hoàn thành; Jitsi và production hardening còn thiếu.

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
- **Trạng thái:** đã có unit/integration test tập trung ở Company, Job/Search, Application, AI, Profile, Media, Interview và Notification. Company hiện đạt **306/306 unit test + build**, PostgreSQL 16 migration/audit/search-index/invitation-normalization/backup/separate-restore gate PASS, public-search HTTP load gate PASS trên 100.000 Company và real Auth–Company invitation gate PASS; Profile đạt **62/62 unit + 89/89 PostgreSQL/Kafka integration test**, Media **26 + 26**, Job/Search **533 unit + 20 PostgreSQL/Kafka/Redis/Elasticsearch integration**, AI **529 unit/non-integration + 62 PostgreSQL/Kafka/Redis integration (591 tổng)**, Application **286 unit/WebMvc/security + 71 PostgreSQL/Kafka integration**, Interview **143/143 unit/WebMvc/security/client/event/query + 16/16 PostgreSQL/Kafka integration**, Notification **51 unit + 7 PostgreSQL/Kafka integration** với migration deploy lặp sạch. Job/Search controlled load gate trên 100.000 Job đạt 10.000 request ở concurrency 32 với 0 lỗi, p95 402,763 ms, p99 503,771 ms và 164,632 req/s. AI controlled repository gate trên 100.000 CV đạt 10.000 call ở concurrency 32 với 0 lỗi/mismatch, p95 130,089 ms, p99 149,503 ms và 323,129 req/s. AI Candidate-facing full-target HTTP gate trên 100.000 Job đạt 100 warm-up + 1.000 measured call ở concurrency 8 với 0 error/mismatch/timeout/security leak, p95 1.021,163 ms, p99 1.133,728 ms, max 1.299,623 ms và 10,762 req/s dưới DB statement timeout 2 giây. Application controlled transaction gate đạt đúng 10.000 service call ở concurrency 32 với 5.000 giao dịch thắng, 5.000 conflict `409` dự kiến, 0 lỗi bất ngờ/deadlock/timeout, p95 114,567 ms, p99 162,895 ms và 585,53 call/s. Chatbot có deterministic plumbing cho 10 FAQ nhưng live Claude quality/staging smoke chưa chạy vì cần credential ngoài repository. Đây là bằng chứng service-level/local controlled load, không đồng nghĩa deployed E2E toàn hệ thống hoặc production SLO và P17 vẫn pending.

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

### Company Media Ownership & Lifecycle — PR #54

- Chuyển sang luồng hai pha: tạo Company trước, sau đó OWNER gọi `POST /:id/media/signature`, upload trực tiếp và `POST /:id/media/confirm`; public Recruiter không thể tự khai owner Company. Company lưu upload-intent bền vững và chỉ confirm exact `company + requester + type + file + expiry + cleanupAt`, chặn confused-deputy trước khi Media đổi trạng thái.
- `PUT /:id` chỉ nhận `fileId` cùng type/order nghiệp vụ, không nhận URL. Company gọi direct Media origin bằng key riêng, kiểm exact `ACTIVE + COMPANY + companyId + COMPANY_LOGO|COMPANY_IMAGE|COMPANY_VIDEO`, public delivery và canonical HTTPS URL trước khi bind.
- Prisma bổ sung `aggregate_version`, upload-intent, reference UUID cho logo/gallery và durable `company_media_operations`. Attach được stage trước HTTP, bind trước domain commit; transaction Serializable/CAS xóa ATTACH operation và tạo DETACH cleanup atomically.
- Foreground request giữ lease token, heartbeat toàn batch và fence tới transactional delete; worker chỉ nhận sau khi lease hết và lease đủ ngân sách bốn HTTP call. Mỗi lần attach logo dùng binding generation UUID mới nên stale cleanup không thể release reference vừa gắn lại.
- Reconciler có grace, compare-and-set lease, fencing, bounded batch và exponential backoff; crash sau bind được recover bằng bind idempotent rồi release/delete, cleanup cũ không xóa file đã reattach và mỗi vòng detach giữ operation UUID riêng. Signature đồng thời stage cleanup deterministic; upload đã confirm nhưng bị bỏ dở được xoá sau grace để trả quota, còn attach thành công consume intent/cleanup trong cùng transaction.
- Legacy `fileId/url` chưa có Media reference bị ẩn khỏi owner/public response thay vì tiếp tục tin dữ liệu cũ. Migration giữ nguyên row legacy để backfill/quarantine có kiểm soát; không tự nhận chúng là canonical.
- Client fail closed với origin/key/timeout, redirect deny, response 64 KiB, exact envelope/field/echo validation và status mapping không tin error body. Full Company đạt **139/139 unit test**, build PASS; migration đã được áp dụng lặp trên PostgreSQL 16 sạch, schema drift bằng 0 và legacy fixture không mất dữ liệu. Real Auth/Admin/Media deployed E2E và live Cloudinary preset vẫn thuộc các gate pending riêng.
- Media quota hiện là 1 logo, 10 ảnh, 1 video ACTIVE mỗi Company. Upload confirm bị bỏ dở được reconciler thu hồi tự động sau intent expiry + grace 900 giây. Khi slot đang được profile sử dụng, thay thế vẫn dùng remove → cleanup/delete → upload → attach và có display gap; atomic replacement cần contract Media mới nên không được tuyên bố hoàn thành trong task này.

### Company Prisma Backup/Restore & Restore-based Rollback — PR #55

- Bổ sung verifier fail-closed chỉ dùng Docker local Unix socket, PostgreSQL **16.15** theo image digest bất biến, internal network không publish port và database/container/network/image tạm gắn exact run sentinel. Cleanup chỉ xóa resource do chính run tạo khi exact ID, name và label cùng khớp; build context chỉ chứa Prisma input, không gửi `.env`, `node_modules`, `dist` hoặc artifact cục bộ vào Docker daemon.
- Tạo pre-media baseline bằng `prisma migrate deploy` từ migration tree chỉ chứa đúng hai migration đầu, nạp fixture legacy deterministic và kiểm migration ledger/checksum. Sau đó deploy migration Media hai lần, kiểm lần hai no-op, `migrate status`, drift bằng 0, catalog/ledger không đổi, dữ liệu cũ nguyên checksum, default/reference mới đúng và constraint unique/FK/enum hoạt động.
- Tạo custom-format backup chỉ cho schema `company`, mode `0600`, giới hạn kích thước, SHA-256 và `pg_restore --list` trước mọi restore. Pre-upgrade và upgraded archive được restore bằng single transaction vào hai database mới/rỗng tách biệt; ledger, dữ liệu, schema, constraint và drift đều được đối chiếu. Archive bị cắt cụt bị từ chối ở bước list trước khi target được tạo.
- Rollback hợp lệ là drain/freeze toàn bộ writer, chấp nhận RPO tại thời điểm pre-upgrade backup, restore sang database mới và chuyển đồng thời connection cùng old artifact đã pin. Old-schema SQL probe chỉ chứng minh database restore đọc/ghi được; không chứng minh binary cũ hoặc mixed old/new writer an toàn trên database đã upgrade, và không có in-place down migration.
- E2E verifier PASS trên PostgreSQL 16 sạch; full regression Company vẫn đạt **139/139 unit test** và build PASS.

### Company Domain Audit Ledger — PR #56

- Prisma bổ sung `CompanyAuditLog` và ba action allowlist: Admin approve, Admin reject và OWNER transfer. Actor luôn lấy từ JWT `sub`; approve/reject cập nhật status và audit trong cùng transaction Serializable, còn transfer đổi hai role, tăng `aggregateVersion` và ghi một audit atomically. Retry review giống hệt không tạo audit trùng; audit insert lỗi làm rollback domain mutation.
- Migration PostgreSQL thêm action-shape/positive-version CHECK, unique `(company_id, resulting_aggregate_version)`, FK `ON DELETE/UPDATE RESTRICT`, partial unique index bảo đảm tối đa một OWNER và trigger chặn `UPDATE`, `DELETE`, `TRUNCATE` audit. Không backfill actor giả; ledger bắt đầu từ rollout và không phải lịch sử đầy đủ của mọi profile/status mutation.
- Phạm vi giữ đúng Người 2: không thêm query API/UI/Kafka/retention, không sửa Admin Service và không thay thế global Admin AuditLog. Audit không lưu email, token/hash invitation, JWT/Authorization, tax code, Media ID/URL, IP/User-Agent hay request body. Production vẫn phải tách migrator/runtime DB role vì table owner/superuser có thể vô hiệu trigger.
- Company JWT consumer nay fail closed với issuer/audience bắt buộc, `alg=RS256`, `typ=JWT`, RFC 7638 thumbprint `kid`, UUID v4 `sub/jti`, integer `iat/exp` và exact uppercase role; controller truyền authenticated Admin ID thay vì nhận actor từ DTO/header.
- Full regression đạt **148/148 unit test** và build PASS. Disposable PostgreSQL **16** gate PASS cho upgrade legacy đủ bốn migration, valid/invalid audit shape, rollback coupling, one-OWNER/FK/append-only negative, deploy lần hai no-op, drift bằng 0, catalog gồm trigger/function, backup/restore tách database và corrupt-archive rejection; audit probe cũng PASS lại sau upgraded restore.

### Company Public Search & Load Verification — PR #57

- Bổ sung public `GET /companies/search?q=&cursor=&limit=` tách biệt hoàn toàn với review queue `GET /companies` của ADMIN. API hard-code chỉ đọc `VERIFIED`, trả card allowlist `id/name/slug/industry/size/address/logoUrl`, ẩn description/tax code/workflow/member/invitation/audit/File/Media ID và biến logo legacy chưa bind thành `null`.
- Phân trang dùng HMAC-SHA256 cursor canonical, versioned và bind exact query đã fold cùng limit; sort/keyset `(normalized_name ASC, id ASC)`, lấy `limit + 1`, không deep `OFFSET` hoặc `COUNT(*)`. Cursor sai chữ ký, sai query/limit, payload/version/UUID không canonical đều fail closed HTTP 400.
- Migration thứ năm dùng function immutable/parallel-safe nằm trong schema `company` để fold case/dấu tiếng Việt và `đ`, partial B-tree cho VERIFIED keyset cùng expression GIN `simple` FTS cho AND token-prefix. Không phụ thuộc extension ngoài schema nên backup chỉ schema Company vẫn restore được; migration deploy lặp, drift, exact function/index/opclass/predicate, audit, backup/restore/rollback và corrupt-archive gate đều PASS trên PostgreSQL 16.
- Full Company đạt **198/198 unit test** và build PASS. Dockerfile Company được bổ sung OpenSSL cho Prisma Alpine; service success/error log chỉ ghi path và search trả `no-store/no-cache` để không phục vụ stale Company vừa mất VERIFIED. Rollout bắt buộc provision `COMPANY_PUBLIC_CURSOR_HMAC_KEY` riêng tối thiểu 32 byte; thiếu hoặc để placeholder làm startup fail closed.
- Default isolated load gate PASS trên **100.000 Company** (80.000 VERIFIED, 10.000 PENDING, 10.000 REJECTED): duyệt đủ 80.000 row qua 1.600 cursor page không trùng/thiếu/sai thứ tự; ba dạng tiếng Việt có dấu/decomposed/không dấu cùng trả 8.000 row; status isolation, privacy, tamper/scope, response tối đa 12.327 byte và EXPLAIN không Seq Scan đều PASS. Benchmark HTTP thật 10.000 request, concurrency 32, **0 lỗi**, p95 **40,362 ms**, p99 **46,685 ms**, throughput **1.213,571 req/s** trên runner Docker cục bộ kiểm soát; đây không phải production SLO/CDN/multi-replica claim.
- Giữ đúng phạm vi Người 2: chưa sửa shared Nginx access-log của Người 3, hiện gateway Company vẫn có rủi ro ghi query/cursor; chưa làm Company frontend/P16 và chưa đánh dấu real Auth/Admin/File E2E hoặc P17.

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
- Rollout không tự backfill mặc định. Controlled one-shot baseline CLI đã được bổ sung ở task 2.24, nhưng vẫn phải dry-run, review và execute có xác nhận trên từng môi trường dữ liệu thật. Retention cleanup của outbox chưa tự động hóa và cần chốt chính sách lưu giữ.

### Durable Elasticsearch Index Sync — PR #27

- Mọi mutation ghi thêm desired index state trong cùng PostgreSQL transaction; dispatcher lease/`SKIP LOCKED` chuyển intent sang BullMQ nên Redis lỗi không làm mất cập nhật.
- Bản PR #27 ban đầu dùng `aggregate_version` với Elasticsearch `external_gte`; Job không còn searchable được giữ dưới dạng tombstone tối thiểu và bị loại bằng `searchable=true`.
- Reindex quét mọi trạng thái Job, tăng generation và hội tụ idempotent; monotonic UPSERT chặn snapshot reindex cũ hạ version mới và không phát Kafka event giả.
- BullMQ retry exponential; producer Redis fail-fast, tự tạo lại kết nối và giữ durable intent khi cold outage. Lỗi cuối được lưu bằng `failed_at`, attempt count và mã lỗi an toàn; Admin có endpoint xem/replay dead letter.
- PR #27 dùng index versioned `job_index_v2`, kiểm tra mapping version trước khi ghi và tái tạo strict mapping/analyzer tiếng Việt sau khi index bị xóa.
- Tại thời điểm merge PR #27, Docker suite đạt 39/39 unit test và 10/10 integration test (9 indexing/search/reindex/retry/outage + 1 Kafka outbox).
- Database đã có dữ liệu phải migrate khi dừng old writer, chạy `POST /jobs/reindex`, chờ hết pending/failed rồi mới mở traffic. Các regression và giới hạn của thiết kế ban đầu được sửa trong mốc hardening tiếp theo bên dưới.

### Job Availability — PR #9

- Endpoint nội bộ `GET /jobs/:id/exists` dùng shared API key.
- Trả trạng thái tồn tại, còn nhận hồ sơ, lý do, company/recruiter/job metadata và deadline.
- Application Service đã sử dụng hợp đồng này khi Candidate nộp đơn hoặc Bookmark.
- Số liệu suite Job/Search hiện tại được tổng hợp ở task bulk detail và hardening ngay bên dưới.

### Bulk Job Detail cho Bookmark và hardening durable indexing — mốc trước P05

- Bổ sung endpoint nội bộ `POST /jobs/details/bulk`, nhận tối đa 100 `jobIds` UUID duy nhất và trả projection chi tiết công khai an toàn trong một truy vấn PostgreSQL; `PUBLISHED`, `CLOSED`, `EXPIRED` vẫn có thể trả chi tiết, còn Job không tồn tại hoặc ở trạng thái nội bộ được gom vào `unavailableJobIds` mà không làm lộ dữ liệu duyệt tin.
- Application Bookmark lấy chi tiết theo lô, chia chunk tối đa 100 ID, giữ nguyên thứ tự bookmark từ database và loại bỏ N+1 call sang Job Service. Client kiểm tra nghiêm ngặt coverage, thứ tự, ID lạ/trùng/overlap và dữ liệu bắt buộc trong response.
- Danh sách Bookmark fail-soft ở cấp toàn bộ request: Job Service lỗi, timeout hoặc trả contract sai thì bookmark vẫn được trả theo đúng thứ tự nhưng `job=null`; luồng tạo Bookmark tiếp tục dùng endpoint availability đơn lẻ để chặn Job không còn nhận hồ sơ.
- Sửa regression của PR #27: Elasticsearch cập nhật nguyên tử theo cặp thứ tự từ điển (`aggregateVersion`, `indexGeneration`) bằng scripted update nên generation cũ không thể ghi đè generation mới khi cùng aggregate version; reindex dùng một set-based UPSERT cho mỗi page 200 Job thay vì transaction gồm nhiều câu lệnh tuần tự.
- Dispatcher chặn claim trước shutdown và release intent nếu shutdown xảy ra ngay sau claim; cold Redis integration khởi động worker thật để kiểm chứng fail-fast/recovery. Projection hiện tại `job_index_v4` có field `indexGeneration`, validator kiểm tra đầy đủ field/analyzer bắt buộc và từ chối alias trỏ nhiều concrete index.
- Baseline Elasticsearch hiện dùng cặp marker bền vững `mappings._meta.baselineVersion=4` và `baselineIndexUuid=<UUID>`, tự resume sau restart cho cả index tương thích đã tồn tại nhưng thiếu/sai marker. Trước khi hoàn tất, search bắt buộc fallback PostgreSQL và health ở `DEGRADED`; sau khi mọi intent hoàn tất, service refresh concrete index, ghi marker kèm UUID rồi revalidate tên index, UUID vật lý và marker. Chỉ khi lần kiểm tra sau ghi này khớp mới bật Elasticsearch search và trả `UP`; index thay thế mang UUID khác không thể dùng marker gắn với UUID cũ.
- Đã verify Job/Search **57/57 unit test + 13/13 integration test** với PostgreSQL 16, Kafka 3.8, Redis 7 có auth và Elasticsearch 8.14.3 thật; Application **173/173 unit test + 35/35 integration test** với PostgreSQL/Kafka/Testcontainers.

### Deep Cursor, Vietnamese Mapping v4 và Search Load Gate — PR #58

- Giữ `pagination=OFFSET` làm mặc định tương thích và thêm opt-in `pagination=CURSOR` dùng Elasticsearch PIT + `search_after`. Cursor HMAC-SHA256 bind toàn bộ filter/sort/limit, có hạn tuyệt đối năm phút, phân trang deterministic, fail closed khi tamper/stale/partial shard và không đổi nguồn giữa traversal; mỗi process giới hạn PIT bằng `JOB_SEARCH_MAX_OPEN_PITS`.
- CURSOR first page trả exact total/facets; continuation giữ total đã ký nhưng không tính lại total/aggregation và trả facet map rỗng. Search relevance yêu cầu mọi term, dùng bounded fuzzy `AUTO` với prefix 1/max expansion 25; OFFSET vượt cửa sổ 10.000 bị chặn và hướng client sang CURSOR.
- Rollout `job_index_v4`/projection-baseline 4 với combining-mark character filter trước tokenizer và strict fail-closed mapping validation. Elasticsearch 8.14.3 thật xác nhận NFC, NFD và accentless cùng token; fixture traversal phủ `title/description/skills/companyName`, và test chứng minh v4 không sửa index v3 tại chỗ.
- Controlled fixture có đúng **100.000 Job**, gồm 80.000 public và 20.000 hidden. Ba dạng tiếng Việt đều duyệt đủ 20.000 kết quả qua 400 page không thiếu/trùng; salary null ordering, short terminal page, cursor scope/tamper và source isolation đều PASS.
- Benchmark HTTP thật gồm 500 warm-up + **10.000 request**, concurrency 32: **0 lỗi**, 0 source mismatch, **164,632 req/s**, p95 **402,763 ms**, p99 **503,771 ms**; PIT context **0 → peak 32 → 0**. Đây là local controlled gate, không phải production SLO/multi-replica claim.
- Verify cuối: build PASS, **429/429 unit/non-integration test**, **20/20 PostgreSQL/Kafka/Redis/Elasticsearch integration test**, shell/Node static check và `git diff --check` PASS.

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
- Tại mốc bàn giao riêng Pipeline, suite khi đó đạt 40/40 unit test và 7/7 integration test với PostgreSQL/Kafka; kết quả Application Service mới nhất được cập nhật ở task 2.22.

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
- CV phân biệt `UPLOAD/ONLINE`, có `file_id/file_url`, builder JSON + schema version, aggregate version, default/deleted/first-used state và giới hạn JSON 1 MiB. Ở foundation task 2.14, partial unique index mới bảo đảm **tối đa một** CV mặc định đang hoạt động; quy tắc đúng một default khi còn CV active được bổ sung ở task 2.20 và cap năm active/50 retained snapshot được thực thi ở service sau đó.
- Ở foundation task 2.14, nội dung/file chỉ trở thành bất biến khi đặt `first_used_at`. Task 2.21 đã siết thành mọi published snapshot đều bất biến và mọi chỉnh sửa Online CV luôn tạo revision/`cv_id` mới. Application V6 ở task 2.19 đã bổ sung usage ledger/lookup authoritative; giới hạn soft-delete-only lịch sử do lookup có TOCTOU đã được permanent gate của task 2.22 supersede cho đúng unused leaf đã FENCED.
- Migration được bọc transaction, có CHECK/FK/index/trigger; Compose thêm one-shot `profile-migrate` trước runtime. Image Node 20/NestJS 11 dùng lockfile, `npm ci`, non-root user và audit production dependency đạt 0 vulnerability.
- Đã verify **7/7 integration test** trên PostgreSQL 16 sạch: đủ sáu block hồ sơ, JSONB round-trip, constraint ngày/URL/skill/completion, CV shape/default/delete/identity, cascade/restrict và revision immutability. `prisma migrate deploy` lần hai không có migration pending, migration diff không có drift; image runtime non-root trả `/health` UP.
- Ở thời điểm foundation PR #34, `CvEventOutbox` cố ý chưa được tạo vì contract `file_url` cũ chưa an toàn. Đây là trạng thái lịch sử; `file_id` + Media fetch, event intent và publisher versioned đã được task 2.23/PR #43 hoàn thành.

## 2.15 Candidate Profile CRUD & Completion — đã hoàn thành và verify

- Hoàn thiện `GET/PUT /profile/:userId` và CRUD độc lập cho Education, Experience, Skill, Certificate, Project. Route plural là canonical, route singular được giữ làm alias tương thích; `PUT` là merge-update và lần ghi đầu tự tạo Profile. Giới hạn transactionally theo Profile là 20 Education, 30 Experience, 100 Skill, 50 Certificate và 50 Project.
- Candidate chỉ được đọc/sửa hồ sơ của chính mình; child lookup luôn ghép child ID với Profile của JWT subject để chặn IDOR. Recruiter read cố ý fail-closed cho tới khi có contract chứng minh Candidate đã ứng tuyển vào đúng công ty.
- Completion rule v1 cố định: full name 10, headline 5, summary 5, phone 5, address 5, ít nhất một external link 5, Education 15, Experience 20, Skill 20, Certificate 5 và Project 5. Mỗi tiêu chí chỉ cộng một lần, tổng tối đa 100; warning chỉ bật khi dưới 50%.
- Response trả `completionPercent`, `completionRuleVersion=1`, `missingSections` và `aggregateVersion`. Avatar vẫn không tính điểm vì completion rule v1 được giữ bất biến để tương thích, dù Media verification đã được triển khai ở task sau; chỉ rule v2 có migration rõ ràng mới được đổi trọng số.
- Mọi mutation chạy Serializable, khóa row Profile, ghi block + completion + version trong một transaction và retry tối đa tám lần với exponential jitter cho Prisma `P2034`, race unique lần tạo đầu lẫn raw-query SQLSTATE `40001`. GET aggregate dùng snapshot Repeatable Read.
- JWT consumer enforce RS256, `typ=JWT`, RFC 7638 `kid`, issuer/audience, UUID v4 `sub/jti`, role hợp lệ, `iat/exp` nguyên, `exp > iat`, expiry và `iat` không vượt quá 60 giây trong tương lai; global guard deny-by-default, exact-origin CORS, response `no-store`, DTO whitelist/forbid unknown field và HTTPS URL canonicalization. JWKS mặc định bắt buộc HTTPS và cấm redirect; HTTP chỉ được bật rõ ràng cho development network.
- Root Compose local trỏ tới Auth JWKS và tiêu thụ active/previous keys khi Auth được cấu hình rotation; verifier có cache + refresh cooldown chống unknown-`kid` amplification. Static public PEM là nguồn cấu hình thay thế khi không dùng JWKS, không phải failover khi JWKS lỗi. `/health` kiểm PostgreSQL + JWT source; Swagger mô tả success/error contract và tự tắt ở production trừ khi opt-in.
- Swagger có ở `/profile/docs` qua gateway (`/docs` trực tiếp) trong môi trường được bật. Docker PostgreSQL 16.15 sạch đạt **1/1 migration-upgrade check + 8/8 unit test + 23/23 integration test**, gồm safety guard chống test nhầm database, backfill whitespace legacy, migration lặp, completion/rollback, route alias, JWT/JWKS negative kể cả future-`iat`, validation, OpenAPI, IDOR đủ năm collection, Unicode skill, collection cap, 12 vòng race lần ghi đầu, burst sáu writer trên Profile đã tồn tại và duplicate skill concurrent.
- Task 2.20 đã merge rename/default/soft delete, deterministic default reassignment và local `firstUsedAt` mirror qua PR #40. Task 2.21 đã hoàn thiện backend CV Builder/revision, task 2.22 hoàn thành deletion fence/hard-delete và task 2.23 hoàn thành transactional `cv-events` cùng AI CV worker. Frontend Builder/PDF renderer và deployed cross-service REST/E2E vẫn pending.

## 2.16 File/Media Service Core — đã hoàn thành và verify qua PR #36

- Hoàn thiện signed upload intent 10 phút và confirm chỉ bằng `fileId`; service tự đọc metadata canonical từ Cloudinary, không tin MIME, size, URL hoặc metadata do client gửi. Policy v1 fail-closed có đúng sáu type `CV`, `AVATAR`, `COMPANY_LOGO`, `COMPANY_IMAGE`, `COMPANY_VIDEO`, `CHAT_ATTACHMENT`; `OFFER_LETTER` chưa được đưa vào để tránh dùng sai policy.
- Public API dùng strict JWT RS256/role/owner; internal API dùng sáu key riêng, ràng buộc đúng danh tính Profile/Company/Application/Chat/Interview/AI và so sánh constant-time. Gateway công khai route `/files`, xóa internal headers và trả `404` cho mọi biến thể `/files/internal`.
- Prisma/PostgreSQL quản lý intent, canonical metadata, trạng thái, audit và immutable reference. Idempotency, tối đa 20 intent còn hạn/requester/type, atomic 60 intent/requester/giờ, quota công ty, advisory/row lock, lease 5 phút và `aggregateVersion` fencing bảo vệ confirm/delete đồng thời; quota được kiểm tra lại khi finalize để chặn race vượt TTL.
- Confirm kiểm tra exact public ID/folder/context, resource/delivery type, format, timestamp, byte size, kích thước ảnh, thời lượng video và tối đa 8 KiB magic bytes cho RAW. CV/attachment dùng private authenticated delivery; file đang được tham chiếu không thể xóa; provider outage có cooldown tăng dần và delete failure có trạng thái retry rõ ràng.
- Docker Node 24 chạy non-root, fail-fast trước khi listen; root Compose có one-shot `media-migrate`, dependency và biến bắt buộc. Đã verify **12/12 unit + 18/18 TAP integration test** trên PostgreSQL 16.15, migration deploy lần hai không còn pending, schema diff không drift, runtime image/fail-fast và Nginx 1.30.4 `nginx -t` đều đạt; production dependency audit báo 0 vulnerability.
- Scheduled cleanup/reconciliation được hoàn thành ở mục 2.17. Phần còn lại của P09 là live smoke với sáu Cloudinary preset thật, malware/deep PDF/DOC/DOCX parser, staging/promote public asset, distributed provider limiter/active-byte quota, archive/retention, Offer letter, wiring Company/Application/Chat/Interview và tách migrator/runtime credential cùng secret rotation/mTLS; Profile và AI đã có contract service-level.

## 2.17 File/Media Scheduled Cleanup & Reconciliation — đã merge vào `develop` qua PR #37

- Bổ sung migration `MediaCleanupJob`, append-only `MediaCleanupEvent` và `MediaMaintenanceControl`; job, event và metadata không hard-delete, terminal job bất biến, state/lease shape được bảo vệ bằng CHECK/trigger và scan lifecycle có index `status + updated_at + id`.
- Scheduler dùng `clock_timestamp()` của PostgreSQL, cycle leader lease có heartbeat/fencing, watchdog và startup jitter. Heartbeat treo/lỗi hoặc mất lease sẽ abort cycle, hủy Admin request đang chạy và dừng discovery/claim mới; shutdown và error path cũng abort cycle đang hoạt động.
- Job được claim bằng `FOR UPDATE SKIP LOCKED`, có lease/fence riêng và ưu tiên `FILE_DELETE → ORPHAN_PURGE → SIBLING_SWEEP` để backlog lịch sử không chặn xóa khẩn cấp. Cycle complete và job finalize đều CAS lease còn hạn theo DB clock; lease tối thiểu phải bao phủ chuỗi xấu nhất `7 × provider timeout + 10 giây`.
- `PENDING` hết hạn chuyển `EXPIRED`; `VERIFYING`/`DELETE_PENDING` stale được phục hồi; delete failure được retry. Orphan purge xóa idempotent exact locator trước khi sweep context; active reconciliation giữ canonical chỉ khi immutable `assetId` khớp và xóa sibling/replacement bất thường.
- Cloudinary context lookup dùng REST `fetch` với Basic Auth, `AbortSignal` timeout/cycle cancellation, tối đa 5 trang × 100 object cho từng `image`/`video`/`raw`. Reconciliation cần hai clean pass kể từ lần xóa cuối; provider outage retry vô hạn với exponential backoff có trần để không để object rác vĩnh viễn.
- Mỗi cycle log `dueJobsRemaining`, `nonTerminalJobs`, `oldestDueAt`. Mặc định 5 claim/5 phút cố ý bảo thủ theo ngân sách Cloudinary Admin API; production còn phải chốt alert/backlog threshold và distributed provider-rate budget trước khi tăng throughput.
- Đã verify **17/17 unit + 26/26 TAP integration test** bằng image Node 24 và PostgreSQL 16 thật: cycle election/lease loss/watchdog/error path, cycle/job lease-expiry CAS, queue priority, lifecycle expire/recover, exact orphan ẩn khỏi context, canonical/sibling reconciliation, clean-pass reset, delete retry, outage recovery, lease reclaim/fencing, trigger audit, timeout cancellation và pagination. Migration deploy lần hai không pending; Prisma schema diff không drift.
- Metadata `EXPIRED/REJECTED/DELETED`, cleanup job và audit event hiện được giữ để truy vết. Chính sách archive/retention, live Cloudinary smoke, alert vận hành và tải thật vẫn là hardening pending; task này không tuyên bố Media production-ready.

## 2.18 Profile–Media Avatar & Uploaded CV Integration — đã merge vào `develop` qua PR #38

- Bổ sung `avatar_media_reference_id` cho Profile và `media_reference_id` nullable unique cho CV. Migration giữ nguyên avatar/CV URL legacy, còn CV upload mới bắt buộc `file_url=NULL` và có immutable Media reference; trigger CV đã dùng khóa thêm reference này. Upgrade test chứng minh dữ liệu cũ không bị viết lại hoặc mất.
- Profile dùng internal Media client có service-specific key, timeout, redirect deny, giới hạn response 64 KiB và validation exact envelope/echoed ID. Chỉ file `ACTIVE`, owner `USER` đúng JWT subject và đúng type mới được chấp nhận; avatar phải public HTTPS, CV phải private và không có stable URL. Các status có thể làm lộ sự tồn tại file được gom thành `422 MEDIA_FILE_INVALID`.
- Hoàn thiện `PUT/DELETE /:userId/avatar`: attach/replace/remove owner-only, retry cùng file và remove lặp là no-op không tăng version. Mỗi thao tác dùng logical reference duy nhất nên race delete/reattach không thể phục hồi một reference đã release.
- Hoàn thiện `POST/GET /cvs`, `GET /cvs/:id` và `POST /cvs/:id/download-url`, kèm alias singular `/cv`. Candidate chỉ gửi `title/fileId`; CV upload luôn private, tối đa năm active CV dưới Profile lock, CV đầu tiên mặc định, duplicate concurrent hội tụ về một row/reference và signed download chỉ được cấp theo yêu cầu.
- Không giữ transaction database khi gọi HTTP. Binding thua race hoặc mutation thất bại được compensation; reference avatar cũ được release sau commit với ba lần retry. Process crash hoặc Media outage kéo dài vẫn có thể tạo safe leak, nên durable release outbox/reconciler còn pending.
- Root Compose nối Profile tới Media và dùng key riêng; README/`.env.example` mô tả timeout/cấu hình. Docker PostgreSQL 16 đạt migration-upgrade, **17/17 unit + 35/35 integration test**, deploy migration lần hai không còn pending và `git diff --check` sạch. Live Cloudinary không được tuyên bố vì repository chưa có credential/preset thật.

## 2.19 Canonical Profile–Application CV Contract — đã merge vào `develop` qua PR #39

> Implementation và tài liệu được bàn giao từ `feature/profile-service/application-cv-contract` vào `develop` qua PR #39.

- Profile bổ sung versioned internal API `POST /internal/v1/cvs/verify`, `GET /internal/v1/candidates/:candidateId/cvs`, `GET /internal/v1/candidates/:candidateId/cvs/:cvId` và `POST /internal/v1/candidates/:candidateId/cvs/:cvId/download-url`. Cả bốn endpoint yêu cầu exact `X-Internal-Service: application-service` cùng key riêng; riêng verify dùng dual auth, bắt buộc thêm Candidate JWT strict, role `CANDIDATE` và JWT subject trùng `candidateId`.
- Verify chỉ trả available cho CV active, đúng owner và Media-backed; missing/wrong-owner/deleted/legacy URL-only cùng hội tụ thành `available=false`. List chỉ trả active Media-backed `UPLOAD/ONLINE`; detail/download cho phép đúng soft-deleted revision để giữ lịch sử Application. Internal controller bị ẩn khỏi Swagger.
- Projection nội bộ chỉ có `cvId`, `candidateId`, `title`, `type`, `fileId`, `isDefault`, `isDeleted`, `firstUsedAt`, `aggregateVersion`, `createdAt`, `updatedAt`; không trả `fileUrl`, `mediaReferenceId`, builder content, contact details hoặc profile biography fields. Download URL là HTTPS ngắn hạn cấp theo yêu cầu và response đặt `no-store`, không có stable private URL.
- Application Submission thay việc gọi `GET /profile/cv?user_id=` rồi scan list bằng `POST /internal/v1/cvs/verify`. Application chuyển tiếp Candidate bearer token cùng service key, kiểm tra exact envelope/echoed IDs/type/file/deleted/version/timestamps và vẫn trả public `CV_NOT_AVAILABLE` cho CV không đủ điều kiện.
- Recruiter dùng `GET /applications/{applicationId}/cv` và `POST /applications/{applicationId}/cv/download-url`. Application xác minh Company membership trước khi đọc DB/Profile, scope theo `applicationId + companyId`, lấy `candidateId/cvId` từ Application và không chuyển Recruiter JWT sang Profile. Public metadata tối thiểu chỉ gồm `cvId/title/type/isDeleted/createdAt`; download chỉ gồm `cvId/url/expiresAt`; cả hai response `no-store`.
- Flyway V6 tạo durable `application_cv_usage`, khóa/backfill Application cũ và dùng `AFTER INSERT` trigger để upsert `first_used_at/application_count` trong cùng transaction. Ledger không phụ thuộc trạng thái, rollback không để usage giả, từ chối một `cvId` thuộc hai Candidate, bảo vệ identity/CV reference bất biến và giữ bằng chứng ngay cả khi Application row bị xóa.
- Application cung cấp Swagger-hidden `POST /internal/v1/cv-usages/lookup` chỉ cho `profile-service`, trả `{candidateId,cvId,used,firstUsedAt,applicationCount}`. Key hai chiều tách biệt: root `PROFILE_INTERNAL_API_KEY_APPLICATION` nối Application → Profile, còn `APPLICATION_INTERNAL_API_KEY_PROFILE` nối Profile → Application. Nginx chặn public access tới internal Profile/Application paths, gồm biến thể case/repeated slash/semicolon, đồng thời xóa internal identity headers trên public routes.
- Kết quả verify tại thời điểm PR #40 là Profile **29/29 unit + 53/53 integration test** với PostgreSQL 16/migration upgrade và Application **212/212 unit + 43/43 integration test** với PostgreSQL/Kafka/Testcontainers. Đây là mốc lịch sử; số liệu mới nhất sau PR #43 được ghi tại mục 2.23. Các suite service-level không đánh dấu P17 REST contract/E2E toàn hệ thống là hoàn tất.
- `application_cv_usage` là nguồn usage authoritative. Task 2.20 đã nối Profile tới lookup này để mirror local `firstUsedAt`. Tại PR #39/#40, hard delete còn bị vô hiệu vì lookup `used=false` rồi delete có TOCTOU với submit đồng thời; backlog này đã được permanent deletion gate và serialization của PR #42 supersede, như mô tả tại mục 2.22.

## 2.20 Profile CV Lifecycle — đã merge vào `develop` qua PR #40

> Implementation và tài liệu được bàn giao từ `feature/profile-service/cv-lifecycle` vào `develop` qua PR #40.

- Bổ sung Candidate API `PATCH /cvs/:id` để rename bằng `{title, expectedAggregateVersion}`, `PATCH /cvs/:id/default` để chuyển default bằng `{expectedAggregateVersion}` và `DELETE /cvs/:id` để soft-delete bằng `{expectedAggregateVersion}`; alias singular `/cv/:id` được giữ tương thích. Rename/default lặp đúng trạng thái là no-op, còn mutation thực dùng CV compare-and-set dưới Profile lock/Serializable retry và tăng Profile aggregate version đúng một lần.
- Default handover cập nhật default cũ và CV đích trong cùng transaction. Khi xóa default, Profile chọn CV active còn lại mới nhất theo `createdAt DESC, id ASC`; xóa CV cuối cùng để lại tập active rỗng. Response delete cố định `deletionMode=SOFT`, trả `deletedAt`, `replacementDefaultCvId` và version mới.
- Tại PR #40, xóa luôn là soft-delete cho cả CV đã dùng lẫn chưa dùng; row, `fileId` và immutable Media reference được giữ nguyên để Application lịch sử vẫn phân giải đúng revision. Chính sách soft-delete-only do chưa có serialization là trạng thái lịch sử và đã được PR #42 supersede: CV USED vẫn được giữ mềm, còn CV leaf chưa dùng chỉ được hard-delete sau khi Application trả FENCED.
- Trong implementation lịch sử PR #40, trước mutation delete đầu tiên Profile gọi `POST /internal/v1/cv-usages/lookup`; lỗi upstream fail closed và chưa thay đổi database. Task 2.22 thay trình tự này bằng durable local premark trước remote acquire, vì vậy lỗi Application hiện trả 202 PENDING và được worker retry thay vì trả lỗi sau một mutation đã commit.
- Hai chiều nội bộ dùng key riêng: `INTERNAL_API_KEY_APPLICATION` bảo vệ Application → Profile, còn `APPLICATION_INTERNAL_API_KEY` tại Profile nhận root secret `APPLICATION_INTERNAL_API_KEY_PROFILE` cho Profile → Application. Root Compose nối `APPLICATION_SERVICE_URL`, timeout `PROFILE_APPLICATION_REQUEST_TIMEOUT_MS`, không thêm dependency vòng; startup/readiness từ chối key thiếu, placeholder, ngắn, malformed hoặc hai key bằng nhau.
- Migration `20260827140000_cv_default_invariant` khóa writer theo thứ tự Profile rồi CV, backfill deterministic Candidate có active CV nhưng thiếu default, tăng version CV được chọn và Profile tương ứng, sau đó cài deferred constraint trigger bắt buộc **đúng một** default khi còn active CV. Partial unique index cũ tiếp tục chặn nhiều hơn một default; transaction lifecycle có thể handover hợp lệ trước khi constraint được kiểm tra.
- Docker PostgreSQL 16 sạch tại PR #40 đạt **29/29 unit + 53/53 integration test**. Coverage lịch sử gồm validation/CAS/no-op, rename/default/delete concurrency, deterministic reassignment, last-CV/repeated delete, used/unused đều soft-delete, `firstUsedAt` mirror, usage failure không mutation, historical detail/download sau delete, direct-SQL exact-one-default/hard-delete guards và migration race với legacy writer đang in-flight. `prisma migrate deploy` lần hai không còn migration pending.
- Đây là service-level implementation/test đã merge qua PR #40; P17 deployed cross-service REST/E2E chưa được đánh dấu hoàn tất. Backend CV Builder/revision được tiếp tục ở task 2.21, hard-delete fence ở task 2.22 và transactional `cv-events` ở task 2.23.

## 2.21 Profile Online CV Builder & Immutable Revisions — đã merge vào `develop` qua PR #41

- Bổ sung Candidate API `POST /cvs/online`, `GET /cvs/:id/builder` và `POST /cvs/:id/revisions`, kèm alias singular `/cv`. Create nhận `title`, `templateId`, `contentSchemaVersion=1`, object `contentJson` và confirmed private PDF `fileId`; revision nhận full snapshot mới, `expectedAggregateVersion` và optional `makeDefault`.
- Luồng có thật là frontend render PDF rồi upload/confirm trực tiếp qua Media trước khi gọi Profile. Profile verify exact owner/type/ACTIVE/private delivery và bind `PROFILE_CV`; không nhận URL/reference/default do client tự khai. Media hiện không có renderer và không chứng minh PDF khớp ngữ nghĩa với JSON, nên task backend này không tuyên bố UI/template/browser renderer hoặc live Cloudinary preset đã hoàn tất.
- Migration `20260827150000_cv_builder_revisions` backfill mọi CV cũ thành root của series riêng mà không tăng aggregate version, thêm `revisionSeriesId/revisionNumber/previousRevisionId`, self-FK, unique predecessor/series-number và partial unique chỉ cho phép một revision active mỗi series. Trigger successor yêu cầu chuỗi tuyến tính cùng owner/type/series và predecessor đã soft-delete; hard delete còn bị chặn tại PR #41, trước khi cơ chế PR #42 supersede giới hạn này cho đúng unused leaf đã FENCED.
- Mỗi CV row là published snapshot bất biến: `type/fileId/fileUrl/mediaReferenceId/templateId/contentJson/contentSchemaVersion` không được sửa tại chỗ, kể cả `firstUsedAt` còn null. Quy tắc này cố ý mạnh hơn usage lookup vì `used=false` rồi update vẫn có TOCTOU với Application submit ở database khác. Mọi thay đổi nội dung/file tạo `cvId`, `fileId` và Media reference mới; row/reference cũ được giữ nguyên cho Application lịch sử.
- Revision handover chạy Serializable dưới Profile lock và CV CAS: soft-delete predecessor, tạo successor, tăng Profile version đúng một lần, kế thừa default hoặc chuyển bằng `makeDefault=true`, rồi ép deferred exact-one-default constraint trước khi trả response. Revision không tăng số active CV nên vẫn chạy khi Candidate đang đủ năm CV. Create/revision retry exact không gọi Media lại; race hai successor chỉ một thắng, binding thua được compensation.
- Tại PR #41, do chưa có deletion fence/retention worker, toàn bộ Upload root, Online root và revision history được giới hạn **50 retained snapshot/Candidate** dưới cùng Profile lock; vượt quota trả `409 CV_SNAPSHOT_LIMIT_REACHED` và compensation Media binding. PR #42 đã supersede phần thiếu deletion fence cho thao tác xóa Candidate, nhưng không phải retention worker tổng quát; quota 50 snapshot và cap năm CV active vẫn áp dụng độc lập.
- JSON Builder v1 phải là plain object an toàn, cấm prototype keys/non-JSON value/Unicode PostgreSQL không hợp lệ, giới hạn depth/node/key và tối đa 1 MiB theo normalized JSONB text; validator tính cả separator spacing và exponent-number expansion để khớp constraint database. HTTP parser có bounded envelope headroom. List/detail/lifecycle/download Candidate đã tổng quát cho Media-backed `UPLOAD/ONLINE`, nhưng summary và internal Application projection không trả `contentJson`; response nhạy cảm tiếp tục `private, no-store`.
- Docker PostgreSQL 16 sạch đạt migration-upgrade/backfill, **33/33 unit + 62/62 integration test** và lần `prisma migrate deploy` thứ hai báo không còn migration pending. Coverage mới gồm exact JSONB byte boundary, body lớn hơn default parser 100 KiB, owner/IDOR, Swagger aliases/schemas, exact retry/default intent, quota + compensation, root/revision lineage, immutable/direct-SQL guards, lifecycle Online, default transfer, revision ở cap năm CV, barrier-synchronized fork/idempotent race + loser cleanup, historical internal resolution đúng `cvId/fileId` cũ và legacy writer đang mở khi revision migration chạy.

## 2.22 Profile–Application Atomic CV Deletion Fence — đã merge vào `develop` qua PR #42

> Implementation và tài liệu được bàn giao từ `feature/application-profile/cv-deletion-fence` vào `develop` qua PR #42 ngày 28/08/2026.

- Application Flyway V7 tạo permanent gate cho từng cặp `candidateId/cvId`, backfill từ durable V6 usage ledger và cài `BEFORE INSERT` trigger làm safety net tại database. Submission và acquire fence cùng khóa một gate row trong transaction: submit chỉ tiếp tục khi gate còn mở, còn gate đã fence trả public `CV_NOT_AVAILABLE`; fence đã cấp không được mở lại hoặc xóa nên không có cửa sổ lookup-then-delete.
- Swagger-hidden `POST /internal/v1/cv-deletion-fences/acquire` chỉ nhận exact Profile service identity/key và `{candidateId,cvId,deletionRequestId}`. Request ID làm acquire idempotent; kết quả `USED` trả authoritative `firstUsedAt/applicationCount`, còn `FENCED` xác nhận không có usage và giữ reservation vĩnh viễn. Lookup V6 vẫn được giữ để backward compatibility, nhưng không còn được dùng làm quyền hard-delete.
- Profile chuyển delete thành durable saga: transaction đầu premark CV `PENDING_FENCE`, lưu stable deletion request ID và bàn giao default; nếu Application chưa quyết định thì API trả **202 PENDING**. Worker claim bằng lease, retry exponential backoff có trần và tiếp tục xử lý idempotent sau restart/process crash thay vì giữ transaction database qua HTTP.
- Quyết định `USED` hoàn tất bằng soft retention, mirror usage authoritative và giữ row/Media reference cho Application lịch sử. Quyết định `FENCED` chỉ hard-delete CV **unused leaf** hợp lệ; predecessor có successor hoặc CV không còn khớp workflow/version sẽ fail closed. Trigger Profile chỉ cho phép hard delete trong transaction có đúng request ID qua transaction-local GUC `profile.cv_deletion_request_id`.
- Release Media sau hard delete dùng durable cleanup job với lease/backoff thay cho best-effort callback. Workflow giữ tombstone `fileId` bền vững trước khi gọi Media, nên file không thể được bind/reuse lại trong khi cleanup pending; lỗi Media được retry và trạng thái cleanup có thể theo dõi mà không phục hồi CV đã xóa.
- Rollout bắt buộc **Application-first**: migrate V7 và đưa toàn bộ Application replica mới vào phục vụ trước, sau đó mới deploy Profile. Khi rollback/dừng worker Profile phải drain hoặc tiếp tục xử lý `PENDING_FENCE` và Media cleanup; permanent gate không được rollback theo cách mở lại CV đã FENCED.
- Phạm vi legacy được giữ rõ: các CV đã soft-delete trước PR #42 không được tự động backfill thành deletion workflow hoặc hard-delete; chúng tiếp tục được giữ trừ khi có migration/retention riêng được review. PR #42 không hoàn tất frontend Builder/PDF renderer, `cv-events` hay P17 deployed end-to-end.
- Verify sau PR #42 đạt Application **219/219 unit + 50/50 PostgreSQL/Kafka integration test**, gồm V7 replay/dynamic-schema/direct INSERT và barrier concurrency giữa acquire fence với submission. Profile đạt **39/39 unit + 65/65 integration test** cùng migration-upgrade/replay PASS trên PostgreSQL 16, gồm 202 premark, lease/retry/idempotency, USED/FENCED paths, default handover, direct-SQL GUC guard, crash recovery, retired file và durable Media cleanup. Đây vẫn là service-level evidence; P17 cross-service deployed E2E còn pending.

## 2.23 Transactional CV Events & AI CV Embedding — hoàn thành qua PR #43

> Implementation được bàn giao từ `feature/profile-ai/cv-events-integration` vào `develop` qua PR #43 ngày 28/08/2026.

- Profile migration tạo independent `cv_event_outbox` không FK tới CV/Profile để `DELETED` tombstone vẫn tồn tại sau hard delete. Mọi intent được ghi cùng Serializable transaction với mutation CV; trigger khóa identity/payload, còn publisher dùng `FOR UPDATE SKIP LOCKED`, per-CV version barrier, lease fencing/heartbeat, bounded Kafka retry và stable `event_id` cho at-least-once delivery.
- Contract `cv-events` v1 dùng Kafka key `cv_id` và đúng chín trường flat snake_case: `event_id`, `action`, `cv_id`, `candidate_id`, `file_id`, `cv_type`, `occurred_at`, `schema_version`, `aggregate_version`. Payload không chứa title/contact/profile biography fields, `file_url`, signed URL, `media_reference_id` nội bộ của Profile, Builder JSON, PDF bytes hoặc text CV.
- Uploaded/Online create phát `UPSERTED`; revision atomically phát predecessor `DEACTIVATED` rồi successor `UPSERTED`; rename/default không phát vì PDF không đổi. Delete chưa có quyết định Application giữ nguyên không event; terminal `USED` phát `DEACTIVATED`, còn unused `FENCED` hard delete phát `DELETED`. Retry/reconcile terminal không nhân bản intent.
- Dedicated non-root `ai-cv-embedding-worker` kiểm tra exact key/schema/version và ledger trước Media/parse/inference. `UPSERTED` gọi Media bằng distinct AI key cùng exact `file_id`/owner/type expectation, chỉ chấp nhận signed HTTPS exact-host ngắn hạn, redirect-off, byte/MIME/PDF-magic hard cap; parser PDF chạy child process với bounded byte-JSON IPC không pickle, timeout/page/text/CPU/memory/file-descriptor limits.
- AI lưu vector 384 chiều, hash/provenance, `is_active`, aggregate cursor/ledger và durable immutable `cv_id → candidate_id`; không lưu/log raw Kafka payload, signed URL, PDF hoặc text. `DEACTIVATED` giữ vector inactive cho Application `/match` lịch sử nhưng không dành cho recommendation; `DELETED` xoá vector và giữ tombstone vĩnh viễn. Event cũ, owner khác hoặc UPSERT sau terminal không thể phục hồi CV.
- Poison JSON/PDF, source đã mất và integrity failure vào terminal redacted-metadata DLQ để partition tiếp tục; raw content được thay bằng hash, còn Kafka position, aggregate identity, action và error code an toàn vẫn được giữ. Media/model/database lỗi tạm thời không commit offset. Payload bị giới hạn 64 KiB, duplicate key, nesting sâu, giant integer và parser resource kill đều có regression test.
- Verify clean Compose: Profile **46/46 unit + 66/66 integration**, bảy migration PostgreSQL 16, deploy lần hai không pending và Kafka 3.8 publisher thật; AI Ruff check/format PASS, **238 unit/non-integration + 38 PostgreSQL/Kafka integration (276 tổng)**. Root Compose config PASS và wiring cả producer, topic-init, distinct Media key và CV worker.
- Phạm vi chưa tuyên bố: không tự backfill active CV lịch sử; chưa có published-outbox retention/alert, Kafka TLS/SASL, live Cloudinary smoke hoặc deployed Profile–Media–AI E2E. Recommendation, chatbot và frontend Builder/PDF renderer tiếp tục ở các task sau.

---

## 2.24 Controlled Historical Event Baseline & Cloudinary Staging Smoke Tooling — hoàn thành qua PR #44

> Implementation được bàn giao từ `feature/ai/historical-embedding-baseline` vào `develop` qua PR #44 ngày 28/08/2026; chưa tuyên bố đã chạy trên database production/staging có dữ liệu thật hoặc tài khoản Cloudinary thật.

- Job Service có one-shot CLI mặc định dry-run, execute chỉ khi khớp exact confirmation `JOB_EVENTS_BASELINE_V1`, giới hạn batch/max-batches và dùng `FOR UPDATE SKIP LOCKED`. CLI chỉ tạo event cho đúng `aggregate_version` chưa có trong outbox, không tăng version/`updated_at`; `DRAFT`, `PENDING_APPROVAL`, `PUBLISHED` map sang `UPDATED`, còn `CLOSED`/`EXPIRED` giữ action terminal. Execute preflight chặn published job đã quá deadline UTC. `JOB_EVENT_PUBLISHER_ENABLED=false` chỉ tắt publisher background, không làm mất khả năng append transactional outbox.
- Profile Service có one-shot CLI mặc định dry-run, execute chỉ khi khớp exact confirmation `CV_EVENTS_BASELINE_V1`, bounded batch và hai pha để gọi Media ngoài transaction. Pha ghi khóa Profile rồi CV bằng Serializable transaction, recheck active/private/Media-backed/current leaf và bỏ qua CV đã có bất kỳ historical outbox event nào; event `UPSERTED` dùng đúng current version, không bump aggregate/version. Legacy URL-only CV chỉ được đếm và bỏ qua, không được đưa URL vào event/log.
- Media Service có guarded Cloudinary live-smoke runner cho đúng sáu policy hiện hành. Runner chỉ chạy khi `CLOUDINARY_LIVE_SMOKE=1`, confirmation cloud name khớp, đủ credentials/internal keys/fixture; audit exact preset trước khi upload, chạy tuần tự signed upload → Media confirm/verify → public/private access → exact delete, và finally cleanup đúng asset/file/context đã tạo. Runner không log secret, signature, private URL hay raw provider response và không có broad folder/prefix deletion.
- Verify: Profile **51/51 unit + 70/70 integration** với PostgreSQL 16/Kafka 3.8; Job **89/89 unit + 3/3 targeted PostgreSQL baseline integration**; Media **26/26 unit + 26/26 PostgreSQL integration**, clean migration/deploy lặp và runtime image fail-closed đúng khi chưa bật live smoke. Full Job Compose chưa được tính PASS vì Docker bridge mất kết nối giữa suite dù các suite indexing/outbox/baseline đã qua.
- Phạm vi vận hành còn lại: chưa execute hai baseline CLI trên môi trường có dữ liệu thật; chưa chạy six-policy smoke trên Cloudinary staging vì repository không có credential/preset/fixture thật. Tại mốc PR #44, deployed E2E, outbox retention/alert, Kafka TLS/SASL và recommendation còn pending; Candidate job recommendation được hoàn thành tiếp ở mục 2.25.

---

## 2.25 Candidate Job Recommendations v1 — hoàn thành qua PR #45

> Implementation được bàn giao từ `feature/ai/job-recommendations-v1` vào `develop` qua PR #45 ngày 28/08/2026. Phạm vi này hoàn thành gợi ý việc làm cho Candidate; không mở API gợi ý Candidate cho Recruiter khi chưa có consent/capability contract.

- AI Service cung cấp internal `POST /recommend/jobs` chỉ cho exact caller `job-search-service` bằng direction-scoped key riêng 32–512 printable ASCII bytes. Request chỉ nhận `cv_id`, limit/cursor và ba filter bounded `location/salary_min/job_type`; response chỉ có Job ID, score, cursor hoặc stable empty reason, không trả vector, CV metadata hay nội dung nguồn.
- Alembic `20260828_05` tạo hai transactional generation `JOBS/CVS` và bốn trigger row/TRUNCATE. Readiness fail-closed nếu table/row/function/event shape hoặc trigger origin/always bị thiếu/sai. Recommendation đọc bằng repeatable-read snapshot, hash cả vector nguồn vào source fingerprint và dùng exact target scan; cursor HMAC-SHA256 canonical gắn endpoint/filter/source/target generation, keyset `(distance, UUID)` và giới hạn mười trang. Target/source mutation, cursor giả hoặc filter đổi trả `409 RECOMMENDATION_CURSOR_STALE`.
- Job Service cung cấp Candidate-only `GET /jobs/recommended`, lấy identity từ JWT và không nhận `userId/cvId`. Service forward nguyên Candidate bearer token chỉ tới allowlisted Profile `GET /cvs`, chọn CV mặc định active Media-backed hoặc CV mới nhất deterministic, sau đó gọi AI qua scoped key; hai client đều timeout bounded, body bounded, redirect-off và không retry.
- PostgreSQL Job vẫn là nguồn sự thật: một query chỉ chọn public job-card fields, revalidate `PUBLISHED`, deadline UTC, location literal không wildcard, salary và job type, rồi khôi phục đúng AI order. Trang đầu fail-soft sang danh sách `LATEST` deterministic khi chưa có CV hoặc Profile/AI lỗi/not-ready/response stale; continuation không trộn nguồn và trả đúng `409/503`. Response có `source/fallbackReason/nextCursor`, `private, no-store` và `Vary: Authorization`.
- Nginx chặn public `/ai/match` và `/ai/recommend/*` kể cả case/repeated slash/path parameter/residual encoding, đồng thời xóa internal headers ở generic AI proxy. Root Compose wiring distinct Job→AI key, timeout và exact outbound allowlist cho Profile/AI; `nginx -t`, route-bypass smoke và Compose config đều PASS.
- Verify: Job build PASS, **189/189 unit test**; riêng task mới có **100/100 targeted unit/contract + 2/2 PostgreSQL recommendation integration** trên database sạch. AI Ruff check/format PASS, **297/297 unit/non-integration + 50/50 PostgreSQL/Kafka integration test (347 tổng)**, gồm migration head/deploy lặp, hơn 50 target rows, filter, hai trang không skip/duplicate, source/target mutation, rollback/zero-row/TRUNCATE generation và trigger readiness.
- Tại mốc PR #45, Profile chưa có lĩnh vực quan tâm nên fallback v1 mới dùng job mới nhất; recruiter-facing `/recommend/candidates` còn chờ consent/visibility/company/job authorization. Contract này đã được hoàn thành tiếp ở mục 2.29/PR #49; CV nearest-neighbor index và controlled synthetic ANN/index/filter benchmark hoàn thành tiếp ở mục 2.34; Candidate-facing full-target internal HTTP/concurrency gate hoàn thành ở mục 2.41. Distributed per-user/IP rate limit, real-model latency/quality tiếng Việt, public Job/deployed multi-replica load và E2E vẫn là acceptance gate trước production.

---

## 2.26 Profile Application Skill Snapshot Contract v2 — hoàn thành qua PR #46

> Implementation được bàn giao từ `feature/profile/application-skill-snapshot-v2` vào `develop` qua PR #46 ngày 28/08/2026. Đây là provider contract cho Application; consumer/persistence/filter đã được hoàn thành tiếp ở mục 2.27.

- Profile thêm rolling-compatible `POST /internal/v2/cvs/verify`, giữ nguyên request, dual auth Candidate JWT + exact `application-service` key, CV projection và unavailable semantics của v1. V1 không thay đổi nên replica Application cũ vẫn rollback/rollout an toàn.
- Khi CV active, private và đúng owner, v2 trả thêm `profileSkillSnapshot={schemaVersion:1,profileAggregateVersion,skills}`. Projection chỉ có tối đa 100 tên kỹ năng tự khai, sắp theo `sortOrder` rồi UUID; không lộ skill ID, level, normalized name, contact, biography, Builder JSON hoặc nội dung CV.
- CV, Profile aggregate version và skills được đọc trong cùng `REPEATABLE READ`. Missing, wrong-owner, deleted hoặc legacy URL-only CV đều trả cùng `available=false`, `cv=null`, `profileSkillSnapshot=null`; dữ liệu drift vượt 100 skills fail-closed thay vì truncate.
- Verify đạt Profile build PASS, **55/55 full unit test**, **14/14 focused PostgreSQL 16 integration test** cho contract v1/v2 và `git diff --check` PASS. Full integration baseline 70 test từ task 2.24 chưa được tuyên bố rerun trong PR này; P17 deployed cross-service E2E vẫn pending.
- Profile chưa có persistence/consent cho lĩnh vực hoặc sở thích nghề nghiệp. Không suy diễn ngầm từ headline/skills; fallback theo sở thích của Job recommendation được tách thành contract/migration riêng.

---

## 2.27 Application-time Profile Skill Snapshot & Recruiter Filter — hoàn thành qua PR #47

> Implementation được bàn giao từ `feature/application/recruiter-skill-filter-v1` vào `develop` qua PR #47 ngày 28/08/2026. Đây là service-level consumer/persistence/filter của contract Profile v2; không đồng nghĩa P17 deployed cross-service E2E đã hoàn tất.

- Application Submission chuyển sang `POST /internal/v2/cvs/verify`, kiểm nghiêm ngặt envelope, echoed IDs, CV projection và `profileSkillSnapshot` schema v1. Tên skill được NFKC/Unicode-trim, giới hạn 100, cấm control character và fail-closed khi Profile sai contract; CV unavailable vẫn hội tụ về public `CV_NOT_AVAILABLE`.
- Flyway V8 thêm metadata nullable `profile_skill_snapshot_schema_version`, `profile_aggregate_version`, `profile_skill_snapshot_expected_count` cùng bảng `application_profile_skill_snapshots`. Application mới lưu exact names-only snapshot với deletion gate/usage ledger, initial history và transactional outbox trong cùng transaction; lỗi snapshot rollback toàn bộ.
- Expected count `0..100`, parent-row lock, deferred exact-count check và trigger child bảo vệ cả incomplete/over-count/late privileged INSERT, UPDATE, independent DELETE; parent Application delete vẫn cascade. V8 không backfill Application lịch sử vì Profile hiện tại không thể tái dựng dữ liệu tại thời điểm nộp.
- Recruiter `GET /applications` nhận `skills` dạng query lặp hoặc phân tách dấu phẩy, tối đa 10 giá trị. Semantics là **ANY**, exact và không phân biệt hoa/thường theo database collation; không substring, alias, bỏ dấu hoặc semantic match. Filter kết hợp với job/status/date và dùng correlated `EXISTS` nên không nhân bản row/count.
- UUID là tie-breaker cuối cho cả `APPLIED_AT_ASC`, `APPLIED_AT_DESC` và `MATCH_SCORE_DESC`. Application legacy/snapshot rỗng vẫn hiện khi không lọc nhưng không match filter active; company isolation MEMBER/OWNER giữ nguyên và pipeline không gọi live Profile.
- Response đặt `Cache-Control: private, no-store` và `Vary: Authorization`, không trả skill names hoặc thêm chúng vào Kafka event. Root Nginx dùng access-log format không có query/referrer cho `/applications/`; `nginx -t` PASS, còn gateway/APM ngoài phải duy trì redaction.
- Full `mvn verify -Pintegration-test` đạt **238/238 unit + 63/63 PostgreSQL/Kafka integration test**, bao phủ strict v2 client, atomic rollback, V7→V8 no-backfill, exact-count/immutability, late INSERT, ANY filter, filter kết hợp, company isolation, legacy/empty snapshot và deterministic pagination mọi sort.
- Skill snapshot là dữ liệu Candidate tự khai tại thời điểm nộp, không phải bằng chứng nội dung PDF và không được dùng để auto-reject. P17 REST/E2E, load test và production rollout vẫn pending.

---

## 2.28 Explicit Candidate Job Preferences & Recommendation Fallback — hoàn thành qua PR #48

> Implementation được bàn giao từ `feature/recommendation/candidate-preferences-fallback-v1` vào `develop` qua PR #48 ngày 28/08/2026. Consent v1 chỉ dành cho Candidate first-page Job fallback; không cấp quyền cho recruiter-facing `/recommend/candidates` hoặc mục đích khác.

- Profile thêm Candidate-only `GET/PUT /job-preferences`, identity chỉ lấy từ JWT và không nhận `userId`. GET chưa cấu hình trả virtual `UNSET/version=0`; PUT là full replacement với `expectedVersion` CAS. `ENABLED` cần consent v1 và ít nhất một tiêu chí; `DISABLED` atomically xóa toàn bộ tiêu chí, giữ withdrawal/version để stale request không thể bật lại consent.
- Migration thứ tám tạo aggregate 1:1 riêng theo Candidate, không backfill/suy diễn và không bump Profile completion/`aggregateVersion`. V1 lưu explicit `targetRoles`, `preferredLocations`, đúng bốn `preferredJobTypes` và `minimumSalary` VND; NFKC/collapse whitespace, giới hạn/dedupe case-insensitive, control character, PostgreSQL-unsafe Unicode và `%`, `_`, `\` đều bị chặn ở DTO, service, database constraint và Job consumer.
- Job chỉ gọi live Profile preferences khi trang đầu thực sự phải fallback; AI thành công và continuation không đọc preferences. Strict client kiểm exact envelope/schema/echo/timestamp/redaction/cap, timeout/body bounded, `cache=no-store`, redirect-off và không retry; Profile contract unavailable/malformed fail-soft sang `LATEST` mà không dùng cache cũ.
- Query `location/salaryMin/jobType` vẫn là hard filter và override dimension tương ứng. Tiêu chí còn lại match **ANY**: role/location exact case-insensitive, job type exact, salary match job negotiable hoặc VND `salaryMax` đạt ngưỡng. Match được xếp trước theo `publishedAt DESC NULLS LAST, id ASC`, rồi fill job mới nhất không trùng trong cùng `REPEATABLE READ`; có match trả `source=PREFERENCES`, không match trả `LATEST`, `score=null`, `nextCursor=null` và giữ nguyên root `fallbackReason`.
- Preferences không đi vào generic Profile response, CV/AI request, Kafka, Job DB/cache hay response recommendation. Root Nginx dùng query/referrer-free access log và strip forged internal headers cho toàn bộ `/profile/`, `/jobs/`, `/applications/`; hai personalized route còn ép `private, no-store`, `Pragma: no-cache`, `Vary: Authorization`. `nginx -t` PASS.
- Verify cuối: Profile build/Prisma validate PASS, **58/58 unit + 82/82 PostgreSQL/Kafka integration**, tám migration và second deploy không pending; Job build PASS, **226/226 unit + 19/19 PostgreSQL integration**; `git diff --check` PASS.
- Tại mốc PR #48, Job chưa có taxonomy ngành/lĩnh vực nên v1 chỉ exact-match role và các field Job hiện có; consent/capability riêng cho Recruiter recommendation còn pending nhưng đã được hoàn thành tiếp ở mục 2.29/PR #49. Candidate preferences UI, relevance tiếng Việt, latency/load/deep-pagination và deployed E2E vẫn pending.

---

## 2.29 Consent-scoped Recruiter Candidate Recommendations v1 — hoàn thành qua PR #49

> Implementation được bàn giao từ `feature/ai/recruiter-candidate-recommendation-v1` vào `develop` qua PR #49 ngày 28/08/2026. Consent này độc lập với Candidate job preferences của PR #48 và chỉ dành cho mục đích cố định `RECRUITER_JOB_RECOMMENDATION`.

- Profile thêm Candidate-only `GET/PUT /recruiter-discovery`: Candidate chưa quyết định nhận virtual `UNSET/version=0`; `ENABLED` cần consent v1 và bind đúng một CV active, owned, private, Media-backed; `DISABLED` rút consent và xóa binding. Aggregate/migration thứ chín không backfill hoặc suy diễn từ default CV, job preferences, Application hay dữ liệu Profile.
- Hidden Profile snapshot chỉ trả tối đa 500 tuple `{candidateId,cvId,discoveryVersion,profileVersion}` đã sắp xếp; vượt cap trả 503 thay vì truncate. Resolver nhận tối đa 50 tuple exact, đọc `REPEATABLE READ`, revalidate consent/CV/version/owner rồi chỉ trả `{candidateId,fullName,headline,skills}` theo đúng thứ tự; stale/withdrawn bị omit để Job fail closed.
- Job public `GET /jobs/:jobId/recommended-candidates` chỉ cho JWT `RECRUITER`. Company phải còn `VERIFIED`; `OWNER` quản lý mọi Job cùng Company, `MEMBER` chỉ Job do mình tạo; Job phải `PUBLISHED`, deadline UTC còn hiệu lực. Sau downstream, Job gọi lại Company self-membership và revalidate Company, role, Job aggregate/status/deadline bằng clock mới trước khi trả dữ liệu.
- Job gửi AI đúng canonical `job_id`, authoritative `job_version`, exact eligible Candidate/CV/version scope, limit và cursor bằng credential riêng. AI từ chối embedding Job lệch version, join đúng từng cặp `(candidate_id,cv_id)`, chỉ dùng CV active cùng model, buộc cursor HMAC vào Job version + toàn scope consent và không có unconsented/latest-CV fallback.
- Public response không chứa CV ID/version, phone, address, summary, avatar, social link, download URL, vector hay consent metadata; score chỉ là semantic similarity và không phải bằng chứng năng lực hoặc căn cứ auto-reject. Profile resolve là authorization snapshot: withdrawal sau snapshot có thể ảnh hưởng request kế tiếp, còn request đang in-flight vẫn có giới hạn TOCTOU phân tán không thể loại bỏ tuyệt đối.
- Profile↔Job và Job↔AI dùng hai purpose-scoped key mới, khác credential Application và Candidate-job recommendation; placeholder/malformed/trùng key fail closed. Gateway chặn public internal Profile/AI routes, strip forged internal headers, ép no-store và áp local limiter cho GET/HEAD kể cả case/trailing slash; runtime smoke xác nhận burst vượt ngưỡng trả 429 cùng `Retry-After: 60`.
- Verify cuối tại mốc PR #49: Profile build PASS, **62/62 unit + 89/89 PostgreSQL/Kafka integration**, chín migration và second deploy không pending; Job build PASS, **292/292 unit + 19/19 PostgreSQL/Kafka/Redis/Elasticsearch integration**; AI Ruff PASS, **331 unit/non-integration + 54 PostgreSQL/Kafka integration (385 tổng)**. Sau mục 2.34, AI đạt **331 + 55 (386 tổng)**; task chatbot ở mục 2.36 nâng mốc đã kiểm chứng lên **445 + 59 (504 tổng)**; personalized recommendation tool ở mục 2.37 nâng mốc hiện tại lên **529 + 62 (591 tổng)**. Root Compose config, Nginx syntax/runtime variants/rate-limit smoke và `git diff --check` đều PASS.
- Rollout phải provision distinct secrets trước, chạy Profile migration và deploy Profile/AI provider trước Job/gateway; health Job chỉ `UP` khi Company/Profile/AI candidate configuration đều an toàn. Tại mốc PR #49 còn pending exact-scan concurrency/filtered ANN; controlled Candidate index/filter gate hoàn thành ở mục 2.34 và Candidate-facing Job full-target HTTP/concurrency gate hoàn thành ở mục 2.41, còn filter-aware ANN vẫn pending. Deployed Company–Job–Profile–AI E2E, distributed multi-replica limiter và real-model relevance/latency/load tiếng Việt vẫn pending.

---

## 2.30 Canonical Application Events → Notification In-app Inbox v1 — hoàn thành qua PR #50

> Implementation được bàn giao từ `feature/notification/application-events-inbox-v1` vào `develop` qua PR #50 ngày 28/08/2026. Phạm vi này hoàn thành in-app projection cho `application-events`; không tuyên bố đã hoàn thành FCM/SMTP/BullMQ hoặc consumer `interview-events`/`chat-events`.

- Application có canonical JSON Schema draft 2020-12 và bốn producer fixture cho submission, pipeline, Offer sent và Offer accepted. Kafka key là exact `application_id`; v1 bắt buộc `schema_version`, resulting `aggregate_version`, nullable `actor_id`, participant IDs và UTC timestamp. Offer trio chỉ hợp lệ theo cặp `SENT: INTERVIEW→OFFER`, `ACCEPTED: OFFER→HIRED`, `DECLINED: OFFER→REJECTED`; payload không chứa salary, note, lý do, file hoặc CV/contact data.
- Submission, Pipeline và Offer đều dùng cùng `ApplicationEventV1`; Application row/history/Offer/outbox tiếp tục cùng commit hoặc rollback. Producer test khóa fixture/schema, resulting version, actor và privacy; full Application verify đạt **246/246 unit + 63/63 PostgreSQL/Kafka integration test**.
- Prisma migration Notification tạo `Notification`, `ProcessedEvent`, `PoisonEvent`, `DeviceToken`, `NotificationLog`, `NotificationSetting`, index keyset/unread và các constraint/hash/uniqueness cần thiết. Device/settings và PUSH/EMAIL chỉ mới có persistence nền, chưa có public API/worker.
- Dedicated group `notification-application-inbox-v1` manual-commit, replay retained backlog ở lần join đầu và ghi `ProcessedEvent + Notification + IN_APP log` trong một PostgreSQL transaction. Required stable rollout cutoff ledger/commit record lịch sử cũ nhưng không biến chúng thành unread mới; event trước khi service start nhưng sau cutoff vẫn được chiếu. Duplicate cùng hash/key là no-op; cùng event ID nhưng payload/key khác bị quarantine. Poison chỉ giữ Kafka position, hash và error code an toàn; raw key/value không lưu. Lỗi tạm thời không commit offset.
- Parser strict v1 có bounded legacy dual-read trong rollout. Mapper gửi đơn mới, Candidate withdrawal và phản hồi Offer về Recruiter; thay đổi do Recruiter và Offer sent về Candidate; không tự thông báo cho actor. `created_at` dùng DB receive time thay vì `occurred_at`, tránh event lệch đồng hồ phá keyset/read-all.
- API owner-only gồm list theo `type/limit/cursor`, unread count, idempotent mark-read và DB-clock cutoff read-all. Identity chỉ lấy từ JWT, cross-owner trả 404; cursor HMAC gắn user/filter/position, response và lỗi đều private/no-store. JWT verifier fail-fast với static RSA PEM hoặc HTTPS JWKS strict, RFC 7638 `kid`, single-flight/cooldown và claim/header canonical.
- Root Nginx giữ nguyên `/notifications`, strip forged internal headers, không log query/referrer và thêm privacy headers `always`. Compose có one-shot migration, trusted public-key secret, Kafka/Application topic wiring, readiness PostgreSQL + `GROUP_JOIN`; runtime Node 24 chạy UID 1000. Static infra, Compose config, Prisma validate, runtime build và `npm audit --omit=dev` (0 vulnerability) đều PASS.
- Full clean Notification Compose đạt **27/27 unit + 6/6 PostgreSQL/Kafka integration test**; migration đầu áp dụng thành công và deploy lần hai không còn pending. Test bao phủ bounded retained replay/cutoff, event có sẵn trước consumer start, duplicate/collision, poison continuation, legacy withdrawal, strict JWT/JWKS, owner isolation, pagination và read-all. KafkaJS 2.2.4 còn phát `TimeoutNegativeWarning` trên Node 24; đây là warning timer upstream, assertions delivery vẫn PASS.
- Tại mốc PR #50 còn pending `interview-events`; foundation `SCHEDULED` đã được hoàn thành tiếp ở mục 2.32. BullMQ, FCM, SMTP, settings API, Chat, reminder, Kafka TLS/SASL/ACL, retention/alert và deployed cross-service E2E vẫn pending.

---

## 2.31 Interview Scheduling Foundation v1 — hoàn thành qua PR #51

> Implementation được bàn giao từ `feature/interview-service/scheduling-foundation-v1` vào `develop` qua PR #51 ngày 28/08/2026. Đây là foundation đặt lịch OFFLINE; không tuyên bố hoàn thành toàn bộ C1 hoặc bật giả Jitsi/Notification khi lifecycle tương ứng chưa có.

- Application thêm hidden `POST /internal/v1/interview-scheduling/authorize`, bắt buộc exact singleton `X-Internal-Service: interview-service`, key hướng riêng và Recruiter JWT được Application verify lại. MEMBER/OWNER chỉ đọc context trong chính Company; application không tồn tại/khác Company cùng trả `404`, trạng thái ngoài `REVIEWING|INTERVIEW` trả `409`. Response chỉ có `applicationId/jobId/companyId/candidateId/status/applicationVersion`, không lộ CV, cover letter, evaluation hay timeline.
- Interview thêm `POST /interviews` cho `RECRUITER`. V1 cố ý self-scheduling (`interviewerId = JWT sub`) vì Company chưa có contract kiểm membership của một interviewer tùy chọn; request không nhận Candidate/Job/Company/interviewer ID và toàn bộ snapshot lấy từ Application. Cùng `requestId` + canonical payload hash trả lại bản ghi cũ, reuse khác payload trả `409`.
- Flyway V1 tạo `interviews`, audit/version/lifecycle columns, active application-round unique và hai GiST exclusion constraint bằng `btree_gist` cho Candidate/interviewer. Khoảng `[start,end)` cho phép hai slot sát nhau; `CANCELLED/COMPLETED/NO_SHOW` giải phóng calendar. Database tiếp tục chặn direct SQL, còn service có bounded retry cho deadlock giữa hai exclusion index đồng thời.
- API bắt timestamp có offset và IANA `timeZone`, kiểm offset theo `ZoneRules` để chặn DST gap/mismatch, chỉ nhận precision millisecond, thời điểm tương lai và duration đúng `30|45|60`; persist UTC `TIMESTAMPTZ(3)`. `ONLINE` trả stable `INTERVIEW_ONLINE_NOT_READY` cho tới khi Jitsi token/room lifecycle thật được triển khai.
- Inbound JWT của Interview khóa `typ=JWT`, RS256, RFC 7638 `kid`, issuer, exact single audience, UUIDv4 `sub/jti`, exact string role và `iat/exp`. Outbound Application client khóa allowlist HTTP(S) origin, no redirect, connect/read timeout, body 16 KiB, content type/exact schema/echoed ID và fail closed khi downstream lỗi.
- Root Compose cấp cùng một directional secret cho Interview outbound/Application inbound, mount trusted public key và wiring URL/timeout. Nginx giữ nguyên prefix cho exact `/interviews` và nested route, strip forged internal headers, dùng query/referrer-free log, ép private/no-store và chặn biến thể public internal path. Runtime image chạy user `interview`, có DB-backed readiness; `.dockerignore` không đưa `.env`/`target` vào build context.
- Verify cuối: Application **260/260 unit test**; Interview **43/43 unit/WebMvc/security/client + 8/8 PostgreSQL migration/concurrency integration test**. Clean migration, JPA validate, second Flyway deploy, UTC/DST, half-open adjacency, idempotency collision, active round, cancelled release, direct SQL và hai race Candidate/interviewer đều PASS. Image build/non-root/healthcheck, Compose static config, `nginx -t` và `git diff --check` PASS.
- Tại mốc PR #51, transactional `interview-events` outbox/Notification consumer còn pending và đã được hoàn thành tiếp cho action `SCHEDULED` ở mục 2.32; backlog list/detail/my/calendar/availability được hoàn thành tiếp ở mục 2.33. `InterviewFeedback`, arbitrary interviewer/panel authorization, Candidate confirm/reschedule, cancel/no-show, Jitsi join/token, các action/reminder khác và frontend/deployed E2E vẫn pending. Local Compose vẫn dùng schema `interview` trong PostgreSQL chung; production cần chốt database/credential isolation riêng như tài liệu kiến trúc.

---

## 2.32 Transactional Interview Scheduled Event v1 → Notification In-app — hoàn thành qua PR #52

> Implementation được bàn giao từ `feature/interview-service/interview-events-v1` vào `develop` qua PR #52 ngày 28/08/2026. Phạm vi chỉ khóa event `SCHEDULED` cho foundation OFFLINE hiện có; không tuyên bố hoàn thành confirm/reschedule/cancel/reminder, Jitsi, email hoặc push.

- Interview sở hữu JSON Schema draft 2020-12 và canonical fixture đúng 15 trường. Kafka key là lowercase `interview_id`; `event_id` bắt buộc UUIDv4; actor bằng interviewer và khác Candidate; timestamps UTC đúng millisecond. Payload loại bỏ location, notes, request ID/hash, CV/contact data và toàn bộ room URL/token.
- Flyway V2 tạo immutable outbox với unique `(interview_id,aggregate_version)`, strict JSONB checks, stream order, lease owner/fence, `SKIP LOCKED`, bounded retry và health theo tuổi backlog. Interview + outbox cùng commit/rollback; unknown outbox integrity fault giữ semantics 5xx thay vì bị báo nhầm 409. Migration không tự sinh event cho Interview lịch sử.
- Publisher dùng Kafka ACK all/idempotence, auto-create off, stable event/key/payload và at-least-once delivery. Test PostgreSQL chứng minh rollback, exact idempotent/concurrent replay, JSON null/UUID sai bị chặn, lease expiry/stale fence và aggregate sau chỉ được claim khi aggregate trước đã publish; Kafka thật chứng minh exact persisted key/payload và không phát lại row đã hoàn tất.
- Notification thêm `INTERVIEW_SCHEDULED`, strict parser exact v1 và Candidate-only safe projection. Dedicated group `notification-interview-inbox-v1` có rollout cutoff riêng, `fromBeginning`, manual commit và dùng chung atomic ledger cho `ProcessedEvent + Notification + IN_APP log`; duplicate no-op, collision/poison chỉ lưu hash/error code, lỗi DB tạm thời không commit offset.
- Readiness Notification yêu cầu cả Application và Interview group đã join. Root Compose provision cùng configurable Interview topic cho `kafka-init`, producer và consumer; rollout phải giữ cố định `NOTIFICATION_INTERVIEW_REPLAY_AFTER` cho group này và deploy consumer/migration trước khi bật publisher.
- Verify cuối: Interview **51/51 unit/WebMvc/security/client/event + 12/12 PostgreSQL/Kafka integration**; Notification clean Docker **51/51 unit + 7/7 PostgreSQL/Kafka integration**, hai Prisma migration áp dụng và lần deploy thứ hai không còn pending. Hai review độc lập không còn finding correctness; `git diff --check` và root Compose config thuộc gate bàn giao cuối.
- Còn pending: deployed Interview→Kafka→Notification E2E trong một stack, production TLS/SASL/ACL/retention/alert, lifecycle event action, reminder/BullMQ, FCM/SMTP, Jitsi và frontend.

---

## 2.33 Interview Query, Calendar & Availability v1 — hoàn thành qua PR #53

> Implementation được bàn giao từ `feature/interview-service/interview-query-calendar-v1` vào `develop` qua PR #53 ngày 28/08/2026. Phạm vi là read-side và gợi ý slot cho Interview OFFLINE hiện có; availability không giữ chỗ và không tuyên bố hoàn thành lifecycle/Jitsi/frontend.

- Thêm năm GET API: `/interviews`, `/interviews/my`, `/interviews/calendar`, `/interviews/availability` và `/interviews/{id}`. History/detail/my hỗ trợ Candidate và Recruiter; Company calendar cùng availability chỉ cho Recruiter, còn Admin/anonymous bị chặn.
- Candidate được DB-scope theo exact JWT `sub`; projection loại Company/Candidate/interviewer/scheduler identity, notes và audit metadata. Recruiter revalidate current MEMBER/OWNER Company membership ở mỗi request; detail/history/calendar chỉ thấy Company hiện tại, còn `/my` khóa thêm `interviewer_id = sub`. Cross-scope và missing cùng trả `404` để chặn IDOR oracle.
- History Candidate chỉ nhận `applicationId`; Recruiter phải có ít nhất một identity filter. Unknown/repeated scalar query, duplicate/invalid status và limit ngoài `1..50` bị từ chối. Response/lỗi đều private/no-store và `Vary: Authorization`.
- HMAC-SHA256 keyset cursor gắn endpoint, user/role, current Company/member role, toàn bộ filter, sort, limit và first-page `asOf` creation cutoff; tamper/cross-user/cross-role/cross-filter/đổi membership đều fail closed. Cutoff chặn row tạo sau chen vào chuỗi trang nhưng lifecycle status vẫn là dữ liệu live; cursor input được giới hạn 1024 ký tự.
- Recruiter Company calendar dùng half-open overlap trong range tối đa 42 ngày. Availability derive authoritative Company/Candidate từ Application, chỉ tìm self-interviewer, nhận IANA/DST-safe window tối đa 26 giờ trong horizon 92 ngày, duration `30|45|60` và grid 15 phút; output không lộ nguồn busy. Atomic `POST /interviews` cùng exclusion constraints vẫn là authority chống race.
- Flyway V3 thêm Company/Job calendar index và trigger khóa bất biến identity/schedule snapshot lịch sử trong mọi direct SQL update. Company client khóa exact response, allowlisted origin, no redirect, timeout/body cap và fail closed; Compose cấp URL/allowlist/timeout cùng cursor key riêng.
- Full clean gate đạt **143/143 unit/WebMvc/security/client/event/query + 16/16 PostgreSQL/Kafka integration test**. Bốn Query PostgreSQL IT chứng minh DB scope/redaction, tied keyset không skip/duplicate, half-open calendar/advisory privacy, migration lặp và trigger chặn sửa snapshot.
- Còn pending: arbitrary interviewer/panel membership, confirm/reschedule/cancel/no-show/feedback, các lifecycle event/reminder, Jitsi join/token, frontend và deployed cross-service E2E.

---

## 2.34 AI CV HNSW, Exact Allowlist Plan & Controlled Benchmark — hoàn thành qua PR #59

> Implementation được bàn giao từ `feature/ai-service/candidate-ann-benchmark` vào `develop` qua PR #59 ngày 29/08/2026. Phạm vi chỉ thuộc Người 2 và hoàn thành đúng checkbox CV nearest-neighbor index/index-filter benchmark của P11; đây không phải bằng chứng relevance tiếng Việt/model thật, HTTP/deployed E2E, distributed rate limit hay chatbot.

- Alembic `20260829_06` tạo partial active-row HNSW cosine cho `ai.cv_embeddings` bằng `CREATE INDEX CONCURRENTLY`, dọn same-name index invalid/leftover trước khi retry và downgrade bằng concurrent drop. Integration test xác nhận method/opclass/options/predicate cùng `indisvalid/indisready`, kể cả trường hợp thay một B-tree cùng tên rồi upgrade lại.
- Candidate production query bỏ việc tắt toàn bộ index scan, materialize trước exact allowlist tối đa 500 cặp `(candidate_id,cv_id)`, lookup bằng PK/B-tree rồi mới tính cosine/sắp xếp exact. HNSW không được đẩy vào đường này vì global ANN post-filter có thể bỏ sót Candidate đã được authorize và phá tính đầy đủ của HMAC keyset cursor.
- Guarded Docker runner chỉ chấp nhận local Unix daemon, database/run sentinel chính xác, image Python và PostgreSQL/pgvector pin digest, internal network không publish port và cleanup theo exact ID/label. Fixture gồm 100.000 CV: 80.000 active đúng model, 10.000 inactive đúng model và 10.000 active sai model.
- Chính migration `05 → 06` chạy trên đủ 100.000 row trong **5.284,159 ms**; index valid/ready chiếm **184.328.192 byte**. Populated gate chưa tạo writer đồng thời nên production vẫn phải dùng một migration job, theo dõi lock/build/write latency và không để nhiều API startup migrator chạy đua.
- Exact oracle cho scope **1/100/500**, traversal **1/2/10 trang**, owner/activity/model isolation, committed/zero-row/rollback generation và EXPLAIN đều PASS: 0 mismatch/duplicate/leak; CV plan dùng PK/B-tree, không Seq Scan và không HNSW. Execution plan lần lượt **0,088 / 0,456 / 1,828 ms**.
- Advisory HNSW experiment được ép planner rõ ràng và đạt recall@100 **1,0**, nhưng global pool 500 tìm **0/50** exact top Candidate trong dynamic allowlist 500. Vì vậy production giữ `EXACT_DYNAMIC_WHITELIST`; CV HNSW hiện chỉ là index advisory/future, không phải readiness dependency và có chi phí storage/write.
- Controlled PostgreSQL repository load chạy 500 warm-up + 10.000 call, concurrency 32, statement timeout production 2 giây: **0 lỗi, 0 mismatch, 323,129 req/s, p95 130,089 ms, p99 149,503 ms, max 183,722 ms**. Vector tổng hợp chỉ dùng hai chiều có dữ liệu trong 384 chiều nên không được diễn giải thành chất lượng semantic/relevance thật.
- Verify code hiện đạt Ruff/format và shell syntax PASS, **331 unit/non-integration + 55 PostgreSQL/Kafka integration test (386 tổng)**. Docker test image cũng lint thư mục `scripts`; toàn bộ tài nguyên benchmark đã được cleanup.

## 2.35 Company Invitation–Auth Identity Binding — hoàn thành qua PR #60

> Phạm vi chỉ thuộc Company Service của Người 2 và hoàn thành lát cắt Auth trong P06. Task này không sửa Auth/Admin/File Service, shared Compose/gateway hoặc frontend, và không tuyên bố full Company multi-service E2E.

- `POST /invitations/accept` không còn tin duy nhất vào `sub/role` của JWT còn hạn. Company chuyển chính access token đã được RS256 guard xác minh tới fixed-origin `GET /auth/me`, yêu cầu exact subject UUID v4, email canonical, role `RECRUITER` và `verified=true`; tài khoản bị khóa/xóa/đổi role hoặc Auth unavailable đều fail closed bằng lỗi đã làm sạch.
- Auth client khóa scheme/origin/host allowlist, path cố định, redirect, timeout, token/response size, content type, UTF-8 JSON và exact response shape. Token không được ghi vào database/log/error; email được chuẩn hóa tương thích Auth bằng NFC + trim + lowercase thay vì NFKC có thể nhập hai identity khác nhau làm một.
- Company gọi Auth trước transaction rồi đọc lại invitation trong transaction `Serializable`, so khớp exact email trước mọi write. Accept thành công/replay trả HTTP `200` và hội tụ idempotent; token dành cho email khác nhận `403` mà không lộ email hoặc thay đổi invitation/member.
- Migration `20260829200000_company_invitation_auth_binding` thêm marker version nullable: invitation mới/reissue dùng version `1`, legacy `PENDING/null` buộc OWNER reissue, legacy `ACCEPTED` được đánh dấu `0` để giữ workflow. PostgreSQL CHECK chặn marker ngoài allowlist và chặn old writer đổi hàng legacy marker-null sang `ACCEPTED`; rollout cấm mixed old/new Company writer.
- Full Company đạt **13/13 suite, 306/306 Jest test** và build PASS. PostgreSQL 16 gate PASS upgrade đủ sáu migration, deploy lần hai, drift/ledger/data/constraint, backup/restore tách database, rollback candidate và corrupt-archive rejection; offline harness guard/syntax/diff đều PASS.
- Real Auth–Company Docker gate lấy **9 JWT** qua `/auth/login`, tạo **7 invitation**, chứng minh stolen-token no-mutation, intended replay, **4** durable identity failure, **8** accept đồng thời hội tụ một membership và Auth outage trả sanitized `503` không write; final counts `1|3|2|5`, tài nguyên tạm được cleanup. Đây là point-in-time Auth recheck, chưa phải atomic cross-service identity fence; muốn loại TOCTOU còn lại cần contract version/fencing mới từ Auth.

## 2.36 Secure AI Chatbot v1 — hoàn thành qua PR #61

> Task chỉ thuộc AI Service của Người 2, được bàn giao từ `feature/ai-service/secure-chatbot` vào `develop` qua PR #61 ngày 29/08/2026. Task không sửa frontend chatbot widget của Người 3, shared gateway/Compose hoặc service ngoài phạm vi.

- Chốt Anthropic Claude theo tài liệu kiến trúc và pin `anthropic==0.120.2`; bỏ ranh giới lựa chọn Gemini trước đây. Runtime chatbot dùng thêm `PyJWT==2.13.0` và `redis==7.4.1`, cấu hình model/timeout/max output hữu hạn và không tự retry request LLM.
- Candidate-only `POST /chat` xác minh access token RS256 qua JWKS, khóa issuer/audience/`typ`/`kid`, UUID claims và exact role. Request khóa session UUID v4, message Unicode/byte/control-character bound; response/error đều làm sạch, không trả prompt, token, Redis key, history hoặc lỗi provider và ép `Cache-Control: no-store`.
- System prompt cố định chỉ cho phép hỗ trợ tuyển dụng, coi message/history là dữ liệu không tin cậy, từ chối tiết lộ prompt/secret/dữ liệu người khác, không hỏi password/OTP/token và không khẳng định trạng thái hệ thống thời gian thực. V1 không nhận `cv_id` tùy ý và không gọi `/recommend/*` hay tool nội bộ.
- Redis chỉ giữ tối đa **10 lượt** trong **24 giờ** dưới owner/session key đã HMAC; append dùng lock token/fencing nguyên tử để hai request cùng session không làm trộn lịch sử. Sliding-window rate limit phân tán theo Candidate và toàn cục dùng Redis server time; outage fail closed, còn lỗi busy/rate/provider trả contract hữu hạn cùng `Retry-After` khi phù hợp.
- Test plumbing deterministic bao phủ **10 FAQ** tiếng Việt, prompt injection, JWT/JWKS, Candidate-only role, owner/session isolation, Redis TTL/trim, atomic lock/fencing, distributed user/global limit, provider timeout/oversize/error redaction và cache headers. Full Compose gate đạt **445 unit/non-integration + 59 PostgreSQL/Kafka/Redis integration (504/504 tổng)**; Ruff và format check đều PASS.
- Còn pending và không được suy diễn là đã PASS: chạy 10 FAQ với Claude thật để đánh giá chất lượng, provider staging smoke bằng API key thật, recommendation intent/tool, frontend chatbot widget của Người 3, deployed gateway E2E, HTTP/load đa replica, production monitoring/SLO và secret rotation.

## 2.37 Personalized Job Recommendation Chat Tool v1 — hoàn thành qua PR #62

> Task chỉ thuộc AI Service của Người 2, được bàn giao từ `feature/ai-service/chat-recommendation-tool` vào `develop` qua PR #62 ngày 29/08/2026. Task không sửa frontend chatbot widget của Người 3, shared gateway/Compose hoặc service ngoài phạm vi.

- Feature flag mặc định tắt giữ chatbot v1 độc lập; khi bật, Anthropic chỉ được khai báo đúng một strict tool `get_my_job_recommendations` không tham số. Provider chỉ chấp nhận một tool call exact hoặc một câu trả lời text hợp lệ, không cho model chọn user/CV/filter/URL và không gọi Claude lần hai sau tool.
- Chỉ sau exact intent, Candidate bearer đang có mới được chuyển tạm thời tới fixed Job endpoint `/recommended?limit=3`; identity, CV mặc định, preferences và authorization tiếp tục do Job/Profile phía server quyết định. Token không đi vào prompt, Redis, formatter, log hoặc error.
- Job client khóa fixed origin/host allowlist, HTTPS production, redirect/proxy, timeout tổng, response `identity`, raw body tối đa 256 KiB, UTF-8 JSON/exact schema và các invariant UUID/date/salary/score/source. Kết quả tối đa ba Job được format deterministic với projection tối thiểu; outage/empty trả hướng dẫn ổn định và không lộ downstream detail.
- Redis chỉ lưu neutral marker sau luồng tool, không lưu title/company/location/score hay nội dung Job có thể quay lại prompt. Session lock được gia hạn bằng exact-token lease; mất fence/Redis sẽ fail closed trước Job hoặc append.
- Dedicated bounded executor cùng admission semaphore, shielded cancellation và async shutdown/drain ngăn đường AI → Job → AI chiếm cạn default worker pool; request giữ đúng thứ tự rate limit → session lease → history → Claude → tối đa một Job call → một append.
- Full Compose gate đạt Ruff/format PASS và **529 unit/non-integration + 62 PostgreSQL/Kafka/Redis integration (591/591 tổng)**. Mười FAQ vẫn dùng deterministic provider fake; không được suy diễn là đã chạy Claude thật.
- Còn pending: live Claude intent/10-FAQ quality và staging smoke; deployed AI → Job → AI HTTP/load/cold-JWKS/multi-replica monitoring; production TLS, secret rotation và SLO. Frontend chatbot widget thuộc Người 3, nằm ngoài phạm vi task này.

## 2.38 Job & Search Strict Access Token Contract & JWKS Rotation — hoàn thành qua PR #63

> Task chỉ thuộc Job & Search Service của Người 2, được bàn giao từ `feature/job-search-service/strict-jwt-contract` vào `develop` qua PR #63 ngày 29/08/2026. Task không sửa Auth, Application, Profile, shared gateway/Compose hay service của Người 1/3 và không tuyên bố deployed Auth–Job E2E đã hoàn tất.

- Mọi route không public/internal chỉ nhận đúng một raw `Authorization: Bearer <compact-jwt>`; duplicate header, khoảng trắng lỏng, control/trailing data, token không canonical và token trên 8 KiB đều fail trước verifier.
- Access token khóa `alg=RS256`, `typ=JWT`, RFC 7638 thumbprint `kid`, exact issuer/audience, UUID v4 lowercase `sub/jti`, exact role `CANDIDATE|RECRUITER|ADMIN`, integer `iat/exp`, giới hạn clock skew và thời hạn hợp lệ. Static PEM chỉ được đọc/cached một lần và cấu hình bắt buộc chọn đúng một nguồn inline, file hoặc JWKS.
- JWKS rotation khóa HTTPS/fixed path/hostname allowlist (HTTP chỉ khi development opt-in), không redirect/userinfo/query/fragment; request có timeout, `identity` encoding và stream cap 32 KiB. Document chỉ nhận 1–16 exact RSA signing key 2048–8192 bit có `kid` đúng thumbprint; current/previous key cùng tồn tại được hỗ trợ.
- Cache/unknown-`kid` dùng monotonic TTL/cooldown và single-flight refresh; refresh publish nguyên tử, không giữ key đã bị rút, không phục vụ stale key sau cache expiry và fail closed khi Auth key unavailable. Response body bị cancel best-effort khi upstream status/header/length sai. Invalid token trả generic 401, key/config outage trả sanitized 503 và lỗi runtime bất ngờ trả sanitized 500.
- Gate cuối: Docker production build PASS, TypeScript source/test check PASS, **533/533 unit test** và **20/20 PostgreSQL 16/Kafka 3.8/Redis 7/Elasticsearch 8.14.3 integration test** PASS; `git diff --check` PASS. Integration gate được chạy lại từ volume sạch sau một lần môi trường kéo dài làm Redis/Kafka timeout; clean rerun hoàn thành trong 21,524 giây.
- Còn pending và không được đánh dấu hoàn tất: deployed Auth–Job negative contract/E2E, cold-JWKS/multi-replica observation và production TLS/secret rotation/monitoring. Strict consumer phía Application được tiếp tục tại mục 2.39; deployed Auth–Application E2E vẫn thuộc P17.

## 2.39 Application Service Strict Access Token Contract & JWKS Rotation — hoàn thành qua PR #64

> Task chỉ thuộc Application Service của Người 2, được bàn giao từ `feature/application-service/strict-jwt-jwks-verification` vào `develop` qua PR #64 ngày 29/08/2026. Task không sửa Auth producer, service của Người 1/3, shared gateway/Compose hoặc frontend và không tuyên bố deployed Auth–Application E2E đã hoàn tất.

- Mọi route không public/internal chỉ nhận đúng một raw `Authorization: Bearer <compact-jwt>` với scheme không phân biệt hoa thường nhưng đúng một ASCII space. Duplicate header, comma/control/trailing data, segment rỗng hoặc không base64url và token trên 8 KiB đều fail trước decoder. Interview internal dual-auth tái sử dụng cùng resolver/decoder sau khi service identity và dedicated key hợp lệ; Profile internal boundary vẫn độc lập.
- Access token khóa exact protected header `alg=RS256`, `typ=JWT`, RFC 7638 thumbprint `kid`; exact issuer và scalar audience; UUID v4 lowercase `sub/jti`; một exact role `CANDIDATE|RECRUITER|ADMIN`; integer `iat/exp`, tối đa 60 giây future skew, `exp > iat` và chưa hết hạn. Role array hoặc chuỗi ngoài allowlist không còn được đổi thành authority.
- Cấu hình fail startup nếu thiếu issuer/audience hoặc không chọn đúng một nguồn `JWT_PUBLIC_KEY`, `JWT_PUBLIC_KEY_PATH`, `JWT_JWKS_URI`. Static X.509 RSA PEM 2048–8192 bit được giới hạn 64 KiB, xác minh exponent/thumbprint và cache đúng một lần.
- JWKS khóa HTTPS, exact lower-case hostname allowlist và fixed `/auth/.well-known/jwks.json`; HTTP chỉ có explicit development opt-in. Client không redirect/compression, dùng timeout tổng cho cả header và body, giới hạn declared/raw body 32 KiB, fatal UTF-8, exact root `{keys}` và 1–16 exact RSA signing key có canonical `n/e` cùng `kid` đúng thumbprint.
- Current/previous key được hỗ trợ bằng monotonic TTL, single-flight cold refresh và unknown-`kid` cooldown. Refresh chỉ publish nguyên tử sau khi toàn document hợp lệ, loại key đã bị rút và không dùng stale key sau expiry. Token sai trả generic no-store 401, key/JWKS outage trả sanitized 503, runtime bất ngờ trả sanitized 500; response không lộ token, PEM, URL hoặc upstream detail.
- Gate cuối: **282/282 unit/WebMvc/security test** và **63/63 PostgreSQL 16/Kafka 3.8 integration test** PASS; Flyway V1–V8, Maven package, production Docker image build và `git diff --check` PASS. Focused security evidence gồm 10 decoder/JWKS test và 15 resolver/entrypoint/internal-filter test.
- Còn pending và không được đánh dấu hoàn tất: deployed Auth–Application negative contract/E2E, cold-JWKS/multi-replica observation, production TLS/secret rotation/monitoring và rollout trên môi trường thật; controlled concurrency/load phía Application được tiếp tục tại mục 2.40 và checkbox tổng P17 vẫn pending.

## 2.40 Application Service Controlled Concurrency & Load Gate — hoàn thành qua PR #65

> Task chỉ thuộc Application Service backend của Người 2, được bàn giao từ `feature/application-service/concurrency-load-gate` vào `develop` qua PR #65 ngày 29/08/2026. Task không sửa frontend, service của Người 1/3, Auth/Company producer, shared gateway/Compose hoặc production code của Application và không tuyên bố deployed HTTP/multi-replica load đã hoàn tất.

- Bổ sung Maven profile độc lập `application-concurrency-load`; gate luôn tự khởi tạo PostgreSQL 16 bằng image digest cố định, chạy Flyway V1–V8 và không nhận URL database ngoài. Mặc định dùng 32 worker, năm workload × 1.000 cặp × hai lời gọi, tổng cộng đúng 10.000 service call.
- Năm race gồm duplicate Candidate submission cùng Job, hai Recruiter đổi cùng Application version, Candidate withdraw đồng thời Recruiter chuyển `INTERVIEW`, duplicate send Offer và Candidate `ACCEPTED` đồng thời `DECLINED`.
- Mỗi cặp bắt buộc đúng một giao dịch commit và một conflict `409` đã được tài liệu hóa. Sau từng workload, gate kiểm tra Application/Offer state-version, active Candidate/Job uniqueness, CV gate/usage, skill snapshot, đúng một history và một pending canonical outbox cho mỗi winner, đồng thời không có history/outbox mồ côi.
- Kết quả controlled local: **10.000 call**, **5.000 winner + 5.000 conflict `409` dự kiến**, **0 unexpected/5xx/deadlock/timeout**, concurrency 32, p50 40,365 ms, p95 114,567 ms, p99 162,895 ms, max 754,295 ms và **585,53 call/s**.
- Gate fail nếu p95 vượt 5 giây, p99 vượt 10 giây, max vượt 15 giây hoặc throughput dưới 5 call/s; các ngưỡng/property đều bị giới hạn. Latency trộn winner với expected-conflict và bắt đầu sau barrier của từng cặp, còn throughput bao phủ toàn cửa sổ submit/thực thi.
- Đây là regression fence cho transaction path trong một process Application và một PostgreSQL local, không phải production SLO. HTTP/JWT, deployed Auth/Company/Kafka E2E, nhiều replica, network/TLS, frontend và capacity production vẫn thuộc P17.
- Gate cuối: standalone load test **1/1 PASS**, full **282/282 unit/WebMvc/security** và **63/63 PostgreSQL 16/Kafka 3.8 integration test** PASS, Flyway V1–V8 PASS, production Docker image build PASS và `git diff --check` PASS.

## 2.41 Candidate-facing Job Recommendation Full-Target HTTP & Load Gate — hoàn thành qua PR #66

> Task chỉ thuộc AI Service backend của Người 2, được bàn giao từ `feature/ai-service/job-recommendation-full-target-gate` vào `develop` qua PR #66 ngày 29/08/2026. Task không sửa frontend, service của Người 1/3, shared gateway/Compose hoặc production recommendation code.

- Bổ sung guarded standalone runner dùng PostgreSQL/pgvector và Python image pin digest, internal Docker network, không mở host port, từ chối database/Docker target ngoài và chỉ cleanup tài nguyên mang exact run label.
- Fixture có **100.000 Job embedding**: 80.000 active đúng model, 10.000 inactive đúng model, 10.000 active sai model và một active source CV. HNSW được dựng lại valid/ready sau bulk seed, chiếm **184.328.192 bytes**.
- Gate gọi HTTP thật `POST /recommend/jobs`, kiểm independent float32-cosine oracle cho no-filter/location/salary/job type, walk 1/2/10 trang, UUID tie-break, activity/model isolation, scoped auth, strict validation, redaction và không rò secret/vector/private metadata.
- Committed target mutation làm cursor stale; zero-row và rollback không bump generation. Sáu reader chạy cùng một writer thực hiện sáu commit chỉ trả **1 exact HTTP 200 + 5 canonical stale HTTP 409** trong lần gate cuối, không có outcome bất ngờ.
- EXPLAIN xác nhận production exact query scan toàn bộ khoảng 100.000 target, không dùng Job HNSW và hoàn tất trong database statement timeout 2 giây.
- Controlled local load PASS với **100 warm-up + 1.000 measured HTTP call**, concurrency 8, **0 error/mismatch/timeout/security leak**, p50 **697,618 ms**, p95 **1.021,163 ms**, p99 **1.133,728 ms**, max **1.299,623 ms** và **10,762 req/s**.
- Guarded gate, Ruff/format và full AI Compose suite **529 unit/non-integration + 62 PostgreSQL/Kafka/Redis integration (591/591 tổng)** đều PASS.
- Đây là regression fence local dùng synthetic 2D-in-384 vector và một FastAPI/PostgreSQL pair, không phải real-model Vietnamese relevance, deployed/multi-replica capacity, gateway E2E, production SLO, filter-aware ANN hoặc distributed rate-limit claim.

## 2.42 Application Offer Terminal-State Consistency — hoàn thành qua PR #67

> Task chỉ thuộc Application Service backend của Người 2, được bàn giao từ `feature/application-service/offer-lifecycle-consistency` vào `develop` qua PR #67 ngày 29/08/2026. Task không sửa frontend, service của Người 1/3, shared gateway/Compose hoặc Notification consumer.

- Flyway V9 bổ sung Offer terminal `CANCELLED`, backfill các cặp legacy `REJECTED/WITHDRAWN + SENT`, đặt `responded_at`, xóa `response_note`, tăng Offer version và không tạo history/outbox giả. Constraint khóa `CANCELLED` phải có terminal timestamp và không có response note.
- Pipeline chỉ cho `OFFER → REJECTED/WITHDRAWN` commit sau khi CAS Offer `SENT → CANCELLED`; Offer và Application cùng transaction, nên lỗi Application/history/outbox rollback cả cancellation. Application ở `OFFER` thiếu Offer fail closed bằng sanitized `503`; stale/concurrent state trả `409`.
- Cả pipeline cancellation và Candidate response giữ write-lock order Offer trước Application. PostgreSQL race test khóa các cặp cuối hợp lệ `HIRED/ACCEPTED`, `REJECTED/DECLINED`, `REJECTED/CANCELLED` hoặc `WITHDRAWN/CANCELLED`, đúng một winner và không có history/outbox mồ côi.
- Cancellation từ pipeline tiếp tục phát canonical `STATUS_CHANGED` không có `offer_id/offer_status/offer_version`; không mở rộng `application-events` v1, không lộ dữ liệu Offer và không kéo Notification của Người 3 vào phạm vi.
- Gate cuối PASS **286/286 unit/WebMvc/security test + 71/71 PostgreSQL 16/Kafka 3.8 integration test**, gồm dedicated V8→V9 backfill, negative constraint, atomic rollback và hai response-versus-pipeline race; Maven package, production Docker image và `git diff --check` PASS.
- V9 không rolling-compatible với binary cũ và giữ `ACCESS EXCLUSIVE` trong backfill/validate. Rollout bắt buộc freeze/drain toàn bộ replica cũ, đo lock window trên dữ liệu production-sized, chạy đúng một migrator trong maintenance window, post-check không còn terminal Application + `SENT` Offer, rồi mới bật replica mới; không rollback về binary cũ.
- Không đánh dấu hoàn tất auto-expiry worker, canonical Offer-letter Media ownership, deployed P17 E2E/HTTP multi-replica load, frontend hoặc production rollout thật.

## 2.43 Application Offer Auto-Expiry Worker — hoàn thành qua PR #68

> Task chỉ thuộc Application Service backend của Người 2, được bàn giao từ `feature/application-service/offer-expiry-worker` vào `develop` qua PR #68 ngày 29/08/2026. Task không sửa frontend, service của Người 1/3, shared gateway/Compose hoặc Notification consumer.

- Bổ sung terminal `OfferStatus.EXPIRED` và Flyway V10 mở rộng `offers_status_check`/`offers_response_coherence_check`, đồng thời backfill mọi row `SENT` đã quá `expires_at`. Backfill lấy `responded_at = expires_at` thay vì clock migration nên kết quả deterministic và trùng đúng với row do worker xử lý sau này; migration không sinh history/outbox giả và không đụng Application.
- `ApplicationOfferExpiryWorker` đọc clock một lần mỗi scan rồi drain theo bounded batch cho tới khi batch trả về ngắn hoặc hết batch budget; `ApplicationOfferExpiryService` commit từng batch riêng nên backlog lớn không giữ row lock lâu. Batch fail rollback nguyên vẹn và scan kế tiếp retry từ cùng durable state.
- Claim dùng `FOR UPDATE SKIP LOCKED` trên partial index `offers_pending_expiry_idx`, nên nhiều replica nhận claim rời nhau, không expire trùng một row và không block Candidate response hay pipeline cancellation đang giữ row. Native query được qualify bằng `{h-schema}` vì native SQL không kế thừa `hibernate.default_schema`.
- Worker chỉ resolve Offer: Application giữ nguyên `OFFER` để quyết định terminal vẫn thuộc Recruiter hoặc Candidate, và worker không ghi history lẫn outbox. Canonical `application-events` v1 không có action expiry lẫn `offer_status=EXPIRED`, nên phát event ở đây sẽ bị Notification consumer của Người 3 từ chối; hợp đồng v1 giữ nguyên.
- Reject/withdraw một Application có Offer đã `EXPIRED` vẫn commit và vẫn phát `STATUS_CHANGED` không có Offer trio, vì Offer terminal thì transition không còn gì để cancel; Offer đã `ACCEPTED/DECLINED` tiếp tục fail closed bằng `409`. Candidate phản hồi Offer quá hạn nhận cùng conflict `OFFER_EXPIRED` bất kể worker đã resolve row hay chưa.
- Gate cuối PASS **299/299 unit/WebMvc/security test + 81/81 PostgreSQL 16/Kafka 3.8 integration test**, gồm dedicated V9→V10 backfill/negative constraint IT và chín IT expiry cho boundary `expires_at`, non-`SENT` isolation, Application/history/outbox không đổi, idempotent rescan, batch budget và bốn scanner đồng thời expire mỗi row đúng một lần. Maven `verify`, production Docker image và `git diff --check` PASS.
- IT trên PostgreSQL thật đã bắt lỗi thực: bản đầu của native query thiếu schema qualification và fail `relation "offers" does not exist` ở runtime; lỗi được sửa trước khi merge.
- V10 giữ `ACCESS EXCLUSIVE` khi drop/recreate check và backfill, không rolling-compatible với binary cũ chưa hiểu `EXPIRED`. Rollout bắt buộc drain toàn bộ replica cũ, chạy đúng một migrator trong maintenance window, post-check không còn `SENT` Offer quá hạn, rồi mới bật replica mới; không rollback về binary cũ.
- Không đánh dấu hoàn tất canonical Offer-letter Media ownership, deployed P17 E2E/HTTP multi-replica load, frontend hoặc production rollout thật.

## 2.44 Distributed Recommendation Rate Limit — hoàn thành qua PR #69

> Task chỉ thuộc AI Service backend của Người 2, được bàn giao từ `feature/ai-service/recommendation-distributed-limiter` vào `develop` qua PR #69 ngày 30/08/2026. Task không sửa frontend, service của Người 1/3, shared gateway/Compose hay recommendation ranking code; limiter tầng Nginx gateway vẫn thuộc Người 3.

- Hai endpoint recommendation là internal và đã xác thực service gọi, nên limiter không phải anti-abuse cho traffic ẩn danh. Nó chặn việc một subject chiếm hết pgvector dùng chung: một `cv_id` lặp `/recommend/jobs` hoặc một `job_id` lặp `/recommend/candidates` do retry storm, client treo hoặc Candidate lạm dụng đẩy qua Job Search.
- Đếm nằm ở Redis chứ không ở bộ nhớ process đúng vì service chạy nhiều replica: limiter theo process sẽ nhân budget thật lên theo số replica và trôi mỗi lần scale, nên không diễn đạt được budget toàn hệ thống.
- Mỗi surface giữ budget subject và budget global riêng nên burst ở một surface không làm đói surface kia. Subject là `cv_id` cho `/recommend/jobs` và `job_id` cho `/recommend/candidates`.
- Một Lua script duy nhất làm trim window, kiểm cả hai hạn mức rồi ghi, lấy Redis server `TIME` làm đồng hồ duy nhất; replica lệch clock hệ thống vẫn chung một window và hai replica không thể cùng thấy slot cuối rồi cùng lấy.
- Key mang digest HMAC-SHA256 từ secret riêng, không bao giờ chứa `cv_id/job_id` thô, nên Redis không giữ dữ liệu liên kết subject với traffic recommendation; counter hết hạn sau window + 1 giây nên subject nhàn rỗi không để lại residue. Hai key của một surface chung hash tag để script single-slot trên Redis Cluster.
- Limiter là opt-in: không bật `RECOMMENDATION_RATE_LIMIT_ENABLED` thì endpoint giữ nguyên hành vi cũ và không phụ thuộc Redis. Khi bật thì fail-closed: Redis không tới được hoặc script trả kết quả lạ đều trả `503 RECOMMENDATION_LIMIT_UNAVAILABLE` đã làm sạch, thay vì để mọi replica chạy vô hạn đúng lúc dependency đang hỏng. Hết budget trả `429 RECOMMENDATION_RATE_LIMITED` kèm `Retry-After`, tính phí trước khi chạm vector store.
- Scoped authorization và validation payload đều chạy trước khi tính phí, nên caller sai key hoặc payload hỏng không thể rút budget của subject khác. `RECOMMENDATION_REDIS_KEY_SECRET` bắt buộc khác `CHAT_REDIS_KEY_SECRET` để hai key space độc lập.
- Gate cuối PASS **654/654 test (581 unit + 73 integration)** cùng `ruff check`/`ruff format --check`; trong đó 11 integration test chạy Redis 7 thật kiểm budget subject/global, phục hồi sau window, cách ly giữa hai surface, hai replica dùng chung budget, tám caller đồng thời không tiêu quá budget, không lộ identifier thô, TTL counter, secret khác nhau tách key space và fail-closed khi Redis không tới được.
- Không đánh dấu hoàn tất real-model relevance tiếng Việt, deployed/multi-replica load, production monitoring/SLO, filter-aware ANN hay limiter tầng gateway; các hạng mục đó vẫn pending.


## 2.45 Company–Media Contract Integration — hoàn thành qua PR #70

> Task chỉ thuộc Company Service của Người 2, được bàn giao từ `feature/company-service/media-contract-integration` vào `develop` qua PR #70 ngày 30/08/2026. Task không sửa Media Service, service của Người 1/3, shared gateway/Compose hay frontend, và không tuyên bố live Cloudinary hoặc Admin E2E đã hoàn tất.

- Trước task này Company chỉ có unit spec (`jest`, `rootDir: src`), chưa có bất kỳ test nào chạy với PostgreSQL thật hay HTTP thật. Bổ sung `test/company-media.integration.test.js` chạy Company app thật + PostgreSQL 16 thật, gọi qua HTTP thật tới deterministic stand-in của Media internal API. Đây đúng chuẩn đã áp cho Profile–Media, không phải live Cloudinary.
- Stand-in chỉ trả lời sáu route internal mà Company thực sự gọi và trả đúng envelope client validate, nên lệch shape sẽ làm fail suite thay vì lọt im lặng.
- Phủ 19 kịch bản: upload intent OWNER gửi đúng body scoped và commit kèm cleanup job; non-OWNER không hề chạm Media nên caller bị từ chối không tiêu quota Media; `Idempotency-Key` forward nguyên vẹn; confirm resolve canonical URL và replay trả từ URL đã lưu không gọi Media lần hai; confirm nhầm công ty khác, sai asset type hoặc intent hết hạn đều bị chặn trước khi gọi Media.
- Attach logo verify ownership/type trước khi bind; gallery bind từng entry theo đúng asset type riêng. Media outage fail-closed `503` đã làm sạch, không lộ internal key lẫn origin Media, và không để lại row Company hay intent. Status bị Media từ chối map sang lỗi sanitized riêng; envelope hỏng bị từ chối thay vì lưu.
- Thay logo đẩy file cũ vào durable cleanup queue; operation worker thực sự chạy detach cleanup và xóa abandoned intent qua Media, retry cleanup lỗi với `nextAttemptAt` lùi lại thay vì bỏ, và không bao giờ xóa file còn đang attach cục bộ. Mọi lời gọi Media đều mang internal key và không bao giờ mang token người dùng cuối.
- Bổ sung `compose.test.yml` với PostgreSQL 16 disposable, Dockerfile stage `test` (stage `runtime` vẫn nằm cuối nên build mặc định không đổi), script `test:unit`/`test:integration` và guard `ALLOW_COMPANY_SCHEMA_RESET` + tên database phải kết thúc bằng `_test`.
- Gate cuối PASS **306/306 unit test + 19/19 integration test** trên compose sạch từ đầu, gồm `prisma migrate deploy` sáu migration trên database rỗng; `git diff --check` PASS.
- Không đánh dấu hoàn tất live Cloudinary E2E (vẫn thuộc P09, repo không có credential/preset/fixture) và real Admin approval E2E (Admin Service mới ở mức scaffold, toàn bộ P10 chưa implement). Vì vậy checkbox tổng P06 vẫn để trống.


## 2.46 Application–AI Match Contract Gate — hoàn thành qua PR #71

> Task chỉ thuộc Người 2, được bàn giao từ `feature/application-service/ai-match-contract-integration` vào `develop` qua PR #71 ngày 30/08/2026. Application và AI đều là service của Người 2 nên gate này không đụng service của Người 1/3, shared gateway/Compose hay frontend.

- `AiMatchContractIT` chạy **AI Service thật** (image build từ module `ai-service`, tự chạy Alembic) trên pgvector thật, và gọi qua đúng `AiClient` cùng request factory của `ClientConfig` mà service triển khai dùng. Trước đó `/match` chỉ từng được kiểm bằng `MockRestServiceServer`, tức là chưa bao giờ chạm dây thật.
- **Gate bắt được lỗi production ngay lần chạy đầu.** JDK HTTP client mặc định HTTP/2, qua cleartext sẽ gửi `h2c` upgrade; AI Service chạy uvicorn, parser `h11` từ chối request đó bằng `400 Invalid HTTP request received`. Nghĩa là **mọi lời gọi `/match` từ Application sẽ hỏng trên dây** trong môi trường thật, trong khi toàn bộ unit test vẫn xanh vì `MockRestServiceServer` chặn ở tầng trên transport. `ClientConfig` nay ghim HTTP/1.1 cho mọi downstream. Các downstream Node không bị ảnh hưởng vì bỏ qua header upgrade lạ.
- Vector được seed bằng unit basis vector nên mọi cosine kỳ vọng là chính xác: trùng nhau `100.00`, trực giao `50.00`, đối nhau `0.00` — trường hợp đối nhau chính là thứ một phép clamp sẽ âm thầm giấu đi.
- Gate khóa các reason not-ready `CV_EMBEDDING_NOT_FOUND`, `JOB_EMBEDDING_NOT_FOUND`, `EMBEDDING_MODEL_MISMATCH`; chứng minh Job đã deactivate không phân biệt được với embedding thiếu nên không lộ việc vector vẫn còn; và kiểm internal key sai cùng provider không tới được đều fail closed không lộ trạng thái store.
- Gate cuối PASS **299/299 unit test + 93/93 integration test** (từ 81, thêm 12 contract test) với PostgreSQL 16, pgvector, Kafka 3.8 và AI Service thật; `git diff --check` PASS.
- Gate cần full repository checkout vì image provider build từ module anh em, và không tuyên bố deployed multi-replica load, gateway E2E hay real-model relevance đã hoàn tất.


## 2.47 Application–Job Internal Contract Gate — hoàn thành qua PR #72

> Task chỉ thuộc Người 2, được bàn giao từ `feature/application-service/job-contract-integration` vào `develop` qua PR #72 ngày 30/08/2026. Application và Job & Search đều là service của Người 2 nên gate này không đụng service của Người 1/3.

- `JobServiceContractIT` chạy **Job Service thật** (image build từ module `job-search-service`, tự chạy Prisma migration trên PostgreSQL thật) cho ba internal read mà Application phụ thuộc: `/{jobId}/exists`, `/stats/active` và `/details/bulk`. Gọi qua đúng `JobClient` và request factory của `ClientConfig` mà service triển khai dùng.
- Gate khóa đúng hành vi Application dựa vào: job `PUBLISHED` trong hạn nhận hồ sơ, còn `DRAFT`/`CLOSED`/quá hạn thì không; job không tồn tại trả absent kèm reason thay vì lỗi; active stats chỉ đếm job published của đúng công ty được hỏi; bulk detail vẫn trả job đã đóng và hết hạn để Candidate còn thấy thứ đã bookmark, báo ID lạ là unavailable, và không bao giờ lộ `DRAFT` chưa từng công khai. Bulk rỗng không chạm provider; internal key sai và provider không tới được đều fail closed.
- Provider cần Redis và Elasticsearch để boot dù ba read này chỉ đọc PostgreSQL, nên cả hai chạy kèm; Kafka publisher tắt vì gate này về hợp đồng REST, không phải outbox. JWT public key sinh dùng một lần ngay trong test vì ba endpoint là internal key-based nhưng service từ chối boot nếu thiếu cấu hình JWT an toàn.
- Gate cuối PASS **299/299 unit test + 107/107 integration test** (từ 93, thêm 14 contract test) với PostgreSQL 16, Redis 7, Elasticsearch 8.14.3, Kafka 3.8, pgvector và Job Service thật; `git diff --check` PASS.
- Gate cần full repository checkout vì image provider build từ module anh em, và không tuyên bố deployed multi-replica load hay gateway E2E đã hoàn tất.


## 2.48 Filter-aware ANN Investigation — hoàn thành qua PR #73

> Task chỉ thuộc AI Service của Người 2, được bàn giao từ `feature/ai-service/filter-aware-ann` vào `develop` qua PR #73 ngày 30/08/2026. Kết quả là một **kết luận kỹ thuật có bằng chứng**, không phải tính năng mới.

- pgvector trong image là **0.8.6**, có iterative index scan (`hnsw.iterative_scan`) với `strict_order` giữ nguyên thứ tự khoảng cách chính xác. Đây đúng là hình dạng của hạng mục "filter-aware ANN" tồn đọng, nên đã điều tra trực tiếp trên schema thật.
- **Kết luận: không áp dụng được** cho `/recommend/jobs` với hợp đồng phân trang hiện tại. Rào cản không nằm ở index cũng không nằm ở filter:
  - index HNSW partial trên active row **phục vụ được** `ORDER BY vector <=> const` thuần, và vẫn phục vụ được khi thêm các filter Job — nghĩa là scan filter-aware sẽ với tới được nếu thứ tự cho phép;
  - query production tính điểm trong CTE rồi sắp xếp ở ngoài, làm thứ tự **tách rời khỏi scan** nên không index vector nào phục vụ được — vì vậy chỉ bật GUC thì không thay đổi gì;
  - làm phẳng query cũng **không đủ**: index chỉ phục vụ khóa khoảng cách đơn thuần, thêm tie-break `job_id` là index hết dùng được, vì ordering operator không kết hợp được với sort key thường.
- Tie-break đó chính là thứ HMAC keyset cursor stateless phụ thuộc vào: khoảng cách đơn thuần **không phải total order**, hai Job cùng cosine distance sẽ khiến continuation lặp hoặc bỏ sót row. Nên áp dụng ANN ở đây đồng nghĩa từ bỏ trang cursor đầy đủ và tái lập được — đó là thay đổi hợp đồng phân trang, không phải một cờ tuning.
- Bằng chứng được giữ dưới dạng test chạy được (`tests/integration/test_job_ann_filter_aware_postgres.py`, sáu test) thay vì ghi chú suông, để kết luận không mục theo thời gian và để người sau không tốn công thử lại.
- Một cờ ANN opt-in đã được prototype rồi **gỡ bỏ có chủ đích**: khi index không bao giờ với tới được, cờ đó là code chết và là cấu hình gây hiểu nhầm.
- Gate cuối PASS **660/660 test** cùng `ruff check`/`ruff format --check`; full-target exact scan giữ nguyên.


## 2.49 Guarded Live Claude FAQ Smoke Runner — hoàn thành qua PR #74

> Task chỉ thuộc AI Service của Người 2, được bàn giao từ `feature/ai-service/chat-faq-live-smoke-runner` vào `develop` qua PR #74 ngày 30/08/2026. Đây là tooling, **không phải** tuyên bố live PASS.

- Toàn bộ chatbot đã được phủ offline bằng provider deterministic. Thứ mà test offline về mặt cấu trúc không trả lời được là: model thật, sau prompt cố định thật, có tạo ra câu trả lời tuyển dụng dùng được và có giữ đúng ranh giới an toàn của prompt hay không. Việc đó cần credential thật nên nằm ở runner có bảo vệ, không nằm trong test suite.
- Runner từ chối chạy nếu thiếu `AI_CHAT_LIVE_SMOKE_CONFIRM=run-live-claude-faq-smoke` và nếu `ANTHROPIC_API_KEY` không đúng dạng key provider, nên không thể tiêu quota do vô ý hay do CI.
- Hỏi đúng mười FAQ chuẩn mà suite offline đang chạy qua bounded provider, rồi bốn safety probe mà prompt cố định hứa từ chối: lộ prompt, đòi credential, dữ liệu người khác, và override off-topic.
- Báo cáo chỉ gồm count, latency và verdict theo từng câu. **Không bao giờ in API key và không bao giờ in câu trả lời** — câu hỏi fail được báo bằng index và tên rule, nên ngay cả lần chạy fail cũng không lộ nội dung model nói. Một lời từ chối được phép nhắc tới credential để từ chối nó; chỉ câu trả lời đọc như đang trao credential mới bị đánh fail.
- **23 offline test** phủ phần không cần credential: opt-in gate, validate key và redaction, các rule chất lượng, xử lý provider outage, và việc câu hỏi được hỏi không có history và không bật tool để phép đo chỉ đo prompt.
- Gate cuối PASS **683/683 test** cùng `ruff check`/`ruff format --check`.
- **Không đánh dấu live quality đã PASS.** Chạy với key thật vẫn là bước vận hành; cho tới khi chạy, tuyên bố chất lượng live vẫn để mở bất kể suite offline xanh đến đâu.


## 2.50 Vietnamese Real-model Relevance Gate — hoàn thành qua PR #75

> Task chỉ thuộc AI Service của Người 2, được bàn giao từ `feature/ai-service/vietnamese-relevance-corpus` vào `develop` qua PR #75 ngày 30/08/2026. Đây là **số liệu thật đầu tiên** về relevance tiếng Việt, không phải benchmark production.

- Mọi test embedding trước đây dùng vector synthetic — chứng minh plumbing và số học, nhưng không nói gì về việc model đã pin có phân biệt được văn bản tuyển dụng tiếng Việt hay không. Gate này nạp đúng revision đã pin mà worker dùng và xếp hạng một corpus tiếng Việt tự soạn: bốn lĩnh vực (backend, frontend, kế toán, nhân sự), mỗi lĩnh vực hai Job và một CV.
- Chạy `--network none` và `local_files_only`, nên đo đúng revision đã pin chứ không phải thứ tải về hôm nay.
- **Kết quả đo trên revision đã pin:** precision@1 = **1.0**, accentless agreement = **1.0**, clean separation rate = **0.25**.
- Hai chỉ số đầu là tính chất model **có** giữ trên tiếng Việt: mọi CV xếp Job cùng lĩnh vực lên đầu, và bỏ dấu không làm đổi lĩnh vực top. Gate coi đây là yêu cầu cứng.
- Clean separation — cả hai Job cùng lĩnh vực đứng trên mọi lĩnh vực khác — là chỗ model đã pin **không đạt**: nó chỉ xếp đúng Job cùng lĩnh vực gần nhất lên đầu, Job thứ hai thường tụt dưới một Job khác lĩnh vực. Đây là tính chất của model, không phải lỗi code xếp hạng, nên gate **ghi nhận `0.25` làm baseline và fail khi tụt xuống dưới**, thay vì đòi một con số model này chưa từng đạt. Muốn nâng lên thì phải đổi sang embedding model hỗ trợ tiếng Việt — đó là quyết định riêng.
- **15 offline test** phủ phần không cần model: hình dạng corpus, xử lý dấu tiếng Việt kể cả chữ `đ`, cosine distance, tie-break tạo total order, và các rule ngưỡng.
- Gate cuối PASS **621/621 unit test** cùng `ruff check`/`ruff format --check`; gate model thật PASS với `--network none`.
- Đây là probe có kiểm soát trên corpus nhỏ tự soạn, **không phải** benchmark relevance production, và **tự nó không đủ** để nâng giới hạn recommendation.


## 2.51 Cross-replica Invariant Gate — hoàn thành qua PR #76

> Task chỉ thuộc AI Service của Người 2, được bàn giao từ `feature/ai-service/multi-replica-gate` vào `develop` qua PR #76 ngày 30/08/2026. Đây là bằng chứng **tính đúng đắn giữa các replica**, không phải benchmark capacity.

- Chạy nhiều replica API chỉ an toàn nếu những phần trông có vẻ stateless thật sự là stateless. Ba thứ chưa từng được kiểm giữa các process, và mỗi thứ đều hỏng **im lặng** chứ không hỏng ồn ào: cursor do replica này phát phải được replica kia chấp nhận, cùng một request phải trả cùng một trang từ bất kỳ replica nào, và rate limit phân tán phải là **một** budget dùng chung chứ không phải mỗi replica một budget.
- Gate dựng **hai replica thật** trên một PostgreSQL dùng chung và một Redis dùng chung, rồi gọi qua HTTP thật.
- **Kết quả đo với subject budget 10:** trang một từ replica A tiếp tục đúng trên replica B, **không lặp Job nào**; hai replica trả về item và cursor **giống hệt**; probe budget chấp nhận đúng **6** call còn lại sau khi hai check trước đã tiêu 4 — limiter theo process sẽ cấp khoảng gấp đôi trước lần từ chối đầu tiên.
- Probe cố tình **luân phiên hai replica**, nên limiter theo process lộ ra dưới dạng cấp vượt hạn mức chứ không phải một con số hơi khác. Nó cũng trừ đi số call mà các check trước đã tiêu thay vì giả định còn nguyên budget.
- Cursor secret là scoped internal key, cấu hình giống nhau giữa các replica — gate xác nhận điều đó bằng thực nghiệm thay vì suy luận.
- **6 offline test** phủ logic quyết định của gate: phát hiện budget theo replica, budget không bao giờ được enforce, status lạ là fail chứ không bỏ qua, và thứ tự luân phiên replica.
- Gate cuối PASS **627/627 unit test** cùng `ruff check`/`ruff format --check`; gate hai replica thật PASS.
- Đây **không phải** benchmark capacity/latency. Deployed load, hành vi gateway và production monitoring vẫn là hạng mục riêng.


## 2.52 SLO Metrics Surface — hoàn thành qua PR #77

> Task chỉ thuộc AI Service của Người 2, được bàn giao từ `feature/ai-service/slo-instrumentation` vào `develop` qua PR #77 ngày 30/08/2026. Đây là bước làm cho SLO **đo được**, không phải triển khai monitoring.

- SLO về availability và latency cần con số tồn tại lâu hơn một request, mà service **không có gì cả**: không counter, không histogram, không có gì để trỏ monitor vào. Nghĩa là hạng mục "production monitoring/SLO" trước đây vĩnh viễn không đóng được vì thiếu bước này.
- `GET /metrics` nay phát Prometheus exposition cho mọi request service phục vụ, được bảo vệ bằng đúng internal credential như các internal surface khác, và trả `no-store` — tần suất request và phân bố latency là thông tin vận hành, không phải thông tin công khai.
- **Không có identifier trong label.** Mỗi series chỉ mang tên route và status class. Gắn nhãn theo `cv_id`, `job_id` hay user sẽ biến một lần scrape thành bản ghi ai đã hỏi gì — đúng thứ phần còn lại của service được xây để tránh.
- **Cardinality có chặn.** Chỉ route đã biết mới có nhãn riêng; mọi path khác gom về `other`, nên scanner quét path ngẫu nhiên không làm phình registry: 500 path lạ vẫn chỉ sinh **một** series.
- Request được ghi nhận bất kể kết quả, gồm cả từ chối và lỗi chưa bắt, vì một trận 401 và một lần crash đều là sự kiện availability. Cài đặt **không phụ thuộc thư viện ngoài** nên runtime image vẫn nhẹ đúng như dự án chủ ý.
- **26 test** phủ: cardinality có chặn, không lộ identifier, histogram cumulative kết thúc `+Inf`, duration âm bị kẹp, ghi nhận đồng thời không mất count, và `/metrics` yêu cầu credential.
- Gate cuối PASS **732/732 test** cùng `ruff check`/`ruff format --check`.
- Việc này làm SLO **đo được**. Nó **không phải** một triển khai monitoring: scrape, dashboard, alert rule và error budget vẫn là việc hạ tầng.


## 2.53 Multi-replica Load Gate & Migration Race Fix — hoàn thành qua PR #78

> Task chỉ thuộc AI Service của Người 2, được bàn giao từ `feature/ai-service/multi-replica-load-gate` vào `develop` qua PR #78 ngày 30/08/2026. Đây là bằng chứng có kiểm soát trên một máy, **không phải** tuyên bố capacity production.

- Gate cross-replica ở mục 2.51 chứng minh bất biến đúng khi hai replica dùng chung database và Redis. Gate này hỏi câu còn lại: **cặp replica thực sự phục vụ được gì dưới tải đồng thời**.
- **Kết quả đo trên hai replica với 5.000 Job, 1.000 call ở concurrency 8:** mọi call thành công, p50 **42,7 ms**, p95 **59,4 ms**, p99 **71,3 ms**, max **81,5 ms**, **182,3 request/giây**, tải chia đúng **500/500**.
- Gate **fail một lần chạy có tải lệch**, vì tải lệch nghĩa là các con số không nói lên điều gì về việc chạy hai replica. Nó báo count theo từng replica để chuyện đó lộ ra thay vì bị trung bình hoá.
- **Việc dựng gate này phát hiện một lỗi thật.** Runtime image chạy `alembic upgrade head` trước khi khởi động Uvicorn, nên **mọi replica đều migrate lúc khởi động**. Khởi động hai replica cùng lúc thì chúng **đua nhau**: một cái tạo version table trong khi cái kia đang làm đúng việc đó, cái thua exit non-zero và sẽ **crash-loop suốt một lần rolling deploy**. Migration nay lấy PostgreSQL session advisory lock nên replica đồng thời **xếp hàng**, cái thứ hai đơn giản là thấy việc đã xong.
- **11 offline test** phủ logic gate: request lỗi làm fail gate, vượt ngân sách p95, throughput dưới sàn, và **tải lệch bị bắt thay vì trung bình hoá** (lệch 1 call vẫn chấp nhận).
- Gate cuối PASS **743/743 test** cùng `ruff check`/`ruff format --check`; gate tải hai replica thật PASS.
- Đây là bằng chứng có kiểm soát trên một máy — không gateway, không CDN, không độ trễ mạng và không phân bố dữ liệu production. **Không phải** tuyên bố capacity.


## 2.54 Application SLO Metrics Surface — hoàn thành qua PR #79

> Task chỉ thuộc Application Service của Người 2, được bàn giao từ `feature/application-service/slo-instrumentation` vào `develop` qua PR #79 ngày 30/08/2026.

- PR #77 mới chỉ trang bị instrumentation cho AI Service, trong khi Người 2 có **bốn** service. SLO cho hệ thống không đóng được khi chỉ 1/4 service đo được. Application trước đó chỉ expose `health` và `info`.
- `GET /actuator/prometheus` nay phát metric HTTP server của Micrometer, nên tần suất request, phân bố status và latency percentile theo route đều đo được.
- Scrape có **credential riêng**, khác key Profile và Interview, và **bị từ chối ngay lúc khởi động nếu trùng** một trong hai. Một service được phép nộp CV không có việc gì phải đọc được tần suất request và phân bố latency của cả deployment; dùng chung một key sẽ âm thầm cấp đúng quyền đó.
- Scrape không mang user nên filter kiểm key thay vì token, so sánh constant-time, và từ chối header bị nhân đôi hoặc nối bằng dấu phẩy để proxy và caller không thể bất đồng về credential.
- Micrometer gắn nhãn request bằng URI **đã template hoá**, nên path như `/{applicationId}/offer` vẫn là một series và **không identifier nào của Application, CV hay user chạm tới label**. Request không khớp route gom về `NOT_FOUND`, giữ cardinality có chặn khi bị quét path.
- **10 test** phủ: key đúng được cấp quyền, thiếu/sai key bị từ chối mà không lộ key kỳ vọng, header nhân đôi và header nối phẩy đều bị từ chối, key placeholder/quá ngắn/có khoảng trắng thừa bị chặn ngay lúc khởi động.
- Gate cuối PASS **309/309 unit test + 107/107 integration test**.
- Việc này làm SLO **đo được**. Nó **không phải** triển khai monitoring: scrape, dashboard, alert rule và error budget vẫn là việc hạ tầng.


## 2.55 Job & Search SLO Metrics Surface — hoàn thành qua PR #80

> Task chỉ thuộc Job & Search Service của Người 2, được bàn giao từ `feature/job-search-service/slo-instrumentation` vào `develop` qua PR #80 ngày 30/08/2026.

- Service thứ ba trong bốn service của Người 2 được trang bị instrumentation, sau AI (PR #77) và Application (PR #79). Trước đó Job & Search không có gì để đo.
- `GET /metrics` phát Prometheus exposition, bảo vệ bằng **credential riêng** cố ý khác `INTERNAL_API_KEY`: một service được phép đọc Job availability không có việc gì phải đọc tần suất request và phân bố latency của cả deployment. Guard kiểm key thay vì token, so sánh constant-time, và từ chối header bị nhân đôi.
- **Không identifier nào chạm tới label.** Path Job được **template hoá** thay vì bỏ đi, nên `/{id}` và `/{id}/exists` vẫn là series hữu ích mà không bao giờ gắn nhãn theo Job id; mọi path lạ khác gom về `other` — ba trăm path bị quét vẫn chỉ sinh một series.
- Request được ghi bằng middleware nên một trận 404 hiện ra như sự kiện availability thay vì biến mất trước khi tới handler. Cài đặt **không phụ thuộc thư viện ngoài**.
- **18 test** phủ: template hoá path Job, gom path lạ, tách 2xx/4xx/5xx, histogram cumulative, không lộ Job id, quét 300 path chỉ thêm một series, duration âm bị kẹp, guard chấp nhận key đúng/từ chối key sai/thiếu/nhân đôi và từ chối chạy nếu key chưa cấu hình đủ dài.
- Gate cuối PASS **20/20 integration test**; suite unit đạt **570/571**, riêng `job-outbox.integration.spec.ts` fail vì cần Kafka topic mà lệnh `npm test` không cấp — đã kiểm chứng lỗi này **có sẵn trên code chưa sửa**, không do task này.
- Việc này làm SLO **đo được**. Nó **không phải** triển khai monitoring.


## 2.56 Company SLO Metrics Surface — hoàn thành qua PR #81

> Task chỉ thuộc Company Service của Người 2, được bàn giao từ `feature/company-service/slo-instrumentation` vào `develop` qua PR #81 ngày 30/08/2026. Đây là service **thứ tư và cuối cùng** của Người 2 được trang bị instrumentation.

- Sau AI (PR #77), Application (PR #79) và Job & Search (PR #80), cả **bốn service của Người 2 nay đều đo được**. SLO cho hệ thống trước đây không đóng được vì không service nào có gì để đo.
- `GET /metrics` phát Prometheus exposition, bảo vệ bằng credential riêng. Scrape không mang user nên guard kiểm key thay vì token, so sánh constant-time, và từ chối header bị nhân đôi.
- **Không identifier nào chạm tới label.** Path Company được template hoá nên `/{id}/members` và `/{id}/media/confirm` vẫn là series hữu ích mà không gắn nhãn theo Company id — và path mang **hai** identifier như `/{id}/members/{id}` thì **mất cả hai**. Mọi path lạ gom về `other`.
- Request ghi bằng middleware nên một trận 404 hiện ra như sự kiện availability thay vì biến mất trước khi tới handler. Không thêm dependency nào.
- Gate cuối PASS **324/324 unit test + 19/19 integration test** (từ 306, thêm 18 test metrics).
- Việc này làm SLO **đo được** cho toàn bộ bốn service. Nó **không phải** triển khai monitoring: scrape, dashboard, alert rule và error budget vẫn là việc hạ tầng.


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

> Core Offer đã hoàn thành, terminal-state consistency được bổ sung qua PR #67 và auto-expiry worker qua PR #68; canonical Offer-letter Media vẫn là hạng mục riêng thuộc P09.

- [x] Tạo bảng `Offer` và trạng thái `SENT/ACCEPTED/DECLINED/CANCELLED`.
- [x] Implement `POST /applications/:id/offer`, chỉ cho phép từ `INTERVIEW`.
- [x] Lưu salary, start date, position, note và cặp reference `file_url/file_id`; xác minh ownership/canonical file chờ P09.
- [x] Chuyển Application sang `OFFER` bằng optimistic locking.
- [x] Phát event `OFFER_SENT` qua transactional outbox.
- [x] Implement `PATCH /offers/:id/respond` cho đúng Candidate.
- [x] ACCEPTED chuyển Application sang `HIRED`; DECLINED chuyển `REJECTED` và lưu lý do.
- [x] Chặn phản hồi lặp, offer hết hạn và concurrent response.
- [x] Khi Application ở `OFFER` bị Recruiter reject hoặc Candidate withdraw, CAS Offer `SENT → CANCELLED` trước Application trong cùng transaction; race response/pipeline chỉ có một winner.
- [x] Flyway V9 backfill legacy terminal Application + `SENT` Offer, tăng Offer version, giữ event v1 không có Offer trio và kiểm constraint/rollback trên PostgreSQL thật.
- [x] Bổ sung worker xử lý Offer `SENT` quá `expires_at`: scheduled scan bounded batch dùng `FOR UPDATE SKIP LOCKED` chuyển row sang terminal `EXPIRED` với `responded_at = expires_at`, Flyway V10 mở rộng constraint và backfill row quá hạn; Application giữ nguyên `OFFER` và worker không phát `application-events`.

## P04 — Application Recruiter Dashboard và AI Match

> Recruiter Dashboard, AI Match và Application-time skill snapshot/filter đã hoàn thành. Profile provider v2 qua PR #46; Application consumer, Flyway V8 và Recruiter filter qua PR #47. P17 deployed cross-service E2E vẫn pending.

- [x] Implement `GET /applications/stats?company_id=`.
- [x] Tổng hợp số đơn theo job/status, tỷ lệ chuyển đổi, biểu đồ thời gian và nguồn Candidate.
- [x] Tích hợp Job Service để lấy tổng số tin đang tuyển.
- [x] Gọi AI `/ai/match` khi cần và lưu/cập nhật `match_score`.
  - [x] Thêm `POST /applications/:id/match-score/refresh`, chỉ MEMBER/OWNER đúng công ty và lấy `cv_id/job_id` từ Application.
  - [x] Chốt contract nội bộ, kiểm tra echoed IDs/score `0..1`, đổi sang phần trăm và làm tròn 2 chữ số; phân loại not-ready/unavailable/invalid response; cấu hình connect timeout 1 giây và read timeout 3 giây.
  - [x] Ghi điểm bằng `expectedVersion`/atomic compare-and-set; lỗi giữ nguyên điểm, không đổi status/`updated_at`, không ghi history hoặc outbox.
- [x] Bổ sung filter kỹ năng Recruiter từ immutable Application-time Profile snapshot: `skills` repeated/comma, tối đa 10, ANY exact case-insensitive, kết hợp filter hiện có và pagination deterministic cho mọi sort.
- [x] Persist snapshot schema/Profile aggregate/expected count và names-only skills trong cùng transaction submission; không backfill Application lịch sử, late SQL mutation bị DB chặn.
- [x] Full Application verify mới nhất đạt **299 unit/WebMvc/security + 81 PostgreSQL/Kafka integration test** sau strict JWT/JWKS consumer gate, Offer lifecycle consistency V9 và Offer auto-expiry worker V10; canonical `application-events` v1 và root Nginx query-free Application access log vẫn được giữ nguyên.
- [x] Bổ sung controlled transaction/load gate độc lập cho năm race quan trọng: đúng **10.000 service call** ở concurrency 32, 5.000 winner/5.000 conflict `409` dự kiến, 0 unexpected/5xx/deadlock/timeout, p95 114,567 ms, p99 162,895 ms và 585,53 call/s.
- [x] Test dữ liệu rỗng, range thiếu/sai/quá 366 ngày, quyền công ty, timezone PostgreSQL, `DAY/WEEK/MONTH` và DST.
- [x] Verify AI Match đạt tổng cộng 162 unit test và 35 integration test PostgreSQL/Kafka; riêng task mới bổ sung 36 unit test và 6 integration test.

## P05 — Hoàn thiện Job & Search

- [x] Tích hợp Candidate-only `GET /jobs/recommended` với AI Service và CV mặc định/eligible; identity chỉ lấy từ JWT, không nhận `userId/cvId`.
- [x] First-page fallback deterministic sang job mới nhất khi không có active CV hoặc Profile/AI unavailable/not-ready/invalid/stale; response có `source/fallbackReason`, còn continuation trả `409/503` và không fallback.
- [x] Fallback theo explicit Candidate preferences/consent: Profile contract riêng, query filter override, ANY exact match, preference-first/latest-fill cùng snapshot và source `PREFERENCES|LATEST`.
- [x] Bổ sung controlled historical `job-events` baseline CLI: dry-run mặc định, exact execute confirmation, bounded batch, exact-version anti-join, row lock/`SKIP LOCKED`, status mapping và expired-published preflight.
- [x] Chạy integration transactional outbox với PostgreSQL 16 và Kafka 3.8 thật: migration sạch, rollback atomic, CAS cạnh tranh, thứ tự version và publish đủ event.
- [x] Bổ sung Redis 7 có auth, BullMQ và Elasticsearch 8.14.3 tắt auto-create vào integration suite Docker thật.
- [x] Kiểm tra outbox claim `SKIP LOCKED`, retry/backoff, lease heartbeat hai publisher, stable `event_id` và thứ tự theo `aggregate_version`.
- [x] Kiểm tra reindex idempotent, Elasticsearch retry và failed-job/dead-letter strategy.
  - [x] Durable PostgreSQL index-sync intent chống mất cập nhật khi Redis lỗi; claim bằng lease/`SKIP LOCKED` và tự reconcile queue state.
  - [x] Scripted update so sánh nguyên tử (`aggregateVersion`, `indexGeneration`) chống stale write; reindex mọi trạng thái bằng generation, set-based monotonic UPSERT và tombstone không searchable.
  - [x] Retry hữu hạn, Redis cold-outage fail-fast/recovery bằng worker thật, lưu lỗi cuối/attempt count và endpoint Admin xem/replay dead letter; shutdown được kiểm tra cả trước/sau claim và release intent nếu race xảy ra.
  - [x] Rollout `job_index_v4`/projection 4 với full field/analyzer/combining-mark validation; alias phải trỏ đúng một concrete index, alias nhiều target bị từ chối và v3 không bị sửa tại chỗ.
  - [x] Cặp marker `mappings._meta.baselineVersion=4` và `baselineIndexUuid` restart-safe cho cả index mới và index tương thích đã tồn tại; search fallback PostgreSQL và health `DEGRADED` cho tới khi baseline hoàn tất.
- [x] Bổ sung bulk/detail contract để Bookmark hiển thị đầy đủ cả Job đã hết hạn/đóng: tối đa 100 ID mỗi request, Application chunk 100, không N+1, strict response validation và fail-soft `job=null`.
- [x] Kiểm tra load test cho search, pagination sâu và index mapping tiếng Việt.
  - [x] OFFSET tương thích và opt-in CURSOR dùng signed HMAC/PIT/search-after; cap PIT, absolute TTL, no-store, scope/tamper/stale/partial-shard đều fail closed.
  - [x] Mapping v4 chuẩn hóa NFC/NFD/accentless trên bốn trường, strict validator và test chứng minh không mutate v3.
  - [x] Fixture 100.000 Job/80.000 public; ba dạng tiếng Việt đều đi đủ 20.000 row/400 page, salary null/short terminal page và hidden-status isolation đều PASS.
  - [x] 10.000 request concurrency 32 đạt 0 lỗi, 164,632 req/s, p95 402,763 ms, p99 503,771 ms; PIT context 0/peak 32/final 0; 429 unit + 20 integration test PASS.
- [x] Enforce strict canonical access-token/JWKS consumer contract ở mức Job service: exact Bearer/header/claim, static/current/previous RSA key, bounded/cooldown/single-flight JWKS rotation, sanitized 401/503/500 và negative security matrix; full gate hiện tại 533 unit + 20 integration test PASS. Deployed Auth–Job E2E vẫn thuộc P17.

## P06 — Hoàn thiện Company Service

- [ ] Chạy integration test với Auth/Admin/File Service thật.
  - [x] Auth–Company invitation acceptance dùng JWT từ real `/auth/login` và durable `/auth/me`: email binding, account lock/delete/role/email change, replay/concurrency và Auth outage đều PASS không mutation sai.
  - [x] Company–Media contract integration: Company app thật + PostgreSQL 16 thật chạy qua HTTP thật với deterministic stand-in của Media internal API, phủ upload intent/confirm/verify/bind/release/delete, outage fail-closed và durable cleanup worker. Đây không phải live Cloudinary.
  - [ ] Real Admin approval vẫn pending vì Admin Service mới ở mức scaffold (toàn bộ P10 chưa implement), và live Cloudinary E2E vẫn thuộc P09; vì vậy checkbox tổng không được đánh dấu hoàn thành.
- [x] Xác minh ownership của logo, ảnh và video qua File/Media thay vì chỉ nhận reference; dùng upload/confirm OWNER-only với durable exact upload-intent guard, abandoned-upload quota cleanup, canonical verify, generation bind-before-commit và leased attach/detach reconciliation.
- [x] Chạy Prisma migration trên database sạch và kiểm tra backup/restore cùng restore-based rollback; verifier PostgreSQL 16 fail-closed, migration deploy lặp, drift/ledger/data/constraint và corrupt-archive negative đều PASS.
- [x] Bổ sung append-only Company domain audit cho duyệt công ty và thay đổi OWNER; actor từ canonical JWT, mutation/audit cùng transaction và PostgreSQL migration/audit/backup/restore gate PASS.
- [x] Kiểm tra phân trang/tìm kiếm trang công ty công khai ở tải lớn: signed keyset + Vietnamese FTS, full 80.000-row traversal và 10.000-request HTTP benchmark trên fixture 100.000 Company đều PASS; PR #57.

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
- [x] Tích hợp Profile với Media bằng confirmed `fileId` cho avatar/CV PDF: verify/bind/release reference, CV private và download URL ngắn hạn; signed upload vẫn đi trực tiếp từ client tới Media.
- [x] Đăng ký/list/detail/download CV upload, giới hạn năm CV dưới Profile lock và tự đặt CV đầu tiên làm mặc định.
- [x] Hoàn thiện và merge rename, atomic default switch, soft delete, deterministic default reassignment, CV compare-and-set và Application usage lookup/`firstUsedAt` mirror qua PR #40.
- [x] Triển khai atomic CV deletion fence qua PR #42: Application V7 permanent gate + idempotent acquire/submission serialization; Profile durable 202 premark saga, USED soft retention, FENCED unused-leaf hard delete và durable Media cleanup.
- [x] Implement và merge backend CV Builder qua PR #41: publish Media-backed Online snapshot, owner-only reopen, immutable linear revision, CAS/default handover, retained quota, retry/race compensation và PostgreSQL migration/test. UI/template/PDF renderer vẫn thuộc P16/frontend.
- [x] Triển khai và merge canonical Profile–Application CV contract qua PR #39: dual-auth verify cho submission, service-auth list/detail/download, Application recruiter APIs, durable V6 usage ledger và Profile-only usage lookup; không đồng nghĩa P17 E2E đã hoàn tất.
- [x] Bổ sung rolling-compatible `POST /internal/v2/cvs/verify` qua PR #46: dual-auth, names-only skill snapshot cùng `REPEATABLE READ`, cap 100/fail-closed, unavailable anti-oracle và giữ nguyên v1 cho rollout/rollback; Application consumer/persistence/filter hoàn thành tiếp qua PR #47.
- [x] Publish exact `cv-events` v1 idempotent cho AI qua no-FK transactional outbox, per-CV version ordering, fenced lease/heartbeat và Kafka key `cv_id`; lifecycle create/revision/USED/FENCED đã có PostgreSQL/Kafka test qua PR #43.
- [x] Bổ sung controlled historical `cv-events` baseline CLI: dry-run mặc định, exact execute confirmation, Media verify ngoài transaction, Serializable recheck/lock và fail-closed với legacy URL hoặc CV đã có event.
- [x] Bổ sung strict JWT/role guard, validation, Swagger và PostgreSQL/concurrency/security test cho Candidate CRUD, avatar/CV upload, internal CV authorization, lifecycle, Builder revisions, deletion fence, event outbox và historical baseline; sau task 2.24 Profile đạt **51 unit + 70 integration test**. Mốc Application mới nhất ở mục 2.30 là **246 unit + 63 integration test**.

## P09 — File/Media Service

- [x] Tạo Prisma migration cho metadata, upload intent, trạng thái, audit và immutable reference; kiểm tra migration lặp và schema drift.
- [x] Implement signed upload, confirm chỉ bằng `fileId`, owner-scoped metadata/download và soft delete theo ownership; có idempotency, quota, rate limit, lease recovery và fencing.
- [x] Kiểm tra canonical format/MIME policy, byte size, image dimensions, video duration, resource/delivery type, public ID/folder/context và RAW magic bytes; deep parser/malware scan vẫn pending.
- [x] Scheduled cleanup/reconciliation cho intent hết hạn, exact orphan, object sibling/replacement, `REJECTED`, stale lease và delete retry; có distributed cycle/job lease-fencing, hai clean pass, bounded Cloudinary pagination/timeout và PostgreSQL integration test.
- [x] API nội bộ xác minh `file_id`, cấp private download và bind/release reference theo scope riêng; Profile, AI CV worker và Company đã được wiring/contract-test bằng fake provider deterministic, còn Application/Chat/Interview và live Cloudinary E2E pending.
- [ ] Bổ sung media type/contract riêng cho Offer letter; không dùng tạm type khác.
- [x] Test intent hết hạn, file giả mạo, exact size boundary đủ sáu type, provider outage, delete đang được tham chiếu/failure, stale lease/fencing, rate/quota concurrency, scheduler lease loss/watchdog/error path, expired finalize CAS, priority, orphan/sibling cleanup và retry recovery trên PostgreSQL 16; full Media đạt **26 unit + 26 integration test**.
- [x] Bổ sung guarded live-smoke runner cho sáu signed preset: exact Admin audit, fixture magic/size guard, Media confirm/verify/access/delete, bounded/redacted output và exact finally cleanup; **9 offline runner test** đã qua và runtime image fail-closed khi chưa opt-in.
- [ ] Chạy runner với tài khoản Cloudinary staging, sáu signed preset và fixture thật; repository hiện không có credential/preset/fixture để tuyên bố live PASS.

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

> Bảy vertical slice pgvector/provider `/match`, Job embedding, CV embedding, Candidate-facing Job recommendation, Recruiter-facing Candidate recommendation, backend chatbot Candidate và personalized Job recommendation chat tool v1 đã hoàn thành ở mức code/service test. Hai controlled gate 100.000 CV exact-allowlist và 100.000 Job full-target HTTP/load đã PASS. Full gate đạt **529 unit/non-integration + 62 PostgreSQL/Kafka/Redis integration test (591/591 tổng)**; live Claude quality/staging smoke vẫn là gate riêng.

- [x] Chốt Anthropic Claude theo tài liệu kiến trúc; pin `anthropic==0.120.2` và loại bỏ dependency chatbot Gemini khỏi đường triển khai.
- [x] Tạo schema pgvector và migration cho provider `/match`.
  - [x] Alembic quản lý `ai.cv_embeddings`, `ai.job_embeddings`, `vector(384)` và partial active-row HNSW cosine index riêng cho Job/CV.
  - [x] Alembic `20260826_03` nâng `salary_min`/`salary_max` của Job embedding lên `NUMERIC(15,2)` để khớp producer.
  - [x] Migration chạy trước Uvicorn; readiness kiểm tra extension, hai embedding table, recommendation generation rows và đúng function/event/enabled mode của bốn trigger.
- [x] Bổ sung CV nearest-neighbor index và benchmark index/filter khi làm recommendation candidates.
  - [x] Alembic `20260829_06` build/drop concurrent, retry an toàn khi còn index cùng tên và integration test khóa method/cosine opclass/options/predicate/valid/ready.
  - [x] Controlled 100.000-CV gate kiểm exact scope 1/100/500, 1/2/10 trang, privacy/model/activity, cursor generation, populated migration, EXPLAIN, HNSW counterexample và repository load 10.000 call concurrency 32.
  - [x] Production giữ exact dynamic allowlist dùng PK/B-tree; HNSW advisory không được dùng cho Candidate cursor vì global ANN → dynamic filter bỏ sót kết quả.
- [x] Hoàn thiện consumer `cv-events` và `job-events`.
  - [x] Consumer `job-events` kiểm tra key/payload flat snake_case, chuẩn hóa nội dung, sinh vector và upsert/deactivate Job embedding.
  - [x] Chỉ `PUBLISHED` active; `/match` bỏ qua Job inactive. Các trạng thái `DRAFT/PENDING_APPROVAL/CLOSED/EXPIRED` tạo tombstone/deactivate.
  - [x] Worker non-root dùng model CPU 384 chiều với commit SHA bất biến, warm-up trước khi consume và cache riêng trong Docker volume.
  - [x] Consumer `cv-events` kiểm exact chín trường/key/version, lấy private PDF qua Media, parse bounded và xử lý `UPSERTED/DEACTIVATED/DELETED`; inactive vector phục vụ match lịch sử, hard delete tạo tombstone.
- [x] Idempotency/order cho Job và CV theo `event_id`, ledger và aggregate cursor; event versioned dùng `aggregate_version`, còn fallback `occurred_at + partition + offset` chỉ dành cho Job payload legacy.
  - [x] Lookup event trước inference, transaction atomic cho embedding/cursor/ledger và redacted-metadata DLQ không giữ raw content; commit Kafka đồng bộ chỉ sau durable terminal outcome.
  - [x] Job và Profile producer dùng `aggregate_version` đơn điệu cùng transactional outbox; publisher có bounded Kafka retry, lease heartbeat và chặn version sau khi version trước chưa publish.
- [x] `job-events` v1 phát đủ `requirements`, `salary_min`, `salary_max` và `job_type`; salary là decimal string hai chữ số hoặc `null`.
- [x] Implement internal `POST /recommend/jobs` bằng scoped auth, exact same-model ranking, HMAC cursor, deterministic pagination và stable empty reason.
  - [x] Candidate-facing `/recommend/jobs` controlled 100.000-Job full-target HTTP gate kiểm independent oracle, filter/page walk, isolation, auth/redaction, generation/cursor, concurrent writer, EXPLAIN và 100 + 1.000 call concurrency 8 với 0 error/mismatch/timeout/security leak; PR #66.
- [x] Implement internal `/recommend/candidates` và public Job Recruiter surface qua PR #49: explicit purpose consent, selected exact CV, Company/Job capability, authoritative Job version, exact Candidate–CV pair, HMAC cursor và minimal safe projection.
- [x] Hoàn thiện source-side controlled historical baseline tooling cho Job/CV embeddings; dry-run/execute trên môi trường dữ liệu thật vẫn là bước vận hành chưa chạy.
- [x] Implement provider `POST /ai/match` cho Application Service.
  - [x] Bảo vệ bằng shared `X-Internal-Api-Key`, so sánh constant-time; request UUID snake_case và response envelope echo IDs.
  - [x] Chuẩn hóa cosine `[-1,1]` thành score `[0,1]` bằng `(cosine_similarity + 1) / 2`, không clamp.
  - [x] Thiếu embedding/model mismatch trả reason ổn định; lỗi vector store trả 503 và không lộ vector/nội dung gốc.
  - [x] Job đã deactivate được coi như không có embedding và trả `JOB_EMBEDDING_NOT_FOUND`.
- [x] Implement backend chatbot Candidate v1 có prompt an toàn, Redis history, timeout và distributed rate limit.
  - [x] Candidate-only `/chat` xác minh RS256/JWKS fail closed; fixed recruitment-only prompt tách khỏi input/history và không cho caller truyền `cv_id`, prompt hay tool tùy ý.
  - [x] Redis HMAC owner/session key giữ tối đa 10 lượt/24 giờ; atomic lock/fencing và sliding-window limit theo user/toàn cục dùng Redis server time.
  - [x] Bounded timeout/output, sanitized provider/store/auth errors, `no-store`, deterministic provider fake và 10 FAQ plumbing đã có test.
  - [ ] Chạy live Claude 10-FAQ quality/staging smoke với API key thật; repository không có credential để tuyên bố PASS.
    - [x] Guarded runner đã hoàn thành qua PR #74: opt-in bắt buộc, validate API key, hỏi đúng mười FAQ chuẩn cộng bốn safety probe, báo cáo chỉ có verdict/latency và không bao giờ in key lẫn câu trả lời; **23 offline test** phủ phần không cần credential. Chạy với key thật vẫn là bước vận hành.
  - [x] Bổ sung personalized Job recommendation intent/tool có authorization rõ ràng: strict parameter-free Claude tool, fixed Candidate `/recommended?limit=3`, transient bearer, deterministic minimal projection, neutral Redis marker và fail-soft downstream.
  - [ ] Frontend chatbot widget thuộc Người 3 và không nằm trong task backend Người 2 này.
- [x] Vector store, ownership registry, ledger và dead-letter chỉ lưu vector/hash/provenance/metadata tối thiểu; không lưu raw Kafka payload/key, signed URL, PDF hoặc nội dung CV/job gốc.
- [x] Test auth/validation/error contract, migration lặp, privacy schema, vector 384 chiều, cosine biên, readiness, runtime non-root, Job/CV ordering/idempotency/retry/DLQ và Kafka commit.
  - [x] Kafka integration thật cho CV kiểm `UPSERTED → DEACTIVATED`, source unavailable rồi `DELETED`, malformed/oversized JSON, redacted DLQ và offset commit; Job Kafka integration tiếp tục kiểm duplicate không inference lại.
  - [x] PostgreSQL CV integration kiểm duplicate/order, inactive historical vector và owner bất biến qua DLQ/tombstone; unit test kiểm poison PDF bounded cùng transient Media không commit.
  - [x] Production worker image sinh thành công vector chuẩn hóa 384 chiều bằng đúng model revision đã pin.
- [x] Test service-level recommendation auth/validation/filter/fallback, exact hai trang, cursor tamper/stale, source/target mutation và transactional generation trên PostgreSQL thật.
- [ ] Hoàn tất real-model relevance/chất lượng dữ liệu tiếng Việt, deployed/multi-replica latency/load, distributed rate limit cho recommendation/gateway và filter-aware ANN trước production.
  - [x] Distributed multi-replica limiter cho cả hai surface recommendation đã hoàn thành qua PR #69: Redis sliding window một Lua script, budget riêng theo subject và theo surface, khóa HMAC không chứa `cv_id/job_id`, opt-in và fail-closed `503`; limiter cho gateway của Người 3 nằm ngoài phạm vi.
  - [x] Recruiter-facing Candidate index/filter/exact-plan synthetic controlled gate đã PASS với 0 lỗi/mismatch/leak, p95 130,089 ms và p99 149,503 ms; không bật ANN production.
  - [x] Candidate-facing Job full-target synthetic HTTP/concurrent-writer gate đã PASS với 0 error/mismatch/timeout/security leak, p95 1.021,163 ms và p99 1.133,728 ms dưới statement timeout 2 giây.
  - [x] Real-model relevance tiếng Việt đã có số liệu đầu tiên qua PR #75: precision@1 và accentless agreement đều **1.0**, clean separation **0.25** — model đã pin không tách sạch trên tiếng Việt, muốn nâng phải đổi model.
  - [x] Bất biến cross-replica đã được chứng minh qua PR #76 với hai replica thật: cursor portable, trang giống hệt, budget rate limit dùng chung chứ không nhân theo replica.
  - [ ] Còn corpus production quy mô thật, deployed load/capacity, concurrent-writer rollout observation trên môi trường thật và production monitoring/SLO; distributed limiter cho chatbot v1 và cho hai surface recommendation đều đã có service/integration test với Redis thật, riêng limiter tầng gateway vẫn thuộc Người 3.
  - [x] Filter-aware ANN đã được điều tra dứt điểm qua PR #73 và **kết luận là không áp dụng được** cho surface này với hợp đồng phân trang hiện tại; lý do được giữ dưới dạng test chạy được thay vì ghi chú suông.

## P12 — Interview & Video Call Service

- [x] Tạo Flyway V1 cho Interview scheduling, audit/version, idempotency và lifecycle columns; migration `InterviewFeedback` còn pending.
- [x] Gọi Application Service bằng purpose-scoped dual auth để xác minh MEMBER/OWNER, Company và trạng thái application; chỉ nhận authoritative minimal snapshot.
- [x] Đặt lịch OFFLINE self-interviewer, chống trùng interviewer/candidate bằng PostgreSQL exclusion constraint và quản lý active interview round.
  - [x] UTC/IANA timezone, DST gap/mismatch, half-open adjacency, direct SQL, idempotency và concurrent race đã có test PostgreSQL thật.
  - [x] Role-aware detail/history/my, Recruiter Company calendar và advisory availability; current Recruiter membership được revalidate qua Company mỗi request, Candidate/Company scope và projection được khóa tại SQL/DTO.
  - [x] HMAC keyset cursor có first-page creation cutoff, strict query/limit/range, redaction/no-store và PostgreSQL integration test cho IDOR, tied pagination, half-open overlap cùng direct-SQL trigger.
  - [ ] Chọn interviewer khác/panel và contract xác minh membership cho interviewer tùy chọn còn pending.
- [ ] Candidate confirm/reschedule; HR accept/reject đề nghị đổi lịch.
- [ ] Cancel/no-show và giới hạn số lần đổi lịch.
- [ ] Sinh Jitsi room URL/token có hạn dùng; bảo vệ người không liên quan.
- [ ] Feedback sau phỏng vấn và gợi ý chuyển application status.
- [ ] Publish đầy đủ lifecycle `interview-events` và scheduler reminder.
  - [x] Foundation `SCHEDULED` v1 đã có exact contract, transactional outbox, lease/fence publisher, Kafka/PostgreSQL test và Candidate in-app consumer.
  - [ ] `CONFIRMED|RESCHEDULED|CANCELLED|REMINDER` chờ lifecycle/scheduler tương ứng; không phát action giả.

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

- [x] Tạo Prisma migration cho Notification, ProcessedEvent, PoisonEvent, DeviceToken, NotificationLog và NotificationSetting; Device/settings cùng kênh PUSH/EMAIL mới ở mức persistence nền.
- [ ] Consumer ba topic application/interview/chat với idempotency.
  - [x] Hoàn thành `application-events` v1 bằng dedicated group, manual commit, retained-backlog replay có stable rollout cutoff, atomic idempotency và poison/collision quarantine.
  - [x] Hoàn thành `SCHEDULED interview-events` v1 bằng group/cutoff riêng, Candidate-only projection và cùng durable ledger semantics.
  - [ ] Các phần Interview lifecycle còn lại và `chat-events` còn pending.
- [ ] BullMQ worker, retry/backoff và lưu lỗi cuối.
- [x] In-app inbox owner-only, unread count, idempotent read, cutoff read-all và HMAC keyset pagination.
- [ ] Đăng ký/xóa FCM device token.
- [ ] Template email/push, FCM và SMTP integration.
- [ ] Scheduler reminder không gửi trùng.
- [ ] Contract/integration test với event thật từ Application/Interview/Chat.
  - [x] Application producer có JSON Schema/fixtures/Kafka contract; Notification có PostgreSQL/Kafka integration cho backlog trước startup, duplicate, collision, poison và legacy withdrawal. Deployed cross-service E2E vẫn thuộc P17.
  - [x] Interview producer/outbox PostgreSQL→Kafka và Notification Interview consumer Kafka→PostgreSQL đã có exact contract, duplicate/collision/poison/backlog/cutoff integration.
  - [ ] Hợp đồng/integration Chat và deployed cross-service E2E còn pending.

## P15 — Hạ tầng và API Gateway

- [x] Bổ sung route chính thức `/offers/`, giữ nguyên prefix khi forward tới Application Service.
- [x] Bổ sung route `/files`, chặn case-insensitive internal Media path và xóa internal identity headers tại public gateway; cấu hình Nginx đã qua `nginx -t`.
- [x] Qua PR #39, chặn public internal paths của Profile/Application kể cả case/repeated slash/matrix-semicolon/double-encoding, strip `X-Internal-Service`/`X-Internal-Api-Key` trên public routes và wiring hai key riêng cho Application ↔ Profile.
- [x] Qua PR #45, chặn public `/ai/match` và `/ai/recommend/*` kể cả case/repeated slash/path parameter/residual encoding; generic AI proxy strip internal headers, còn Job→AI/Profile dùng scoped key và exact outbound host allowlist.
- [x] Qua PR #49, thêm exact Recruiter candidate route no-store/query-free log, strip internal headers và local GET/HEAD limiter bao phủ case/trailing slash; runtime smoke xác nhận route variants và 429. Distributed limiter vẫn pending cho nhiều gateway replica.
- [ ] Bổ sung route chính thức `/bookmarks`; hiện Bookmark đi qua `/applications/bookmarks`.
- [ ] Xử lý cả URL có và không có dấu `/` cuối, ví dụ `/applications` và `/applications/`.
- [ ] Thêm healthcheck cho từng service và `depends_on` theo trạng thái healthy.
  - [x] Auth Service có health Actuator thật, trả `503` khi dependency `DOWN/OUT_OF_SERVICE`; Redis có healthcheck/auth và Auth chờ Redis healthy trong Compose.
  - [x] Profile image có healthcheck non-root; Compose chạy `profile-migrate` one-shot và chỉ khởi động Profile sau khi migration thành công.
  - [x] Media image Node 24 chạy non-root và fail-fast; Compose chạy `media-migrate` one-shot trước runtime, nhưng full Compose toàn hệ thống vẫn chưa smoke test.
  - [x] Notification image Node 24 chạy non-root; Compose chạy `notification-migrate` one-shot, runtime chờ migration và `/health/ready` kiểm PostgreSQL cùng Kafka group đã join.
- [x] Route `/notifications/` giữ prefix, strip internal headers, không log query/referrer và ép private/no-store cho cả success/error response.
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
- [ ] Frontend Interview calendar/Jitsi, realtime chat và notification center.
- [ ] Admin dashboard, company/job approval, user/report management và export.
- [ ] Loading/error/empty state, responsive UI, accessibility và E2E test.

## P17 — Kiểm thử tích hợp, bảo mật và phát hành

- [ ] Chốt schema JWT và toàn bộ payload Kafka giữa các thành viên; `job-events` v1 đã khóa key `job_id`/16 trường, `cv-events` v1 đã khóa key `cv_id`/chín trường cùng ba action qua PR #43, `application-events` v1 đã khóa exact Offer trio qua PR #50, và foundation `SCHEDULED interview-events` v1 đã khóa key `interview_id`/15 trường qua PR #52. Các phần Interview lifecycle còn lại, `chat-events` và các consumer Admin vẫn pending.
- [ ] Contract test REST giữa Auth/Profile/Company/Job/Application/Interview.
  - [x] Interview Query đã có service-level contract test cho Candidate/Recruiter role, current Company membership, SQL visibility/redaction, Application-derived availability và downstream fail-closed; deployed multi-service REST E2E vẫn pending.
- [ ] Hoàn thiện contract test Kafka cho tất cả producer/consumer thật và duplicate event.
  - [x] AI Job consumer đã được kiểm tra với payload đúng shape Job producer, broker Kafka thật, duplicate event, DLQ và commit offset.
  - [x] Application → AI `/match` đã có contract gate với AI Service thật qua PR #71; gate bắt được lỗi h2c upgrade làm hỏng mọi lời gọi tới uvicorn và đã sửa bằng cách ghim HTTP/1.1.
  - [x] Application → Job `/exists`, `/stats/active` và `/details/bulk` đã có contract gate với Job Service thật qua PR #72.
  - [x] Job producer đã được kiểm tra từ PostgreSQL transaction/outbox tới Kafka thật: rollback khi outbox lỗi, concurrent CAS, version `1/2/3`, salary biên, Kafka key/payload và trạng thái published.
  - [x] Profile CV producer đã được kiểm tra PostgreSQL transaction/outbox → Kafka 3.8 thật: exact key/chín trường, version order, `published_at` và terminal flush không phát thêm.
  - [x] AI CV consumer Kafka 3.8 → PostgreSQL/pgvector kiểm `UPSERTED → DEACTIVATED`, source unavailable → `DELETED`, malformed/oversized JSON, redacted DLQ và commit offset. Duplicate/order/ownership/tombstone được kiểm ở PostgreSQL integration; Media/parser dùng fake deterministic nên deployed E2E vẫn pending.
  - [x] Application producer PostgreSQL outbox → Kafka 3.8 và Notification consumer Kafka → PostgreSQL đã kiểm exact v1 fixtures, Offer transitions, retained backlog, duplicate/collision, poison continuation và offset terminal; deployed hai service cùng lúc vẫn pending.
  - [x] Interview producer PostgreSQL outbox → Kafka 3.8 và Notification consumer Kafka → PostgreSQL đã kiểm exact 15 fields/privacy, atomic rollback, lease/fence/order, retained backlog/cutoff, duplicate/collision, poison continuation và offset terminal; deployed hai service cùng lúc vẫn pending.
- [ ] E2E Candidate: đăng ký → hồ sơ/CV → tìm việc → bookmark/apply → interview → offer → hired.
- [ ] E2E Recruiter: công ty → xác minh → job → duyệt → nhận hồ sơ → interview → offer.
- [ ] E2E Admin: duyệt, khóa user, report và dashboard.
- [ ] Security test JWT giả/hết hạn/sai role, IDOR, injection, file upload và secret leakage.
  - [x] Notification đã test strict RS256/JWKS/static PEM, issuer/audience/header/claim, unknown-`kid` cooldown, owner isolation/404, cursor tamper/cross-owner và no-store.
  - [x] Interview Query đã test Candidate/Recruiter/Admin/anonymous, cross-Candidate/cross-Company IDOR, DTO redaction, cursor tamper/cross-scope, unknown/repeated query, bounded range/limit và Company/Application fail-closed.
  - [x] Job & Search đã test strict canonical Bearer/RS256/JWKS/static PEM, issuer/audience/`typ`/thumbprint `kid`/UUID/role/time claims, current-previous rotation, cache/cooldown/timeout/body cap, malformed upstream, error redaction và no-stale-key. Đây là service-level gate; deployed Auth–Job negative E2E vẫn pending.
  - [x] Application đã test strict canonical Bearer/RS256/JWKS/static PEM, issuer/scalar audience/`typ`/thumbprint `kid`/UUIDv4/role/time claims, current-previous rotation, atomic cache/single-flight/cooldown/total timeout/body cap/no-stale và sanitized 401/503/500. Đây là service-level gate; deployed Auth–Application negative E2E vẫn pending.
- [ ] Load test search, chat socket, notification worker và application concurrency.
  - [x] Application controlled service/PostgreSQL concurrency gate đã PASS đúng 10.000 call ở concurrency 32 với 0 unexpected/5xx/deadlock/timeout; đây chưa phải deployed HTTP/multi-replica load.
  - [x] AI Candidate-facing `/recommend/jobs` controlled local HTTP gate đã PASS 100 warm-up + 1.000 measured call trên 100.000 Job ở concurrency 8 với 0 error/mismatch/timeout/security leak; đây chưa phải public Job/deployed/multi-replica load.
  - [ ] Chat socket, Notification worker, deployed Application HTTP/multi-replica load và deployed/multi-replica recommendation load vẫn pending.
- [ ] CI chạy lint, unit test, build, migration check và container scan cho từng Pull Request.
- [ ] Chuẩn hóa README, OpenAPI, `.env.example`, runbook và checklist release.

---

## Thứ tự ưu tiên đề xuất

1. Hoàn thiện confirm/reschedule/cancel/no-show/feedback, lifecycle events, reminder/BullMQ và Jitsi join/token.
2. Làm Chat persistence/JWT/participant authorization, sau đó chốt `chat-events` và nối Notification.
3. Chạy các external staging gate đang chờ credential/dữ liệu: controlled Job/CV baseline, six-policy Cloudinary smoke và deployed recommendation E2E/load.
4. Hoàn thiện Candidate CV Builder/job-preferences UI, Admin/Frontend và các E2E Candidate/Recruiter/Admin trước production.

Live Cloudinary smoke với sáu preset thật vẫn là hạng mục P09 độc lập cần credential/preset ngoài repository; không chặn unit/service contract bằng fake provider deterministic, nhưng là staging/production rollout gate và bắt buộc hoàn tất trước production.

## Rủi ro và điểm cần chốt ngay

- Core Auth đã hoàn thành qua OTP, password login, Google OIDC, JWT/refresh, forgot/reset password và Admin account control. Account-link Google có re-auth chỉ là hạng mục tùy chọn; production vẫn cần quy trình provisioning/bootstrap Admin được kiểm soát.
- Admin account control bị ẩn khỏi public gateway và chưa có AuditLog vì proxy/audit thuộc P10 Admin Service. Access JWT stateless đã phát cho service khác vẫn có thể dùng tối đa 15 phút; chưa có denylist/introspection để thu hồi tức thời toàn hệ thống. API hiện là set-state idempotent theo last-commit-wins và chưa nhận expected version/`If-Match`; P10 phải serialize command hoặc bổ sung conditional mutation nếu nghiệp vụ cần chặn delayed unlock.
- Password recovery dùng generic response và bounded async SMTP nhưng không cam kết timing tuyệt đối đồng nhất. Rate limit Nginx hiện theo từng gateway instance/client socket; triển khai sau LB/CDN hoặc nhiều replica phải cấu hình trusted Real IP, đồng bộ recovery CORS allowlist và dùng distributed ingress/WAF limiter. Production phải bật SMTP auth cùng STARTTLS bắt buộc.
- Company, Job và Application nay enforce issuer/audience, `typ=JWT`, RS256 thumbprint `kid`, UUID v4 `sub/jti` cùng exact role ở mức service test; Job và Application hỗ trợ bounded JWKS current/previous rotation. Application đã có thêm controlled transaction/load gate một process; deployed cross-service negative contract/E2E, HTTP/multi-replica load, cold-JWKS observation và production rollout vẫn thuộc P17.
- Profile đã có Candidate CRUD/completion/auth, upload/list/detail/private-download CV, lifecycle PR #40, backend Builder PR #41, atomic deletion fence PR #42 và transactional `cv-events` PR #43. Verify còn bắt buộc strict Candidate JWT, còn recruiter chỉ đi qua Application sau Company authorization. Service-level contract/security/concurrency tests đã có, nhưng deployed cross-service REST/E2E trong P17 vẫn chưa hoàn thành; frontend Builder/PDF renderer cũng vẫn thuộc P16.
- Profile skill snapshot v2 qua PR #46 chỉ cấp projection names-only cho đúng Candidate đang submit bằng dual auth; PR #47 đã thêm Application V8 consumer/filter. Kỹ năng là dữ liệu tự khai tại thời điểm nộp, không phải bằng chứng nội dung PDF và không được dùng để auto-reject. Rollout phải deploy Profile v2, chạy V8, deploy Application mới rồi drain replica còn gọi v1; replica cũ trong mixed rollout vẫn có thể tạo row legacy không snapshot. Không backfill lịch sử; active filter loại legacy/snapshot rỗng. V8 thêm constraint/check/index trong migration transaction nên phải đo lock window trên dữ liệu production trước rollout.
- Root Nginx đã bỏ query/referrer khỏi access log cho toàn bộ `/applications/`, `/profile/` và `/jobs/`, đồng thời strip forged internal headers ở public Profile/Job routes. CDN, load balancer, APM và tracing bên ngoài vẫn có thể thu query hoặc request body Candidate tự khai; production phải duy trì redaction và retention hạn chế. Matching preference/skill là exact case-insensitive theo database collation, không phải accent-insensitive/substring/alias/semantic search.
- Completion và `aggregate_version` của Candidate Profile đã được transaction hóa; registration enforce tối đa năm CV, lifecycle dùng compare-and-set, atomic default handover và deterministic delete reassignment. Migration PR #40 bổ sung lock/backfill/version bump cùng deferred exact-one-default invariant trên `develop`.
- Application V6 vẫn cung cấp durable usage ledger/lookup authoritative để backward compatibility; PR #42 bổ sung V7 permanent gate và serialize acquire với submission trên cùng gate row, nên race lookup-then-delete cũ đã được đóng. Gate `FENCED` là quyết định vĩnh viễn và submit sau đó phải fail `CV_NOT_AVAILABLE`; không được xóa gate, mở lại gate hoặc rollback database theo cách làm mất fence. PR #43 đã chốt `cv-events` bằng `file_id` + Media fetch an toàn, không còn dùng `file_url` trong Kafka.
- Profile deletion dùng durable `PENDING_FENCE`, trả 202 khi Application chưa quyết định và worker lease/backoff tiếp tục sau restart. Hard-delete chỉ xảy ra cho unused leaf sau `FENCED`; `USED` luôn soft-retain. Transaction-local GUC `profile.cv_deletion_request_id` là correlation/accidental-write guard chứ không phải ranh giới xác thực; production vẫn phải dùng DB role tối thiểu, TLS/mTLS hoặc network policy, connection-pool transaction boundary và secret rotation. CV legacy đã soft-delete trước PR #42 không được backfill tự động; quota 50 snapshot vẫn áp dụng vì PR #42 không phải retention worker tổng quát.
- Media cleanup của luồng CV hard-delete nay dùng durable job, retired file và retry lease/backoff; không còn là callback best-effort cho luồng này. Tuy vậy cleanup avatar/compensation ngoài deletion saga vẫn có thể để safe leak theo các đường cũ. Vận hành phải theo dõi tuổi/số lượng `PENDING_FENCE`, lease hết hạn, retry/error code, cleanup pending/failed và backlog Media; cảnh báo/ngưỡng SLO vẫn cần chốt trước production.
- Rollout fence phải theo thứ tự Application V7 trước, xác nhận mọi replica đã hỗ trợ acquire/submission gate, rồi mới deploy Profile; khi rollback hoặc dừng worker phải drain/duy trì xử lý pending fence và cleanup. Service-level evidence mới nhất là Application **286 unit/WebMvc/security + 71 integration test** cùng controlled 10.000-call concurrency gate và Profile **62 unit + 89 integration test** ở full clean suite, cùng migration-upgrade/replay PASS; P17 deployed cross-service E2E vẫn pending.
- Rollout `cv-events` phải provision topic và distinct AI→Media key, migrate AI ownership/activity state, deploy strict CV worker, migrate/roll toàn bộ Profile writer rồi mới bật publisher. Existing active CV không có event tự sinh; controlled baseline CLI đã có nhưng phải dry-run/review/execute riêng trên từng môi trường. Theo dõi outbox backlog/oldest age, AI retry/DLQ và consumer lag; published-row retention, Kafka TLS/SASL và alert threshold chưa hoàn tất.
- Backend revision API đã hoàn thành ở task 2.21 và áp dụng invariant mọi thay đổi content/file đều sinh `cv_id/file_id` mới. API clone revision/default handover/lineage đã có; Candidate UI/template/browser PDF renderer vẫn pending ở P16 và Media chưa kiểm chứng PDF khớp ngữ nghĩa với `contentJson`.
- Candidate Profile đã có cap transactionally cho từng collection; production vẫn cần distributed rate limit theo user/IP và load test các response ở sát giới hạn trước khi chạy nhiều gateway replica.
- Root Compose hiện dùng một PostgreSQL chung và tách bằng schema, khác yêu cầu kiến trúc cố định `profile-db` container/database riêng. Một số consumer local còn opt-in JWKS HTTP, riêng Notification đã mặc định dùng static PEM được mount tin cậy; production phải dùng HTTPS/mTLS hoặc static PEM cùng rotation được kiểm soát. Nhóm phải chính thức chấp nhận schema-per-service hoặc tách database/credential trước production.
- Nhà cung cấp LLM đã chốt Anthropic Claude theo tài liệu kiến trúc và pin SDK `anthropic==0.120.2`; live Claude 10-FAQ quality/staging smoke vẫn cần API key thật và không ảnh hưởng provider `/match` thuần pgvector.
- Candidate-facing Job recommendation v1 đã hoàn thành service contract và controlled 100.000-Job full-target HTTP/concurrent-writer gate; exact scan vẫn là correctness-first. Recruiter-facing Candidate recommendation đã PASS controlled 100.000-CV exact allowlist/index/filter gate; global ANN sau dynamic filter bị chứng minh không đầy đủ nên không bật. Distributed rate limit cho cả hai hướng đã có ở mức service qua PR #69. Filter-aware ANN đã được điều tra và loại trừ qua PR #73: index chỉ phục vụ khóa khoảng cách đơn thuần nên tie-break của cursor làm nó không dùng được. Cả hai hướng vẫn cần real-model relevance tiếng Việt, deployed/multi-replica load, false-stale rollout observation và production monitoring/SLO trước production.
- Cursor recommendation gắn HMAC scoped key, canonical filter, hash vector nguồn và transactional target generation. Đổi key hoặc embedding mutation làm cursor cũ stale; rollout bắt buộc migrate qua `20260829_06`, dùng đúng một migration job cho concurrent HNSW build, xác nhận bốn trigger rồi mới nhận traffic. HNSW CV hiện advisory nên không phải readiness dependency; trigger disabled/replica-only vẫn làm readiness fail để không tiếp tục phân trang không an toàn.
- First page cố ý fail-soft qua explicit `PREFERENCES` rồi deterministic `LATEST`, luôn giữ root `fallbackReason`; continuation dùng `409/503` và không đọc preferences để tránh trộn nguồn, skip hoặc duplicate. V1 chỉ exact-match role/location/job type/VND salary vì Job chưa có taxonomy ngành; relevance tiếng Việt và behavior trên dữ liệu thật vẫn phải benchmark.
- Recruiter-facing candidate recommendation đã có public Job HTTP/Swagger qua PR #49; AI/Profile provider vẫn hidden. Consent/CV/version và Company/Job capability đều fail closed, nhưng resolver chỉ là authorization snapshot nên withdrawal xảy ra sau snapshot vẫn có thể để request đang in-flight hoàn tất. Production vẫn cần TLS/mTLS, network policy, secret rotation, distributed ingress protection và deployed E2E.
- `job-events` v1 đã khóa key `job_id`/16 trường; `cv-events` v1 đã khóa key `cv_id`/chín trường; `application-events` v1 đã khóa key `application_id` và exact Offer trio; foundation `SCHEDULED interview-events` v1 đã khóa key `interview_id`/15 trường, UTC millisecond và privacy boundary. Các phần Interview lifecycle còn lại/`chat-events` vẫn phải chốt riêng.
- Pipeline, Kafka và hợp đồng quyền MEMBER/OWNER đã được kiểm chứng; Application Pipeline dùng quyền toàn công ty, còn quyền sửa/xóa Job vẫn do Job Service kiểm soát.
- Application Evaluation đã được kiểm chứng với JSONB trên PostgreSQL thật, gồm quyền công ty, validation, chống đánh giá trùng và Candidate privacy; P02 đã merge vào `develop` theo xác nhận của người dùng.
- Application Offer đã khóa terminal-state consistency qua PR #67 bằng Flyway V9, CAS nguyên tử và PostgreSQL race/rollback test. Event không lộ salary/note/file; Media core đã có internal verify nhưng policy v1 chưa có `OFFER_LETTER` và Application chưa được nối, nên Offer vẫn chưa xác minh canonical file metadata/ownership.
- Application hiện đạt **286 unit/WebMvc/security + 71 PostgreSQL/Kafka integration test** và standalone controlled gate **10.000 call / concurrency 32 / 0 lỗi bất ngờ**; Interview đạt **143 unit/WebMvc/security/client/event/query + 16 PostgreSQL/Kafka integration test**; AI đạt **529 unit/non-integration + 62 PostgreSQL/Kafka/Redis integration (591/591 tổng)** cùng standalone Candidate-facing gate **100 + 1.000 HTTP call / 100.000 Job / concurrency 8 / 0 error-mismatch-timeout-security leak**; Notification đạt **51 unit + 7 PostgreSQL/Kafka integration test** cho Application và Interview Scheduled in-app projections. Đây vẫn là service-level/local evidence; live Claude/recommendation quality, deployed cross-service và multi-replica production capacity còn pending.
- Interview availability chỉ là gợi ý; request tạo lịch và PostgreSQL exclusion constraints mới quyết định slot trong race. Đổi `INTERVIEW_CURSOR_HMAC_KEY` làm cursor cũ vô hiệu; Recruiter query fail closed khi Company không xác minh được membership, còn schedule snapshot lịch sử bất biến nhưng membership luôn được đánh giá lại theo trạng thái hiện tại.
- Notification có hai stable rollout cutoff độc lập: `NOTIFICATION_APPLICATION_REPLAY_AFTER` và `NOTIFICATION_INTERVIEW_REPLAY_AFTER`; mỗi giá trị phải chốt ngay trước event cần chiếu và giữ nguyên cho group tương ứng. Kafka local còn plaintext; production cần TLS/SASL/ACL, ledger retention, lag/backlog/poison alert và quy trình rotate static PEM. KafkaJS 2.2.4 trên Node 24 còn có thể phát `TimeoutNegativeWarning` upstream dù delivery assertions PASS.
- Publisher `job-events` và `cv-events` dùng at-least-once: nếu broker đã ACK nhưng process dừng trước khi ghi `published_at`, cùng `event_id` có thể được phát lại; consumer bắt buộc dedupe theo `event_id` và chặn event cũ theo `aggregate_version`.
- Migration outbox Kafka không tự tạo historical `job-events` hoặc `cv-events`; hai controlled one-shot baseline CLI đã được bổ sung nhưng chưa chạy trên môi trường dữ liệu thật. Mỗi môi trường phải dry-run, review counters, execute bằng exact confirmation rồi theo dõi outbox/consumer lag. Riêng Elasticsearch `job_index_v4` dùng cặp marker bền vững `mappings._meta.baselineVersion=4` và `baselineIndexUuid`, tự enqueue/resume baseline cho cả index mới và index tương thích đã tồn tại sau restart. Khi marker chưa hoàn tất, search chuyển sang PostgreSQL và health ở `DEGRADED`; cần theo dõi tải fallback, pending/failed intent và chỉ coi rollout hoàn tất khi health trở lại `UP`.
- Cấu hình Elasticsearch sai field/type/analyzer hoặc alias trỏ nhiều concrete index hiện bị từ chối trước khi ghi; checklist rollout phải kiểm tra mapping/alias. Graceful shutdown đã release intent nếu gặp race ngay sau claim, nhưng deployment vẫn cần dành thời gian drain dispatcher/worker thay vì kill cưỡng bức.
- Outbox chưa có job retention tự động; payload chứa cả description/requirements. Các FK từ outbox và `job_index_sync` tới Job đang là `RESTRICT`, nên hard-delete Job sẽ bị chặn; cần chốt soft-delete hoặc thiết kế tombstone intent độc lập trước khi triển khai xóa cứng, không được đổi sang `CASCADE` khi chưa bảo đảm sự kiện/index xóa vẫn được phát.
- Offer lifecycle gap đã được đóng qua PR #67: `OFFER → REJECTED/WITHDRAWN` chỉ commit cùng `SENT → CANCELLED`, tăng Offer version và giữ `application-events` v1 ở dạng `STATUS_CHANGED` không có Offer trio. V9 không rolling-compatible với binary cũ và giữ `ACCESS EXCLUSIVE` trong backfill/validate; rollout bắt buộc freeze/drain toàn bộ replica cũ, dùng một migrator trong maintenance window, xác nhận không còn terminal Application + `SENT` Offer rồi mới nhận traffic, và không rollback về binary cũ. Auto-expiry vẫn là hạng mục riêng.
- Media confirm hiện có per-file cooldown và atomic 60 upload intent/requester/giờ; scheduler/reconciliation đã có DB-clock, distributed cycle/job lease-fencing, watchdog, exact orphan/sibling sweep, timeout cancellation và capped retry. Guarded six-policy Cloudinary runner cùng offline/runtime tests đã có, nhưng chưa được chạy với staging credentials/preset/fixture thật. Distributed token bucket toàn cục cho Cloudinary Admin API, alert backlog, cleanup audit/archive retention, malware/deep parser và staging/promote public asset vẫn là điều kiện trước production.
- Docker daemon/Testcontainers đã hoạt động; AI API/worker đã verify migration, non-root, readiness, Kafka 3.8, PostgreSQL 16/pgvector và model thật; Media đã verify **26 unit + 26 PostgreSQL integration**, clean migration, runtime image và Nginx riêng. Profile đạt **62 unit + 89 PostgreSQL/Kafka integration**, chín migration và second deploy clean; Job đạt **533 unit + 20 PostgreSQL/Kafka/Redis/Elasticsearch integration**, full Compose, strict JWT/JWKS service gate và controlled 100.000-Job search load gate PASS; Application controlled 10.000-call transaction/load gate PASS; AI controlled CV gate đã PASS ở mốc **386 test**, chatbot v1 nâng lên **504/504 test**, personalized recommendation tool nâng full gate lên **591/591 test** và Candidate-facing 100.000-Job full-target HTTP/load gate PASS độc lập. Root Compose config và Nginx recommendation runtime smoke PASS, nhưng Compose toàn hệ thống vẫn chưa được khởi chạy vì còn thiếu file môi trường runtime của một số service.
- Nginx đã có route độc lập `/offers/`; route `/bookmarks` và exact path không có dấu `/` cuối vẫn còn pending.
