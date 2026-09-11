# Báo cáo sửa lỗi luồng Người 2 — 10/09/2026

## Phạm vi và nhánh

- Nhánh: `fix/person2-full-flow`, tạo sau khi chuyển về `develop` và `git pull --ff-only origin develop`.
- Baseline sau pull: `10d4cb9` (đã có PR #135 sửa COPY components/lib trong Dockerfile FE).
- Chỉ sửa Company, Job/Search, Application và FE tương ứng; dùng API Auth/Profile có sẵn, không sửa backend các nhóm khác.
- Chưa commit/push, không thay đổi `.env` thật, không thao tác dữ liệu của database dự án.
- Sau xác nhận tiếp theo của người dùng, đã sửa riêng `frontend`/`ai-service` và thêm `ai-migrate` trong Compose; so sánh cấu hình đã phân giải xác nhận mọi service còn lại, port/volume và cấu hình cấp root không đổi.
- Tham chiếu phạm vi nghiệp vụ: `TIEN_DO_DU_AN.md`. Báo cáo này là delta sửa lỗi, không thay thế toàn bộ báo cáo tiến độ.

## Những lỗi đã xử lý

| Nhóm | Kết quả |
|---|---|
| Company BE + FE | Form đủ 7 trường; gửi expectedVersion từ snapshot đang sửa; 409 so sánh đủ trường, giữ draft. Media không âm thầm nâng baseline. Website rỗng gửi null; thay đổi pháp lý vẫn xác nhận duyệt lại. |
| Job BE + FE | Đồng bộ FULL_TIME/PART_TIME/REMOTE/INTERNSHIP; giữ currency thực tế. Update DTO không chèn VND khi chỉ sửa trường khác. Job response có aggregateVersion; expectedVersion chặn stale form. |
| Validation/quyền | Job trim trước validation và kiểm lại non-blank tại service. Company lookup của Job CRUD fail closed khi response thiếu/sai companyId hoặc memberRole. |
| Đăng nhập/phiên | Login/logout/refresh theo JSON contract Auth hiện có; token chỉ trong memory. Private routes có gate, thanh điều hướng theo role thật. Chặn vòng lặp401 và response/refresh của tài khoản cũ; refresh single-flight theo phiên; không gửi expired bearer vào Auth. |
| Job detail/gợi ý | Chi tiết public không phụ thuộc AI hoặc đăng nhập. Link gợi ý giữ source; fallback rỗng vẫn có hướng dẫn. Recruiter có tải thêm cursor, bỏ trùng và xử lý cursor stale. |
| Ứng tuyển/Bookmark | Đọc CV active từ Profile để chọn; source đúng, khóa gửi trùng. Có lưu/bỏ lưu ở Job detail và danh sách; DELETE204 không bị coi là lỗi JSON. |
| Tracking/Offer/Evaluation | Giữ timeline, coverLetter và offerId từ BE. GET Offer có kiểm quyền và snapshot nhất quán của hai phiên bản; phản hồi qua dialog xác nhận, kiểm hạn trước POST. GET Evaluation để đọc lại đánh giá đã lưu. |
| Application outbox | Predecessor gate theo aggregateVersion, khóa FOR UPDATE SKIP LOCKED; event backoff chặn event tiếp theo cùng application, không chặn application khác. Giữ at-least-once và eventId ổn định. |
| FE build/runtime | npm ci từ lockfile; build-time API_MODE gateway mặc định; proxy cùng origin /api; URL nội bộ riêng cho Next server và Docker runtime. Compose đã ấn định mode gateway và /api ở cả build/runtime; env local demo không ghi đè Docker. |
| UI | Giữ DESIGN.md/tokens hiện tại; thống nhất session gate, confirmation và conflict recovery. Bỏ số thống kê giả ở màn đã sửa. |

### Contract có thay đổi cần lưu ý khi gọi API

- `PUT /companies/:id`: body phải có `expectedVersion >= 0`, lấy từ `aggregateVersion` đang hiển thị. Áp dụng cả PUT media.
- `PUT /jobs/:id`: body phải có `expectedVersion >= 1`. Không tự fetch phiên bản mới rồi âm thầm ghi đè draft cũ.
- `GET /offers/:id`: Candidate sở hữu đơn hoặc Recruiter đúng công ty. `version` là phiên bản Offer; `applicationVersion` là phiên bản Application.
- `GET /applications/:id/evaluations` qua Gateway: Recruiter đúng công ty; Candidate không được đọc.
- Application detail và list có nullable `offerId`.
- Flyway mới: `V11__order_application_event_outbox.sql`. Thêm generated column và index pending; không xóa bảng/dữ liệu. Migration có thể giữ khóa ALTER TABLE, cần kiểm tra kích thước outbox và lên lịch phù hợp khi triển khai dữ liệu lớn.
- Auth hiện trả token trong JSON, chưa có HttpOnly session/BFF. Phiên memory-only sẽ yêu cầu đăng nhập lại khi reload toàn trang.

## Bằng chứng kiểm tra

| Kiểm tra | Kết quả |
|---|---|
| Company unit + Nest build | 334/334 PASS; build PASS |
| Job/Search unit + Nest build | 577/577 PASS; build PASS; tsc spec PASS |
| Application Maven package | 324/324 PASS; build JAR PASS |
| Application PostgreSQL16 thực | 6/6 PASS: migration, ordering, retry/backoff, hai replica, rollback. Kafka được mock để gây lỗi có kiểm soát. |
| FE unit | 131/131 PASS |
| FE production build và typecheck | PASS |
| Browser regression | 52/52 PASS (44 lượt chính + 8 bổ sung): desktop1440×960 và mobile390×844; API mock, không phải deployed E2E |
| Strict UI audit | 0 findings |
| Compose config | `docker compose config --quiet` PASS; 12/12 assertions FE/AI PASS; chỉ frontend/ai-service đổi và thêm ai-migrate |
| Docker runtime | CHƯA KIỂM CHỨNG: socket `/var/run/docker.sock` không có trong môi trường kiểm tra |
| Whitespace/patch | `git diff --check` PASS |

Test bổ sung: `person2-session-apply.spec.ts` và case Offer hết hạn trong dialog ở `person2-flow-fixes.spec.ts`. Đã kiểm tra không POST Offer quá hạn, không lặp401, CV/source đúng và DELETE204 hoạt động.

## Những phần còn pending — không tuyên bố đã xong

1. **Docker runtime cần kiểm chứng:** phần Compose FE/AI đã được cho phép và đã sửa. Chưa khởi động container hoặc chạy migration vì không kết nối được Docker daemon của môi trường kiểm tra.
2. **Cấu hình local vẫn giữ nguyên của bạn:** `frontend/.env` đang demo, API URL localhost8080; root .env cũng dùng localhost8080. Để thử gateway bằng Next local khi backend đã chạy, dùng lệnh bên dưới. Docker Compose đã ghi đè các giá trị public bằng gateway + /api, không phụ thuộc cấu hình local demo. Cấu hình đã kiểm tra, runtime Docker chưa nghiệm thu.
3. **AI ngoài root Compose:** trong cùng Compose project, ai-migrate chạy trước API và worker; API command không còn tự migrate. Dockerfile AI standalone vẫn giữ hành vi cũ. Nếu dùng orchestrator khác hoặc nhiều project trỏ cùng DB, phải bảo đảm chỉ một migration job trước rollout; không coi thay đổi này là khóa phân tán toàn hệ thống.
4. **Gateway Person2-only:** cấu hình chung vẫn có upstream/dependency của các service khác; chưa tạo gateway riêng hoặc đổi orchestration toàn dự án.
5. **Tạo/tải/quản lý CV đầy đủ** thuộc nhóm Profile/Media. FE Người2 chỉ đọc/chọn CV đang có, route /candidate/profile/cvs có hướng dẫn rõ; không giả vờ đã hoàn thiện CV builder/upload.
6. **Offer file attachment, Cloudinary thật, AI model/Claude thật, Notification liên thông, Admin duyệt và deployed E2E** cần hệ thống tích hợp và cấu hình hợp lệ. Không sửa policy Media ngoài phạm vi.
7. **Dirty navigation:** đã chặn hủy/đóng form Company bẩn; guard mọi link, browser Back, reload vẫn là hạng mục riêng.
8. **Không có bảo đảm exactly-once Kafka:** outbox cố ý at-least-once; consumer vẫn cần dedupe eventId và áp phiên bản. Test6/6 không phải Kafka cluster E2E.

## Chạy kiểm tra lại

Từ root, cài Node đúng môi trường terminal rồi:

```bash
cd frontend
npm ci
npm test
npm run typecheck
npm run test:e2e
npm run build
```

Browser suite dùng Chrome channel; cần có Chrome trên máy.

Chạy FE nối Gateway local đã có sẵn:

```bash
cd frontend
NEXT_PUBLIC_API_MODE=gateway NEXT_PUBLIC_API_BASE_URL=/api API_INTERNAL_BASE_URL=http://localhost:8080 npm run dev
```

Vào http://localhost:3000/login bằng tài khoản đã được xác minh. Không cung cấp tài khoản/mật khẩu mẫu giả cho database.

Kiểm tra Docker (sau khi bật Docker Engine/Desktop):

```bash
docker compose config --quiet
docker compose ps
```

Không dùng `down -v`, xóa volume hoặc reset database để giải quyết các lỗi này. Chưa tự động push; cần nghiệm thu và xem diff trên nhánh sửa lỗi trước khi tạo PR về develop.

## Cập nhật Compose sau khi được xác nhận

- `frontend`: build args và runtime cùng dùng `NEXT_PUBLIC_API_MODE=gateway`, `NEXT_PUBLIC_API_BASE_URL=/api`; Next server dùng `API_INTERNAL_BASE_URL=http://api-gateway`. Giữ nguyên cổng FE3000, không sửa Gateway hay backend nhóm khác.
- `ai-migrate`: dùng cùng image target runtime và file môi trường AI; chỉ chạy `alembic upgrade head`, chờ PostgreSQL healthy, không tự restart.
- `ai-service`: chỉ chạy Uvicorn, chờ migration exit0. Hai worker giữ dependency API healthy, nên không chạy trước khi schema sẵn sàng.
- Trong Docker Desktop, `ai-migrate` ở trạng thái `Exited (0)` sau khi hoàn tất là bình thường. Không xóa volume hoặc chạy migration trực tiếp vào DB trong phiên sửa code.
- Chỉ kiểm tra cấu hình trong lần cập nhật này; các kết quả BE/FE ở trên thuộc lượt kiểm thử code trước đó, không chạy lại toàn bộ vì không đổi logic ứng dụng.
