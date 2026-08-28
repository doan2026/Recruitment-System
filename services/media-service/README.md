# File/Media Service

Media Service là nguồn dữ liệu gốc cho metadata file và là service duy nhất được giữ Cloudinary API secret. Service sinh capability upload có chữ ký để client upload thẳng lên Cloudinary, sau đó tự đọc metadata canonical từ Cloudinary để xác nhận file. Các service nghiệp vụ chỉ lưu và trao đổi `fileId`; không tự tin metadata hoặc URL do client gửi.

## Phạm vi hiện tại

Đã triển khai:

- signed upload intent có hạn 10 phút, idempotency, giới hạn 60 intent/requester/giờ và tối đa 20 intent còn hạn/requester/type;
- confirm bằng Cloudinary Admin API, không nhận metadata xác nhận từ client;
- kiểm tra owner, type, folder, resource/delivery type, format, dung lượng, thời điểm upload và provider identity;
- kiểm tra kích thước ảnh, thời lượng video và magic bytes có giới hạn 8 KiB cho file RAW;
- public metadata/download, private download URL, soft delete và reference binding;
- confirmation/delete fencing bằng `aggregateVersion`, lease recovery và exponential cooldown khi provider tạm lỗi;
- scheduled cleanup/reconciliation bền vững cho intent hết hạn, object orphan/sibling, file bị reject và delete retry;
- cycle election cùng heartbeat/fencing trên PostgreSQL, job lease bằng `SKIP LOCKED`, retry vô hạn có capped backoff và audit append-only;
- API nội bộ phân quyền theo từng service;
- Prisma migration, database constraints/trigger, Docker image non-root, migration job và gateway route;
- unit test cùng integration test trên PostgreSQL 16.

Chưa thuộc phạm vi đã hoàn thành:

- live smoke test với tài khoản Cloudinary và sáu preset thật;
- malware scanning và parser sâu cho PDF/DOC/DOCX;
- staging/promote trước khi public asset được phục vụ;
- distributed rate limit/token bucket cho confirm/cleanup theo user/IP/toàn hệ thống, active-byte quota và cảnh báo backlog;
- chính sách archive/retention cho metadata, cleanup job và cleanup audit event;
- media type/contract cho Offer letter;
- wiring client ở Profile, Company, Chat, Application, Interview và AI;
- tách database/runtime role, secret rotation và mTLS cho internal API.

## Policy v1

Giới hạn dùng byte nhị phân: 1 MiB = 1,048,576 byte.

| Type | Owner / bên tạo | Format | Tối đa | Cloudinary | Quota owner |
| --- | --- | --- | ---: | --- | ---: |
| `CV` | USER; Candidate hoặc Profile | PDF | 5 MiB | RAW / AUTHENTICATED | — |
| `AVATAR` | USER; Candidate, Recruiter, Admin hoặc Profile | JPG, PNG, WEBP | 2 MiB | IMAGE / UPLOAD | — |
| `COMPANY_LOGO` | COMPANY; Company Service | JPG, PNG, WEBP | 2 MiB | IMAGE / UPLOAD | 1 |
| `COMPANY_IMAGE` | COMPANY; Company Service | JPG, PNG, WEBP | 5 MiB | IMAGE / UPLOAD | 10 |
| `COMPANY_VIDEO` | COMPANY; Company Service | MP4 | 50 MiB | VIDEO / UPLOAD | 1 |
| `CHAT_ATTACHMENT` | USER; Candidate, Recruiter hoặc Chat Service | PDF, DOC, DOCX, JPG, PNG, WEBP | 10 MiB | RAW / AUTHENTICATED | — |

Public upload được fail-closed theo role:

- Candidate: `CV`, `AVATAR`, `CHAT_ATTACHMENT`;
- Recruiter: `AVATAR`, `CHAT_ATTACHMENT`;
- Admin: `AVATAR`.

Internal producer:

- `profile-service`: `CV`, `AVATAR`;
- `company-service`: logo, ảnh và video công ty;
- `chat-service`: `CHAT_ATTACHMENT`.

Internal consumer:

- `profile-service`: `CV`, `AVATAR`;
- `company-service`: ba type công ty;
- `application-service`, `interview-service`, `ai-service`: `CV`;
- `chat-service`: `CHAT_ATTACHMENT`.

`OFFER_LETTER` chưa có trong policy v1. Không dùng tạm một type khác cho Offer.

## API

Response thành công được bọc trong trường `data`; lỗi dùng `code`, `message` và `details`.

