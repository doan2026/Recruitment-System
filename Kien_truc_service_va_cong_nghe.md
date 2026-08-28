Kiến Trúc Service & Tech Stack Cố Định
Hệ thống tuyển dụng (Candidate – Recruiter – Company – Admin) | 11 service | Tài liệu dùng để triển
khai/vibe-code


0. Nguyên tắc chọn công nghệ
Tài liệu này cố định đúng một công nghệ cho mỗi vai trò trong hệ thống (không đưa ra 2-3 lựa chọn
"A hoặc B") để khi dùng AI hỗ trợ code (vibe coding), mỗi service sinh ra nhất quán trong nội bộ
framework của nó — giảm tối đa việc AI phải đoán hoặc trộn lẫn nhiều phong cách khác nhau.
        •   Không dùng 1 framework duy nhất cho toàn hệ thống, mà chọn theo đúng đặc điểm
            nghiệp vụ: Spring Boot cho service cần giao dịch phức tạp/bảo mật chặt, NestJS cho
            service CRUD/I-O cao cần phát triển nhanh (chi tiết ở mục 1).
        •   Trong từng nhóm, chỉ dùng một ORM duy nhất: Spring Data JPA cho nhóm Spring Boot,
            Prisma cho nhóm NestJS — AI sinh model/migration theo đúng 1 chuẩn của từng nhóm,
            không lẫn lộn.
        •   Giảm số lượng hạ tầng phải quản lý ở những chỗ không ảnh hưởng tới nguyên tắc cô lập
            dữ liệu: dùng lại PostgreSQL cho cả vector search (pgvector) trong DB riêng của AI
            Service thay vì thêm Pinecone/FAISS; dùng Redis riêng cho cache/session/hàng đợi nội
            bộ, tách biệt với Kafka lo việc truyền sự kiện giữa các service. Riêng dữ liệu nghiệp vụ,
            mỗi service có PostgreSQL riêng (đúng chuẩn database-per-service), không dùng chung 1
            cluster để tránh mất tính cô lập lỗi.
        •   Giao tiếp giữa 2 nhóm framework chuẩn hoá qua REST + JWT (RS256) cho giao tiếp
            đồng bộ, và Kafka cho giao tiếp bất đồng bộ (event-driven) — ngôn ngữ khác nhau
            nhưng hợp đồng giao tiếp (contract) giống nhau, AI không cần biết chi tiết nội bộ service
            kia viết bằng gì.
        •   Một file docker-compose.yml khởi chạy toàn hệ thống dù có 2 ngôn ngữ backend — AI
            vẫn đọc được toàn cảnh kiến trúc từ một file duy nhất.


1. Phân bổ Spring Boot vs NestJS theo từng
service
Thay vì dùng 1 framework duy nhất cho toàn bộ backend, hệ thống chia theo đúng đặc điểm nghiệp
vụ của từng service: service nào cần giao dịch phức tạp/bảo mật chặt dùng Spring Boot, service nào
cần I/O nhiều/tốc độ phát triển nhanh dùng NestJS.
        •   Spring Boot (Java): Auth Service, Application Service, Interview & Video Call Service,
            Admin & Statistics Service
        • NestJS (TypeScript): User/Profile Service, Company Service, Job & Search Service,
            Notification Service, File/Media Service
        • Node.js + Socket.IO (không dùng NestJS để giảm overhead): Chat Service
        • Python + FastAPI: AI Service
Cả hai nhóm framework giao tiếp với nhau bình thường qua REST + JWT (RS256) cho request đồng
bộ, và Kafka cho sự kiện bất đồng bộ.

 Tiêu chí               Chọn Spring Boot khi...                Chọn NestJS khi...

 Tính toàn vẹn giao      Nghiệp vụ nhiều bước, cần rollback     Nghiệp vụ CRUD đơn giản, ít ràng
 dịch (transaction)      chặt chẽ, ràng buộc dữ liệu phức tạp   buộc chéo bảng, tốc độ phát triển ưu
                         → @Transactional, optimistic           tiên hơn transaction phức tạp
                         locking của JPA xử lý tốt hơn

 Bảo mật                 Cần cơ chế xác thực/phân quyền         Bảo mật ở mức API thông thường
                         chuẩn công nghiệp, nhiều lớp bảo       (Guard/Middleware kiểm tra JWT)
                         vệ (method-level security, OAuth2)     là đủ
                         → Spring Security là chuẩn mực

 I/O và độ trễ           Xử lý tính toán/logic nhiều hơn I/O    Nhiều thao tác I/O đồng thời
                         thuần                                  (đọc/ghi liên tục, gọi API ngoài,
                                                                streaming file) → non-blocking
                                                                event loop của Node tận dụng tốt
                                                                hơn

 Tốc độ phát triển       Không ưu tiên chia sẻ type với         Cần chia sẻ kiểu dữ liệu
 & đồng bộ frontend      frontend                               (TypeScript) trực tiếp với Next.js,
                                                                lặp UI nhanh

 Báo cáo / tác vụ        Cần export Excel/CSV, chạy job         Không có yêu cầu báo cáo phức tạp
 định kỳ                 định kỳ (Spring Scheduler, Apache
                         POI) → hệ sinh thái Java mạnh hơn
                         hẳn



