# Kiểm thử hệ thống trên Docker local — 16/10/2026

Múi giờ báo cáo: GMT+7 (`Asia/Ho_Chi_Minh`). Nhánh: `develop`.
Phạm vi theo yêu cầu mới nhất: khởi chạy toàn hệ thống, kiểm thử nghiệp vụ liên
service và sửa lỗi backend/frontend cần thiết. AI Assistant giữ tắt theo lựa chọn
của chủ dự án; gợi ý và matching bằng model local vẫn hoạt động.

## Môi trường và dữ liệu

- Docker Compose gốc: frontend, Nginx, 12 API service, 2 embedding worker,
  PostgreSQL/pgvector, Redis, Kafka, Elasticsearch và MongoDB tương thích.
- Chốt runtime: cả 12 health endpoint qua cổng host 8081–8092 trả HTTP 200;
  frontend/gateway/hạ tầng có healthcheck đều healthy. Hai worker đang chạy và
  đã xử lý thành công các event fixture. Compose chính được để chạy để test tiếp.
- PostgreSQL dữ liệu dự án được giữ nguyên. Không reset schema hay xóa volume
  dự án. Unit/integration test sử dụng database/container test riêng.
- Luồng nghiệm thu dùng 4 tài khoản fixture mới, công ty/tin/CV/đơn ứng tuyển giả
  lập riêng. Không đổi quyền hoặc mật khẩu tài khoản có sẵn.
- Credential fixture, token, URL ký riêng tư và log tạm chỉ lưu trong `.cache`
  đã bị Git bỏ qua. Báo cáo và commit không chứa secret.
- Đăng ký OTP sử dụng alias Gmail của chủ dự án đã cho phép; mã do chủ dự án
  cung cấp được xác minh thành công. Không bật MailHog trở lại.

## Kết quả chạy với dịch vụ thật

| Luồng | Bằng chứng đã kiểm tra |
| --- | --- |
| Auth ba vai trò | Đăng nhập qua UI Docker bằng Candidate/Recruiter/Admin; response chỉ có user, access/refresh là HttpOnly; tải lại trang vẫn giữ phiên |
| Phiên đăng nhập | Xóa access cookie rồi tải lại trang: refresh rotation thật khôi phục phiên, response không lộ token; đăng xuất UI xóa cookie và `/auth/me` trả 401 |
| OTP Gmail | Gửi thư bằng SMTP thật, xác minh mã qua `/api/auth-cookie/verify` trả 200, cookie đăng nhập đọc được `/auth/me` đúng chủ tài khoản |
| Google OAuth | Chủ dự án trực tiếp thao tác và xác nhận đăng nhập thành công, vào đúng vai trò. Hai cổng Candidate/Recruiter và state/binder/cookie/chống replay được kiểm thử tự động riêng |
| Profile/Media | Lưu hồ sơ; upload PDF thật vào Cloudinary bằng signed capability; confirm fileId; tải riêng tư kiểm tra chữ ký `%PDF-`; người khác không đọc được CV |
| Company/Job/Admin | Recruiter tạo công ty → Admin duyệt → tạo/submit tin → Admin duyệt → đọc tin công khai và tìm thấy qua Elasticsearch |
| Application | Lưu việc làm, nộp đơn, chặn đơn trùng, scope Candidate/Recruiter, pin snapshot CV, chuyển trạng thái, lưu đánh giá |
| Offer | Recruiter gửi offer; Candidate chấp nhận bằng đúng version; đơn chuyển HIRED; người ngoài không đọc được offer |
| Xóa CV đã dùng | CV ẩn khỏi danh sách Candidate nhưng Recruiter vẫn đọc/tải đúng snapshot riêng tư đã nộp; không phá deletion fence |
| Interview | Đặt lịch OFFLINE qua Application authorization; lưu GMT+7 đúng; Candidate đọc lịch riêng. Kiểm tra cả API thật và submit form UI thật trên Docker |
| Chat | Tin nhắn lưu DB; người ngoài bị từ chối; Recruiter gửi bằng UI, Candidate nhận ngay qua WebSocket |
| Notification | Kafka tạo inbox thật; đánh dấu đã đọc làm giảm unread; trình duyệt nhận notification qua SSE có xác thực |
| Video/LiveKit | API tạo/join/end call; người ngoài không join; hai trình duyệt kết nối LiveKit Cloud, phát âm thanh giả lập và nhận remote audio track; đóng phòng thử khi xong |
| AI gợi ý/matching | PDF giả lập → Media → Kafka → sentence-transformers CPU local → pgvector. Candidate nhận nguồn AI với score; Recruiter thấy ứng viên đã đồng ý chia sẻ; Application lưu match score số thật |
| Admin quản trị | Xuất CSV/XLSX thật, Candidate bị chặn Admin; xử lý báo cáo USER khóa tài khoản fixture, login và `/auth/me` từ chối, có audit; mở khóa đăng nhập lại thành công; đăng xuất trực tiếp từ workspace xóa cookie thật |
| Trang UI thay dữ liệu mẫu | Pipeline/chi tiết hồ sơ, form/lịch phỏng vấn, bốn trang con Admin, dashboard và metadata CV gọi API thật; đường dẫn CV builder/gợi ý cũ trỏ sang chức năng đang hoạt động |

