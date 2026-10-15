# Bàn giao luồng Người 1

Nguồn yêu cầu: phần III/A1–A4 trong tài liệu phân công đính kèm. Mã nguồn đích: `D:\Recruitment System`. Tài liệu phân công là đặc tả nghiệp vụ; các chỉ dẫn tổ chức nhóm trong tài liệu không được coi là lệnh gửi thông báo, tạo tài khoản cloud hoặc thay đổi hệ thống bên ngoài.

## Phạm vi

| Luồng | Triển khai |
|---|---|
| Đăng ký Candidate/Recruiter, OTP, gửi lại | /register cho Candidate, /recruiter/register cho Recruiter; giữ registrationId cho đúng lần đăng ký; OTP thành công thiết lập phiên; liên hệ Recruiter lưu qua /auth/me/recruiter-contact |
| Đăng nhập, refresh, logout | Tái sử dụng phiên trong bộ nhớ; refresh rotation; điều hướng đúng Candidate/Recruiter/Admin |
| Google | Cổng Candidate/Recruiter gửi role ngay từ /auth/google; Auth giữ role theo state và exchange code trong Redis. /auth/callback xóa fragment và tự exchange một lần, không có bước chọn vai trò; tài khoản khác role nhận lỗi và không bị đổi quyền |
| Quên/đặt lại mật khẩu | /forgot-password, /reset-password; thông báo quên mật khẩu chung; token không lưu trên thiết bị |
| Hồ sơ | /candidate/profile: thông tin chung, liên kết, avatar, CRUD học vấn/kinh nghiệm/kỹ năng/chứng chỉ/dự án, % hoàn thiện |
| CV PDF | /candidate/profile/cvs: upload signed trực tiếp, confirm bằng fileId, lưu metadata, đổi tên, mặc định, tải riêng tư, xóa có expectedAggregateVersion |
| CV Builder | /candidate/profile/cvs/builder: tự điền hồ sơ, 2 mẫu, sửa và sắp xếp mục, preview/xuất PDF có phông tiếng Việt và văn bản, lưu/reopen/revision |
| Admin | /admin: duyệt/từ chối công ty/tin, tìm và khóa/mở tài khoản, xử lý báo cáo USER, nhật ký, thống kê, phễu, Excel/CSV |
| Báo cáo vi phạm | /reports; liên kết từ chi tiết tin/công ty điền sẵn đối tượng |
| Bàn giao | Swagger Auth/Admin, Postman collection, cấu hình mẫu, Docker healthcheck, test unit và browser |

Backend Auth/Profile/Media đã có nhiều nghiệp vụ và kiểm thử trước lần triển khai này. Công việc giữ các invariant hiện có: giới hạn 5 CV, đúng một mặc định, file private, reference binding, transactional outbox và deletion fence với Application. Không viết lại chúng thành phiên bản đơn giản hơn.

## Khác biệt đã xử lý theo hợp đồng hiện tại

1. OTP cần registrationId; đăng ký lại thay thế flow cũ an toàn.
2. Google không tự nối tài khoản chỉ vì email trùng: Auth trả ACCOUNT_LINK_REQUIRED, yêu cầu đăng nhập tài khoản cũ. Đây là chính sách bảo vệ tài khoản hiện có.
3. CV không lưu URL download công khai; lưu fileId và dùng URL riêng tư ngắn hạn. Event cv-events hiện dùng schema private v1 của repo, không đưa URL file vào Kafka.
4. Chỉnh sửa CV ONLINE tạo snapshot mới; đơn ứng tuyển cũ giữ nguyên CV đã nhận.
5. POST /admin/reports cho người đã đăng nhập là ngoại lệ cần thiết của quy tắc ADMIN-only để thực hiện luồng người dùng báo cáo. Các API đọc/quản trị vẫn chỉ ADMIN.
6. Company review trả toàn bộ hồ sơ trong danh sách PENDING. Màn chi tiết dùng dữ liệu này, tránh gọi public detail vốn chỉ trả công ty VERIFIED.
7. Chỉ số thống kê dùng event contract đang được producer triển khai. USER/COMPANY mới hiển thị chưa có nguồn; không tự bổ sung topic chưa thống nhất.
8. Export chỉ cho daily metrics với khoảng ngày hữu hạn, không phát sinh báo cáo >50.000 dòng.

## Giới hạn tích hợp còn lại

