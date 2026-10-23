# Quy ước đường dẫn frontend và API

Frontend dùng `/api/...` cho mọi request dữ liệu, cả trên trình duyệt và khi render phía server. Link và điều hướng trang dùng đường dẫn giao diện, không thêm `/api`.

| Chức năng | Trang giao diện | API dữ liệu |
| --- | --- | --- |
| Công ty | `/companies`, `/companies/:id` | `/api/companies/search`, `/api/companies/:id` |
| Hồ sơ ứng viên | `/candidate/profile` | `/api/profile/:userId` |
| CV | `/candidate/profile/cvs` | `/api/profile/cvs` |
| Tuyển dụng | `/recruiter/jobs` | `/api/jobs/mine` |
| Quản trị | `/admin` | `/api/admin/...` |
| Tin nhắn | `/candidate/messages`, `/recruiter/messages` | `/api/chat/chats` |
| Thông báo | `/candidate/notifications`, `/recruiter/notifications` | `/api/notifications` |
| Đăng nhập | `/login`, `/recruiter/login`, `/admin/login` | `/api/auth-cookie/login` |

## Cách sử dụng

- Các API adapter gọi `requestApi` với đường dẫn `/api/...` hoặc dùng hằng `API_PATHS`. Các helper Application và AI cũng trả đường dẫn có `/api`.
- `apiRoutes.ts` tạo URL backend và tránh lặp `/api/api` khi base URL đã có `/api`. API client vẫn chuẩn hóa đường dẫn cũ không có tiền tố để tương thích.
- `Link`, `router.push`, `router.replace` và các helper trong `portalRoutes.ts` chỉ dùng đường dẫn trang.
- Next.js giữ nguyên tiền tố `/api` khi proxy sang gateway. Gateway chuyển tới route service tương ứng, giữ nguyên các kiểm tra quyền, chặn API nội bộ và giới hạn tần suất hiện có. API không tồn tại trả JSON 404, không rơi vào trang frontend.
- SSR không lưu cache phản hồi API. Điều này tránh giữ HTML lỗi và bảo đảm hồ sơ công ty cập nhật khi render lại.

## Cấu hình

`NEXT_PUBLIC_API_BASE_URL=/api`. Trình duyệt luôn gọi cùng origin, dùng cookie HttpOnly hiện tại.

`API_INTERNAL_BASE_URL` là gateway origin: local Docker dùng `http://api-gateway`, prod dùng `http://api-gateway:8080`. API client tự thêm `/api`. Giá trị có hậu tố `/api` cũng được hỗ trợ, nhưng không cần thay `.env` hiện tại.

## Google OAuth và dịch vụ ngoài

Các URL bắt đầu OAuth (`/auth/google`, `/auth/oauth2/...`), callback Google và `/auth/google/exchange` giữ nguyên đường dẫn canonical đã đăng ký. Cookie binder của bước exchange có phạm vi `/auth/google/exchange`; đổi URL trình duyệt sang `/api/auth/google/exchange` sẽ làm mất cookie này. Next.js trao đổi với Auth qua `/api/auth/google/exchange` ở cổng gateway nội bộ, rồi đặt cookie HttpOnly cho trình duyệt.

`/auth/callback` là trang frontend. `/api/auth-cookie/*` là API do Next.js xử lý để quản lý cookie, không proxy trực tiếp sang Auth.

Upload Cloudinary dùng URL có chữ ký do Media Service trả về; không thêm `/api` vào URL dịch vụ ngoài. SSE thông báo và WebSocket chat đã dùng `/api/notifications/stream` và `/api/chat/ws/chat`.