Các kết quả này phân biệt với browser contract test dùng API giả lập bên dưới.
Test LiveKit chỉ dùng thiết bị âm thanh giả lập, không thu micro/camera thật.
Model embedding chạy local; không gửi CV sang Anthropic/Gemini.

## Các lỗi đã sửa

1. Compose còn cấu hình Chat/Notification theo runtime Node cũ: sai port,
   healthcheck, dữ liệu Mongo và thiếu PostgreSQL/JWKS/Kafka cho Go Chat.
   Đồng bộ với runtime hiện tại; mở Video trên loopback 8092 và chờ readiness.
2. Next.js bỏ slash cuối trong khi nginx thêm slash ở `/applications`, tạo vòng
   lặp 308/301 khiến pipeline bị treo. Gateway phục vụ trực tiếp cả hai dạng.
3. Lockfile frontend không phải JSON hợp lệ sau merge. Tạo lại từ manifest sạch
   với các dependency SWC theo nền tảng; Docker không tải Chromium cho Puppeteer.
4. Auth session frontend có merge lỗi, OTP/Google chưa tạo cookie như password,
   binder Google bị lệch đường dẫn. Thống nhất proxy HttpOnly, bảo toàn binder
   canonical và chỉ trả user về JavaScript.
5. Hydration phiên cũ có thể hủy login mới hoặc exchange Google. Google callback
   tự exchange một lần, không chạy hydration cạnh tranh; login/OTP chờ hydration
   ban đầu hoàn tất. Có test chủ động giữ chậm refresh rồi đăng nhập.
6. Jackson chuyển offset `+07:00` sang UTC trước khi Interview kiểm tra IANA zone,
   làm lịch hợp lệ bị 400. Giữ offset nhập vào, vẫn giữ nguyên kiểm tra timezone.
7. Các trang pipeline/phỏng vấn/Admin/dashboard/CV hiển thị dữ liệu cố định hoặc
   nút không thực hiện. Nối API thật, loading/error/retry và version/idempotency.
   Tính năng chưa có backend được trình bày đúng trạng thái khả dụng.
8. Video reject chưa kiểm tra người được mời; phòng bị từ chối vẫn có thể join
   và xuất hiện trong active list. Kiểm tra actor ở repository và giới hạn status.
9. Job phân loại sai lỗi Company lookup, ảnh hưởng trạng thái lỗi indexing.
   Dùng lỗi có kiểu rõ ràng. Sửa Docker test thiếu thư mục setup và tách Kafka
   topic từng lượt outbox test để không đọc event cũ.
10. Admin thiếu query bắt buộc bị trả 503 thay vì 400. Thêm xử lý validation và
    MockMvc regression test.
11. Worker embedding chờ kiểm tra mạng dù model đã có đủ trong volume. Kiểm chứng
    model offline tạo vector 384 chiều, sau đó bật
    `EMBEDDING_MODEL_LOCAL_FILES_ONLY=true` cho máy hiện tại. Mẫu cấu hình vẫn
    mặc định false để máy mới có thể tải model lần đầu.
12. Workspace Admin thiếu nút đăng xuất trực tiếp. Bổ sung nút dùng cùng cookie
    proxy; nếu server chưa xác nhận thu hồi, trang đăng nhập hiện thông báo đúng
    thay vì tuyên bố đã thu hồi phiên trên server.

## Kiểm thử tự động

| Phần | Kết quả |
| --- | --- |
| Auth | 232 unit + 44 integration đạt |
| Admin | 23 unit + 5 PostgreSQL integration đạt |
| Application | 326 unit + 107 integration đạt; thêm 6 outbox ordering test opt-in đạt trên DB riêng |
| Interview | 144 unit + 16 integration đạt |
| Profile | 62 unit + 89 integration đạt |
| Media | 26 unit + 27 integration đạt |
| Company | 352 unit + 19 integration đạt |
| Job & Search | 632 test đạt, 26 suite, bật PostgreSQL/Kafka integration |
| AI | 751 pytest đạt; ruff check và format đạt |
| Chat/Notification/Video | Cả ba `go test -count=1 ./...` đạt, gồm JWT và integration dùng PostgreSQL/Redpanda |
| Frontend | 143 unit đạt; TypeScript typecheck và Docker production build đạt |
| Browser desktop/mobile | 138/138 đạt trong một lượt đầy đủ cuối cùng (5,3 phút), không retry |

Application ban đầu báo 113 integration case, trong đó 6 bị skip vì thiếu
`APPLICATION_OUTBOX_TEST_URL`. Sáu case này đã được chạy riêng thành công với
database `person2_outbox_test` trên container tạm, không dùng DB dự án. Container
tạm đã được dọn sau khi hoàn tất.

