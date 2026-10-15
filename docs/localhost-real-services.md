# Chạy toàn bộ hệ thống thật trên localhost

Chạy lệnh từ thư mục gốc dự án. Compose mặc định khởi động frontend, gateway, 11 API service, hai AI worker, các migration job và hạ tầng. Không cần bật profile demo.

```powershell
docker compose config --quiet
docker compose up -d --build
docker compose ps --all
```

Build lần đầu cần tải dependency Node, Maven, Python và model cho AI worker. Các migration job có trạng thái `Exited (0)` sau khi hoàn tất; API và hạ tầng phải tiếp tục chạy. Gateway đợi healthcheck các API, frontend đợi gateway.

## Địa chỉ truy cập

| Chức năng | Địa chỉ |
| --- | --- |
| Ứng viên đăng nhập / đăng ký | http://localhost:3000/login / http://localhost:3000/register |
| Nhà tuyển dụng đăng nhập / đăng ký | http://localhost:3000/recruiter/login / http://localhost:3000/recruiter/register |
| Admin đăng nhập | http://localhost:3000/admin/login |
| API Gateway | http://localhost:8080 |
| Auth health | http://localhost:8080/auth/health |
| PostgreSQL cho pgAdmin | localhost:5433 (hoặc `POSTGRES_HOST_PORT`) |
| Redis từ máy host | localhost:6380 (hoặc `REDIS_HOST_PORT`) |

Các container dùng `postgres:5432`, `redis:6379` và các tên service Docker. Các cổng được publish chỉ trên loopback của máy. Giữ frontend ở `localhost:3000` để callback Google và cookie trùng cấu hình.

## Dịch vụ ngoài

- Gmail SMTP và Google OAuth lấy giá trị từ `.env` gốc qua Auth. Google UI được bật tại thời điểm build frontend theo `GOOGLE_OAUTH_ENABLED`.
- Frontend Docker luôn build với `NEXT_PUBLIC_API_MODE=gateway` và `/api`; không chọn nhánh demo bằng `frontend/.env`.
- Media nhận credentials Cloudinary từ `.env` gốc. Healthcheck Media kiểm tra cấu hình và PostgreSQL, không chứng minh preset hoặc upload hoạt động.
- Trước khi test CV/avatar, hoàn tất các signed preset trong [cloudinary-local-setup.md](cloudinary-local-setup.md). Thiếu preset vẫn có thể khởi động API nhưng upload thật sẽ lỗi.
- Sau khi đổi biến môi trường, dùng `docker compose up -d` để tạo lại container cần thiết. Đổi cờ Google cần build lại frontend: `docker compose up -d --build auth-service frontend`.

## Kiểm tra nhanh và dừng hệ thống

```powershell
docker compose ps --all
docker compose logs --tail 60 auth-service profile-service media-service admin-service
docker compose stop
```

`stop` giữ dữ liệu. Không dùng `down -v` cho việc khởi động lại thông thường. Cấu hình tài khoản kết nối nằm trong `.env`; không copy mật khẩu hoặc API secret vào báo cáo lỗi.

Các service ngoài Người 1 được khởi chạy bằng implementation hiện có của người phụ trách. Khởi động thành công không chứng minh toàn bộ nghiệp vụ liên service đã được nghiệm thu; trạng thái tích hợp cần kiểm tra trên dữ liệu thật.

## Xác minh trên máy local ngày 15/10/2026 (GMT+7)

- Cả 11 API, frontend, gateway và năm thành phần hạ tầng đã báo healthy.
- Năm job khởi tạo/migration đã hoàn tất; kiểm tra trang đăng nhập/đăng ký Candidate, Recruiter và trang đăng nhập Admin trả HTTP 200.
- Auth, Profile, Media và Admin health đều trả HTTP 200 qua gateway; frontend `/api/auth/health` cũng trả HTTP 200.
- Chrome headless đã render form mật khẩu của cả ba vai trò, không có uncaught page error. Đây là kiểm tra hiển thị và routing, chưa phải đăng nhập và thao tác nghiệp vụ đầy đủ.
- Google chuyển hướng tới `accounts.google.com` với callback đúng `http://localhost:3000/auth/google/callback`; chưa thực hiện đăng nhập Google tương tác.
- Cloudinary vẫn từ chối tạo preset với HTTP 403 thiếu quyền `create`, dù authenticated ping thành công. Chưa nghiệm thu upload CV/avatar.
- Hai AI worker được build từ Dockerfile gốc; trạng thái build/start cần xem bằng `docker compose ps --all`. Không sửa mã nguồn hoặc Dockerfile các service ngoài Người 1.