- Cập nhật 16/10/2026 (GMT+7): Gmail SMTP đã kiểm thử thật qua đăng ký Candidate/Recruiter và đặt lại mật khẩu. Cloudinary đã có đủ sáu signed preset; CV và avatar đã qua upload/confirm/lưu/đọc/xóa với provider thật trên Docker localhost. Xem [báo cáo Cloudinary](person1-cloudinary-2026-10-16.md). Google đã cấu hình và kiểm tra chuyển hướng, chưa nghiệm thu thao tác đăng nhập tương tác với Google; các giới hạn khác ở [báo cáo hồi quy](person1-regression-2026-10-15.md) vẫn áp dụng.
- Job/Company chưa có API Admin gỡ đối tượng đã công khai. Báo cáo các loại này được tiếp nhận nhưng không giả lập RESOLVED; cần hợp đồng từ Người 2.
- UNKNOWN/PROCESSING sau remote timeout cần đối soát vận hành; chưa có tự động phục hồi tác vụ quản trị xuyên service.
- PostgreSQL Compose hiện tách schema trong một cluster, chưa chuyển thành database/container/credential độc lập như kiến trúc đích.
- Mô hình Auth hiện cho access token cũ tồn tại tối đa TTL 15 phút sau khóa. Admin kiểm tra trạng thái bền vững qua /auth/me trước thao tác; các service khác giữ hợp đồng stateless hiện có.
- Không có API tự đăng ký/provisioning Admin. Trong lần kiểm thử 15/10/2026, đã tạo Admin thử riêng tại Docker local theo xác nhận của chủ dự án; không đổi role tài khoản hiện hữu. Credential thử nằm trong `.cache` được Git bỏ qua.
- Chưa xác nhận toàn bộ 11 service và ba luồng E2E liên người 1/2/3 trên môi trường thật.
- Chưa thay đổi phương thức quản lý key rotation/production secrets hay cơ chế phân quyền recruiter của Profile vốn do hợp đồng liên service hiện tại quyết định.

## Chạy

1. Chạy `scripts/init-env.ps1`, điền `.env`, sinh RSA keys theo README gốc. SMTP, Cloudinary signed presets, internal keys là các giá trị bắt buộc.
2. Chạy `docker compose up --build`. Admin mới dùng Flyway để tạo các bảng trong schema admin.
3. Mở frontend /register hoặc /login. Candidate dùng /candidate/profile; Admin dùng /admin.
4. Để bật Google, cấu hình Google client/callback ở Auth, `GOOGLE_OAUTH_ENABLED=true`, frontend `NEXT_PUBLIC_GOOGLE_LOGIN_ENABLED=true` trước build.
5. Bật Swagger khi phát triển bằng `SWAGGER_ENABLED=true`. Auth: /auth/swagger-ui.html và /auth/v3/api-docs qua gateway; Admin: trực tiếp /swagger-ui/index.html và /v3/api-docs.
6. Import `docs/postman/person1.postman_collection.json`. Nhập otp nhận qua email vào collection variable; token/register ID được script test lưu vào biến collection cục bộ. Không export collection kèm token thực.

## Kiểm thử

```powershell
cd frontend
npm ci
npm test
npm run typecheck
npm run test:e2e -- person1-flows.spec.ts
npm run build
```

Playwright dùng .next-e2e riêng; production build dùng .next. Kiểm thử trình duyệt chạy desktop 1440px và mobile 390px, mock API tại cổng 4174. PDF được tạo thực sự bằng pdfmake/Roboto và kiểm tra chữ ký PDF, kích thước artifact, nội dung JSON lưu và quy trình upload/confirm.

```powershell
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-21'
cd services/auth-service
mvn test
cd ../admin-service
mvn test
mvn -Pintegration -Dapi.version=1.44 verify
```

### Kết quả xác minh (24/09/2026)

- Frontend: 137 kiểm thử unit/API, typecheck, production build và 16/16 kịch bản Playwright (desktop/mobile) đều đạt.
- Auth service: 218 kiểm thử Maven đều đạt.
- Admin service: 12 kiểm thử đơn vị và 4/4 kiểm thử tích hợp PostgreSQL/Testcontainers đều đạt.
- `docker compose config --quiet` yêu cầu file `.env` với các biến bảo mật và hạ tầng bắt buộc; không có file `.env` cục bộ nên Compose được giữ ở trạng thái chưa khởi chạy để tránh dùng cấu hình hoặc bí mật giả.
