# Ghi chú thuyết trình — Recruitment System

Bản tổng hợp ngày 23/10/2026 (GMT+7). Gợi ý thời lượng: 12–15 phút.

Các số liệu kiểm thử được trích từ tài liệu đã lưu, không phải lượt chạy mới khi tạo slide. Các ảnh UI lấy từ artifact local 22/10/2026; số liệu bằng 0 trong ảnh thuộc phiên minh họa. Kế hoạch là đề xuất; không gán tỷ lệ hoàn thành hoặc ngày cam kết chưa được xác nhận.

## Slide 01 — Mở đầu

Báo cáo sơ bộ giới thiệu hệ thống Recruitment System với giao diện thương hiệu CareerHub. Nội dung tập trung vào bài toán, phạm vi đã triển khai, kiến trúc, kết quả kiểm chứng và phần cần tiếp tục hoàn thiện. Thông tin được tổng hợp đến ngày 23/10/2026. Đây là báo cáo hiện trạng dựa trên mã nguồn và tài liệu, không phải tuyên bố nghiệm thu production.

Nguồn:
- [README.md](<../../../README.md>)
- [docs/system-regression-2026-10-16.md](<../../../docs/system-regression-2026-10-16.md>)
- [docs/frontend-portals-2026-10-22.md](<../../../docs/frontend-portals-2026-10-22.md>)
- [docs/chat-identities-2026-10-23.md](<../../../docs/chat-identities-2026-10-23.md>)

## Slide 02 — Bài toán và mục tiêu

Bài toán được xác định từ phạm vi nghiệp vụ của dự án: ứng viên cần quản lý hồ sơ và theo dõi đơn; nhà tuyển dụng cần tổ chức toàn bộ vòng đời tuyển dụng; quản trị viên cần kiểm soát nội dung và tài khoản. Mục tiêu hệ thống là tập trung các tác vụ này, giữ trạng thái nhất quán và bổ sung gợi ý dựa trên độ tương đồng CV với công việc. Chưa có khảo sát người dùng hoặc số liệu đo mức tiết kiệm thời gian để khẳng định hiệu quả định lượng.

Nguồn:
- [README.md](<../../../README.md>)
- [Phan-cong-cong-viec-He-thong-tuyen-dung.md](<../../../Phan-cong-cong-viec-He-thong-tuyen-dung.md>)
- [docs/system-regression-2026-10-16.md](<../../../docs/system-regression-2026-10-16.md>)

## Slide 03 — Vai trò và phạm vi

Ba cổng Candidate, Recruiter và Admin được tách về URL và trải nghiệm điều hướng. Khách có thể xem dữ liệu công khai theo chính sách; các tác vụ cá nhân yêu cầu đăng nhập. Nhà tuyển dụng không được đọc toàn bộ hồ sơ riêng tư của ứng viên. Quyền xem CV gắn với đơn ứng tuyển hoặc consent tìm kiếm. Kiểm tra vai trò trên giao diện chỉ hỗ trợ trải nghiệm; backend vẫn chịu trách nhiệm phân quyền tài nguyên.

Nguồn:
- [docs/frontend-portals-2026-10-22.md](<../../../docs/frontend-portals-2026-10-22.md>)
- [docs/chat-identities-2026-10-23.md](<../../../docs/chat-identities-2026-10-23.md>)
- [docs/architecture.md](<../../../docs/architecture.md>)

## Slide 04 — Luồng tuyển dụng

Đây là luồng thành công điển hình. Recruiter tạo hồ sơ công ty và được Admin duyệt, sau đó tin tuyển dụng cũng qua kiểm duyệt. Candidate chọn CV để ứng tuyển; hệ thống chặn đơn trùng và pin snapshot CV. Recruiter xử lý hồ sơ, đặt lịch OFFLINE và gửi offer; Candidate chấp nhận đúng phiên bản để đơn chuyển HIRED. Tin nhắn và thông báo hỗ trợ giao tiếp trong quá trình này. Cuộc gọi LiveKit trong chat đã được kiểm chứng nhưng chưa đồng nghĩa lịch phỏng vấn ONLINE hoạt động.

Nguồn:
- [docs/system-regression-2026-10-16.md](<../../../docs/system-regression-2026-10-16.md>)
- [docs/architecture.md](<../../../docs/architecture.md>)

