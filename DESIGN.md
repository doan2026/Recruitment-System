---
version: alpha
name: "CareerHub"
description: "Modern Corporate recruitment workspace for Vietnamese candidates and recruiters."
colors:
  primary: "#006e2e"
  primary-action: "#00b14f"
  primary-soft: "#eaf5ee"
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
  gutter: "2rem"
  section-gap: "2rem"
  control-height: "2.875rem"
components:
  button: { rounded: "0.5rem" }
  card: { rounded: "1rem" }
  input: { height: "2.875rem" }
  badge: { rounded: "9999px" }
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
- **Memorable signature:** logo CareerHub, xanh đậm trên nền xanh nhạt, nhãn vai trò và các bước tìm việc rõ ràng.
- **Restraint:** form, bảng, trạng thái lỗi và hành động nguy hiểm không dùng trang trí gây phân tâm.
- **Anti-references:** không dùng dashboard tối neon, gradient tím kiểu AI chung chung, glassmorphism dày hoặc card cùng kích thước thiếu thứ bậc.
- **Token ownership/runtime mapping:** CSS variables trong `frontend/app/globals.css` là nguồn runtime hiện tại; file này phản chiếu giá trị đã chấp nhận. Build và audit frontend là drift gate.

## Colors

Primary xanh đậm mang vai trò thương hiệu và focus; xanh sáng chỉ dùng cho hành động tích cực hoặc điểm nhấn. Nền xanh-trắng rất nhạt tạo lớp tonal thay vì dùng nhiều shadow. Danger đỏ và warning hổ phách luôn đi kèm chữ/icon, không truyền nghĩa chỉ bằng màu.

## Typography

Manrope dành cho tiêu đề, số liệu và điểm nhấn. Inter dành cho body, form, bảng và nhãn. Body nền 16px/1.6; nội dung nghiệp vụ, bảng và control 14px; tiêu đề trang 28px/1.3 (24px trên mobile). Không dùng italic trong nội dung nghiệp vụ.

## Layout

Nội dung workspace tối đa 1280px với gutter 32px; mobile dùng lề 16px. Desktop dùng lưới 12 cột về nguyên tắc, các màn hiện tại quy về 2–3 cột. Bảng có vùng cuộn ngang riêng, form giữ document scrolling tự nhiên.

## Elevation & Depth

Card dùng nền trắng, viền tonal và shadow môi trường `var(--shadow)` (`0 4px 18px rgba(21,28,39,.04)`). Hover nâng tối đa 3px. Header desktop cao tối thiểu 76px, sticky, nền trắng; không dùng shadow lớn trên form và bảng.

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

`WorkspaceShell` sở hữu toàn bộ header, identity, navigation, content và footer cho ba vai trò. `CandidateWorkspace`, `RecruiterShell`, `AdminShell` chỉ cấp menu/danh tính theo quyền; context ngăn lồng hai shell. Tin nhắn, Thông báo và Báo cáo dùng lại shell tương ứng. Khách xem việc làm công khai qua `PublicShell`, dùng cùng logo, header và token. Sidebar desktop rộng 248px, mục menu cao tối thiểu 44px, trạng thái hiện tại dùng `aria-current` và nền `--primary` với chữ trắng. Header chỉ chứa ba liên kết công khai, thông báo, tin nhắn và đăng xuất; menu nghiệp vụ nằm trong sidebar.

Cả ba sidebar chuyển thành thanh cuộn ngang ở 980px. Mục đang mở tự hiện trong viewport menu mà không cuộn trang. Gutter mobile 16px ở 680px. Form cuộn theo trang; bảng cuộn ngang riêng; chat có chiều cao giới hạn trên desktop và xếp dọc trên mobile. Admin chỉ có một sidebar; các tab dữ liệu nội bộ nằm trong nội dung.

`PageHeader`, `Metric`, `Card`, `LoadingState`, `EmptyState` và `.table-wrap` là các mẫu chuẩn cho trang nghiệp vụ. Metric 32px, card bo 16px, nút/input 46px và bo 8px. Trang hồ sơ/CV không tự đặt lại cỡ chữ và kích thước nút thấp hơn hệ thống.

`AuthFrame` sở hữu logo, liên kết cổng đăng nhập, phần giới thiệu vai trò, card form và footer cho login/register/forgot/reset/Google callback của cả ba vai trò. Desktop hai cột; dưới 900px chỉ còn form. H1 28px, card 16px, control 46px. Không hiển thị số liệu hay lời chứng thực không có nguồn. Trang chủ dùng cùng logo, màu, card và nút, trình bày ba bước hồ sơ → tìm việc → theo dõi ứng tuyển.

### Forms and overlays

Input cao tối thiểu 46px, label luôn nhìn thấy, lỗi được gắn bằng `aria-describedby`. Textarea `resize: none`. Native select/date được chấp nhận cho baseline; khi sản phẩm yêu cầu popup đồng nhất sẽ thay bằng primitive accessible dùng chung.

### Iconography

Dùng Lucide outline cho điều hướng, hành động và trạng thái trống. Icon-only bắt buộc có accessible name; icon cạnh nhãn dùng `aria-hidden`.

### Motion

Hover/feedback 120–180ms ease-out. Motion chỉ giải thích trạng thái; `prefers-reduced-motion` giảm gần như toàn bộ animation.

### Content and data visualization

Giọng văn trực tiếp: “Lưu thay đổi”, “Gửi đi chờ duyệt”, “Đóng tin”. Số và ngày theo `vi-VN`; VND có phân tách hàng nghìn.

## Do's and Don'ts

- **Do:** dùng nhãn trạng thái tiếng Việt và thông báo nguồn dữ liệu khi ảnh hưởng đến quyết định của người dùng; phiên bản kỹ thuật chỉ dùng trong xử lý xung đột.
- **Do:** giữ cùng hành động, màu ngữ nghĩa và phản hồi giữa Candidate và Recruiter.
- **Don't:** hiển thị raw backend message, token, cursor hoặc thông tin nhạy cảm như nội dung chính.
- **Don't:** tạo card trang trí không giúp người dùng ra quyết định hoặc hoàn thành công việc.