### Public qua API Gateway

| Method | Gateway route | Mô tả |
| --- | --- | --- |
| `POST` | `/files/signature` | Tạo signed intent; nhận `type`, `originalFilename`, hỗ trợ `Idempotency-Key` |
| `POST` | `/files` | Confirm bằng `fileId` sau khi client upload trực tiếp |
| `GET` | `/files/:id` | Lấy metadata theo owner |
| `POST` | `/files/:id/download-url` | Lấy URL public hoặc private URL ngắn hạn |
| `DELETE` | `/files/:id` | Xóa file chưa được service khác tham chiếu |
| `GET` | `/files/health` | Health/readiness của service |

Gateway bỏ prefix `/files` khi proxy. Nếu gọi trực tiếp container `media-service:3000`, các route tương ứng là `/signature`, `/`, `/:id`, `/:id/download-url`, `/health`.

JWT public phải là RS256 với `typ=JWT`, `kid`, issuer, audience, UUID v4 `sub`/`jti`, `iat`/`exp` và role canonical. Owner mismatch trả not-found để hạn chế IDOR.

### Internal, chỉ gọi trực tiếp trong service network

| Method | Direct route | Mô tả |
| --- | --- | --- |
| `POST` | `/internal/signature` | Tạo intent cho owner nghiệp vụ |
| `POST` | `/internal/confirm` | Producer confirm file |
| `POST` | `/internal/verify` | Xác minh ACTIVE + expected owner/type |
| `POST` | `/internal/download-url` | Xác minh scope rồi cấp URL |
| `POST` | `/internal/references` | Bind reference idempotent |
| `DELETE` | `/internal/references/:id` | Service sở hữu reference release reference |
| `DELETE` | `/internal/files/:id` | Producer xóa file đúng scope |

Mọi request internal cần:

```http
X-Internal-Service: profile-service
X-Internal-Api-Key: <distinct-key-at-least-32-bytes>
```

Mỗi danh tính service có key riêng và key được so sánh constant-time với đúng `X-Internal-Service`. Nginx chặn case-insensitive `/files/internal`, đồng thời xóa hai internal header trên public route. Internal controller cũng bị loại khỏi Swagger.

## Luồng upload và xác nhận

1. Public JWT hoặc internal service được kiểm tra role, producer, owner và type.
2. Service chuẩn hóa tên file NFC, từ chối path/control/format character và extension ngoài policy.
3. Transaction khóa scope, kiểm tra quota/idempotency rồi ghi `FileMeta(PENDING)`.
4. Service trả signed parameters; API secret không bao giờ được trả cho client.
5. Client upload bytes trực tiếp tới URL Cloudinary trong capability.
6. Client chỉ gửi lại `fileId` để confirm.
7. Service chuyển sang `VERIFYING`, đọc canonical metadata bằng Cloudinary Admin API và lấy tối đa 8 KiB đầu đối với RAW.
8. Service so khớp public ID, folder, context `file_id`, resource/delivery type, exact format, timestamp, size và content checks.
9. File hợp lệ chuyển `ACTIVE`; metadata provider đã confirm trở thành immutable.
10. Service nghiệp vụ verify rồi bind reference trước khi commit tham chiếu domain của mình.

Ảnh/video public chỉ trả canonical HTTPS URL thuộc đúng Cloudinary cloud. `CV` và `CHAT_ATTACHMENT` có `url=null`; download URL AUTHENTICATED chỉ sống 5 phút. Consumer phải lưu `fileId`, không persist URL tạm.

## State, idempotency và concurrency

State được lưu:

```text
PENDING -> VERIFYING -> ACTIVE
   |          |          |
   +-> EXPIRED/REJECTED  +-> DELETE_PENDING -> DELETED
              |                 |
              +-----------------+-> DELETE_FAILED -> retry
```