2. Kafka Topics chuẩn hoá
Toàn bộ giao tiếp bất đồng bộ giữa các service đi qua Kafka theo các topic cố định sau, tránh mỗi
service tự đặt tên event khác nhau:

 Topic              Producer              Consumer               Mục đích

 job-events         Job & Search          AI Service             Cập nhật/tính lại embedding job
                    Service                                      khi tin tuyển dụng được tạo hoặc
                                                                 sửa

 cv-events          User/Profile          AI Service             Cập nhật embedding CV khi ứng
                    Service                                      viên upload hoặc chỉnh sửa CV

 application-ev     Application Service   Notification           Gửi thông báo khi trạng thái đơn
 ents                                     Service                ứng tuyển thay đổi
                                                                 (Reviewing/Interview/Offer/Rejec
                                                                 ted)

 interview-even     Interview & Video     Notification           Foundation SCHEDULED gửi thông
 ts                 Call Service          Service                báo in-app an toàn; room URL/token
                                                                 được lấy qua API đã xác thực

 chat-events        Chat Service          Notification           Gửi push/email khi có tin nhắn
                                          Service                mới và người nhận đang offline



3. Tech Stack chuẩn hoá toàn hệ thống

Thành phần           Công nghệ cố định              Lý do chọn

Backend nhóm         Java 21 + Spring Boot 3        Áp dụng cho service cần tính toàn vẹn
nghiệp vụ lõi                                       giao dịch cao, nghiệp vụ nhiều bước, bảo
                                                    mật chặt: Auth, Application, Interview &
                                                    Video Call, Admin & Statistics

Backend nhóm         Node.js + NestJS               Áp dụng cho service cần phát triển nhanh,
CRUD / I-O cao       (TypeScript)                   I/O nhiều (đọc/ghi liên tục, gọi API
                                                    ngoài), chia sẻ kiểu dữ liệu (TS) với
                                                    frontend Next.js: User/Profile, Company,
                                                    Job & Search, Notification, File/Media

Backend AI Service   Python + FastAPI               Hệ sinh thái AI/ML (embedding, LLM
                                                    SDK) mạnh nhất ở Python, tách riêng
                                                    khỏi backend nghiệp vụ

Backend Chat         Node.js + Socket.IO            Realtime thuần, không cần overhead của
Service                                             NestJS/Spring, tối ưu cho kết nối
                                                    WebSocket số lượng lớn

ORM (nhóm Spring     Spring Data JPA +              Chuẩn mặc định của hệ sinh thái Spring,
Boot)                Hibernate                      hỗ trợ @Transactional, optimistic locking
                                                    cho nghiệp vụ nhiều bước

ORM (nhóm NestJS)    Prisma                         Type-safe, sinh schema/migration tự
                                                    động, cú pháp đơn giản nên AI generate
                                                    model + query chính xác hơn TypeORM

Database quan hệ     PostgreSQL — 1                 Tuân đúng chuẩn database-per-service:
chính                container/instance riêng cho   mỗi service có DB riêng (auth-db,
                     mỗi service                    profile-db, company-db, job-db,
                                                    application-db, interview-db,
                                                    notification-db, file-db, admin-db, ai-db),
                                                    cô lập lỗi — Postgres của 1 service down
                                                    không ảnh hưởng service khác; đổi lại tốn
                                                    tài nguyên hơn so với dùng chung 1
                                                    cluster nhiều schema

Database cho Chat    MongoDB                        Dữ liệu tin nhắn dạng document, ghi liên
                                                    tục, không cần quan hệ chặt như dữ liệu
                                                    nghiệp vụ khác

Vector store (AI)    pgvector (extension của        Tận dụng luôn Postgres đang có, không
                     PostgreSQL)                    cần thêm FAISS/Pinecone/Milvus riêng
                                                    — giảm 1 hạ tầng phải quản lý

Cache / Session /    Redis                          Dùng cho: lưu OTP, refresh token, cache,
Hàng đợi nội bộ                                     hàng đợi nội bộ (BullMQ) cho tác vụ nền
                                                    của riêng từng service — không dùng để
                                                    truyền sự kiện giữa các service

Giao tiếp bất đồng    Apache Kafka (KRaft mode,      Message broker chuẩn cho kiến trúc
bộ giữa service       không cần Zookeeper)           event-driven: lưu log bền vững (durable)
                                                     nên không mất sự kiện khi consumer
                                                     đang offline/restart, cho phép nhiều
                                                     consumer cùng đọc 1 topic độc lập, hỗ trợ
                                                     tốt cả Java (Spring Kafka) lẫn Node
                                                     (KafkaJS)

Kafka client (nhóm    Spring Kafka                   Tích hợp sẵn với Spring Boot qua
Spring Boot)                                         @KafkaListener, cấu hình qua
                                                     application.yml

Kafka client (nhóm    KafkaJS (qua                   Client Kafka thuần TypeScript phổ biến
NestJS)               @nestjs/microservices)         nhất cho Node, tích hợp tốt với module hệ
                                                     thống của NestJS