Lệnh tái chạy chính:

```powershell
docker compose up -d --build --wait --wait-timeout 240
docker compose ps

# Chạy tại frontend
npm.cmd ci
npm.cmd test
npm.cmd run typecheck
npx.cmd playwright test

# Chạy tại Auth/Admin (Java 21, Docker đang bật)
mvn.cmd -Pintegration '-Dapi.version=1.44' verify
# Chạy tại Application/Interview
mvn.cmd -Pintegration-test '-Dapi.version=1.44' verify

# Ví dụ Node/Python integration với hạ tầng test độc lập
docker compose -f services/job-search-service/compose.test.yml up --build --abort-on-container-exit --exit-code-from job-tests
docker compose -f services/ai-service/compose.test.yml up --build --abort-on-container-exit --exit-code-from ai-tests

# Chạy tại mỗi Go service, Docker đang bật
go test -count=1 ./...
```

Các smoke script cục bộ và kết quả JSON nằm trong `.cache/system-*`: `live`,
`hiring`, `browser-live`, `provider`, `ai-live`, `admin-live`, `email`. Chúng tham
chiếu fixture và credential riêng của máy này nên không commit. Browser regression
có thể tái chạy từ `frontend/tests/e2e` không cần secret cloud thật; các bài đó
khóa hợp đồng UI/API bằng mock, không thay thế nghiệm thu provider thật ở trên.

Script UI thật có thể tái chạy trên bộ fixture đã chuẩn bị của máy này:

```powershell
node scripts/test-system-browser.cjs .cache/system-accounts.json .cache/system-state.json
```

Script chỉ chấp nhận email fixture `@careerhub.local`, bốn role đã định nghĩa và
UUIDv4 đúng định dạng. Nó đăng nhập qua UI, đọc các tài nguyên fixture, gửi một
tin nhắn thử và tạo lịch OFFLINE cho đơn fixture nếu chưa có; không chạy với tài
khoản người dùng thật. File accounts có `{batch, accounts}`; mỗi account gồm
`id/email/password/role`. File state ghi ID của các tài nguyên fixture đã chuẩn bị
(`applicationId` HIRED, `aiApplicationId` APPLIED/REVIEWING, `aiCvId`, `chatId`,
`aiInterviewId` nếu đã có). Kết quả và ảnh lỗi chỉ ghi vào `.cache/system-browser`.
Script kiểm tra giao diện với dữ liệu sẵn có, không tự dựng lại toàn bộ fixture
và không chứa credential mặc định được commit.

Lượt nghiệm thu script cuối đạt 12 bước trên Compose chính: đăng nhập ba vai trò,
khôi phục cookie sau reload, refresh thật, Candidate application/calendar,
Recruiter pipeline/detail, Admin export/phân quyền, các workspace/CV/dashboard,
lịch phỏng vấn đã lưu, WebSocket, Kafka/SSE, Candidate logout và Admin logout.

## Giới hạn còn lại

- **AI Assistant giữ tắt** theo yêu cầu (`CHAT_ENABLED=false`), chưa nghiệm thu
  chatbot Anthropic/Gemini. Luyện phỏng vấn AI chưa được backend triển khai.
- **Lịch phỏng vấn ONLINE chưa hỗ trợ**: Interview trả
  `INTERVIEW_ONLINE_NOT_READY`. Video call qua Tin nhắn đã chạy LiveKit thật,
  nhưng chưa có liên kết lifecycle Interview ↔ Video; không dùng nhầm hai loại ID.
- Báo cáo JOB/COMPANY vẫn chưa có hợp đồng Admin gỡ nội dung. Hệ thống nhận báo
  cáo và cho bỏ qua, không giả lập xử lý RESOLVED. USER report đã nghiệm thu thật.
- Admin `UNKNOWN/PROCESSING` sau remote timeout vẫn cần đối soát; đây không phải
  thao tác đã thành công để tự động gửi lại.
- Auth kiểm tra trạng thái khóa bền vững; các API stateless khác vẫn theo TTL
  access token hiện có. Môi trường local chia sẻ PostgreSQL credential, chưa phải
  mô hình database/credential tách riêng cho production.
- Chưa chạy bài tải đồng thời dài hạn hoặc khẳng định chất lượng xếp hạng AI
  trên bộ CV thực tế. Kết quả hiện tại là kiểm thử chức năng và hợp đồng.

## Truy cập localhost

- Ứng viên: <http://localhost:3000/login>
- Nhà tuyển dụng: <http://localhost:3000/recruiter/login>
- Admin: <http://localhost:3000/admin/login>
- API gateway: <http://localhost:8080/auth/health>
- API trực tiếp: Auth 8081, Profile 8082, Media 8083, Admin 8084, Company 8085,
  Job 8086, Application 8087, Interview 8088, Notification 8089, Chat 8090,
  AI 8091, Video 8092 (loopback; theo giá trị cổng trong `.env`).

Không đặt tài khoản/mật khẩu test hoặc secret provider vào tài liệu công khai.
