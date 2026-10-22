# Frontend: ba khu vực độc lập và trải nghiệm điều hướng

Ngày thực hiện: 22/10/2026, GMT+7. Không tạo commit theo yêu cầu người dùng.

## Cách tổ chức

| Chức năng | Ứng viên | Nhà tuyển dụng | Admin |
| --- | --- | --- | --- |
| Trang giới thiệu công khai | `/` | `/recruiter` | Không công khai cổng quản trị trong menu ứng viên |
| Trang chủ làm việc | `/candidate/dashboard` | `/recruiter/dashboard` | `/admin` |
| Khám phá công ty | `/candidate/companies`, `/candidate/companies/[companyId]` | Hồ sơ công khai `/companies/[companyId]` trong shell riêng | Hồ sơ công khai trong shell riêng |
| Đăng nhập | `/login` | `/recruiter/login` | `/admin/login` |
| Đăng ký | `/register` | `/recruiter/register` | Không mở đăng ký |
| Thông báo | `/candidate/notifications` | `/recruiter/notifications` | `/admin/notifications` |
| Tin nhắn | `/candidate/messages` | `/recruiter/messages` | Không mở giao diện chat |
| Gửi báo cáo | `/candidate/reports` | `/recruiter/reports` | Xử lý tại `/admin/reports` |
| Cuộc gọi từ chat | `/candidate/calls/[id]` | `/recruiter/calls/[id]` | Không mở giao diện gọi |
| Trợ lý nghề nghiệp | `/candidate/ai` | Không có | Không có |

- Logo và Trang chủ trong workspace luôn về dashboard của chính khu vực đó.
- Người dùng Recruiter/Admin mở `/` sẽ về dashboard của tài khoản, không hiển thị
  landing ứng viên rồi giữ họ trong luồng sai.
- Candidate routes được kiểm tra role tại layout, kể cả tìm việc: khách chưa đăng
  nhập có thể tìm việc công khai; tài khoản vai trò khác nhận màn hình từ chối và
  nút trở về workspace của mình. Kiểm tra UI không thay thế phân quyền tại backend.
- Tin nhắn, thông báo, báo cáo, AI và cuộc gọi có màn hình dùng lại nhưng URL và
  workspace riêng. URL cũ vẫn tương thích qua chuyển hướng theo tài khoản, giữ
  query/fragment cần thiết. Nếu chưa đăng nhập, chuyển tới login với returnTo an toàn.
- Trang doanh nghiệp công khai giữ shell Recruiter/Admin nếu mở từ tài khoản đó.
  Link báo cáo công ty cũng theo vai trò; Admin đi tới nơi xử lý báo cáo.
- Sidebar ứng viên có mục Công ty. Danh sách và hồ sơ công ty trong
  `/candidate/companies` giữ một workspace ứng viên xuyên suốt; khách chưa đăng
  nhập cũng có thể xem dữ liệu công khai ở đây. Giữ URL `/companies` tương thích.
  Hai nhóm route dùng chung `CompaniesDirectory` và `CompanyProfile`.
- Danh sách dùng `GET /companies/search`, hồ sơ dùng `GET /companies/:id`:
  backend chỉ công khai doanh nghiệp VERIFIED. Trang chi tiết render động để
  kiểm tra lại quyền công khai mỗi lần mở, không giữ hồ sơ đã mất xác minh trong
  cache trang tĩnh. Không nạp việc làm nếu hồ sơ công ty không tồn tại.
- Việc làm trên hồ sơ gọi `GET /jobs/search` với `companyId`, `sort=NEWEST`,
  `pagination=OFFSET`, `limit=6`; giữ bộ lọc khi tải thêm/thử lại. Backend sẵn có
  lọc đúng companyId, trạng thái PUBLISHED và hạn nộp ở cả Elasticsearch và
  PostgreSQL. Không tải một trang việc làm chung rồi lọc tại browser. Hiển thị
  lương, địa điểm, hình thức, hạn nộp, tổng số vị trí và trạng thái trống/lỗi.
  Link tới `/candidate/jobs/[jobId]?source=COMPANY_PAGE`, giữ nguồn ứng tuyển;
  nút Xem công ty trong tin tuyển dụng quay về hồ sơ trong khu vực ứng viên.
