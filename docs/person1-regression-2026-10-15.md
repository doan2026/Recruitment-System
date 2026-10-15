# Kiểm thử luồng Người 1 — 15/10/2026 (GMT+7)

Phạm vi mã nguồn: Auth, frontend của luồng Người 1 và gateway dùng chung. Không sửa mã nguồn/Dockerfile của Company, Job, Application, Interview, Notification, Chat hay AI. Các API hiện có của Company/Job được gọi để tạo dữ liệu riêng và kiểm tra thao tác duyệt của Admin.

## Những lỗi đã sửa

- Đăng ký Recruiter trước đây ghi tên/số điện thoại vào Profile chỉ dành cho Candidate và nhận 403. Bổ sung `GET/PUT /auth/me/recruiter-contact` với RestController → Service → JPA, Flyway V3 và kiểm tra chủ sở hữu/vai trò/trạng thái tài khoản. CORS PUT chỉ mở cho đúng route này; API Admin nội bộ vẫn không mở PATCH cho trình duyệt.
- Khi đăng nhập hoặc xác minh OTP làm thay đổi phiên, frontend dựng lại toàn bộ form nên mất thông báo sai vai trò và trạng thái lưu liên hệ. Giữ trạng thái các trang xác thực; màn hình riêng tư vẫn reset khi đổi danh tính. Recruiter có thể chủ động lưu lại liên hệ sau lỗi tạm thời.
- Cổng Candidate từ chối tài khoản khác vai trò, thu hồi phiên vừa tạo và giữ thông báo lỗi. Đường dẫn quay lại được kiểm tra theo từng vai trò, chặn URL ngoài và đường dẫn mã hóa vượt khu vực.
- Khôi phục email ghi nhớ riêng cho cổng Recruiter/Admin; không lưu mật khẩu/token vào browser storage. Bật nút Google đăng ký Candidate theo cấu hình thực tế.
- Kiểm tra email trước yêu cầu quên mật khẩu; nội dung giao diện mô tả đúng email chứa liên kết reset.
- Next chuẩn hóa URL collection bỏ dấu `/` cuối, trong khi Nginx chỉ có `/companies/` và `/jobs/`. Redirect tiếp theo đưa hostname nội bộ Docker ra client và có thể làm mất phương thức POST. Bổ sung exact location `/companies` và `/jobs` để proxy trực tiếp, giữ cơ chế loại bỏ internal credential.

## Kiểm thử tự động

| Thành phần | Kết quả |
|---|---:|
| Auth JUnit đơn vị | 227/227 |
| Auth PostgreSQL/Redis tích hợp | 44/44 |
| Admin JUnit đơn vị | 22/22 |
| Admin PostgreSQL tích hợp | 5/5 |
| Profile đơn vị | 62/62 |
| Profile PostgreSQL/Kafka tích hợp | 89/89 |
| Media đơn vị | 26/26 |
| Media PostgreSQL tích hợp | 26/26 |
| Frontend đơn vị | 138/138 |
| Playwright desktop/mobile | 26/26 |

Tổng 665 ca, không failure/error/skipped trong các bộ trên. Frontend typecheck và build Docker Auth/frontend thành công. `nginx -t` thành công sau khi sửa gateway.

Các bộ tích hợp dùng PostgreSQL/Redis/Kafka hoặc Testcontainers riêng. Profile dùng `profile_test`, Media dùng `media_test`; không reset database đang chạy trên localhost. Playwright hồi quy dùng API mock để chủ động kiểm tra lỗi/role/OTP/retry. Kiểm thử Media tích hợp có provider giả lập, không chứng minh upload Cloudinary thật.

## Các luồng đã chạy thật trên Chrome và Docker localhost

| Luồng | Bằng chứng/kết quả |
|---|---|
| Candidate đăng ký | Gửi OTP qua Gmail SMTP, người dùng cung cấp mã, xác minh trên trình duyệt, đăng nhập vào hồ sơ; tên lưu được qua Profile thật |
| Quên mật khẩu | Email reset thật, người dùng cung cấp link; đổi mật khẩu qua giao diện, đăng nhập mật khẩu mới thành công; mật khẩu cũ/refresh cũ bị từ chối; link dùng lại bị từ chối |
| Recruiter đăng ký | Gmail alias riêng nhận OTP thật; xác minh, PUT/GET liên hệ tại Auth khớp tên/số điện thoại; chuyển đúng `/recruiter/jobs` |
| Ba cổng đăng nhập | Thử tài khoản sai vai trò tại Candidate, Recruiter, Admin; giữ thông báo lỗi, xóa mật khẩu nhập, không tải dữ liệu riêng; refresh phiên vừa tạo bị từ chối sau logout |
| Hồ sơ Candidate | Lưu thông tin chung; thêm/sửa/xóa từng nhóm học vấn, kinh nghiệm, kỹ năng, chứng chỉ, dự án trên UI và đối chiếu API lưu trữ |
| CV Builder | Tự điền từ Profile; xuất file PDF thật qua trình duyệt, kiểm tra chữ ký `%PDF-` |
| Upload CV | Media cấp chữ ký thật; Cloudinary từ chối upload do cấu hình preset; UI báo lỗi, không có CV giả được lưu |
| Admin thống kê | Đăng nhập Admin thử, tải overview/funnel thật, tải CSV và XLSX; kiểm tra file XLSX là ZIP hợp lệ |
| Quản lý tài khoản | Tìm mục tiêu thử riêng, xác nhận khóa/mở trên UI; Admin gọi Auth thật; trạng thái cập nhật |
| Báo cáo USER | Candidate gửi báo cáo qua UI; Admin xác nhận xử lý; báo cáo RESOLVED sau Auth khóa mục tiêu; thấy audit SUCCEEDED; mở lại mục tiêu sau kiểm thử |
| Duyệt công ty | Recruiter tạo công ty thử qua API; Admin xem chi tiết, từ chối có lý do; Recruiter nộp lại; Admin duyệt, đối chiếu VERIFIED tại Company |
| Duyệt tin | Recruiter tạo draft, gửi duyệt; Admin từ chối, đối chiếu DRAFT; gửi lại và duyệt; API công khai trả PUBLISHED; đóng tin thử sau kiểm thử |