- Metadata không hard-delete; database trigger chặn xóa cứng và state transition sai.
- Reference chỉ được bind cho file `ACTIVE`, immutable và unique theo file/service/type/id.
- File có reference không thể vào `DELETE_PENDING`.
- Intent có TTL 10 phút và tối đa 20 intent chưa hết hạn trên mỗi requester/type.
- Idempotency key dài 8–128 ký tự safe; replay chỉ hợp lệ với cùng producer, owner, type và filename.
- Quota logo/image/video tính cả reservation `PENDING`/`VERIFYING` chưa hết hạn; bước finalize khóa lại cùng scope và đếm `ACTIVE` để không vượt quota khi một confirm kéo dài qua TTL.
- Transaction dùng PostgreSQL advisory/row lock ở `READ COMMITTED` và retry lỗi serialization/deadlock.
- `VERIFYING` và `DELETE_PENDING` có lease 5 phút; `aggregateVersion` đóng vai trò fencing token nên worker giữ lease cũ không thể ghi đè worker đã renew. Request mới và cleanup scheduler đều có thể khôi phục lease stale.
- Provider lookup thất bại đưa file về `PENDING` với cooldown 5–60 giây tăng theo số lần thử; đây không thay thế distributed rate limit cho Cloudinary Admin API.
- Delete provider failure chuyển `DELETE_FAILED` và có thể retry.

Bind reference và transaction ở service consumer không phải distributed transaction. Consumer cần chiến lược bind-before-use và compensation/retry nếu domain commit thất bại.

## Scheduled cleanup và reconciliation

Root Compose bật scheduler theo mặc định; nếu chạy ứng dụng mà không khai báo `MEDIA_CLEANUP_ENABLED`, scheduler fail-safe ở trạng thái tắt. Mỗi cycle thực hiện:

1. dùng giờ `clock_timestamp()` của PostgreSQL để chuyển `PENDING` hết hạn sang `EXPIRED`, khôi phục `VERIFYING` stale và phát hiện job còn thiếu;
2. ưu tiên `FILE_DELETE`, sau đó `ORPHAN_PURGE`, cuối cùng mới đến `SIBLING_SWEEP` để backlog lịch sử không chặn xóa file khẩn cấp;
3. claim job bằng `FOR UPDATE SKIP LOCKED`, tăng fencing token và xử lý object theo exact locator trước khi quét context `file_id`;
4. phân trang Cloudinary Admin API tối đa 5 trang × 100 object trên mỗi resource type, dùng `fetch` với `AbortSignal` để timeout hoặc mất cycle lease có thể hủy request thật;
5. chỉ đánh dấu reconciliation thành công sau hai clean pass cách nhau một khoảng ổn định. Lỗi provider được retry vô hạn với exponential backoff có trần, tránh biến outage dài thành object rác vĩnh viễn.

Cycle leader được bầu bằng lease PostgreSQL và heartbeat. Watchdog cục bộ abort trước hạn nếu heartbeat bị treo; heartbeat lỗi/mất lease cũng dừng discovery/claim mới và không complete lease cũ. Cycle complete và job finalize đều CAS `lease_until > clock_timestamp()`, nên owner hết hạn không thể thắng trong khe thời gian trước lúc worker khác reclaim. Log kết quả cycle có `dueJobsRemaining`, `nonTerminalJobs` và `oldestDueAt` để theo dõi backlog.

| Biến | Mặc định | Giới hạn/ý nghĩa |
| --- | ---: | --- |
| `MEDIA_CLEANUP_ENABLED` | `false` trong app, `true` ở root Compose | Bật/tắt scheduler |
| `MEDIA_CLEANUP_INTERVAL_SECONDS` | 300 | 30–3600 giây giữa hai cycle |
| `MEDIA_CLEANUP_BATCH_SIZE` | 5 | 1–20 job/cycle |
| `MEDIA_CLEANUP_LEASE_SECONDS` | 300 | 60–1800 giây và tối thiểu `7 × provider timeout + 10` |
| `MEDIA_CLEANUP_PROVIDER_TIMEOUT_SECONDS` | 20 | 1–60 giây cho mỗi request provider |
| `MEDIA_CLEANUP_RETRY_BASE_SECONDS` | 30 | 5–3600 giây |
| `MEDIA_CLEANUP_RETRY_MAX_SECONDS` | 21600 | 30–86400 giây và không nhỏ hơn retry base |
| `MEDIA_CLEANUP_PROVIDER_GRACE_SECONDS` | 300 | 60–3600 giây sau cửa sổ upload trước khi sweep |
| `MEDIA_CLEANUP_CLEAN_INTERVAL_SECONDS` | 60 | 10–3600 giây giữa hai clean pass |
| `MEDIA_CLEANUP_EXPIRED_RETENTION_SECONDS` | 86400 | 3600–604800 giây trước khi purge intent hết hạn |
| `MEDIA_CLEANUP_STARTUP_JITTER_SECONDS` | 30 | 0–300 giây |

