# Rà soát dịch vụ thật của Người 1

Thời điểm: 15/10/2026, GMT+7. Phạm vi: Auth, Profile, Media, Admin và cấu hình Docker phục vụ các luồng này.

## Kết quả thực tế

| Thành phần | Cấu hình và bằng chứng | Trạng thái nghiệm thu |
| --- | --- | --- |
| Gmail SMTP | Đăng nhập trực tiếp `smtp.gmail.com:587` qua STARTTLS thành công. Auth nhận đúng cấu hình từ `.env` gốc; sender trùng tài khoản SMTP. Code gửi OTP và reset dùng `JavaMailSender`. | Kết nối thật đã xác thực; chưa gửi email hay kiểm tra nhận thư qua luồng web. |
| Google OAuth | Đã bật; client ID/secret đúng dạng; callback `http://localhost:3000/auth/google/callback`, frontend callback `/auth/callback`. Docker build bật nút Google theo cấu hình gốc. Backend dùng Google provider của Spring Security. | Chỉ xác minh cấu hình cục bộ. Chưa kiểm chứng client secret, danh sách test users, callback đã đăng ký trên Console hoặc đăng nhập trình duyệt thành công. |
| Cloudinary | Authenticated ping thành công với thông tin trong `.env` gốc. GET từng preset dưới đây đều trả HTTP 404. Media dùng `CloudinaryStorageProvider`. | Chưa sẵn sàng upload/confirm/download; chưa kiểm tra tệp thật và quyền tải PDF. |
| Auth | Cấu hình PostgreSQL, Redis, HMAC và khóa RSA; không bật ephemeral test key. | Chưa kiểm tra runtime trong đợt rà soát này. |
| Profile | Prisma/PostgreSQL, Media và Application dùng địa chỉ Docker; key Profile–Media khớp; bật CV outbox publisher Kafka. | Chưa kiểm tra runtime hoặc CRUD/CV trên web trong đợt rà soát này. |
| Admin | JDBC/PostgreSQL, JWT/JWKS, gọi Auth/Company/Job và bật Kafka consumer. | Chưa kiểm tra runtime hoặc thao tác quản trị trên web trong đợt rà soát này. |
| Docker Compose | `docker compose config --quiet` thành công; có 25 định nghĩa service. `docker compose ps --all` và `docker compose images` không có dòng container/image của project. | Project hiện không có container. Chưa thể xác nhận các service chạy ổn. Điều này không kết luận host không có image hoặc container của project khác. |

Sáu preset đang thiếu:

- `recruitment_cv_signed`
- `recruitment_avatar_signed`
- `recruitment_company_logo_signed`
- `recruitment_company_image_signed`
- `recruitment_company_video_signed`
- `recruitment_chat_attachment_signed`

Lần tạo preset trước từng bị HTTP 403 thiếu quyền `create`. Đợt rà soát này chỉ đọc preset, không thử tạo lại nên chưa kết luận quyền tạo hiện đã được sửa hay chưa.

## Phân biệt dịch vụ thật và kiểm thử

- PostgreSQL, Redis, Kafka trong Compose là các hệ thống thật chạy local. Cấu hình kết nối hợp lệ không chứng minh kết nối thành công khi container khởi động.
- Auth/Profile/Media/Admin cấu hình sử dụng persistence và adapter thật. Kiểm tra mã nguồn trong phạm vi này không phát hiện adapter mô phỏng được chọn làm runtime.
- Frontend Docker build và runtime đặt `NEXT_PUBLIC_API_MODE=gateway`. `person2Api.ts` vẫn có nhánh demo cho chế độ khác; sự tồn tại của nhánh đó không có nghĩa Docker đang dùng demo.
- `frontend/.env` bật chế độ gateway nhưng cờ Google UI hiện là false; Compose ghi đè cờ này từ `.env` gốc khi build Docker. Chạy frontend bằng npm riêng cần đồng bộ cờ trước khi build/chạy.
- Các browser test có API mock chỉ xác minh giao diện/hợp đồng; kết quả cũ không chứng minh Google, Gmail hoặc Cloudinary hoạt động đầy đủ.
- Issuer/audience JWT của bốn service khớp nhau; các file RSA mount tồn tại; Cloudinary API secret không nằm trong environment của Auth/Profile/Admin/frontend.

## Giới hạn nghiệp vụ cần giữ rõ

- Admin chưa có hợp đồng gỡ Job/Company đã công khai; xử lý RESOLVED cho các đối tượng này báo `TAKEDOWN_CONTRACT_UNAVAILABLE`, không giả lập thành công.
- Thống kê người dùng/công ty mới chưa có nguồn sự kiện được thống nhất; không được coi là chỉ số đã tích hợp đầy đủ.
- Các chức năng liên service còn phụ thuộc Company, Job và Application của người phụ trách khác. Đợt này không sửa nghiệp vụ các service đó.

## Các bước còn lại để xác nhận chạy đầy đủ

1. Hoàn tất quyền Cloudinary và tạo/đọc lại đủ preset theo chính sách Media; kiểm tra delivery PDF riêng tư.
2. Build và khởi động Compose, kiểm tra migration, PostgreSQL/Redis/Kafka và health của các service.
3. Kiểm tra gửi/nhận OTP, xác minh đăng ký, quên/reset mật khẩu qua Auth; kiểm tra Google trên trình duyệt với tài khoản test đã khai báo.
4. Upload/confirm/tải/xóa CV và avatar, CRUD hồ sơ; kiểm tra Admin với tài khoản và dữ liệu thật.

Không ghi credentials, token hay URL tải tệp riêng tư vào báo cáo. Đợt rà soát không gửi email, upload tệp, sửa preset hoặc khởi động container.