Xác thực xuyên ngôn   JWT ký bằng RS256 (khoá        Auth Service (Spring Boot) giữ private
ngữ                   bất đối xứng)                  key để ký token; mọi service khác (kể cả
                                                     NestJS/Python) chỉ cần public key để
                                                     verify — không phải chia sẻ secret giữa
                                                     các ngôn ngữ

Realtime (Chat)       Socket.IO + Redis Adapter      Chuẩn phổ biến nhất cho realtime
                                                     Node.js, Redis Adapter cho phép scale
                                                     nhiều instance sau này

Đăng nhập mạng xã     Google OAuth2 (Spring          Tích hợp sẵn, mature, hỗ trợ tốt luồng
hội                   Security OAuth2 Client)        OAuth2 phức tạp trong Spring Security

Lưu trữ file          Cloudinary                     Dịch vụ quản lý media chuyên biệt: tự
                                                     động tối ưu/resize ảnh & video, có CDN
                                                     sẵn giúp tải nhanh toàn cầu, free tier đủ
                                                     dùng cho đồ án, không cần tự vận hành
                                                     hạ tầng lưu trữ như self-host MinIO

Video phỏng vấn       Jitsi Meet (self-host, nhúng   Có sẵn UI/signaling server, chỉ cần nhúng
                      qua Jitsi Meet External API)   iframe + tạo room theo application_id,
                                                     không phải tự dựng WebRTC từ đầu

Push notification     Firebase Cloud Messaging       Miễn phí, SDK ổn định cho cả web và
                      (FCM)                          mobile nếu mở rộng app sau này

Gửi email             Nodemailer (NestJS) /          Mỗi ngôn ngữ dùng thư viện chuẩn của
                      JavaMailSender (Spring         mình, cùng 1 SMTP server (Gmail SMTP
                      Boot) qua SMTP                 hoặc SendGrid)

Chatbot (AI)          Anthropic Claude API           Chất lượng hội thoại tốt, dễ tích hợp qua
                                                     REST API, có thể truyền system prompt
                                                     chứa ngữ cảnh nghiệp vụ tuyển dụng

Embedding CV/Job      sentence-transformers          Model nhỏ, chạy được CPU, đủ tốt để so
(AI)                  (all-MiniLM-L6-v2)             khớp ngữ nghĩa CV–JD mà không cần
                                                     GPU

 API Gateway               Nginx reverse proxy             Không quan tâm service phía sau viết
                                                           bằng ngôn ngữ gì, chỉ định tuyến theo
                                                           path prefix (/auth, /jobs, /chat, ...)

 Frontend Web              Next.js (React + TypeScript)    Chia sẻ kiểu dữ liệu (TypeScript) trực tiếp
                           + TailwindCSS                   với các service NestJS, giảm lỗi hợp đồng
                                                           API

 Containerization          Docker + Docker Compose         Một file docker-compose.yml khởi chạy
                                                           toàn bộ hệ thống dù có 2 ngôn ngữ
                                                           backend khác nhau — AI vẫn đọc được
                                                           toàn cảnh kiến trúc từ một file duy nhất

 API Docs                  OpenAPI/Swagger                 Mỗi ngôn ngữ dùng thư viện chuẩn của
                           (springdoc-openapi cho          mình nhưng cùng chuẩn OpenAPI,
                           Spring Boot,                    gateway có thể tổng hợp thành 1 tài liệu
                           @nestjs/swagger cho             API duy nhất
                           NestJS)



4. Chi tiết 11 Service
1. Auth Service
       •    Công nghệ cố định: Spring Boot 3 (Java 21) · Spring Security + Spring Data JPA ·
            PostgreSQL (container riêng: auth-db) · Redis · JWT (RS256) · Spring Security OAuth2
            Client (Google) · JavaMailSender
Chịu trách nhiệm toàn bộ vòng đời xác thực và phân quyền của hệ thống — là service duy nhất phát
hành token cho các service khác tin dùng.

Chức năng chi tiết
       •    Đăng ký/đăng nhập bằng email + mật khẩu (bcrypt hash)
       •    Đăng nhập Google OAuth2
       •    Xác thực OTP qua email khi đăng ký (OTP lưu tạm trong Redis, hết hạn sau 5 phút)
       •    Quên mật khẩu / đặt lại mật khẩu bằng reset token
       •    Refresh token có rotation (mỗi lần refresh sinh token mới, token cũ bị revoke)
       •    Guard phân quyền theo role: Candidate / Recruiter / Admin

Data model gợi ý
       •    User(id, email, password_hash, role, is_verified, created_at)
       •    RefreshToken(id, user_id, token_hash, expires_at, revoked)

API / event chính
       •    POST /auth/register
       •    POST /auth/login
       •    POST /auth/google
       •    POST /auth/otp/verify
       •    POST /auth/refresh
       •    POST /auth/forgot-password

Giao tiếp với service khác

Phát hành JWT ký bằng RS256 (giữ private key) chứa user_id + role dùng chung toàn hệ thống; các
service khác — dù viết bằng Spring Boot, NestJS hay Python — chỉ cần public key để verify chữ ký,
không cần gọi ngược lại Auth Service mỗi request.