Mặc định 5 claim/5 phút được giữ bảo thủ để không vượt ngân sách Cloudinary Admin API; không nên tăng chỉ để xả backlog khi chưa biết giới hạn plan. Production cần alert theo ba trường backlog nói trên và chốt distributed provider-rate budget. Metadata `EXPIRED/REJECTED/DELETED`, cleanup job và event hiện được giữ để audit; task archive/retention vẫn pending.

## Cloudinary

Biến bắt buộc:

```dotenv
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
CLOUDINARY_UPLOAD_PRESET_CV=recruitment_cv_signed
CLOUDINARY_UPLOAD_PRESET_AVATAR=recruitment_avatar_signed
CLOUDINARY_UPLOAD_PRESET_COMPANY_LOGO=recruitment_company_logo_signed
CLOUDINARY_UPLOAD_PRESET_COMPANY_IMAGE=recruitment_company_image_signed
CLOUDINARY_UPLOAD_PRESET_COMPANY_VIDEO=recruitment_company_video_signed
CLOUDINARY_UPLOAD_PRESET_CHAT_ATTACHMENT=recruitment_chat_attachment_signed
```

Sáu preset phải là signed preset và phải enforce đúng allowed format, max file size cùng delivery rule tương ứng bảng policy. Service ký exact format/folder/public ID/context, nhưng Cloudinary chọn `resource_type` bằng upload endpoint chứ không đưa trường đó vào chữ ký. Vì vậy confirm quét context `file_id` trên cả `image`/`video`/`raw`, từ chối và cố xóa toàn bộ identity lệch. Giới hạn upload-side về dung lượng vẫn phụ thuộc cấu hình preset; confirm và database constraints là lớp chặn cuối.

Service không tự tạo hoặc gọi remote để xác minh preset khi khởi động. Health chỉ kiểm tra database, cấu hình JWT, sáu internal key và sự hiện diện của Cloudinary credentials/preset name. Vì vậy cần live smoke test trên environment trước release.

## Live Cloudinary staging smoke

Runner `scripts/cloudinary-live-smoke.js` là acceptance gate opt-in, không nằm trong `npm test` và mặc định fail-closed. Runner chỉ bắt đầu khi `CLOUDINARY_LIVE_SMOKE=1` và `CLOUDINARY_LIVE_SMOKE_CONFIRM_CLOUD` khớp chính xác `CLOUDINARY_CLOUD_NAME`.

Runner lấy đúng sáu case từ `MEDIA_POLICIES`, audit read-only từng preset qua Cloudinary Admin API rồi chạy tuần tự:

1. tạo capability qua internal `/internal/signature`;
2. upload multipart trực tiếp bằng đúng params/signature;
3. confirm và verify canonical metadata qua Media Service;
4. kiểm public CDN hoặc private download ngắn hạn thực sự truy cập được;
5. delete bằng exact Media `fileId`;
6. trong `finally`, retry exact asset locator và sweep exact context `file_id` trên `image`/`video`/`raw`, sau đó xác nhận context rỗng.

Preset audit yêu cầu Admin API trả rõ `unsigned=false`, `allowed_formats`, `max_file_size` và `type`; các giá trị phải khớp chính xác policy. Runner không tạo/sửa/xóa preset, không xóa theo folder/prefix và không ghi secret, signature, private URL hoặc nội dung fixture ra log.

Ngoài Cloudinary credential, sáu preset và ba internal key Profile/Company/Chat, cấu hình:

```dotenv
CLOUDINARY_LIVE_SMOKE=1
CLOUDINARY_LIVE_SMOKE_CONFIRM_CLOUD=<exact CLOUDINARY_CLOUD_NAME>
CLOUDINARY_LIVE_SMOKE_MEDIA_BASE_URL=https://media.staging.example
CLOUDINARY_LIVE_SMOKE_PDF_PATH=/absolute/path/smoke.pdf
CLOUDINARY_LIVE_SMOKE_IMAGE_PATH=/absolute/path/smoke.png
CLOUDINARY_LIVE_SMOKE_VIDEO_PATH=/absolute/path/smoke.mp4
```

Base URL phải là direct Media origin, không phải public gateway; HTTP chỉ được chấp nhận cho loopback. PDF phải có magic `%PDF-`, ảnh là JPG/PNG/WEBP hợp lệ và video là MP4 hợp lệ có duration dương. Fixture phải là regular file không rỗng và không vượt giới hạn policy. Một PDF được dùng cho CV/chat, một ảnh cho avatar/logo/company image và một MP4 cho company video.

Sau khi build, chạy với environment được inject từ secret manager hoặc shell:

```bash
npm run build
npm run test:cloudinary:live
```

Runtime image cũng chứa runner và compiled `dist`, nên có thể chạy cùng package command trong staging nếu fixture được mount read-only và các biến môi trường được inject. Không chạy task này trên production cloud. Nếu bất kỳ bước chính hoặc cleanup nào lỗi, lệnh trả exit code khác 0; lỗi cleanup không che lỗi ban đầu.

## Cấu hình và chạy local

Node.js 24 LTS và PostgreSQL 16 được hỗ trợ. Khi chạy trực tiếp, tạo `.env` từ `.env.example` rồi thay toàn bộ placeholder, đặc biệt phải ghi `DATABASE_URL` thành URL PostgreSQL hoàn chỉnh. Sáu internal key phải khác nhau và mỗi key dài ít nhất 32 byte.

```bash
npm ci
npm run prisma:migrate:deploy
npm run start:dev
```

Swagger public: `http://localhost:3000/docs` khi `SWAGGER_ENABLED=true`. Production nên giữ `SWAGGER_ENABLED=false`.

Root Compose dùng one-shot `media-migrate` trước runtime:

```bash
docker compose up --build media-migrate media-service
```

Khi chạy bằng root Compose, `.env` ở root là nguồn cấu hình Media duy nhất cho database, Cloudinary và sáu `MEDIA_INTERNAL_API_KEY_*`; Compose sẽ dừng ngay nếu một biến bắt buộc bị thiếu. File `services/media-service/.env` chỉ dành cho chạy service trực tiếp bằng npm, không được root Compose nạp.

Hiện root Compose dùng PostgreSQL chung với schema `media`, chưa phải container/database `file-db` và credential riêng như kiến trúc đích.

## Kiểm thử

Chạy unit + integration trên PostgreSQL 16 sạch:

```bash
docker compose -p recruitment-media-test-local -f compose.test.yml down -v --remove-orphans
docker compose -p recruitment-media-test-local -f compose.test.yml up --build --abort-on-container-exit --exit-code-from media-tests
```

Kết quả xác nhận gần nhất: **26/26 unit + 26/26 TAP integration test**. Integration test dùng PostgreSQL 16 thật và `FakeStorageProvider` deterministic; Cloudinary adapter được unit-test bằng SDK/fetch mock. Đây không phải live Cloudinary integration test.

Phạm vi test gồm:

- default-deny auth, JWT role/owner, JWKS cold-start single-flight và per-service internal key;
- intent TTL/idempotency, atomic 60-intent/hour rate limit, quota và concurrency;
- đủ sáu policy tại exact size boundary;
- spoofed provider metadata, RAW magic bytes và provider outage;
- private delivery và owner-scoped download;
- concurrent reference bind, delete đang được tham chiếu và delete retry;
- stale confirm/delete lease recovery, fencing worker cũ và quota recheck khi confirm vượt TTL;
- cycle election/heartbeat loss/watchdog, DB clock, job lease reclaim/fencing và queue priority;
- exact orphan cleanup khi context lookup không thấy object, active canonical/sibling reconciliation, hai clean pass và provider outage recovery;
- Cloudinary context pagination, immutable `assetId`, request timeout có hủy thật và capped retry;
- database state/audit constraints, hard-delete guard và migration safety.

Kiểm tra migration lặp và schema drift:

```bash
docker compose -p recruitment-media-test-local -f compose.test.yml up -d postgres-test
docker compose -p recruitment-media-test-local -f compose.test.yml run --rm --no-deps media-tests npx prisma migrate deploy
docker compose -p recruitment-media-test-local -f compose.test.yml run --rm --no-deps media-tests npx prisma migrate diff --from-url postgresql://media_test:media_test_password@postgres-test:5432/media_test?schema=media --to-schema-datamodel prisma/schema.prisma --exit-code
```

Kết quả gần nhất: deploy lần hai không còn migration pending và `No difference detected`.

## Việc tiếp theo

1. Tạo/kiểm tra sáu signed preset và chạy live Cloudinary smoke.
2. Chốt `fileId` + private delivery contract rồi nối Profile CV/avatar.
3. Nối Company/Chat và các CV consumer Application/Interview/AI.
4. Chốt media type riêng cho Offer letter.
5. Bổ sung alert backlog, distributed provider-rate budget và chính sách archive/retention.
6. Tách runtime/migrator DB role, đưa secret vào secret manager, bổ sung rotation/mTLS và chạy full Compose/E2E.
