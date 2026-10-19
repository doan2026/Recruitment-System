---
version: alpha
name: "CareerHub"
description: "Modern Corporate recruitment workspace for Vietnamese candidates and recruiters."
colors:
  primary: "#006e2e"
  primary-action: "#00b14f"
  primary-soft: "#71fe91"
  background: "#f9f9ff"
  surface: "#ffffff"
  surface-muted: "#f0f3ff"
  text: "#151c27"
  text-muted: "#3d4a3d"
  border: "#dce2f3"
  danger: "#d32f2f"
  warning: "#f59e0b"
typography:
  display:
    fontFamily: "Manrope, Inter, sans-serif"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
rounded:
  DEFAULT: "0.5rem"
  sm: "0.25rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.5rem"
  full: "9999px"
spacing:
  page-max: "80rem"
  gutter: "1.5rem"
  section-gap: "2rem"
  control-height: "2.875rem"
components:
  button: { radius: "0.5rem" }
  card: { radius: "1rem" }
  input: { minHeight: "2.875rem" }
  badge: { radius: "9999px" }
---

# CareerHub Design System

## Overview

### Creative North Star

CareerHub có cảm giác như một “career operations desk”: rõ nhịp, tin cậy, có khoảng thở và luôn cho người dùng biết hồ sơ đang ở đâu. Nguồn thiết kế trực tiếp là `stitch_ui_ux_design_document_clone.zip`, đặc biệt các màn tìm việc, hồ sơ công ty và quản lý tin tuyển dụng.

### Product context and register

- **Audience and primary job:** ứng viên Việt Nam tìm việc/theo dõi hồ sơ và recruiter vận hành công ty, tin tuyển dụng, pipeline, offer.
- **Target market and evidence:** Việt Nam; giao diện, tiền tệ và dữ liệu mẫu trong tài liệu nghiệp vụ và Stitch đều dùng tiếng Việt/VND.
- **Locale and language policy:** `vi-VN`; nội dung UI viết câu ngắn, chủ động, không lộ thông báo thô từ backend.
- **Usage scene:** desktop là chính cho recruiter, desktop/mobile cho candidate; mật độ vừa phải, ưu tiên đọc nhanh trạng thái.
- **Register:** product UI; trang chủ có thể biểu đạt thương hiệu nhưng màn nghiệp vụ phải quen thuộc và ổn định.
- **Memorable signature:** “career signal” dạng quỹ đạo tròn và đường nhấn xanh dọc thể hiện tiến trình nghề nghiệp.
- **Restraint:** form, bảng, trạng thái lỗi và hành động nguy hiểm không dùng trang trí gây phân tâm.
- **Anti-references:** không dùng dashboard tối neon, gradient tím kiểu AI chung chung, glassmorphism dày hoặc card cùng kích thước thiếu thứ bậc.
- **Token ownership/runtime mapping:** CSS variables trong `frontend/app/globals.css` là nguồn runtime hiện tại; file này phản chiếu giá trị đã chấp nhận. Build và audit frontend là drift gate.

## Colors

Primary xanh đậm mang vai trò thương hiệu và focus; xanh sáng chỉ dùng cho hành động tích cực hoặc điểm nhấn. Nền xanh-trắng rất nhạt tạo lớp tonal thay vì dùng nhiều shadow. Danger đỏ và warning hổ phách luôn đi kèm chữ/icon, không truyền nghĩa chỉ bằng màu.

## Typography

Manrope dành cho tiêu đề, số liệu và điểm nhấn. Inter dành cho body, form, bảng và nhãn. Kích thước body mặc định 16px, line-height 1.5; không dùng italic ngoại trừ nhấn từ ngắn ở hero.

## Layout

Nội dung tối đa 1280px với gutter 24px; mobile dùng lề 16px. Desktop dùng lưới 12 cột về nguyên tắc, các màn hiện tại quy về 2–3 cột. Bảng có vùng cuộn ngang riêng, form giữ document scrolling tự nhiên.

## Elevation & Depth

Card dùng nền trắng, viền tonal và shadow môi trường `var(--shadow)` (`0 8px 24px rgba(0,0,0,.08)` theo runtime hiện tại). Hover nâng tối đa 3px. Header sticky có nền bán trong suốt; không dùng shadow lớn trên form và bảng.

## Shapes

Card 16px, control 8px, badge pill. Brand mark được phép bất đối xứng nhẹ để tạo nhận diện; các control nghiệp vụ vẫn giữ hình học quen thuộc.

## Components

### Foundational visual states

Tất cả control có hover, active, focus-visible, disabled/busy. Focus dùng vòng xanh rõ. Loading dùng spinner trong vùng có chiều cao ổn định; reduced-motion loại bỏ transform và rút ngắn animation.

### Buttons and actions

Primary solid xanh, secondary viền xanh, neutral viền xám, warning hổ phách, danger đỏ. Một vùng quyết định chỉ có một primary. Nút nguy hiểm tách khỏi hành động thường.

### Navigation and data display

Top navigation sticky, cuộn ngang trên màn hẹp. Bảng dùng HTML semantic và vùng overflow riêng. Badge hiển thị trạng thái bằng màu cộng với văn bản đầy đủ.

### Workspace consistency

`CandidateWorkspace` là khung duy nhất cho ứng viên đã đăng nhập; `CandidateShell` dùng lại khung này, kể cả Tin nhắn và Thông báo. Khách và tài khoản khác xem việc làm công khai qua `PublicShell`. `RecruiterShell` và `AdminShell` dùng chung geometry `.shell-body`/`.sidebar`/`.content`, token nền/viền và nhãn trạng thái điều hướng `aria-current`. Trang đăng nhập/đăng ký tách khỏi khung nghiệp vụ. Tiêu đề trang nghiệp vụ dùng chung 26px/1.3, menu đang chọn dùng `--primary` trên chữ trắng; chuông thông báo dùng chung `NotificationBell` với số chưa đọc.

Sidebar Recruiter/Admin chuyển thành thanh cuộn ngang ở 980px; khung Candidate giữ breakpoint 680px hiện có. Form cuộn theo trang. Chỉ vùng chat giới hạn chiều cao để tin nhắn cuộn độc lập; ở mobile danh sách hội thoại nằm trên nội dung.

### Forms and overlays

Input cao tối thiểu 46px, label luôn nhìn thấy, lỗi được gắn bằng `aria-describedby`. Textarea `resize: none`. Native select/date được chấp nhận cho baseline; khi sản phẩm yêu cầu popup đồng nhất sẽ thay bằng primitive accessible dùng chung.

### Iconography

Baseline dùng ký hiệu chữ đơn giản và nhãn văn bản; icon-only bắt buộc có accessible name. Khi bổ sung thư viện icon sẽ dùng một họ outline duy nhất.

### Motion

Hover/feedback 120–180ms ease-out. Motion chỉ giải thích trạng thái; `prefers-reduced-motion` giảm gần như toàn bộ animation.

### Content and data visualization

Giọng văn trực tiếp: “Lưu thay đổi”, “Gửi đi chờ duyệt”, “Đóng tin”. Số và ngày theo `vi-VN`; VND có phân tách hàng nghìn.

## Do's and Don'ts

- **Do:** dùng trạng thái, nguồn dữ liệu và phiên bản để làm rõ điều gì đang xảy ra.
- **Do:** giữ cùng hành động, màu ngữ nghĩa và phản hồi giữa Candidate và Recruiter.
- **Don't:** hiển thị raw backend message, token, cursor hoặc thông tin nhạy cảm như nội dung chính.
- **Don't:** tạo card trang trí không giúp người dùng ra quyết định hoặc hoàn thành công việc.