2. User/Profile Service
       •    Công nghệ cố định: NestJS (TypeScript) · PostgreSQL (container riêng: profile-db) +
            Prisma
       • Lý do chọn framework: NestJS — CRUD hồ sơ đơn giản, cần lặp nhanh theo UI, chia
            sẻ type trực tiếp với CV Builder ở frontend Next.js.
Quản lý hồ sơ chi tiết của ứng viên — nguồn dữ liệu chính để Application Service và AI Service
(matching) sử dụng.

Chức năng chi tiết
       •   CRUD hồ sơ: học vấn, kinh nghiệm làm việc, kỹ năng, chứng chỉ, dự án cá nhân
       •   Liên kết Github/LinkedIn/portfolio cá nhân
       •   CV Builder: chọn template có sẵn, nhập dữ liệu, xuất PDF
       •   Quản lý nhiều CV cho một ứng viên, đặt CV mặc định

Data model gợi ý
       •   Profile(id, user_id, headline, summary)
       •   Education / Experience / Skill / Certificate (liên kết profile_id)
       •   CV(id, user_id, file_id, type, is_default, is_deleted, aggregate_version)

API / event chính
       •   GET /profile/:userId
       •   PUT /profile/:userId
       •   POST /profile/cv
       •   GET /profile/cv/:id

Giao tiếp với service khác
Ghi transactional outbox và publish sự kiện versioned lên topic Kafka `cv-events` khi một PDF CV
được tạo, ngừng hoạt động hoặc xoá cứng. Kafka key là `cv_id`; payload flat snake_case có đúng chín
trường `event_id`, `action`, `cv_id`, `candidate_id`, `file_id`, `cv_type`, `occurred_at`,
`schema_version`, `aggregate_version`. Payload không chứa URL ký, nội dung CV hoặc
`media_reference_id` nội bộ của Profile. AI Service dùng `file_id` cùng owner/type expectation để
lấy URL tải riêng tư ngắn hạn từ Media Service; Application Service lấy CV qua REST nội bộ khi ứng
viên chọn CV nộp đơn.

3. Company Service
       •   Công nghệ cố định: NestJS (TypeScript) · PostgreSQL (container riêng: company-db) +
           Prisma
       • Lý do chọn framework: NestJS — CRUD đơn giản, không có nghiệp vụ giao dịch phức
           tạp, ưu tiên tốc độ phát triển.
Quản lý thông tin doanh nghiệp và các recruiter thuộc doanh nghiệp đó.

Chức năng chi tiết
       •   Đăng ký hồ sơ công ty (tên, mô tả, lĩnh vực, quy mô, địa chỉ)
       •   Admin xác minh (verify) công ty trước khi được đăng tin
       •   Quản lý logo, ảnh, video giới thiệu (upload qua File Service)
       •   Quản lý danh sách recruiter thuộc công ty, phân quyền nội bộ (owner/member)

Data model gợi ý
       •   Company(id, name, description, industry, size, address, verified_status)

        •   CompanyMember(company_id, user_id, role)

API / event chính
        •   POST /companies
        •   GET /companies/:id
        •   PUT /companies/:id
        •   POST /companies/:id/members

Giao tiếp với service khác
Job & Search Service tham chiếu company_id khi đăng tin tuyển dụng; Admin & Statistics Service
gọi REST API của Company Service (GET/PATCH /companies/:id/verify) để duyệt, vì không được
truy cập trực tiếp company-db.

4. Job & Search Service
        •   Công nghệ cố định: NestJS (TypeScript) · PostgreSQL (container riêng: job-db) +
            Prisma (dữ liệu gốc) · Elasticsearch (tìm kiếm)
        • Lý do chọn framework: NestJS — traffic đọc (search) rất cao so với ghi, non-blocking
            I/O của Node phù hợp phục vụ nhiều request tìm kiếm đồng thời; client Elasticsearch
            chính thức cũng hỗ trợ tốt trên Node.
Gộp từ Job Service và Search Service vì dữ liệu tìm kiếm bám sát trực tiếp dữ liệu tin tuyển dụng, gộp
giúp tránh đồng bộ chéo giữa hai service.

Chức năng chi tiết
        •   CRUD tin tuyển dụng: tiêu đề, mô tả, yêu cầu, mức lương, địa điểm, loại hình
            (full-time/part-time/remote)
        •   Quản lý trạng thái tin: Draft / Published / Closed / Expired
        •   Tìm kiếm full-text kết hợp filter: địa điểm, mức lương, kỹ năng, kinh nghiệm
        •   Ghi Job và JobEventOutbox trong cùng transaction PostgreSQL; publisher phát
            job-events độc lập sau commit
        •   Đồng bộ dữ liệu sang Elasticsearch bằng BullMQ sau commit, độc lập với Kafka và
            không chạy đồng thời trong transaction nghiệp vụ

Data model gợi ý
        •   Job(id, company_id, title, description, requirements, salary_min, salary_max, location,
            status, skills[], aggregate_version)
        •   JobEventOutbox(event_id, job_id, aggregate_version, topic, event_key, action, payload,
            attempts, lease_owner, lease_expires_at, published_at, last_error, created_at)

