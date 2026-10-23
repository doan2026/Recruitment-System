# Nhận diện đối tác trong hội thoại

Ứng viên thấy tên/logo công ty; nhà tuyển dụng thấy tên/ảnh ứng viên tại cả danh
sách hội thoại và tiêu đề khung chat. Các cuộc trò chuyện cũ tự nhận thông tin
hiện tại qua API, không cần tạo lại hay đổi tiêu đề đã lưu. Chat nhóm giữ tên nhóm.

## Hợp đồng dữ liệu

Chat trả thêm `counterpart` tùy người xem trên các API tạo, danh sách và chi tiết:

```json
{
  "user_id": "UUID thành viên còn lại",
  "kind": "COMPANY hoặc CANDIDATE",
  "display_name": "Tên công ty hoặc ứng viên",
  "avatar_url": "URL ảnh công khai nếu có",
  "company_id": "Chỉ có khi là công ty"
}
```

Chat kiểm tra JWT và membership trước, rồi chỉ gom UUID thành viên còn lại của
các cuộc chat trực tiếp đã được phép đọc. Gọi song song các API nội bộ
`POST /internal/v1/chat-identities` của Company/Profile, tối đa 100 ID/request,
không forward JWT người dùng và không join database khác service. Tổng thời gian
tra cứu giới hạn hai giây; một service lỗi không chặn lịch sử/gửi tin.

Company chỉ đọc membership và tên/logo công ty. Profile chỉ đọc tên/avatar,
không trả email, điện thoại, địa chỉ, nội dung hồ sơ hoặc CV. Hai contract dùng
hai key mới riêng biệt `COMPANY_INTERNAL_API_KEY_CHAT` và
`PROFILE_INTERNAL_API_KEY_CHAT` trong `.env` gốc; Compose truyền chúng cho đúng
service. Profile giữ nguyên owner scope, quyền CV và consent tìm kiếm ứng viên.
API Gateway loại bỏ header nội bộ từ browser.

Frontend ưu tiên counterpart thuộc đúng thành viên, bỏ tiền tố “Chat với” ở
tiêu đề cũ khi cần fallback. Thiếu ảnh/ảnh lỗi có biểu tượng công ty hoặc chữ cái
đại diện. Hội thoại không có tên rõ ràng hiển thị trạng thái đang cập nhật kèm
mã ngắn; không đoán tên công ty từ tiêu đề hoặc gọi full profile từ browser.
Ảnh có kích thước cố định, lazy loading, không hiển thị ảnh có protocol không an toàn.

## Kiểm chứng

- Typecheck và 155 kiểm tra logic frontend đạt.
- 26 ca Chrome desktop/mobile cho hai vai trò và hồi quy communication đạt:
  ảnh/tên ở danh sách và header, chọn chat, ảnh lỗi, chat nhóm, WebSocket, phân
  trang lịch sử, gửi lại tin và marker cuộc gọi.
- Company: 355 unit tests đạt; Profile: 64 unit tests và Prisma validate đạt.
- API Profile với PostgreSQL `profile_test` riêng đạt: projection tối thiểu,
  ID đầu vào bị giới hạn, caller/key sai bị chặn, key Chat không đọc được CV,
  recruiter vẫn không truy cập được full profile.
- Go unit tests đạt, gồm nhận diện khác nhau theo người xem, không tra cứu ID
  ngoài hội thoại, giữ nguyên tên nhóm và hoạt động khi API thông tin lỗi.
- Đã build và cập nhật riêng Profile, Company, Chat, frontend trên Compose local;
  cả bốn container healthy. Gateway đã được kiểm tra cấu hình và reload.
- Chrome/backend thật đạt ở cả hai vai trò, desktop/mobile: cùng hội thoại hiển
  thị công ty/logo cho ứng viên và tên ứng viên cho recruiter; chọn hội thoại,
  header và input nhắn tin đúng. Kiểm tra outsider bị 403, recruiter vẫn bị 403
  khi đọc full profile, gateway ẩn/chặn API nội bộ dù có header key.
- Lượt kiểm tra chỉ dùng tài khoản fixture local và một hội thoại trực tiếp
  giữa chúng; chỉ bổ sung tên hiển thị khi hồ sơ fixture chưa có tên. Không thay
  hồ sơ hay nội dung hội thoại của tài khoản người dùng thật. Ảnh/log kiểm tra
  lưu trong `.cache/chat-identity-*`.

Không tạo commit; không đổi schema hay sửa dữ liệu hội thoại cũ.
