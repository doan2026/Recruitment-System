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
- API nội bộ phân quyền theo từng service;
- Prisma migration, database constraints/trigger, Docker image non-root, migration job và gateway route;
- unit test cùng integration test trên PostgreSQL 16.

Chưa thuộc phạm vi đã hoàn thành:

- scheduler dọn intent/file rác và reconciliation Cloudinary chạy nền;
- live smoke test với tài khoản Cloudinary và sáu preset thật;
- malware scanning và parser sâu cho PDF/DOC/DOCX;
- staging/promote trước khi public asset được phục vụ;
- distributed rate limit/token bucket cho confirm theo user/IP/toàn hệ thống và active-byte quota/retention;
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
- `VERIFYING` và `DELETE_PENDING` có lease 5 phút; `aggregateVersion` đóng vai trò fencing token nên worker giữ lease cũ không thể ghi đè worker đã renew. Hiện lease chỉ được khôi phục khi request confirm/delete mới tới.
- Provider lookup thất bại đưa file về `PENDING` với cooldown 5–60 giây tăng theo số lần thử; đây không thay thế distributed rate limit cho Cloudinary Admin API.
- Delete provider failure chuyển `DELETE_FAILED` và có thể retry.

Bind reference và transaction ở service consumer không phải distributed transaction. Consumer cần chiến lược bind-before-use và compensation/retry nếu domain commit thất bại.

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

Kết quả xác nhận gần nhất: **12/12 unit + 18/18 TAP integration test**. Integration test dùng PostgreSQL 16 thật và `FakeStorageProvider` deterministic; Cloudinary adapter được unit-test bằng SDK/fetch mock. Đây không phải live Cloudinary integration test.

Phạm vi test gồm:

- default-deny auth, JWT role/owner, JWKS cold-start single-flight và per-service internal key;
- intent TTL/idempotency, atomic 60-intent/hour rate limit, quota và concurrency;
- đủ sáu policy tại exact size boundary;
- spoofed provider metadata, RAW magic bytes và provider outage;
- private delivery và owner-scoped download;
- concurrent reference bind, delete đang được tham chiếu và delete retry;
- stale confirm/delete lease recovery, fencing worker cũ và quota recheck khi confirm vượt TTL;
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
2. Implement scheduled cleanup/reconciliation cho intent hết hạn, object orphan, `REJECTED` và delete retry.
3. Chốt `fileId` + private delivery contract rồi nối Profile CV/avatar.
4. Nối Company/Chat và các CV consumer Application/Interview/AI.
5. Chốt media type riêng cho Offer letter.
6. Tách runtime/migrator DB role, đưa secret vào secret manager, bổ sung rotation/mTLS và chạy full Compose/E2E.