API / event chính
        •   POST /jobs
        •   PUT /jobs/:id
        •   GET /jobs/search?q=&location=&salary=&skills=
        •   GET /jobs/:id

Giao tiếp với service khác
Publish sự kiện lên topic Kafka 'job-events' khi job được tạo/sửa để AI Service tính lại embedding
phục vụ matching. Kafka key là `job_id`; schema v1 là payload flat snake_case gồm đúng 16 trường:
`event_id, action, job_id, company_id, title, description, skills, location, status, occurred_at,
schema_version, aggregate_version, requirements, salary_min, salary_max, job_type`. Mutation dùng
CAS để `aggregate_version` tăng đơn điệu; Job và outbox cùng commit/rollback. Publisher claim bằng
lease có heartbeat, retry Kafka có backoff/cận trên và giữ nguyên `event_id`, do đó delivery là
at-least-once. Việc đồng bộ Elasticsearch được xử lý riêng bằng BullMQ; reindex chỉ dựng lại chỉ mục,
không phát domain event.

Khoảng trống rollout/vận hành: database đã có dữ liệu cần baseline/replay được review (migration
không tự backfill); retention/cleanup outbox đã publish chưa triển khai; kiểm thử tích hợp đầy đủ
Redis/BullMQ và Elasticsearch vẫn còn thiếu.

5. Application Service
        •   Công nghệ cố định: Spring Boot 3 (Java 21) · Spring Data JPA · PostgreSQL (container
            riêng: application-db)

        •  Lý do chọn framework: Spring Boot — pipeline trạng thái (Applied → Reviewing →
           Interview → Offer → Rejected) là state machine cần ràng buộc chuyển trạng thái chặt
           chẽ, @Transactional + optimistic locking của JPA đảm bảo không mất/trùng dữ liệu khi
           nhiều recruiter thao tác đồng thời trên cùng application.
Quản lý toàn bộ pipeline ứng tuyển từ lúc nộp đơn đến khi có kết quả.

Chức năng chi tiết
        •   Nộp đơn ứng tuyển: chọn CV có sẵn + viết cover letter
        •   Theo dõi trạng thái: Applied → Reviewing → Interview → Offer → Rejected
        •   Bookmark / lưu tin tuyển dụng yêu thích
        •   Recruiter xem danh sách ứng viên theo từng job, lọc theo trạng thái

Data model gợi ý
        •   Application(id, job_id, candidate_id, cv_id, status, applied_at)
        •   Bookmark(user_id, job_id)

API / event chính
        •   POST /applications
        •   GET /applications?job_id=
        •   PATCH /applications/:id/status

Giao tiếp với service khác
Khi status đổi → publish sự kiện lên topic Kafka 'application-events' để Notification Service gửi
thông báo; Interview & Video Call Service tham chiếu application_id khi đặt lịch phỏng vấn.

6. Interview & Video Call Service
        •   Công nghệ cố định: Spring Boot 3 (Java 21) · Spring Data JPA · PostgreSQL (container
            riêng: interview-db) · Jitsi Meet (self-host, nhúng qua Jitsi Meet External API)
        • Lý do chọn framework: Spring Boot — logic kiểm tra trùng lịch (conflict-checking)
            giữa các slot phỏng vấn và trạng thái buổi phỏng vấn cần xử lý giao dịch chặt chẽ; gọi ra
            Jitsi External API qua WebClient của Spring không phải điểm nghẽn vì tần suất tạo room
            thấp hơn nhiều so với traffic search/notification.
Gộp từ Interview Service và Video Call Service vì lịch phỏng vấn và phiên gọi video là một luồng liên
tục — đặt lịch xong vào thẳng phòng gọi, gộp giúp quản lý trạng thái phiên phỏng vấn dễ hơn.

Chức năng chi tiết
        •   Đã triển khai Recruiter đặt lịch OFFLINE self-interviewer với authoritative Application
            snapshot và PostgreSQL chống trùng Candidate/interviewer
        •   Đã triển khai role-aware detail/history/my, Recruiter Company calendar và advisory
            availability không giữ chỗ/không lộ nguồn busy
        •   Đã publish transactional `SCHEDULED interview-events` cho Notification in-app
        •   Tự động tạo phòng video, arbitrary interviewer/panel, feedback và các mutation
            lifecycle vẫn là target pending

Data model gợi ý
        •   Interview(id, application_id, scheduled_at, room_url, status, feedback)

API / event chính
        •   POST /interviews
        •   GET /interviews
        •   GET /interviews/my
        •   GET /interviews/calendar
        •   GET /interviews/availability
        •   GET /interviews/{id}
        •   PATCH /interviews/:id/feedback

Giao tiếp với service khác
Liên kết application_id từ Application Service; scheduling/availability lấy authoritative
Company/Candidate context qua purpose-scoped Application authorization. Recruiter query chuyển caller
JWT sang Company Service để revalidate current MEMBER/OWNER membership mỗi request; service không đọc
database của service khác. Interview và transactional outbox cùng commit rồi publish `SCHEDULED
interview-events` v1 cho Notification tạo in-app item. Event không chứa location, notes, room URL/token
hoặc contact/CV data. Khi Jitsi được triển khai, room credential ngắn hạn phải được lấy qua endpoint join
đã xác thực; service không xử lý/lưu trữ luồng media vì Jitsi đảm nhiệm.