## Slide 05 — Chức năng đã kiểm chứng

Bốn nhóm chức năng bao phủ các hành trình chính và đã có bằng chứng chạy với backend thật trên Docker local. Trong phần này, cần phân biệt chức năng đã được kiểm chứng với toàn bộ yêu cầu mở rộng. Ví dụ quản lý CV/upload có bằng chứng; không vì vậy kết luận CV Builder/PDF nâng cao đã nghiệm thu đầy đủ. Admin có quản trị và export thật nhưng báo cáo JOB/COMPANY vẫn có giới hạn xử lý. Chatbot AI hiện giữ tắt.

Nguồn:
- [docs/system-regression-2026-10-16.md](<../../../docs/system-regression-2026-10-16.md>)
- [README.md](<../../../README.md>)

## Slide 06 — Kiến trúc tổng thể

Hệ thống có 12 API service và hai embedding worker; không cộng worker vào số lượng API. Frontend Next.js cung cấp ba portal và chuyển yêu cầu qua gateway. Sơ đồ gom service theo vai trò để dễ trình bày, không biểu diễn quyền truy cập cơ sở dữ liệu chéo. PostgreSQL hiện dùng chung cluster/database, tách schema theo service, riêng một số bảng Go có owner trong public. Nghiệp vụ giao tiếp qua API hoặc Kafka; không truy cập chéo bảng. Redis, Elasticsearch, Cloudinary và LiveKit phục vụ từng nhu cầu cụ thể.

Nguồn:
- [README.md](<../../../README.md>)
- [docs/architecture.md](<../../../docs/architecture.md>)

## Slide 07 — Công nghệ sử dụng

Bốn service Java dùng Spring Boot; bốn service Node dùng NestJS; ba service Go xử lý chat, notification và video; AI dùng FastAPI và sentence-transformers. Cách chia này phản ánh runtime hiện tại của README và architecture, thay thế các mô tả cũ về 11 service, Node cho chat hoặc Jitsi. Đa ngôn ngữ giúp khai thác thư viện phù hợp nhưng tăng chi phí vận hành và kiểm thử hợp đồng. Trong báo cáo không cần đọc toàn bộ công nghệ, chỉ giải thích vai trò của từng nhóm.

Nguồn:
- [README.md](<../../../README.md>)
- [docs/architecture.md](<../../../docs/architecture.md>)
- [frontend/package.json](<../../../frontend/package.json>)

## Slide 08 — Phân quyền và dữ liệu

Auth là nơi phát hành token RS256; khóa bí mật chỉ thuộc Auth. Với browser, cookie proxy HttpOnly quản lý access/refresh, phản hồi JSON chỉ chứa user. Backend kiểm tra quyền đến từng tài nguyên: CV, đơn ứng tuyển, hội thoại và cuộc gọi. Snapshot CV tránh việc ứng viên sửa hoặc xóa CV làm thay đổi nội dung đã nộp. Transactional outbox của Job hỗ trợ ghi dữ liệu và sự kiện nguyên tử; delivery at-least-once đòi hỏi consumer xử lý trùng. Giới hạn cần công khai: môi trường local chưa tách credential database như production; việc khóa tài khoản không làm tất cả token stateless biến mất tức thì.

Nguồn:
- [README.md](<../../../README.md>)
- [docs/architecture.md](<../../../docs/architecture.md>)
- [docs/system-regression-2026-10-16.md](<../../../docs/system-regression-2026-10-16.md>)

## Slide 09 — Pipeline AI

AI sử dụng sentence-transformers với model được ghim revision, sinh embedding 384 chiều trên CPU và lưu pgvector. Hai worker nhận sự kiện CV và Job, tách khỏi API. Báo cáo 16/10 ghi nhận pipeline thật với PDF fixture và điểm match dạng số; candidate nhận gợi ý, recruiter xem người đã consent. Điều này xác nhận chức năng tích hợp, chưa xác nhận độ chính xác hoặc công bằng trên dữ liệu tuyển dụng thực. Điểm tương đồng chỉ hỗ trợ quyết định. AI Assistant có code riêng nhưng hiện CHAT_ENABLED=false; luyện phỏng vấn AI chưa được backend triển khai.

