# Kiểm thử Cloudinary thật — 16/10/2026 (GMT+7)

## Kết quả

API key đã được cấp quyền tại đúng Product Environment. Authenticated ping thành công; cả sáu signed preset đã được tạo và đọc lại để xác nhận đúng định dạng, delivery type và `unsigned=false`. Credential trong `.env` gốc khớp container Media; không cần thay key/secret hoặc bật upload unsigned.

| Luồng trên Docker localhost | Bằng chứng với dịch vụ thật |
|---|---|
| CV PDF | Chrome tải PDF thử 17.208 byte qua capability có chữ ký tới Cloudinary RAW/authenticated; Media confirm trả ACTIVE, `privateDelivery=true`, `url=null`; Profile lưu fileId và UI hiển thị CV |
| Tải CV | Profile gọi Media nội bộ thành công; URL tải riêng tư trả HTTP 200 và bytes bắt đầu bằng `%PDF-` |
| Xóa CV | Xác nhận xóa trên UI thành công; metadata owner không còn truy cập được; Cloudinary Admin lookup đúng public ID trả 404 |
| Ảnh đại diện | Chrome upload PNG thật, confirm, gắn vào Profile và hiển thị ảnh; URL ảnh trả nội dung image; tháo ảnh, giải phóng reference và xóa file thành công; Cloudinary Admin lookup trả 404 |

Chỉ sử dụng tài khoản và tài nguyên thử riêng. Việc xác minh xóa dùng đúng hai public ID được tạo trong lần thử; không xóa theo folder/prefix. Credential, token và URL tải riêng tư không được ghi vào báo cáo hoặc commit. Helper và kết quả đã lọc thông tin nằm trong `.cache/person1-cloudinary-*` được Git bỏ qua.

## Các lỗi đã sửa

- Script cấu hình và live smoke đọc được preset options trong `settings` của Admin API hiện tại, vẫn tương thích `options`/flat.
- Bỏ yêu cầu `max_file_size` không được Cloudinary hỗ trợ cho từng preset. Client kiểm tra trước upload; canonical confirm và database tiếp tục giữ giới hạn Media. Capability luôn ký `overwrite=false`.
- Cloudinary không trả `format` cho RAW: suy ra phần mở rộng từ public ID canonical của provider tại cả inspection và context reconciliation; vẫn đối chiếu intent, ownership, resource/delivery, size và magic bytes.
- Private Download API giữ đầy đủ public ID RAW gồm `.pdf`. Inspection dùng URL tải có hạn 60 giây để đọc tối đa 8 KiB; URL tải cho người dùng vẫn hết hạn sau 5 phút. CV không chuyển sang public.
- Đăng ký controller nội bộ trước route công khai `:id/download-url`, tránh `/internal/download-url` bị yêu cầu bearer token thay vì khóa dịch vụ. Kiểm thử hồi quy xác nhận đúng khóa được tải, sai owner bị từ chối và bearer đơn lẻ không vào được API nội bộ.
- Frontend phân loại lỗi cấu hình, dung lượng, dịch vụ gián đoạn; không hiển thị raw response của Cloudinary. Lỗi upload giữ nội dung form, không confirm hoặc lưu CV giả; retry thành công mới lưu.

## Kiểm tra và triển khai

- Script cấu hình: **8/8 unit**.
- Media: **26/26 unit + 27/27 PostgreSQL integration**, chạy bằng Compose test riêng. Các integration này dùng FakeStorageProvider; bảng live phía trên là bằng chứng Cloudinary thật riêng biệt.
- Frontend: **140/140 unit**, typecheck và Docker build thành công; **4/4 Playwright** cho CV upload/retry và CV Builder trên desktop/mobile. Playwright hồi quy dùng provider mock; Chrome live ở bảng trên gọi Cloudinary thật.
- Image Media/frontend đã build và recreate; gateway đã restart để nạp lại địa chỉ container Media.
- Kiểm tra cuối bằng `docker compose ps --all`: 18 thành phần có healthcheck đều healthy, hai AI worker running; năm job init/migration exit 0.

Sáu preset sẵn sàng không đồng nghĩa đã chạy đủ sáu loại file qua provider thật: lần này nghiệm thu CV và AVATAR. COMPANY_LOGO/IMAGE/VIDEO và CHAT_ATTACHMENT chưa chạy toàn bộ nghiệp vụ qua các service ngoài Người 1. Google OAuth tương tác vẫn cần người dùng tự đăng nhập/chấp thuận tại Google theo giới hạn trong [báo cáo trước](person1-regression-2026-10-15.md).

Hướng dẫn cấu hình lại: [Cloudinary local](cloudinary-local-setup.md). Giao diện kiểm thử: <http://localhost:3000>.