7. Chat Service
        •    Công nghệ cố định: Node.js + Socket.IO · MongoDB + Mongoose · Redis Adapter
             (scale nhiều instance)
Phục vụ nhắn tin real-time giữa Candidate và Recruiter, tách riêng khỏi NestJS/Postgres vì đặc tính
dữ liệu và tần suất ghi khác biệt.

Chức năng chi tiết
        •   Chat 1-1 giữa Candidate và Recruiter theo từng application/job
        •   Gửi văn bản, hình ảnh, file đính kèm (file thật lưu ở File Service, Chat chỉ lưu URL)
        •   Trạng thái đã xem (seen), đang nhập (typing indicator)
        •   Lịch sử hội thoại, phân trang tin nhắn cũ

Data model gợi ý
        •   Conversation(_id, participants[], last_message)
        •   Message(_id, conversation_id, sender_id, content, type, seen_by[], created_at)

API / event chính
        •   Kết nối Socket.IO xác thực bằng JWT
        •   event 'message:send'
        •   event 'message:seen'
        •   event 'typing'

Giao tiếp với service khác
Publish sự kiện lên topic Kafka 'chat-events' cho Notification Service khi người nhận đang offline để
gửi push/email.

8. Notification Service
        •  Công nghệ cố định: NestJS (TypeScript) · PostgreSQL (container riêng: notification-db,
           chỉ lưu log) + Prisma · Firebase Cloud Messaging · BullMQ + Redis (queue) ·
           Nodemailer
        • Lý do chọn framework: NestJS — bản chất là service I/O thuần (lắng nghe event, gọi
           FCM/SMTP ra ngoài), gần như không có logic tính toán nặng; event loop của Node xử lý
           rất nhiều tác vụ I/O đồng thời hiệu quả hơn thread-per-request của Spring MVC.
Trung tâm xử lý thông báo, lắng nghe sự kiện từ toàn bộ hệ thống qua Kafka và xử lý gửi bất đồng bộ
qua hàng đợi nội bộ (BullMQ).

Chức năng chi tiết
        •   Lắng nghe event: application đổi trạng thái, lịch phỏng vấn mới, tin nhắn mới (khi
            offline), job phù hợp gợi ý từ AI Service
        •   Tạo thông báo trong app (in-app notification)
        •   Gửi push notification qua FCM
        •   Gửi email cho các thông báo quan trọng (offer, lịch phỏng vấn)

        •   Đánh dấu đã đọc / chưa đọc

Data model gợi ý
        •   Notification(id, user_id, type, payload, is_read, created_at)

API / event chính
        •   GET /notifications?user_id=
        •   PATCH /notifications/:id/read

Giao tiếp với service khác
Consume tất cả các topic Kafka sự kiện từ service khác (application-events, interview-events,
chat-events); là service duy nhất gọi ra FCM/SMTP.

9. File/Media Service
        •     Công nghệ cố định: NestJS (TypeScript) · Cloudinary (lưu trữ + xử lý media) ·
              PostgreSQL (container riêng: file-db) + Prisma (lưu metadata)
         • Lý do chọn framework: NestJS — bản chất chỉ là lớp trung gian gọi Cloudinary SDK và
              lưu metadata, tận dụng non-blocking I/O của Node khi xử lý nhiều upload đồng thời.
Trung tâm lưu trữ file cho toàn hệ thống, các service khác chỉ lưu tham chiếu (URL/ID), không lưu
file trực tiếp. File thật (CV, avatar, ảnh, video) được đẩy lên Cloudinary — server chỉ lưu lại metadata
và public_id để quản lý/xoá sau này.

Chức năng chi tiết
        •   Upload CV (PDF), avatar, ảnh và video công ty lên Cloudinary qua Cloudinary Node
            SDK
        •   Cloudinary tự động tối ưu ảnh/video (nén, resize theo nhu cầu hiển thị) và phục vụ qua
            CDN sẵn có
        •   Giới hạn dung lượng và định dạng file theo loại (VD: CV chỉ nhận PDF ≤ 5MB) trước khi
            upload
        •   Sinh signed upload URL/preset để client upload thẳng lên Cloudinary (giảm tải băng
            thông cho backend)
        •   Xoá file trên Cloudinary (qua public_id) khi bản ghi liên quan bị xoá (dọn rác định kỳ)

Data model gợi ý
        •   FileMeta(id, owner_id, cloudinary_public_id, url, type, size, created_at)

API / event chính
        •   POST /files/signature (sinh signed upload params)
        •   POST /files (lưu metadata sau khi Cloudinary upload xong)
        •   GET /files/:id
        •   DELETE /files/:id

Giao tiếp với service khác
Mọi service khác chỉ lưu `file_id` và metadata nghiệp vụ tối thiểu. URL công khai chỉ áp dụng cho
loại media có public delivery; CV dùng private delivery và phải lấy URL ký ngắn hạn theo từng lần
tải. Media Service là nơi duy nhất giữ Cloudinary API secret.