- Admin có sidebar duy nhất, bỏ thanh tab chức năng bị lặp. Nhật ký có URL riêng
  `/admin/audit`; URL cũ `/admin?tab=audit` vẫn được hỗ trợ.
- Màn hình đăng nhập có nhãn khu vực riêng, không có thanh chọn ba vai trò. Logo,
  liên kết quay về và footer không đưa Recruiter/Admin sang trang ứng viên.
- Không thay hợp đồng API, dữ liệu backend, HttpOnly cookie, Google binder hay
  chính sách xác thực/role của tài khoản Google đã có.

## Giao diện và tham khảo

Tham khảo cách chia cổng và ưu tiên tác vụ của [TopCV ứng viên](https://www.topcv.vn/)
và [TopCV Nhà tuyển dụng](https://tuyendung.topcv.vn/), giữ thương hiệu CareerHub;
không sao chép logo, hình ảnh hay số liệu kinh doanh của TopCV.

- Landing ứng viên tập trung tìm việc; form GET chuyển q/location tới tìm kiếm
  thật, danh mục theo từ khóa, việc mới từ API và công cụ CV.
- Landing nhà tuyển dụng giới thiệu quy trình công ty → đăng tin → ứng viên, với
  CTA đăng ký/đăng nhập đúng khu vực. Recruiter chưa có công ty thấy hướng dẫn tạo
  hồ sơ trên dashboard, thay cho lỗi 404 chung chung.
- Thống nhất control, thẻ, khoảng cách, bảng và nền workspace; Admin có màu nhấn
  riêng. Sidebar mobile chuyển thành drawer có nút mở/đóng, Escape, vòng focus và
  khóa cuộn nền khi mở. Có skip link, focus rõ và hỗ trợ reduced motion.
- Skeleton dành cho chuyển route; lỗi tải trang và 404 có hành động phục hồi về
  đúng trang chủ của tài khoản.

## Hiệu năng

- Bỏ CSS import font từ Google; dùng font hệ thống hỗ trợ tiếng Việt, không cần
  kết nối font ngoài trước khi vẽ chữ.
- Sidebar/link thứ cấp tắt prefetch hàng loạt; các CTA chính vẫn dùng Next Link.
- NotificationProvider sống xuyên các lần điều hướng, không bị key của màn hình
  riêng tư remount theo route. Kiểm tra browser xác nhận một SSE connection qua
  dashboard → thông báo. Chỉ tải inbox khi mở màn hình, các trang khác chỉ cần
  unread count; khi reconnect trong inbox thì tải lại để đối soát sự kiện bỏ lỡ.
- Dữ liệu thông báo/cuộc gọi chỉ được đưa vào context khi owner khớp tài khoản
  hiện tại, kể cả render trước khi effect reset chạy. Các request cũ tiếp tục bị
  loại theo session revision như trước.
- Việc mới trên landing chỉ nạp module API và gọi dữ liệu khi gần viewport; không
  dựng số liệu giả. Header chờ xác định phiên trước khi hiện menu theo vai trò.
- Cờ API mode tách khỏi module API tuyển dụng lớn trong shell. LiveKit nạp động
  trong trang gọi; ảnh doanh nghiệp có kích thước và decoding async, gallery lazy.
- Build đầu của bản này báo First Load JS dùng chung khoảng 88 kB. Trang gọi mới
  khoảng 101 kB so với khoảng 307 kB ở route gọi cũ trong build local 20/10; SDK
  video vẫn phải tải khi thực sự dùng phòng. Đây là bundle khởi đầu, không phải
  tổng byte hay tốc độ mạng thực tế. Chưa đo Lighthouse/Core Web Vitals production.

## Kiểm chứng

- TypeScript và 151 kiểm tra logic frontend đạt.
- 49 kiểm tra portal/cookie browser đạt, một ca chỉ dành cho mobile được bỏ qua
  ở desktop. Gồm phân quyền, logo/home, link cũ, query tìm kiếm thật, mobile và
  thông báo theo nhu cầu. Kiểm tra ảnh desktop/mobile trực tiếp.
- Nhóm chat/thông báo đạt 18/18 sau khi sửa mock WebSocket cũ: mock chỉ bắt socket
  Chat, hỗ trợ URL object và không thay socket dev của Next.
- Build image frontend production đạt, đã khởi động gateway/các backend có sẵn
  và thay riêng container frontend local. Không build lại source backend.
- Chrome với backend Compose thật đạt 9 bước ở ba vai trò: login, một workspace
  header, logo về đúng home, không có link sidebar sang role khác, link cũ giữ
  role, reload HttpOnly, drawer mobile/Escape và không gọi font ngoài. Credential
  thử chỉ đọc từ file ignored đã có; ảnh/log chỉ lưu trong `.cache`.
- Lượt hồi quy Auth/CV/admin/workspace 132 ca đạt 127 ca ở lượt đầu; 5 ca fixture
  còn dùng menu mobile/phiên sau reload theo hành vi cũ đã được cập nhật, chạy lại
  và đạt. Không thay kiểm tra phân quyền để bỏ qua các lỗi này.
- Lượt xác nhận sau cập nhật (cross-team navigation, live workspace, communication,
  portal navigation): **81 đạt, 1 ca chỉ mobile được bỏ qua ở desktop**. Lượt cuối
  portal + cookie sau tối ưu tải module/header: **49 đạt, 1 bỏ qua tương tự**.
  Các lượt có ca trùng nhau, không cộng số ca thành tổng kiểm thử độc lập.
- Typecheck cuối đạt; image cuối build thành công và frontend local healthy.
  Smoke Chrome/backend thật được chạy lại trên image cuối: **9/9 bước đạt**,
  không lỗi JavaScript. Không thực hiện lại consent Google bằng tài khoản thật
  trong lượt chỉnh UI này; luồng callback/cookie được kiểm tra tự động.

Local: `http://localhost:3000`, `http://localhost:3000/recruiter`,
`http://localhost:3000/admin/login`. Chưa push/deploy domain production.

## Bổ sung mục Công ty cho ứng viên

- Thanh điều hướng trên cùng của workspace ứng viên có tab Công ty cạnh Trang
  chủ, kể cả khi đang mở hồ sơ cá nhân; tab được đánh dấu khi xem danh sách hoặc
  chi tiết công ty. Mobile tiếp tục truy cập qua mục Công ty trong menu bên.
- Typecheck và **152/152** kiểm tra logic đạt, gồm hợp đồng `companyId` trên
  mọi trang kết quả và kiểm tra ID trước khi gọi API.
- **14/14** ca Chrome desktop/mobile trong `candidate-companies.spec.ts` đạt:
  menu Công ty, hồ sơ công ty, việc đang tuyển, nguồn COMPANY_PAGE, quay lại,
  phân trang/thử lại không trùng tin, tìm kiếm, trạng thái trống, công ty không
  công khai, khách chưa đăng nhập và chặn vai trò khác. Kiểm tra ảnh hai kích thước.
  Phần hồ sơ/việc làm trong nhóm này dùng API fixture có kiểm tra request.
- Đã build production và thay riêng container frontend local; container healthy.
  Smoke Chrome trên backend Docker thật đạt: đăng nhập ứng viên, menu Công ty,
  danh sách công khai, giữ phiên sau reload, mobile không tràn ngang, hồ sơ
  không tồn tại có nút quay lại đúng khu vực và không lỗi JavaScript.
- Database Docker tại thời điểm kiểm tra chưa có doanh nghiệp VERIFIED:
  `GET /companies/search` trả danh sách rỗng, UI hiển thị trạng thái trống đúng.
  Chưa xác nhận trực tiếp hồ sơ có tin tuyển dụng bằng dữ liệu thật trong lần
  này; luồng đó đã đạt với fixture desktop/mobile. Không tạo hoặc duyệt dữ liệu
  công ty giả vào database hiện tại. Công ty được Admin duyệt sẽ xuất hiện qua
  API sẵn có, tin tuyển dụng được duyệt và còn hạn sẽ hiện trên hồ sơ công ty.
- Không thay source backend, cấu hình secret hoặc tạo commit.

Sau lượt kiểm tra trên, đã bổ sung dữ liệu Demo theo yêu cầu: 10 công ty VERIFIED,
10 tài khoản nhà tuyển dụng OWNER và 40 tin PUBLISHED còn hạn. Danh sách Công ty
local hiện có dữ liệu để kiểm thử trực tiếp. Xem
[bộ dữ liệu và tài khoản nhà tuyển dụng Demo](recruiter-demo-data.md).
