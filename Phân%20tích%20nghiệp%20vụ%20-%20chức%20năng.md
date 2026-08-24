# I. Các vai trò

## 1.1 Ứng viên (Candidate)

- Đăng ký
- Đăng nhập
- Quản lý hồ sơ
- Upload CV
- Tạo CV Online
- Tìm việc
- Lưu việc
- Ứng tuyển
- Chat với HR
- Theo dõi trạng thái hồ sơ
- Xem lịch phỏng vấn
- Tham gia phỏng vấn online
- Nhận thông báo

## 1.2 Nhà tuyển dụng (Recruiter)

- Tạo công ty
- Đăng tuyển
- Quản lý bài tuyển dụng
- Quản lý ứng viên
- Lọc hồ sơ
- Đặt lịch phỏng vấn
- Chat
- Đánh giá ứng viên
- Gửi Offer
- Thống kê

## 1.3 Công ty

- Thông tin
- Logo
- Địa chỉ
- Quy mô
- Lĩnh vực
- Hình ảnh
- Video giới thiệu

## 1.4 Admin

Có thể:

- Quản lý người dùng
- Quản lý công ty
- Duyệt bài đăng
- Quản lý báo cáo
- Khóa tài khoản
- Dashboard

# II. Chức năng chi tiết

## 2.1 Quản lý tài khoản

### Đăng ký

Có nhiều loại:

- Candidate
- Recruiter

### Đăng nhập

- JWT
- Refresh Token
- Google Login
- OTP Email

### Quên mật khẩu

- Email
- OTP

## 2.2 Hồ sơ ứng viên

Ứng viên có thể tạo:

- Avatar
- Kỹ năng
- Học vấn
- Kinh nghiệm
- Chứng chỉ
- Dự án
- Portfolio
- Github
- LinkedIn

Có thể:

- Upload PDF
- Hoặc tạo CV Online

## 2.3 Quản lý việc làm

Nhà tuyển dụng tạo:

- Tiêu đề
- Mô tả
- Mức lương
- Địa điểm
- Hình thức
- Kỹ năng
- Deadline

Có thể ở các trạng thái:

- Draft
- Published
- Closed

## 2.4 Tìm kiếm việc

Theo:

- Tên
- Công ty
- Thành phố
- Mức lương
- Kỹ năng
- Kinh nghiệm
- Loại hình

## 2.5 Bookmark

Ứng viên lưu việc yêu thích.

## 2.6 Ứng tuyển

```text
Ứng viên
   ↓
Click Apply
   ↓
Chọn CV
   ↓
Viết Cover Letter
   ↓
Upload
   ↓
Done
```

## 2.7 Quản lý hồ sơ ứng tuyển

HR thấy:

```text
Danh sách CV
   ↓
Lọc
   ↓
Đánh giá
   ↓
Chuyển trạng thái
```

Ví dụ:

```text
Applied
   ↓
Reviewing
   ↓
Interview
   ↓
Passed
   ↓
Rejected
```

## 2.8 Đặt lịch phỏng vấn

```text
HR
   ↓
Chọn ngày
   ↓
Giờ
   ↓
Hình thức
   ↓
Google Meet
   ↓
Online
   ↓
Offline
```

## 2.9 Chat

**Candidate ↔ Recruiter**

- Realtime
- WebSocket

Có:

- Text
- Image
- File
- Emoji
- Seen

## 2.10 Notification

- Firebase
- Thông báo email
- Có lịch phỏng vấn
- Có Offer
- Có Chat
- Có Job mới

## 2.11 Dashboard

Recruiter có:

- Số bài tuyển
- Số CV
- Tỷ lệ đậu
- Nguồn ứng viên
- Biểu đồ

## 2.12 Video Interview

Có:

- Camera
- Mic
- Screen Share

## 2.13 Video Interview với trợ lý AI nhà tuyển dụng

- Đọc CV ứng viên
- Tương tác phỏng vấn ứng viên

## 2.14 Chatbot hỗ trợ ứng viên

- Đưa ra các gợi ý việc làm phù hợp theo CV ứng viên