10. Admin & Statistics Service
        •   Công nghệ cố định: Spring Boot 3 (Java 21) · Spring Data JPA · PostgreSQL (container
            riêng: admin-db) · Apache POI (export Excel/CSV) · Spring Scheduler

        •   Lý do chọn framework: Spring Boot — cần truy vấn tổng hợp/thống kê phức tạp trên
            nhiều bảng, chạy job định kỳ tính toán số liệu (Spring Scheduler), và xuất báo cáo
            Excel/CSV (Apache POI là thư viện Java mạnh nhất cho việc này); các thao tác
            duyệt/khoá tài khoản cũng cần transaction chặt chẽ.
Gộp từ Admin Service và Statistics/Dashboard Service vì Admin cũng là nơi xem thống kê tổng hợp
toàn hệ thống, không cần tách riêng service đọc dữ liệu khi quy mô còn nhỏ.

Chức năng chi tiết
        •   Quản lý tài khoản người dùng: khoá/mở khoá
        •   Duyệt hồ sơ công ty và tin tuyển dụng trước khi công khai
        •   Xử lý report vi phạm (spam job, nội dung không phù hợp)
        •   Dashboard thống kê: số user/job/application theo thời gian, tỷ lệ chuyển đổi Applied →
            Interview → Offer
        •   Export báo cáo (CSV/Excel)

Data model gợi ý
        •   Report(id, reporter_id, target_type, target_id, reason, status)

API / event chính
        •   GET /admin/stats/overview
        •   PATCH /admin/users/:id/lock
        •   GET /admin/reports
        •   PATCH /admin/jobs/:id/approve

Giao tiếp với service khác
Vì mỗi service có database riêng (đúng chuẩn database-per-service), Admin & Statistics Service
KHÔNG được query trực tiếp DB của service khác. Thay vào đó: (1) gọi REST API nội bộ của từng
service khi cần dữ liệu tức thời (VD: gọi Company Service để duyệt hồ sơ công ty), (2) consume các
topic Kafka sẵn có (application-events, job-events...) để tổng hợp số liệu thống kê theo thời gian mà
không phải hỏi trực tiếp service gốc.

11. AI Service
        •   Công nghệ cố định: Python + FastAPI · Anthropic Claude API (chatbot) ·
            sentence-transformers all-MiniLM-L6-v2 (embedding) · PostgreSQL (container riêng:
            ai-db) + pgvector
Bổ sung tạm thời cho 2 chức năng AI: chatbot tương tác người dùng và recommendation engine
match CV với job. Bản phân tích nghiệp vụ gốc chưa mô tả chi tiết chức năng này nên cần làm rõ
thêm khi có yêu cầu cụ thể hơn.

Chức năng chi tiết
        •   Chatbot: trả lời câu hỏi thường gặp, hướng dẫn thao tác, dùng Claude API với system
            prompt chứa ngữ cảnh nghiệp vụ tuyển dụng; lưu lịch sử hội thoại ngắn hạn trong Redis
            theo session
        •   Recommendation: khi CV được upload (event từ Profile Service) hoặc job mới đăng
            (event từ Job & Search Service), tính embedding bằng sentence-transformers rồi lưu vào
            PostgreSQL (pgvector)
        •   Khi cần gợi ý, tính cosine similarity giữa vector CV và vector các job đang mở, trả về
            top-N job phù hợp nhất
        •   Expose kết quả gợi ý để Job & Search Service hiển thị mục 'Việc làm phù hợp với bạn'

Data model gợi ý
        •   CvEmbedding(cv_id, user_id, vector, text_hash, model_name, is_active,
            source_event_id, source_version, updated_at)
        •   CvAggregateOwner(cv_id, user_id, created_at) — ownership bất biến qua DLQ/tombstone
        •   JobEmbedding(job_id, vector, location, salary_min NUMERIC(15,2),
            salary_max NUMERIC(15,2), job_type, updated_at)
        •   ChatSession(session_id, user_id, history_json)

API / event chính
        •   POST /ai/chat
        •   POST /ai/recommend/jobs?cv_id=
        •   POST /ai/embeddings/refresh

Giao tiếp với service khác
Subscribe topic Kafka `job-events` và `cv-events` để tự động cập nhật embedding; không lưu trữ dữ
liệu CV/Job gốc, signed URL hoặc raw Kafka payload, chỉ lưu vector, hash, provenance và metadata tối
thiểu. Cả hai consumer chống trùng theo `event_id`, không cho `aggregate_version` cũ ghi đè state
mới. `cv-events` phân biệt `UPSERTED`, `DEACTIVATED` và `DELETED`: soft-deleted snapshot vẫn giữ
vector cho lịch sử Application nhưng không dùng cho recommendation, còn hard delete xoá vector và
đặt tombstone vĩnh viễn.


