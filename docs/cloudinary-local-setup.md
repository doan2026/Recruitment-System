# Cloudinary thật cho Docker local

Cloudinary là nơi lưu bytes; Media Service giữ API secret và metadata canonical.
Profile/CV chỉ lưu `fileId`, không giữ secret hoặc URL tải riêng tư lâu dài.

## Credential

Điền vào `.env` tại thư mục gốc dự án, không phải `frontend/.env`:

```dotenv
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET='your_api_secret'
```

Ba giá trị phải thuộc cùng Product Environment. Root Docker Compose truyền chúng
cho Media Service; Compose không nạp `services/media-service/.env`.
Không commit `.env` và không đưa API secret vào biến `NEXT_PUBLIC_*`.

Lấy credential trong Console → Settings → API Keys theo
[hướng dẫn Cloudinary](https://cloudinary.com/documentation/developer_onboarding_faq_find_credentials).

## Kiểm tra và tạo signed preset

Chạy từ thư mục gốc:

```powershell
python scripts/person1_integrations.py check-cloudinary
python scripts/person1_integrations.py setup-cloudinary
python scripts/person1_integrations.py check-cloudinary --presets
```

`setup-cloudinary` đọc policy trực tiếp từ Media Service, kiểm tra toàn bộ preset
có sẵn, chỉ tạo preset chưa tồn tại và đọc lại để xác nhận. Nếu preset cũ khác
policy hoặc API không đủ quyền, script dừng; không cập nhật/xóa preset hay asset.
Các lệnh không in key/secret hoặc URL riêng tư.

| Preset mặc định | Format | Giới hạn tại client/Media | Delivery type |
|---|---|---|---|
| `recruitment_cv_signed` | pdf | 5 MiB | authenticated |
| `recruitment_avatar_signed` | jpg, png, webp | 2 MiB | upload |
| `recruitment_company_logo_signed` | jpg, png, webp | 2 MiB | upload |
| `recruitment_company_image_signed` | jpg, png, webp | 5 MiB | upload |
| `recruitment_company_video_signed` | mp4 | 50 MiB | upload |
| `recruitment_chat_attachment_signed` | pdf, doc, docx, jpg, png, webp | 10 MiB | authenticated |

Tất cả preset phải là **signed** (`unsigned=false`). Tên có thể đổi bằng các biến
`CLOUDINARY_UPLOAD_PRESET_*` trong `.env`, nhưng mỗi loại cần tên riêng.

Cloudinary không hỗ trợ giới hạn byte riêng theo upload preset. Không gửi/kiểm tra `max_file_size` như một trường preset bắt buộc. Các giới hạn trong bảng được client kiểm tra trước upload và Media xác minh bằng metadata canonical trước khi ACTIVE; file quá giới hạn bị reject và cleanup. Giới hạn nhận file ở Cloudinary phụ thuộc tài khoản. Script xác minh `settings.allowed_formats`, `settings.type` và `unsigned=false`; Media ký `overwrite=false` trong capability để chặn ghi đè, độc lập mặc định của preset. [Tài liệu Cloudinary](https://cloudinary.com/documentation/upload_presets).

Nếu ping thành công nhưng `POST /upload_presets` trả `403` kèm
`missing permissions (actions=["create"])`, key hợp lệ nhưng thiếu quyền tạo preset.
Trong Console, cấp quyền quản lý Upload Presets cho API key của Product Environment,
hoặc tạo preset bằng tài khoản Console có quyền tương ứng. Không tạo lại key chỉ vì
ping thành công; cần kiểm tra quyền đang gán cho key. Các API tạo/đọc preset được
mô tả trong [Admin API](https://cloudinary.com/documentation/admin_api#upload_presets);
[Roles and Permissions](https://cloudinary.com/documentation/dam_admin_permissions)
mô tả quyền của API key.

Trên hệ thống Roles and Permissions hiện tại:

1. Mở **Settings → API Keys** trong đúng Product Environment ứng với cloud name trong `.env`.
2. Tại key đang dùng, mở menu **⋮ → Assign Roles**.
3. Chọn role có **Manage upload settings**. Với kiểm thử Docker local, system role **Tech Admin** của Product Environment có quyền quản lý upload settings và tài nguyên cần thiết; không chọn nhầm role cùng tên ở cấp Account.
4. Lưu quyền, giữ key/secret trong `.env`, rồi chạy lại `setup-cloudinary` và `check-cloudinary --presets`.

Nguồn: [gán role cho API key](https://production.cloudinary.com/documentation/dam_admin_role_management#assign_roles_to_api_keys) và [quyền của system roles](https://production.cloudinary.com/documentation/dam_admin_system_roles_permissions#global_product_environment_level_roles).

Đổi `.env` chỉ có tác dụng khi thay bằng credential được cấp quyền hoặc trỏ đến preset đã tồn tại và đúng policy. Không có biến `.env` nào tự cấp quyền cho key tại Cloudinary. Nếu đổi key/secret hoặc tên preset, phải recreate Media để nạp cấu hình mới; chỉ `docker compose restart` không cập nhật environment:

```powershell
docker compose up -d --no-deps --force-recreate media-service
docker compose restart api-gateway
```

## Cho phép tải PDF

Cloudinary có thể chặn delivery PDF qua CDN theo cấu hình tài khoản. Media dùng
Private Download API với public ID RAW đầy đủ và thời hạn ngắn; luồng CV này đã
tải PDF thành công mà không cần đổi cài đặt delivery. Chỉ kiểm tra **Settings →
Security → Allow delivery of PDF and ZIP files** nếu thực sự cần delivery qua CDN
và provider báo chặn PDF. CV vẫn dùng `authenticated`. Xem
[hướng dẫn PDF](https://cloudinary.com/documentation/ts_how_to_upload_manage_and_deliver_pdf_files)
và [kết quả live ngày 16/10/2026](person1-cloudinary-2026-10-16.md).

## Áp dụng vào Docker

Sau khi credential/preset được xác nhận:

```powershell
docker compose up -d --build media-service
docker compose restart api-gateway
```

Media healthcheck không tự kiểm tra Cloudinary từ xa; HTTP health thành công không
có nghĩa là upload/download đã chạy thật. Kiểm tra thực tế bằng upload avatar/CV
trên ứng dụng sau khi luồng local được khởi chạy. Live smoke test đầy đủ được mô tả
trong [Media README](../services/media-service/README.md#live-cloudinary-staging-smoke).