Nguồn:
- [services/ai-service/README.md](<../../../services/ai-service/README.md>)
- [README.md](<../../../README.md>)
- [docs/system-regression-2026-10-16.md](<../../../docs/system-regression-2026-10-16.md>)

## Slide 10 — Giao diện ứng viên

Ảnh này lấy trực tiếp từ artifact giao diện có sẵn trong repository, không phải ảnh dựng hoặc một lần chạy mới. Ảnh được chụp khi dashboard chưa có hồ sơ/đơn của phiên minh họa, nên các số 0 không mô tả quy mô dữ liệu dự án. Có thể chỉ vào ba tác vụ chính: khám phá việc, quản lý CV và theo dõi đơn. Tài liệu portal ghi nhận thiết kế responsive, role gate và xử lý trạng thái lỗi/trống. Menu hiển thị trợ lý AI không có nghĩa chức năng chatbot đang bật.

Nguồn:
- [.cache/portal-live/candidate-desktop.png](<../../../.cache/portal-live/candidate-desktop.png>)
- [docs/frontend-portals-2026-10-22.md](<../../../docs/frontend-portals-2026-10-22.md>)

## Slide 11 — Giao diện nhà tuyển dụng và Admin

Hai ảnh minh họa workspace thật của frontend local, cắt phần trên để giữ độ đọc được. Recruiter có điều hướng quản lý tin, ứng viên, hồ sơ công ty, lời mời và tin nhắn. Admin có điều hướng quản lý người dùng, duyệt tin/công ty, báo cáo, audit và thống kê. Đây là trạng thái giao diện theo phiên fixture trước khi bổ sung bộ demo, không phải ảnh dashboard có số liệu kinh doanh. Các hành vi backend thật cần căn cứ báo cáo kiểm thử, không suy ra từ ảnh đơn thuần.

Nguồn:
- [.cache/portal-live/recruiter-desktop.png](<../../../.cache/portal-live/recruiter-desktop.png>)
- [.cache/portal-live/admin-desktop.png](<../../../.cache/portal-live/admin-desktop.png>)
- [docs/frontend-portals-2026-10-22.md](<../../../docs/frontend-portals-2026-10-22.md>)
- [docs/system-regression-2026-10-16.md](<../../../docs/system-regression-2026-10-16.md>)

## Slide 12 — Bằng chứng kiểm thử

Nhấn mạnh ngày và phạm vi của từng số: 12 health endpoint và 138 browser test thuộc báo cáo 16/10; 155 kiểm tra logic frontend thuộc cập nhật 23/10. Đây không phải số lượng hoàn thành chức năng hay phần trăm tiến độ. Báo cáo hệ thống còn có kết quả backend unit/integration theo từng service. Báo cáo portal 22/10 ghi nhận smoke Chrome/backend thật 9/9 bước cho ba vai trò; báo cáo chat 23/10 có 26 ca Chrome và kiểm tra backend thật ở hai vai trò. Không cộng các lượt có ca trùng thành tổng độc lập. Tại lần tạo deck này chỉ đối chiếu tài liệu và kiểm tra file trình chiếu.

Nguồn:
- [docs/system-regression-2026-10-16.md](<../../../docs/system-regression-2026-10-16.md>)
- [docs/frontend-portals-2026-10-22.md](<../../../docs/frontend-portals-2026-10-22.md>)
- [docs/chat-identities-2026-10-23.md](<../../../docs/chat-identities-2026-10-23.md>)

## Slide 13 — Phân công nhóm

Tài liệu phân công gốc chia theo vertical slice, tức một người chịu trách nhiệm cả nghiệp vụ backend và frontend tương ứng. Báo cáo giữ tên Người 1, Người 2, Người 3 vì repository không cung cấp tên thành viên được xác nhận. Nhóm 1 phụ trách danh tính/hồ sơ/quản trị; nhóm 2 phụ trách công ty/tin/ứng tuyển/AI; nhóm 3 phụ trách lịch, giao tiếp và hạ tầng. Phần service trong slide đã cập nhật theo runtime hiện tại: Video tách riêng, Chat/Notification/Video dùng Go và LiveKit thay Jitsi. Điểm giao quan trọng nhất là JWT, Media và contract Kafka.

