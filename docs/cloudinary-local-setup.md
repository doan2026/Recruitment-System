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

| Preset mặc định | Format | Giới hạn | Delivery type |
|---|---|---|---|
| `recruitment_cv_signed` | pdf | 5 MiB | authenticated |
| `recruitment_avatar_signed` | jpg, png, webp | 2 MiB | upload |
| `recruitment_company_logo_signed` | jpg, png, webp | 2 MiB | upload |
| `recruitment_company_image_signed` | jpg, png, webp | 5 MiB | upload |
| `recruitment_company_video_signed` | mp4 | 50 MiB | upload |
| `recruitment_chat_attachment_signed` | pdf, doc, docx, jpg, png, webp | 10 MiB | authenticated |

Tất cả preset phải là **signed** (`unsigned=false`). Tên có thể đổi bằng các biến
`CLOUDINARY_UPLOAD_PRESET_*` trong `.env`, nhưng mỗi loại cần tên riêng.

Nếu ping thành công nhưng `POST /upload_presets` trả `403` kèm
`missing permissions (actions=["create"])`, key hợp lệ nhưng thiếu quyền tạo preset.
Trong Console, cấp quyền quản lý Upload Presets cho API key của Product Environment,
hoặc tạo preset bằng tài khoản Console có quyền tương ứng. Không tạo lại key chỉ vì
ping thành công; cần kiểm tra quyền đang gán cho key. Các API tạo/đọc preset được
mô tả trong [Admin API](https://cloudinary.com/documentation/admin_api#upload_presets);
[Roles and Permissions](https://cloudinary.com/documentation/dam_admin_permissions)
mô tả quyền của API key.

## Cho phép tải PDF

Với tài khoản Free, Cloudinary có thể chặn delivery PDF theo mặc định. Trong
Console → Settings → Security, bật **Allow delivery of PDF and ZIP files** khi
thiết lập CV. CV vẫn phải dùng `authenticated`; không chuyển sang public để xử lý
lỗi tải. Xem [hướng dẫn PDF](https://cloudinary.com/documentation/ts_how_to_upload_manage_and_deliver_pdf_files).

## Áp dụng vào Docker

Sau khi credential/preset được xác nhận:

```powershell
docker compose up -d --build media-service
```

Media healthcheck không tự kiểm tra Cloudinary từ xa; HTTP health thành công không
có nghĩa là upload/download đã chạy thật. Kiểm tra thực tế bằng upload avatar/CV
trên ứng dụng sau khi luồng local được khởi chạy. Live smoke test đầy đủ được mô tả
trong [Media README](../services/media-service/README.md#live-cloudinary-staging-smoke).