Tất cả thao tác thay đổi dữ liệu chỉ dùng tài khoản/tài nguyên thử riêng. Tài khoản Google đang có của chủ dự án không bị đổi role hay mật khẩu. Admin thử được tạo theo xác nhận riêng, không nâng quyền tài khoản người dùng hiện hữu. Báo cáo thử còn mở đã được đóng bằng thao tác DISMISSED; không xóa lịch sử audit.

## Giới hạn chưa thể nghiệm thu đầy đủ

- **Cloudinary:** key xác thực được, 6 preset yêu cầu vẫn thiếu. API tạo preset trả 403 thiếu quyền `create`; upload thật bị từ chối. Cần hoàn tất quyền/preset theo [hướng dẫn Cloudinary](cloudinary-local-setup.md), rồi chạy lại upload/avatar, confirm, lưu CV, tải private, mặc định, revision và xóa trên cloud. Các chức năng này đã có kiểm thử tự động nhưng chưa qua trọn luồng với provider thật.
- **Google OAuth:** có cấu hình và kiểm tra redirect/exchange trong kiểm thử hồi quy; chưa chạy tương tác đăng nhập/chấp thuận tại Google bằng tài khoản người dùng. Không coi mock exchange là bằng chứng Google live thành công.
- Báo cáo Job/Company đã công khai chưa có hợp đồng upstream gỡ nội dung, nên không giả lập RESOLVED. Thống kê người dùng/công ty mới chưa có nguồn sự kiện được thống nhất. UNKNOWN/PROCESSING sau timeout vẫn cần đối soát.
- Access JWT ở các API stateless giữ TTL tối đa 15 phút sau khóa; Auth và Admin kiểm tra trạng thái tài khoản bền vững theo hợp đồng hiện tại. Token frontend chỉ ở bộ nhớ; tải lại toàn trang yêu cầu đăng nhập lại.

## Chạy và xem bằng chứng

Frontend: <http://localhost:3000>. Admin: <http://localhost:3000/admin/login>. Recruiter: <http://localhost:3000/recruiter/login>. Gateway: <http://localhost:8080>.

Auth/frontend đã được build và recreate với bản sửa; gateway đã reload. Các service ngoài Người 1 chạy từ mã nguồn có sẵn.

Log kiểm thử và helper live nằm trong `.cache/person1-*.log` / `.cache/person1-live-*.cjs`. Credential thử chỉ ở `.cache/person1-live-account.json`, `.cache/person1-recruiter-account.json`, `.cache/person1-admin-account.json` được Git bỏ qua. Không đưa password, OTP, reset link, token hoặc secret cloud vào báo cáo/commit.

Chạy lại kiểm thử tự động:

```powershell
# Trong services/auth-service (Java 21)
mvn.cmd -q -Pintegration-test '-Dapi.version=1.44' verify
# Trong services/admin-service
mvn.cmd -q -Pintegration '-Dapi.version=1.44' verify
# Từ thư mục gốc
docker compose -f services/profile-service/compose.test.yml up --build --abort-on-container-exit --exit-code-from profile-tests
docker compose -f services/media-service/compose.test.yml up --build --abort-on-container-exit --exit-code-from media-tests
# Trong frontend
npm.cmd test
npm.cmd run typecheck
npx.cmd playwright test person1-flows.spec.ts --reporter=line
```

## Bổ sung: Google tự chọn vai trò theo cổng đăng nhập

Theo yêu cầu tiếp theo ngày 15/10/2026, bỏ form chọn vai trò và nút Tiếp tục tại `/auth/callback`. Candidate nhận role CANDIDATE; Recruiter nhận RECRUITER. Backend giữ cổng bắt đầu trong OAuth state ở Redis, chỉ chuyển metadata sau khi state hợp lệ, rồi ràng buộc role với exchange code một lần. Callback xóa fragment và tự exchange đúng một lần trong StrictMode.

Tài khoản đã liên kết Google nhưng khác role với cổng bắt đầu nhận `403 GOOGLE_ROLE_MISMATCH`; không đổi role, không cấp phiên. Việc sửa role tại callback/body không thay được role đã lưu tại server. Chính sách không tự liên kết theo email giữ nguyên.

Đợt kiểm thử riêng cho thay đổi này: **232/232 Auth unit**, **44/44 Auth PostgreSQL/Redis integration**, **138/138 frontend unit**, **36/36 Playwright desktop/mobile**, typecheck và build Docker thành công. Playwright dùng mock exchange; giới hạn kiểm thử tương tác Google thật ở trên vẫn áp dụng.

Đã recreate Auth/frontend và reload gateway trên Docker local. Kiểm tra HTTP qua `localhost:3000` xác nhận Candidate/Recruiter chuyển đúng role đến authorization endpoint, có PKCE/state/nonce và Redis lưu đúng role gắn với state. `role=ADMIN` bị từ chối 400. Không đăng nhập/chấp thuận Google thay người dùng trong bước kiểm tra này.