5. Lý do gộp service
        •   Job & Search Service = Job Service + Search Service — dữ liệu tìm kiếm bám sát dữ liệu
            tin tuyển dụng, gộp lại tránh đồng bộ chéo giữa hai service.
        •   Interview & Video Call Service = Interview Service + Video Call Service — lịch phỏng
            vấn và phiên video là một luồng liên tục, gộp giúp quản lý trạng thái phiên phỏng vấn dễ
            hơn.
        •   Admin & Statistics Service = Admin Service + Statistics/Dashboard Service — Admin
            cũng là nơi xem thống kê tổng hợp, không cần tách riêng service đọc dữ liệu khi quy mô
            còn nhỏ.


6. Gợi ý cấu trúc Docker Compose
Toàn hệ thống có thể khởi chạy bằng một file docker-compose.yml duy nhất với các container sau:
        •   api-gateway (Nginx) — reverse proxy tới các service theo path prefix (/auth, /jobs, /chat,
            ...), không quan tâm service phía sau là Java hay Node
        •   auth-db, profile-db, company-db, job-db, application-db, interview-db, notification-db,
            file-db, admin-db, ai-db — mỗi service PostgreSQL 1 container riêng (đúng chuẩn
            database-per-service, cô lập lỗi giữa các service)
        •   mongo — riêng cho Chat Service
        •   kafka (KRaft mode, không cần Zookeeper) — message broker cho các topic: job-events,
            cv-events, application-events, interview-events, chat-events
        •   redis — cache, session, OTP, hàng đợi nội bộ (BullMQ) của từng service
        •   jitsi (docker-jitsi-meet) — self-host video phỏng vấn
        •   auth-service, application-service, interview-video-service, admin-stats-service — base
            image eclipse-temurin (Java 21), build bằng Maven/Gradle, mỗi service 1 container, kết
            nối tới database riêng tương ứng
        •   profile-service, company-service, job-search-service, notification-service, file-service —
            base image node:20-alpine (NestJS), mỗi service 1 container, kết nối tới database riêng
            tương ứng (file-service gọi ra Cloudinary API, không cần container lưu trữ riêng)
        •   chat-service (Node.js + Socket.IO) — base image node:20-alpine, 1 container riêng, dùng
            chung mongo
        •   ai-service (Python FastAPI) — base image python:3.11-slim, 1 container riêng, kết nối
            ai-db

       •   frontend (Next.js) — base image node:20-alpine, 1 container riêng, gọi qua api-gateway


7. Phân công công việc cho nhóm 3 người
Chia 11 service theo nhóm framework đã xác định ở mục 1, cân bằng khối lượng công việc giữa 3
thành viên (mỗi người phụ trách 3-4 service backend + phần frontend liên quan trực tiếp đến domain
mình làm):

 Thành viên      Service backend phụ           Frontend liên quan         Ghi chú / phụ thuộc
                 trách

 Thành viên 1    Auth Service; Application     Trang đăng nhập/đăng       Làm Auth Service
 (Backend        Service; Interview & Video    ký, trang theo dõi trạng   TRƯỚC TIÊN vì mọi
 Java)           Call Service; Admin &         thái ứng tuyển, trang      service khác cần public
                 Statistics Service            lịch phỏng vấn & video     key JWT (RS256) để
                                               call, trang Admin          verify token; sau đó 3
                                               Dashboard                  service còn lại có thể
                                                                          làm song song

 Thành viên 2    User/Profile Service;         Trang hồ sơ ứng            Job & Search Service
 (Backend        Company Service; Job &        viên/CV Builder, trang     cần thống nhất schema
 Node —          Search Service; File/Media    công ty, trang tìm kiếm    Job với Thành viên 3
 CRUD)           Service                       & chi tiết job, chức       (AI Service đọc
                                               năng upload                job-events); tạo tài
                                               avatar/CV/ảnh              khoản Cloudinary chung
                                                                          cho cả nhóm sớm

 Thành viên 3    Notification Service; Chat    Trang chat real-time,      Phụ trách thêm hạ tầng
 (Backend        Service; AI Service           trung tâm thông báo,       chung:
 Node/Python     (chatbot +                    chatbot widget, mục        docker-compose.yml,
 + Hạ tầng)      recommendation)               "Việc làm phù hợp với      cấu hình Kafka topics,
                                               bạn"                       Nginx API Gateway,
                                                                          Jitsi self-host — vì phụ
                                                                          trách ít service backend
                                                                          hơn 2 thành viên còn lại

Lưu ý phối hợp nhóm
       •   Tuần đầu tiên: cả 3 thống nhất chung schema JWT payload (user_id, role, exp), danh sách
           Kafka topic (mục 2) và naming convention API (REST resource, DTO) trước khi code
           song song — tránh phải sửa lại hợp đồng API giữa chừng.
       •   Thành viên 1 nên hoàn thành Auth Service sớm nhất (trong 3-5 ngày đầu) và public thư
           viện/đoạn code mẫu xác thực dùng chung (verify JWT middleware/guard mẫu) để Thành
           viên 2 và 3 tích hợp ngay, tránh bị block.
       •   Mỗi thành viên tự viết Dockerfile cho service của mình; Thành viên 3 gộp lại thành
           docker-compose.yml chung của cả hệ thống ở giai đoạn tích hợp.
       •   Trước khi ghép nối (integration), mỗi thành viên nên có Postman collection hoặc Swagger
           UI cho service của mình để 2 người còn lại test thử mà không cần đọc code.