Nguồn:
- [Phan-cong-cong-viec-He-thong-tuyen-dung.md](<../../../Phan-cong-cong-viec-He-thong-tuyen-dung.md>)
- [README.md](<../../../README.md>)
- [docs/architecture.md](<../../../docs/architecture.md>)

## Slide 14 — Hạn chế và rủi ro

Các giới hạn này lấy từ tài liệu đã ghi nhận, không suy diễn rằng cả hệ thống chưa hoạt động. Thứ nhất, gọi video trong chat hoạt động nhưng lịch phỏng vấn ONLINE chưa có binding phòng/token. Thứ hai, chatbot giữ tắt theo cấu hình hiện tại và luyện phỏng vấn AI chưa triển khai. Thứ ba, báo cáo USER đã có xử lý thật nhưng JOB/COMPANY chưa có hợp đồng gỡ nội dung; trạng thái UNKNOWN/PROCESSING sau timeout cần đối soát. Cuối cùng, cần bộ CV thực tế, kiểm thử tải dài hạn và mô hình credential production. Không dùng số ca test để khẳng định hệ thống sẵn sàng production.

Nguồn:
- [docs/system-regression-2026-10-16.md](<../../../docs/system-regression-2026-10-16.md>)
- [README.md](<../../../README.md>)

## Slide 15 — Kế hoạch tiếp theo

Đây là đề xuất dựa trên hiện trạng, không phải cam kết của nhóm về tuần hoặc ngày hoàn thành. Mốc đầu ưu tiên ổn định demo hiện có và chạy lại ba hành trình. Mốc hai khép các contract sản phẩm còn thiếu nếu giữ trong phạm vi nghiệm thu. Mốc ba đo chất lượng AI và tải với dữ liệu có quyền sử dụng, dùng tiêu chí được xác định trước. Mốc bốn chuẩn bị môi trường, giám sát, sao lưu/phục hồi và tài liệu bàn giao. Chatbot là phạm vi cần xác nhận, không tự bật chỉ để có thêm tính năng trong demo.

Nguồn:
- [docs/system-regression-2026-10-16.md](<../../../docs/system-regression-2026-10-16.md>)
- [README.md](<../../../README.md>)
- [docs/architecture.md](<../../../docs/architecture.md>)

## Slide 16 — Kết luận và demo

Kết luận ở mức sơ bộ: hệ thống đã có ba portal, 12 API service và bằng chứng chạy local cho các hành trình chính. Các mục còn mở đã được chỉ rõ, vì vậy chưa kết luận đạt nghiệm thu toàn hệ thống hay production. Nếu demo trực tiếp, chuẩn bị trước tài khoản fixture: Candidate xem việc/CV/đơn; Recruiter xem pipeline/offer hoặc tin nhắn; Admin xem duyệt tin/audit. Chỉ chạy các thao tác thay đổi dữ liệu trên fixture được phép. Nếu backend chưa chạy, dùng các ảnh và bằng chứng có ngày trong deck; không nói đó là demo live. Mời người nghe góp ý về phạm vi nghiệm thu và ưu tiên tiếp theo.

Nguồn:
- [README.md](<../../../README.md>)
- [docs/system-regression-2026-10-16.md](<../../../docs/system-regression-2026-10-16.md>)
- [docs/frontend-portals-2026-10-22.md](<../../../docs/frontend-portals-2026-10-22.md>)
- [docs/chat-identities-2026-10-23.md](<../../../docs/chat-identities-2026-10-23.md>)

## Chuẩn bị trước khi trình bày

- Điền tên thành viên/lớp/giảng viên nếu cần; bản hiện tại giữ nhãn Người 1/2/3 từ tài liệu dự án.
- Mở file PowerPoint để chỉnh sửa. Ghi chú lời dẫn đã nằm trong Speaker Notes của cả 16 slide.
- PDF dùng để xem/chia sẻ, PowerPoint giữ các thành phần chữ và sơ đồ có thể sửa.
- Nếu demo live, khởi chạy đúng môi trường và dùng fixture được phép; không dùng ảnh cũ như bằng chứng live.

## Tái tạo bản trình chiếu

Chạy từ thư mục gốc dự án sau khi cài python-pptx và Pillow vào `.cache/report-tools`:

```powershell
python docs/reports/recruitment-preliminary-2026-10-23/build_report.py
```
