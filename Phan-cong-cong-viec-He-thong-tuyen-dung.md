# TÀI LIỆU PHÂN CÔNG CÔNG VIỆC
## HỆ THỐNG TUYỂN DỤNG TRỰC TUYẾN
Kiến trúc microservice · 11 service · Nhóm 3 thành viên

Chia việc theo LUỒNG NGHIỆP VỤ — kèm luồng hoạt động và tài liệu nghiệp vụ từng chức năng


Ngày lập: 18/08/2026

<!-- Page 2 -->

# MỤC LỤC
# I. Nguyên tắc chia việc & phân công tổng quan

1. 1 Nguyên tắc chia theo luồng nghiệp vụ · 1.2 Bảng phân công tổng quan · 1.3 Cân đối khối lượng
# II. Hợp đồng giao tiếp giữa các thành viên

2. 1 Bảng điểm giao · 2.2 Quy ước chung toàn hệ thống

```text
 III.      PHẦN A — Người 1: Luồng Danh tính & Hồ sơ                  Auth · User/Profile · File/Media · Admin &
                                                                      Statistics
 IV.       PHẦN B — Người 2: Luồng Tin tuyển dụng & Ứng tuyển         Company · Job & Search · Application · AI
                                                                      Service
 V.        PHẦN C — Người 3: Luồng Phỏng vấn, Giao tiếp & Hạ tầng     Interview & Video · Chat · Notification ·
                                                                      Hạ tầng
 VI.       Luồng nghiệp vụ xuyên service (end-to-end)                 3 kịch bản kiểm thử tích hợp
 VII.      Lộ trình triển khai theo tuần                              5 tuần cho 3 thành viên
 VIII.     Các điểm cần chốt trước khi code                           6 vấn đề chưa khớp giữa 2 tài liệu đầu
                                                                      vào
 IX.       Checklist nghiệm thu chung                                 Theo service · toàn hệ thống · phối hợp
                                                                      nhóm
```


Mỗi service trong chương III, IV, V đều trình bày theo cùng một cấu trúc: (1) Luồng hoạt động các chức năng; (2) Tài liệu nghiệp vụ gồm quy tắc nghiệp vụ, mô hình dữ liệu, API, sự kiện Kafka, phụ thuộc và tiêu chí hoàn thành.

<!-- Page 3 -->

# I. NGUYÊN TẮC CHIA VIỆC & PHÂN CÔNG TỔNG QUAN
### 1.1. Nguyên tắc chia theo luồng nghiệp vụ
Tài liệu này chia 11 service cho 3 thành viên theo LUỒNG NGHIỆP VỤ (vertical slice) chứ không theo ngôn ngữ lập trình. Mỗi người sở hữu trọn một luồng từ backend tới màn hình frontend tương ứng, nhờ đó khi một tính năng lỗi thì chỉ một người phải điều tra thay vì cả ba.
- Mỗi thành viên sở hữu trọn vẹn một luồng nghiệp vụ, bao gồm cả phần frontend của luồng đó.
- Service dùng chung (Auth, File/Media) thuộc về người sở hữu luồng dùng chúng nhiều nhất và phải hoàn thành sớm nhất.
- Service có quan hệ dữ liệu chặt với nhau thì giao cùng một người, để hợp đồng dữ liệu không phải đàm phán qua lại (ví dụ: Job & Search với AI Service).
- Khối lượng cân bằng theo độ khó chứ không theo số lượng service: người ít service hơn gánh thêm hạ tầng dùng chung.
- ĐÁNH ĐỔI CẦN BIẾT TRƯỚC: chia theo luồng nghiệp vụ thì không ai chỉ làm một ngôn ngữ. Người 1 làm cả Java và Node; Người 2 làm Node, Java và Python. Nếu trong nhóm có bạn chỉ thạo một ngôn ngữ, cần cân nhắc đổi lại theo cách chia theo framework.

### 1.2. Bảng phân công tổng quan
```text
 Thành viên          Service backend phụ trách            Frontend phụ trách            Trách nhiệm thêm
 Người 1 — Luồng     Auth Service (Spring);               Đăng nhập/đăng ký, hồ sơ      Redis (OTP/session), cấu
 Danh tính & Hồ sơ   User/Profile Service (Nest);         ứng viên, CV Builder,         hình SMTP, tài khoản
                     File/Media Service (Nest); Admin     upload file, Admin            Cloudinary chung
                     & Statistics Service (Spring)        Dashboard
 Người 2 — Luồng     Company Service (Nest); Job &        Trang công ty, tìm kiếm &     Elasticsearch, pgvector, tài
 Tuyển dụng & Ứng    Search Service (Nest);               chi tiết job, luồng ứng       khoản Anthropic API
 tuyển               Application Service (Spring); AI     tuyển, màn quản lý ứng
                     Service (Python)                     viên của HR, mục Việc làm
                                                          phù hợp
 Người 3 — Luồng     Interview & Video Call Service       Lịch phỏng vấn & phòng        docker-compose tổng,
 Phỏng vấn & Giao    (Spring); Chat Service (Node);       video, chat realtime, trung   Kafka, Nginx gateway, Jitsi
 tiếp                Notification Service (Nest)          tâm thông báo, chatbot        self-host, Firebase
                                                          widget
```


### 1.3. Cân đối khối lượng công việc
Điểm độ khó ước lượng theo thang 1–5 cho mỗi hạng mục:
```text
 Thành viên                Chi tiết điểm                                                  Tổng
 Người 1                   Auth 5 · Profile 4 · Admin & Statistics 4 · File/Media 2       15
 Người 2                   Job & Search 5 · Application 4 · AI Service 4 · Company 2      15
 Người 3                   Interview & Video 4 · Chat 4 · Notification 3 · Hạ tầng 4      15
```


Ba luồng có tổng điểm bằng nhau. Rủi ro lệch lớn nhất nằm ở Người 2 (Elasticsearch và AI cùng lúc) — nếu tiến độ chậm, chuyển Company Service sang Người 1 để cân lại.

<!-- Page 4 -->

# II. HỢP ĐỒNG GIAO TIẾP GIỮA CÁC THÀNH VIÊN
Đây là các điểm giao bắt buộc phải thống nhất TRƯỚC KHI code song song. Sai ở đây thì phải sửa lại cả hai phía.

### 2.1. Bảng điểm giao
```text
 Giao diện                   Bên cung cấp     Bên tiêu thụ      Nội dung cần chốt
 JWT RS256 + public key      Người 1          Người 2, 3        Payload: sub (user_id), role, iat, exp; endpoint
                                                                JWKS; mẫu code verify cho NestJS, Node thuần
                                                                và FastAPI
 Kafka cv-events             Người 1          Người 2 (AI)      key=cv_id; schema v1 flat snake_case đúng 9 trường
                             (Profile)                          { event_id, action, cv_id, candidate_id, file_id,
                                                                cv_type, occurred_at, schema_version,
                                                                aggregate_version }; action = UPSERTED |
                                                                DEACTIVATED | DELETED; không chứa URL/nội dung CV
 REST File/Media             Người 1          Người 2, 3        POST /files/signature, POST /files; service nghiệp vụ
                                                                lưu file_id canonical; URL ổn định chỉ cho public media,
                                                                private media dùng signed URL ngắn hạn theo request
 Kafka application-events    Người 2          Người 3           { event_id, action, application_id, job_id,
                                              (Notification),   job_title, candidate_id, recruiter_id,
                                              Người 1           from_status, to_status, occurred_at }
                                              (Thống kê)
 Kafka job-events            Người 2          Người 2 (AI),     key=job_id; schema v1, value flat snake_case gồm
                                              Người 1           đúng 16 trường { event_id, action, job_id,
                                              (Thống kê)        company_id, title, description, skills, location,
                                                                 status, occurred_at, schema_version,
                                                                 aggregate_version, requirements, salary_min,
                                                                 salary_max, job_type }
 Kafka interview-events      Người 3          Người 3           { event_id, action, interview_id, application_id,
                                              (Notification)    candidate_id, recruiter_id, scheduled_at,
                                                                room_url }
 Kafka chat-events           Người 3          Người 3           { event_id, message_id, conversation_id,
                                              (Notification)    sender_id, receiver_id, preview }
 REST duyệt công ty / tin    Người 2          Người 1           PATCH /companies/:id/verify, PATCH
                                              (Admin)           /jobs/:id/approve — định dạng body và mã lỗi
 REST khoá tài khoản         Người 1 (Auth)   Người 1           PATCH /auth/users/:id/lock — kèm revoke
                                              (Admin)           refresh token
 REST danh sách CV           Người 1          Người 2           REST nội bộ versioned — trả cv_id, title, type,
                             (Profile)        (Application)     file_id, is_default, aggregate_version; tải private
                                                                qua endpoint download được phân quyền riêng
 REST AI Match              Người 2 (AI)    Người 2           POST /ai/match; X-Internal-Api-Key; body
                                             (Application)     { cv_id, job_id }; response { data: { cv_id,
                                                               job_id, score, reason }, meta }
 REST xác thực đơn ứng       Người 2          Người 3           GET /applications/:id — kiểm tra tồn tại, trạng
 tuyển                       (Application)    (Interview)       thái và quyền công ty
```


Ba hợp đồng phải chốt sớm nhất, theo thứ tự ưu tiên: (1) JWT — chặn cả hai người còn lại; (2) application-events — Notification phụ thuộc hoàn toàn; (3) cv-events — AI Service không chạy được nếu thiếu.

### 2.2. Quy ước chung toàn hệ thống
- Định dạng phản hồi thành công: { data, meta } — meta chứa thông tin phân trang khi cần.
- Định dạng lỗi thống nhất: { code, message, details } với code là chuỗi viết hoa (VD: JOB_NOT_FOUND).
- Đặt tên endpoint theo REST resource số nhiều, chữ thường, phân cách bằng dấu gạch ngang.
- Mọi mốc thời gian dùng ISO-8601 kèm múi giờ (UTC lưu trong database, quy đổi ở frontend).
- Mọi event Kafka bắt buộc có event_id (UUID) và occurred_at để consumer chống xử lý trùng.
- `job-events` dùng Kafka key `job_id` và payload flat snake_case; không dùng envelope camelCase.
- Job producer dùng `aggregate_version` tăng đơn điệu và compare-and-set (CAS); bản ghi Job và event outbox phải cùng commit hoặc cùng rollback trong một transaction PostgreSQL.
- Consumer group đặt theo mẫu {service-name}-group.
- Mỗi service tự có Swagger/OpenAPI; hai người còn lại chỉ đọc Swagger, không đọc code của nhau.
- Repo dùng nhánh theo mẫu feature/{ten-service}/{ten-tinh-nang}; merge vào develop qua pull request.

<!-- Page 6 -->

# III. PHẦN A — NGƯỜI 1: LUỒNG DANH TÍNH & HỒ SƠ
Người 1 sở hữu toàn bộ luồng "một người bước vào hệ thống": đăng ký, xác thực, dựng hồ sơ/CV, lưu trữ file, và mặt quản trị người dùng/công ty của Admin. Đây là luồng nằm trên đường găng của cả dự án — Auth Service phải xong sớm nhất vì hai thành viên còn lại cần public key để verify token. Danh sách service phụ trách: Auth Service · User/Profile Service · File/Media Service · Admin & Statistics Service

## A1. Auth Service
```text
 Người phụ trách             Người 1
 Công nghệ                   Spring Boot 3 (Java 21), Spring Security, Spring Data JPA
 Database                    PostgreSQL container riêng: auth-db · Redis (OTP, reset token)
 Tích hợp ngoài              Google OAuth2 (Spring Security OAuth2 Client), JavaMailSender + SMTP
 Vai trò trong hệ thống      Service DUY NHẤT phát hành JWT. Mọi service khác chỉ verify bằng public key, không
                             gọi ngược lại Auth mỗi request.
 Ưu tiên                     Cao nhất — phải hoàn thành trong 3–5 ngày đầu
```


### 1. Luồng hoạt động các chức năng
#### Luồng 1: Đăng ký tài khoản + xác thực OTP email
1. Người dùng chọn loại tài khoản (Candidate hoặc Recruiter), nhập email và mật khẩu.
2. Hệ thống kiểm tra email đã tồn tại chưa. Nếu đã tồn tại và đã xác thực → trả lỗi 409. Nếu tồn tại nhưng chưa xác thực → cho phép gửi lại OTP.
3. Hash mật khẩu bằng bcrypt (cost 10), tạo bản ghi User với is_verified = false, role = loại tài khoản đã chọn.
4. Sinh mã OTP 6 chữ số, lưu vào Redis với key otp:{email}, TTL 5 phút.
5. Gửi OTP tới email người dùng qua JavaMailSender.
6. Người dùng nhập OTP → hệ thống so khớp giá trị trong Redis.
7. Đúng: set is_verified = true, xoá key Redis, phát hành cặp access token + refresh token, trả về cho client.
8. Sai: tăng bộ đếm otp:fail:{email}. Sai quá 5 lần → chặn gửi/nhập OTP trong 15 phút.
9. Hết hạn OTP: người dùng bấm "Gửi lại mã", tối đa 3 lần trong 1 giờ.
#### Luồng 2: Đăng nhập bằng email + mật khẩu
1. Nhận email + mật khẩu.
2. Tra User theo email. Không tồn tại → trả lỗi chung "Email hoặc mật khẩu không đúng" (không tiết lộ email có tồn tại hay không).
3. So khớp bcrypt. Sai → tăng bộ đếm đăng nhập sai; sai 5 lần liên tiếp → khoá đăng nhập 15 phút.
4. Kiểm tra is_verified = true; chưa xác thực → trả mã lỗi riêng để frontend chuyển sang màn nhập OTP.
5. Kiểm tra trạng thái tài khoản (bị Admin khoá → trả 403 kèm lý do).
6. Phát hành access token (TTL 15 phút) và refresh token (TTL 7 ngày); lưu hash của refresh token vào bảng RefreshToken.
7. Trả về cặp token + thông tin cơ bản của user (id, email, role).
#### Luồng 3: Đăng nhập bằng Google OAuth2
1. Frontend chuyển hướng người dùng tới trang đồng ý của Google.
2. Google gọi callback về Auth Service kèm authorization code.

<!-- Page 7 -->

3. Auth Service đổi code lấy access token của Google và lấy thông tin hồ sơ (email, tên, avatar).
4. Nếu email đã có trong hệ thống → đăng nhập luôn (bỏ qua bước OTP vì Google đã xác thực email).
5. Nếu chưa có → tạo User mới với password_hash = null, is_verified = true, role mặc định Candidate.
6. Nếu người dùng muốn là Recruiter → điều hướng sang màn bổ sung để chọn vai trò trước khi phát hành token (chỉ cho phép một lần duy nhất).
7. Phát hành cặp token như luồng đăng nhập thường.
#### Luồng 4: Refresh token có rotation
1. Client gửi refresh token khi access token hết hạn.
2. Auth Service hash token nhận được và tra trong bảng RefreshToken.
3. Không tìm thấy hoặc đã hết hạn → trả 401, buộc đăng nhập lại.
4. Tìm thấy nhưng revoked = true → nghi ngờ token bị đánh cắp và dùng lại: revoke TOÀN BỘ refresh token của user đó, trả 401.
5. Hợp lệ: đánh dấu token cũ revoked = true, sinh cặp access + refresh mới, lưu hash token mới.
6. Trả cặp token mới cho client.
#### Luồng 5: Quên mật khẩu / đặt lại mật khẩu
1. Người dùng nhập email ở màn "Quên mật khẩu".
2. Hệ thống luôn trả về thông báo thành công (không tiết lộ email có tồn tại hay không).
3. Nếu email tồn tại: sinh reset token (UUID ngẫu nhiên), lưu Redis key reset:{token} → user_id, TTL 15 phút.
4. Gửi email chứa link đặt lại mật khẩu kèm token.
5. Người dùng mở link, nhập mật khẩu mới → hệ thống kiểm tra token còn hạn.
6. Cập nhật password_hash mới, xoá token khỏi Redis.
7. Revoke toàn bộ refresh token đang có của user (buộc đăng nhập lại trên mọi thiết bị).
#### Luồng 6: Cung cấp khoá công khai cho các service khác
1. Auth Service giữ private key RS256, dùng để ký mọi JWT phát hành.
2. Expose endpoint công khai chứa public key (dạng JWKS) để các service khác tải về.
3. Service NestJS/Python/Node cache public key trong bộ nhớ, verify chữ ký token cục bộ — không gọi mạng mỗi request.
4. Khi xoay khoá (key rotation), publish khoá mới kèm kid; token cũ vẫn verify được bằng khoá cũ trong thời gian chuyển tiếp.

### 2. Tài liệu nghiệp vụ
### 2.1. Quy tắc nghiệp vụ (business rules)
- Mật khẩu tối thiểu 8 ký tự, bắt buộc có cả chữ và số; lưu dạng bcrypt, tuyệt đối không lưu plaintext.
- Access token TTL 15 phút; refresh token TTL 7 ngày, có rotation (mỗi lần refresh sinh token mới và revoke token cũ).
- Payload JWT thống nhất toàn hệ thống: sub (user_id), role, iat, exp, kid trong header. Không nhét dữ liệu nghiệp vụ khác vào token.
- Một tài khoản chỉ có duy nhất một role, cố định sau khi đăng ký. Chỉ Admin mới đổi được role.
- Tài khoản bị Admin khoá: không đăng nhập được và toàn bộ refresh token bị revoke ngay lập tức.
- OTP chỉ dùng được một lần và chỉ trong 5 phút.
- Không tiết lộ sự tồn tại của email ở luồng đăng nhập và quên mật khẩu (chống dò tài khoản).
- Mọi thông báo lỗi xác thực trả về theo cùng một cấu trúc { code, message } để frontend xử lý thống nhất.
### 2.2. Mô hình dữ liệu

<!-- Page 8 -->

- User(id, email, password_hash, role, is_verified, is_locked, locked_reason, provider, created_at, updated_at)
- RefreshToken(id, user_id, token_hash, expires_at, revoked, created_at)
- Redis: otp:{email} (TTL 5'), otp:fail:{email}, reset:{token} (TTL 15'), login:fail:{email}
### 2.3. API chính
```text
 Endpoint                             Mô tả                                          Quyền truy cập
 POST /auth/register                  Đăng ký tài khoản, gửi OTP                     Public
 POST /auth/otp/verify                Xác thực OTP, kích hoạt tài khoản              Public
 POST /auth/otp/resend                Gửi lại OTP (tối đa 3 lần/giờ)                 Public
 POST /auth/login                     Đăng nhập email + mật khẩu                     Public
 GET /auth/google                     Bắt đầu luồng OAuth2 Google                    Public
 GET /auth/google/callback            Nhận callback, phát hành token                 Public
 POST /auth/refresh                   Đổi refresh token lấy cặp token mới            Public
 POST /auth/forgot-password           Gửi email đặt lại mật khẩu                     Public
 POST /auth/reset-password            Đặt mật khẩu mới bằng reset token              Public
 GET /auth/me                         Thông tin tài khoản hiện tại                   Đã đăng nhập
 PATCH /auth/users/:id/lock           Khoá/mở khoá tài khoản                         Admin (nội bộ)
 GET /auth/.well-known/jwks.json      Public key để service khác verify              Public
```


### 2.4. Sự kiện Kafka
- Không producer bắt buộc theo tài liệu gốc.
- ĐỀ XUẤT BỔ SUNG: publish topic user-events (USER_REGISTERED, USER_LOCKED) để Admin & Statistics đếm số người dùng theo thời gian mà không phải gọi REST liên tục. Cần cả nhóm thống nhất trước khi thêm.
### 2.5. Phụ thuộc giữa các service
- Không phụ thuộc service nào khác → làm được ngay từ ngày đầu.
- Được phụ thuộc bởi: TẤT CẢ service còn lại (verify JWT). Đây là lý do Auth phải xong trước.
### 2.6. Tiêu chí hoàn thành (Definition of Done)
- Swagger UI chạy được, đủ 12 endpoint ở bảng trên.
- Endpoint JWKS trả public key đúng chuẩn.
- Bàn giao đoạn code mẫu verify JWT cho NestJS (Guard) và FastAPI (dependency) để Người 2, 3 dùng lại.
- Postman collection cho luồng đăng ký → OTP → đăng nhập → refresh.
- Dockerfile + biến môi trường mẫu (.env.example) đã đẩy lên repo chung.

<!-- Page 9 -->

## A2. User/Profile Service
```text
 Người phụ trách              Người 1
 Công nghệ                    NestJS (TypeScript) + Prisma
 Database                     PostgreSQL container riêng: profile-db
 Vai trò trong hệ thống       Nguồn dữ liệu hồ sơ ứng viên cho Application Service (chọn CV khi nộp đơn) và AI
                              Service (tính embedding matching).
 Phụ thuộc                    Auth Service (JWT), File/Media Service (upload CV, avatar)
```


### 1. Luồng hoạt động các chức năng
#### Luồng 1: Tạo và hoàn thiện hồ sơ ứng viên
1. Sau khi đăng ký lần đầu, Candidate được điều hướng tới trang hồ sơ.
2. Nhập thông tin chung: họ tên, headline (vị trí mong muốn), summary giới thiệu, số điện thoại, địa chỉ, avatar (upload qua File Service).
3. Thêm từng khối dữ liệu độc lập: Học vấn, Kinh nghiệm làm việc, Kỹ năng, Chứng chỉ, Dự án cá nhân. Mỗi khối là một API CRUD riêng để frontend lưu từng phần, không phải submit cả trang.
4. Thêm liên kết ngoài: Github, LinkedIn, Portfolio (validate đúng định dạng URL và đúng domain tương ứng).
5. Hệ thống tính % hoàn thiện hồ sơ theo trọng số các khối và hiển thị gợi ý bổ sung phần còn thiếu.
6. Thay đổi kỹ năng/kinh nghiệm của Profile không tự phát `cv-events`: embedding bám theo immutable
   PDF snapshot. Candidate phải xuất một revision CV/file mới thì Profile mới publish `UPSERTED`.
#### Luồng 2: Upload CV dạng file PDF
1. Candidate chọn file PDF ở màn quản lý CV.
2. Frontend gọi File/Media Service để lấy signed upload params (type = CV).
3. Frontend upload file trực tiếp lên Cloudinary (không đi qua backend nghiệp vụ).
4. Frontend xác nhận upload với File/Media Service và chỉ gửi `file_id` canonical về Profile Service;
   CV là private delivery nên không lưu URL lâu dài.
5. Profile Service xác minh owner/type/trạng thái, kiểm tra số CV hiện có (tối đa 5), bind Media
   reference và tạo bản ghi CV(type = UPLOAD, file_id, is_default).
6. Nếu đây là CV đầu tiên → tự động đặt is_default = true.
7. Publish sự kiện lên topic Kafka cv-events để AI Service tính embedding.
#### Luồng 3: Tạo CV online bằng CV Builder
1. Candidate chọn một template có sẵn.
2. Hệ thống tự điền dữ liệu từ hồ sơ đã có (học vấn, kinh nghiệm, kỹ năng...).
3. Candidate chỉnh sửa nội dung, sắp xếp thứ tự các mục, xem trước.
4. Bấm "Xuất PDF" → render PDF (thư viện phía server hoặc client tuỳ thống nhất).
5. File PDF được đẩy lên Cloudinary qua File/Media Service.
6. Tạo immutable snapshot CV(type = ONLINE, template_id, content_json, file_id) — giữ `content_json`
   để clone revision, còn AI luôn đọc đúng PDF private đã export qua Media.
7. Publish cv-events.
#### Luồng 4: Quản lý danh sách CV
1. Xem danh sách CV kèm ngày tạo, loại, trạng thái mặc định.
2. Đặt CV mặc định: set is_default = true cho CV được chọn và false cho tất cả CV còn lại trong cùng một transaction.
3. Đổi tên CV, tải xuống.

<!-- Page 10 -->

4. Xoá CV: nếu CV chưa từng dùng để ứng tuyển → xoá cứng và gọi File Service xoá file trên Cloudinary. Nếu đã dùng trong đơn ứng tuyển → chỉ đánh dấu is_deleted = true (soft delete) vì Application Service đang tham chiếu cv_id.
#### Luồng 5: Phục vụ dữ liệu cho service khác
1. Application Service gọi GET /profile/cv?user_id= để lấy danh sách CV khả dụng khi ứng viên bấm Apply.
2. Application Service gọi GET /profile/cv/:id để hiển thị CV cho recruiter xem.
3. AI Service nhận `cv-events`, sau đó gọi trực tiếp Media API nội bộ bằng `file_id` cùng
   `candidate_id`/type expectation để lấy URL tải private ngắn hạn; event không mang URL.

### 2. Tài liệu nghiệp vụ
### 2.1. Quy tắc nghiệp vụ (business rules)
- Mỗi ứng viên có tối đa 5 CV; muốn thêm phải xoá bớt.
- CV upload chỉ nhận PDF, dung lượng tối đa 5MB (chặn ở cả frontend và upload preset của Cloudinary).
- Luôn có đúng một CV mặc định nếu ứng viên có ít nhất một CV.
- CV đã dùng để ứng tuyển không được xoá cứng — chỉ ẩn khỏi danh sách chọn.
- Chỉ chủ hồ sơ mới sửa được hồ sơ của mình; recruiter chỉ xem được hồ sơ của ứng viên đã nộp đơn vào job của công ty mình (kiểm tra quyền ở tầng API).
- Hồ sơ hoàn thiện dưới 50% thì hiển thị cảnh báo khi ứng tuyển, nhưng KHÔNG chặn nộp đơn.
- Liên kết Github/LinkedIn phải đúng domain tương ứng, nếu không thì báo lỗi validate.
### 2.2. Mô hình dữ liệu
- Profile(id, user_id, full_name, headline, summary, phone, address, avatar_url, completion_percent, updated_at)
- Education(id, profile_id, school, major, degree, start_date, end_date, description)
- Experience(id, profile_id, company_name, position, start_date, end_date, is_current, description)
- Skill(id, profile_id, name, level)
- Certificate(id, profile_id, name, issuer, issued_at, credential_url)
- Project(id, profile_id, name, role, description, url)
- CV(id, user_id, title, type[UPLOAD|ONLINE], file_id, media_reference_id, template_id, content_json, is_default, is_deleted, aggregate_version, created_at)
### 2.3. API chính
```text
 Endpoint                             Mô tả                                          Quyền truy cập
 GET /profile/:userId                 Lấy hồ sơ đầy đủ                               Chủ hồ sơ / Recruiter
                                                                                     liên quan
 PUT /profile/:userId                 Cập nhật thông tin chung                       Chủ hồ sơ
 POST|PUT|DELETE                      CRUD học vấn                                   Chủ hồ sơ
 /profile/education/*
 POST|PUT|DELETE                      CRUD kinh nghiệm                               Chủ hồ sơ
 /profile/experience/*
 POST|PUT|DELETE /profile/skill/*     CRUD kỹ năng                                   Chủ hồ sơ
 POST /profile/cv                     Lưu metadata CV sau khi upload                 Candidate
 GET /profile/cv?user_id=             Danh sách CV                                   Chủ hồ sơ / nội bộ
 GET /profile/cv/:id                  Chi tiết một CV                                Chủ hồ sơ / Recruiter
                                                                                     liên quan
 PATCH /profile/cv/:id/default        Đặt CV mặc định                                Candidate
```

<!-- Page 11 -->

```text
 Endpoint                            Mô tả                                        Quyền truy cập
 DELETE /profile/cv/:id              Xoá hoặc ẩn CV                               Candidate
```


### 2.4. Sự kiện Kafka
- PRODUCE topic `cv-events` bằng transactional outbox khi snapshot được tạo, deactivate hoặc xoá cứng.
- Contract v1: Kafka key=`cv_id`; value flat snake_case đúng 9 trường
  `{ event_id, action, cv_id, candidate_id, file_id, cv_type, occurred_at, schema_version, aggregate_version }`.
- `UPSERTED` tải/ghi vector; `DEACTIVATED` giữ vector cho match lịch sử nhưng loại khỏi recommendation;
  `DELETED` xoá vector và đặt tombstone. Không event cho rename/default vì PDF không đổi.
- Không publish `file_url`, signed URL, `content_json`, title hay `media_reference_id` nội bộ của Profile. Consumer lấy PDF qua
  Media nội bộ bằng `file_id` và exact owner/type expectation.
### 2.5. Phụ thuộc giữa các service
- Phụ thuộc: Auth Service (JWT), File/Media Service (upload).
- Được phụ thuộc bởi: Application Service (Người 2) — chọn CV khi nộp đơn; AI Service (Người 2) — qua cv-events.
### 2.6. Tiêu chí hoàn thành (Definition of Done)
- CRUD đủ 6 khối hồ sơ + quản lý CV, có Swagger.
- cv-events đã publish được và Người 2 nhận đúng schema.
- CV Builder xuất được PDF và lưu lên Cloudinary.
- Kiểm tra quyền: recruiter không xem được hồ sơ ứng viên chưa nộp đơn vào công ty mình.

<!-- Page 12 -->

## A3. File/Media Service
```text
 Người phụ trách             Người 1
 Công nghệ                   NestJS (TypeScript) + Prisma, Cloudinary Node SDK
 Database                    PostgreSQL container riêng: file-db (chỉ lưu metadata)
 Vai trò trong hệ thống      Nơi DUY NHẤT giữ Cloudinary API secret. Service nghiệp vụ chỉ lưu file_id
                             canonical; signed URL ngắn hạn chỉ lấy theo request và không persist.
 Phụ thuộc                   Auth Service (JWT)
```


### 1. Luồng hoạt động các chức năng
#### Luồng 1: Upload trực tiếp từ client lên Cloudinary (signed upload)
1. Client gọi POST /files/signature kèm loại file (CV, AVATAR, COMPANY_LOGO, COMPANY_IMAGE, COMPANY_VIDEO, CHAT_ATTACHMENT).
2. File Service kiểm tra JWT, xác định quyền upload loại file đó.
3. Sinh chữ ký (signature) + upload preset tương ứng: giới hạn định dạng, dung lượng tối đa, thư mục lưu trên Cloudinary.
4. Ghi trước một bản ghi FileMeta với status = PENDING (để đối soát rác về sau).
5. Trả signature + params cho client.
6. Client upload file thẳng lên Cloudinary (backend không gánh băng thông).
7. Cloudinary trả về public_id, secure_url, kích thước, định dạng.
8. Client gọi POST /files gửi lại metadata → File Service đối chiếu và cập nhật bản ghi sang status = ACTIVE.
9. Trả về file_id + url cho client để service nghiệp vụ lưu tham chiếu.
#### Luồng 2: Xoá file
1. Service nghiệp vụ hoặc người dùng gọi DELETE /files/:id.
2. Kiểm tra owner_id trong FileMeta khớp với user trong JWT (hoặc là lời gọi nội bộ có service token).
3. Gọi Cloudinary destroy theo public_id.
4. Xoá (hoặc đánh dấu DELETED) bản ghi metadata.
#### Luồng 3: Dọn file rác định kỳ
1. Job chạy hằng đêm quét các FileMeta có status = PENDING quá 24 giờ (client xin chữ ký nhưng không upload hoặc không confirm).
2. Kiểm tra trên Cloudinary xem public_id có tồn tại không.
3. Tồn tại → xoá trên Cloudinary. Không tồn tại → xoá bản ghi metadata.
4. Ghi log số lượng file đã dọn.

### 2. Tài liệu nghiệp vụ
### 2.1. Quy tắc nghiệp vụ (business rules)
- CV: chỉ PDF, tối đa 5MB.
- Avatar / logo: JPG, PNG, WEBP, tối đa 2MB.
- Ảnh công ty: JPG, PNG, WEBP, tối đa 5MB, tối đa 10 ảnh mỗi công ty.
- Video giới thiệu công ty: MP4, tối đa 50MB, tối đa 1 video.
- File đính kèm chat: PDF, DOC, DOCX, ảnh, tối đa 10MB.
- Cloudinary API secret chỉ nằm trong biến môi trường của service này, không chia sẻ cho service khác hay frontend.

<!-- Page 13 -->

- Chữ ký upload có hiệu lực tối đa 10 phút.
- Mọi ảnh phục vụ qua CDN của Cloudinary kèm tham số tối ưu (f_auto, q_auto).
### 2.2. Mô hình dữ liệu
- FileMeta(id, owner_id, owner_type[USER|COMPANY|MESSAGE], cloudinary_public_id, url, type, mime, size, status[PENDING|ACTIVE|DELETED], created_at)
### 2.3. API chính
```text
 Endpoint                            Mô tả                                     Quyền truy cập
 POST /files/signature               Sinh chữ ký + preset để upload            Đã đăng nhập
 POST /files                         Lưu metadata sau khi upload xong          Đã đăng nhập
 GET /files/:id                      Lấy metadata + url                        Đã đăng nhập
 DELETE /files/:id                   Xoá file trên Cloudinary + metadata       Chủ sở hữu / nội bộ
```


### 2.4. Sự kiện Kafka
- Không tham gia Kafka. Giao tiếp thuần REST.
### 2.5. Phụ thuộc giữa các service
- Được phụ thuộc bởi: Profile (CV, avatar), Company (logo, ảnh, video), Chat (file đính kèm).
- CẦN LÀM SỚM: tạo tài khoản Cloudinary chung của nhóm ngay tuần đầu và chia sẻ preset cho cả 3 người.
### 2.6. Tiêu chí hoàn thành (Definition of Done)
- Upload thử được cả 5 loại file với đúng giới hạn.
- Người 2 và Người 3 gọi được API signature từ service của mình.
- Job dọn rác chạy được và có log.

<!-- Page 14 -->

## A4. Admin & Statistics Service
```text
 Người phụ trách            Người 1
 Công nghệ                  Spring Boot 3 (Java 21), Spring Data JPA, Apache POI, Spring Scheduler, Spring Kafka
 Database                   PostgreSQL container riêng: admin-db
 Vai trò trong hệ thống     Cổng quản trị và tổng hợp số liệu toàn hệ thống. KHÔNG được query trực tiếp
                            database của service khác.
 Phụ thuộc                  Auth (khoá tài khoản), Company (duyệt công ty), Job (duyệt tin), Kafka (số liệu)
```


### 1. Luồng hoạt động các chức năng
#### Luồng 1: Duyệt hồ sơ công ty
1. Admin mở hàng chờ duyệt → Admin Service gọi REST Company Service lấy danh sách công ty có verified_status = PENDING.
2. Admin xem chi tiết: thông tin, giấy tờ, logo, ảnh.
3. Chọn Duyệt hoặc Từ chối (bắt buộc nhập lý do khi từ chối).
4. Admin Service gọi PATCH /companies/:id/verify của Company Service kèm quyết định và lý do.
5. Company Service cập nhật trạng thái và thông báo cho recruiter.
6. Admin Service ghi lại nhật ký thao tác (AuditLog) để truy vết.
#### Luồng 2: Duyệt tin tuyển dụng
1. Recruiter submit tin → tin ở trạng thái PENDING_APPROVAL.
2. Admin xem hàng chờ (gọi REST Job & Search Service).
3. Kiểm tra nội dung (spam, lương ảo, nội dung không phù hợp).
4. Duyệt → gọi PATCH /jobs/:id/approve → Job Service chuyển sang PUBLISHED và index lên Elasticsearch.
5. Từ chối → gọi PATCH /jobs/:id/reject kèm lý do → tin quay về DRAFT cho recruiter sửa.
6. Ghi AuditLog.
#### Luồng 3: Quản lý người dùng, khoá / mở khoá tài khoản
1. Admin tìm kiếm người dùng theo email, vai trò, trạng thái.
2. Xem lịch sử vi phạm (từ bảng Report).
3. Bấm Khoá → nhập lý do → gọi PATCH /auth/users/:id/lock của Auth Service.
4. Auth Service set is_locked = true và revoke toàn bộ refresh token của user.
5. Mở khoá → gọi cùng endpoint với giá trị ngược lại.
6. Ghi AuditLog cho mỗi thao tác.
#### Luồng 4: Xử lý báo cáo vi phạm
1. Người dùng bấm "Báo cáo" trên một tin tuyển dụng, công ty hoặc tài khoản.
2. Admin Service lưu Report(reporter_id, target_type, target_id, reason, status = OPEN).
3. Admin xem danh sách report, lọc theo loại và trạng thái.
4. Xử lý: bỏ qua (DISMISSED) hoặc chấp nhận (RESOLVED) — nếu chấp nhận thì gọi REST của service gốc để gỡ tin / khoá tài khoản.
5. Cập nhật trạng thái report và ghi kết quả xử lý.
#### Luồng 5: Thu thập và tổng hợp số liệu thống kê
1. Admin Service consume các topic Kafka có sẵn: job-events, application-events (và user-events nếu nhóm thống nhất bổ sung).
2. Mỗi event được ghi vào bảng sự kiện thô StatEvent(event_type, entity_id, occurred_at, payload).

<!-- Page 15 -->

3. Spring Scheduler chạy 00:15 hằng ngày tổng hợp StatEvent của ngày hôm trước vào bảng DailyStat.
4. Dashboard đọc từ DailyStat (nhanh, không đụng tới service khác).
5. Chỉ số hiển thị: số người dùng mới, số công ty mới, số tin đăng, số đơn ứng tuyển theo ngày/tuần/tháng; tỷ lệ chuyển đổi Applied → Interview → Offer → Hired.
6. Biểu đồ đường theo thời gian và biểu đồ phễu cho tỷ lệ chuyển đổi.
#### Luồng 6: Xuất báo cáo Excel/CSV
1. Admin chọn loại báo cáo và khoảng thời gian.
2. Service truy vấn DailyStat / StatEvent trong khoảng đó.
3. Dùng Apache POI sinh file XLSX (hoặc CSV) với các sheet tương ứng.
4. Trả file về cho trình duyệt tải xuống. Báo cáo lớn (> 50.000 dòng) thì sinh bất đồng bộ rồi gửi link tải qua thông báo.

### 2. Tài liệu nghiệp vụ
### 2.1. Quy tắc nghiệp vụ (business rules)
- TUYỆT ĐỐI không kết nối trực tiếp tới database của service khác — chỉ REST hoặc Kafka (đúng chuẩn database-per-service).
- Số liệu thống kê chấp nhận độ trễ: các chỉ số tổng hợp theo ngày cập nhật sau 00:15 hôm sau; chỉ số realtime (nếu cần) lấy trực tiếp từ StatEvent.
- Mọi thao tác quản trị (khoá tài khoản, duyệt/từ chối) đều phải ghi AuditLog: ai làm, làm gì, lúc nào, lý do.
- Từ chối duyệt bắt buộc có lý do — lý do được gửi lại cho recruiter.
- Chỉ role ADMIN truy cập được toàn bộ endpoint của service này.
- Consumer Kafka phải idempotent theo event_id để không đếm trùng khi Kafka gửi lại event.
### 2.2. Mô hình dữ liệu
- Report(id, reporter_id, target_type[JOB|COMPANY|USER], target_id, reason, description, status[OPEN|RESOLVED|DISMISSED], handled_by, handled_at)
- AuditLog(id, admin_id, action, target_type, target_id, reason, created_at)
- StatEvent(id, event_id, event_type, entity_id, occurred_at, payload_json)
- DailyStat(stat_date, metric, value)
### 2.3. API chính
```text
 Endpoint                              Mô tả                                          Quyền truy cập
 GET /admin/stats/overview             Số liệu tổng quan cho dashboard                Admin
 GET /admin/stats/funnel?from=&to=     Tỷ lệ chuyển đổi Applied→Hired                 Admin
 GET                                   Xuất Excel/CSV                                 Admin
 /admin/stats/export?type=&from=&t
 o=
 GET /admin/companies/pending          Hàng chờ duyệt công ty (proxy REST)            Admin
 PATCH /admin/companies/:id/verify     Duyệt / từ chối công ty                        Admin
 GET /admin/jobs/pending               Hàng chờ duyệt tin                             Admin
 PATCH /admin/jobs/:id/approve         Duyệt tin tuyển dụng                           Admin
 PATCH /admin/users/:id/lock           Khoá / mở khoá tài khoản                       Admin
 GET /admin/reports                    Danh sách báo cáo vi phạm                      Admin
 PATCH /admin/reports/:id              Xử lý báo cáo                                  Admin
```

<!-- Page 16 -->

### 2.4. Sự kiện Kafka
- CONSUME: job-events, application-events (và user-events nếu bổ sung).
- Không produce event nào.
### 2.5. Phụ thuộc giữa các service
- Phụ thuộc REST: Company Service và Job & Search Service (Người 2), Auth Service (chính Người 1).
- Phụ thuộc Kafka: application-events (Người 2), job-events (Người 2).
- LƯU Ý: đây là service nên làm SAU CÙNG trong phần của Người 1, vì cần các service kia có API trước.
### 2.6. Tiêu chí hoàn thành (Definition of Done)
- Dashboard hiển thị được ít nhất 4 chỉ số và 1 biểu đồ phễu.
- Duyệt được công ty và tin tuyển dụng qua REST thật (không mock).
- Xuất được file Excel mở lên đọc được.
- AuditLog ghi đủ cho mọi thao tác quản trị.

<!-- Page 17 -->

# IV. PHẦN B — NGƯỜI 2: LUỒNG TIN TUYỂN DỤNG & ỨNG TUYỂN
Người 2 sở hữu trục nghiệp vụ chính của sản phẩm: doanh nghiệp lên sàn → đăng tin → ứng viên tìm thấy → nộp đơn → HR xử lý pipeline đến khi ra kết quả. AI Service được gắn vào nhóm này vì toàn bộ dữ liệu nó xử lý (embedding CV ↔ Job, gợi ý việc làm) bám sát schema Job — cùng một người sở hữu thì không phải đồng bộ hợp đồng dữ liệu qua người khác. Danh sách service phụ trách: Company Service · Job & Search Service · Application Service · AI Service

## B1. Company Service
```text
 Người phụ trách             Người 2
 Công nghệ                   NestJS (TypeScript) + Prisma
 Database                    PostgreSQL container riêng: company-db
 Vai trò trong hệ thống      Quản lý hồ sơ doanh nghiệp và danh sách recruiter thuộc doanh nghiệp đó.
 Phụ thuộc                   Auth (JWT), File/Media (logo, ảnh, video), Admin (duyệt)
```


### 1. Luồng hoạt động các chức năng
#### Luồng 1: Recruiter tạo hồ sơ công ty
1. Recruiter đăng nhập, nếu chưa thuộc công ty nào → hiển thị màn tạo công ty.
2. Nhập thông tin: tên công ty, mô tả, lĩnh vực, quy mô, địa chỉ, website, mã số thuế.
3. Upload logo, ảnh môi trường làm việc, video giới thiệu (qua File/Media Service, chỉ lưu url + file_id).
4. Submit → tạo Company với verified_status = PENDING, đồng thời tạo CompanyMember(user_id, role = OWNER).
5. Hiển thị trạng thái "Đang chờ duyệt" và chặn chức năng đăng tin.
6. Admin duyệt → verified_status = VERIFIED → recruiter được đăng tin.
7. Admin từ chối → verified_status = REJECTED kèm lý do → recruiter sửa và submit lại.
#### Luồng 2: Quản lý thành viên trong công ty
1. Owner mở màn quản lý thành viên.
2. Mời recruiter khác bằng email → hệ thống kiểm tra email đó đã có tài khoản Recruiter chưa.
3. Chưa có → gửi email mời kèm link đăng ký. Đã có và chưa thuộc công ty nào → tạo lời mời chờ xác nhận.
4. Người được mời chấp nhận → tạo CompanyMember(role = MEMBER).
5. Owner có thể gỡ thành viên hoặc chuyển quyền Owner.
6. MEMBER chỉ quản lý được tin tuyển dụng do chính mình tạo; OWNER thấy toàn bộ tin của công ty.
#### Luồng 3: Cập nhật hồ sơ công ty
1. Owner sửa thông tin công ty.
2. Nếu sửa các trường trọng yếu (tên công ty, mã số thuế, giấy phép) → verified_status quay về PENDING, chờ Admin duyệt lại; các tin đang PUBLISHED vẫn giữ nguyên.
3. Nếu chỉ sửa mô tả, ảnh, video → cập nhật ngay, không cần duyệt lại.
4. Xoá ảnh/video → gọi File/Media Service xoá file thật trên Cloudinary.
#### Luồng 4: Trang công ty công khai
1. Ứng viên xem trang công ty: thông tin, ảnh, video, danh sách tin đang tuyển (gọi Job & Search Service theo company_id).
2. Chỉ công ty VERIFIED mới hiển thị công khai.
3. Ứng viên có thể theo dõi công ty (tuỳ chọn mở rộng) để nhận thông báo khi có tin mới.

<!-- Page 18 -->

### 2. Tài liệu nghiệp vụ
### 2.1. Quy tắc nghiệp vụ (business rules)
- Một tài khoản Recruiter chỉ thuộc đúng một công ty tại một thời điểm.
- Chỉ role OWNER được: mời/gỡ thành viên, sửa thông tin công ty, xoá công ty.
- Công ty chưa VERIFIED không được tạo tin tuyển dụng (Job Service kiểm tra bằng lời gọi REST hoặc cache trạng thái).
- Tên công ty là duy nhất (không phân biệt hoa thường) để tránh giả mạo.
- Từ chối duyệt bắt buộc kèm lý do, hiển thị cho recruiter.
- Xoá công ty chỉ được phép khi không còn tin tuyển dụng đang PUBLISHED.
### 2.2. Mô hình dữ liệu
- Company(id, name, slug, description, industry, size, address, website, tax_code, logo_url, verified_status[PENDING|VERIFIED|REJECTED], reject_reason, created_at)
- CompanyMember(id, company_id, user_id, role[OWNER|MEMBER], joined_at)
- CompanyMedia(id, company_id, file_id, url, type[IMAGE|VIDEO], sort_order)
- CompanyInvitation(id, company_id, email, status, expires_at)
### 2.3. API chính
```text
 Endpoint                             Mô tả                                          Quyền truy cập
 POST /companies                      Tạo hồ sơ công ty                              Recruiter
 GET /companies/:id                   Chi tiết công ty                               Public (nếu VERIFIED)
 PUT /companies/:id                   Cập nhật thông tin                             Owner
 GET /companies?verified_status=      Danh sách / hàng chờ duyệt                     Admin (nội bộ)
 PATCH /companies/:id/verify          Duyệt / từ chối                                Admin (nội bộ)
 POST /companies/:id/members          Mời thành viên                                 Owner
 DELETE                               Gỡ thành viên                                  Owner
 /companies/:id/members/:userId
 GET /companies/by-user/:userId       Công ty của một recruiter                      Nội bộ
```


### 2.4. Sự kiện Kafka
- Không produce/consume Kafka. Giao tiếp thuần REST với Admin và Job Service.
### 2.5. Phụ thuộc giữa các service
- Được phụ thuộc bởi: Job & Search Service (tham chiếu company_id, kiểm tra VERIFIED), Admin Service (duyệt).
- Cần thống nhất với Người 1 hợp đồng endpoint PATCH /companies/:id/verify ngay tuần đầu.
### 2.6. Tiêu chí hoàn thành (Definition of Done)
- Tạo công ty → chờ duyệt → được duyệt → đăng tin được: chạy thông suốt.
- Phân quyền OWNER/MEMBER hoạt động đúng.
- Swagger + Postman collection.

<!-- Page 19 -->

## B2. Job & Search Service
```text
 Người phụ trách              Người 2
 Công nghệ                    NestJS (TypeScript) + Prisma, Elasticsearch, BullMQ + Redis
 Database                     PostgreSQL container riêng: job-db (dữ liệu gốc) + Elasticsearch (chỉ mục tìm kiếm)
 Vai trò trong hệ thống       Gộp Job Service và Search Service. Nguồn sự thật của tin tuyển dụng; đồng bộ sang
                              Elasticsearch để phục vụ tìm kiếm.
 Phụ thuộc                    Auth (JWT), Company (kiểm tra VERIFIED), Admin (duyệt tin), AI (gợi ý việc)
```


### 1. Luồng hoạt động các chức năng
#### Luồng 1: Tạo và đăng tin tuyển dụng
1. Recruiter mở form tạo tin, nhập: tiêu đề, mô tả công việc, yêu cầu ứng viên, quyền lợi, mức lương (min–max hoặc thoả thuận), địa điểm, hình thức (Full-time/Part-time/Remote/Internship), kỹ năng yêu cầu, số năm kinh nghiệm, số lượng tuyển, deadline.
2. Hệ thống kiểm tra công ty của recruiter có verified_status = VERIFIED không; chưa được duyệt → chặn.
3. Lưu nháp: trạng thái DRAFT, chưa hiển thị công khai, không index Elasticsearch.
4. Recruiter bấm "Đăng tin" → trạng thái chuyển PENDING_APPROVAL, gửi vào hàng chờ duyệt của Admin.
5. Admin duyệt → trạng thái PUBLISHED.
6. Trong cùng transaction PostgreSQL, ghi thay đổi Job và một bản ghi JobEventOutbox; lỗi ở bất kỳ bước nào thì cùng rollback.
7. Sau khi commit, đẩy job vào hàng đợi nội bộ BullMQ để index lên Elasticsearch; luồng này độc lập với publisher Kafka.
8. Publisher lấy event từ outbox và publish lên topic Kafka job-events để AI Service tính embedding.
#### Luồng 2: Vòng đời trạng thái tin tuyển dụng
1. DRAFT: đang soạn, chỉ recruiter thấy.
2. PENDING_APPROVAL: chờ Admin duyệt.
3. PUBLISHED: hiển thị công khai, nhận đơn ứng tuyển.
4. CLOSED: recruiter chủ động đóng (đã tuyển đủ) → gỡ khỏi chỉ mục tìm kiếm, không nhận đơn mới, đơn cũ vẫn xử lý được.
5. EXPIRED: scheduler chạy mỗi giờ quét các tin PUBLISHED có deadline < hôm nay → chuyển EXPIRED và gỡ khỏi Elasticsearch.
6. Sửa tin đang PUBLISHED: nếu đổi tiêu đề/mô tả/lương → quay lại PENDING_APPROVAL; nếu chỉ sửa deadline hoặc số lượng → cập nhật ngay.
#### Luồng 3: Tìm kiếm việc làm
1. Ứng viên nhập từ khoá và/hoặc chọn bộ lọc.
2. Truy vấn Elasticsearch: full-text trên tiêu đề, mô tả, kỹ năng, tên công ty (có phân tích tiếng Việt).
3. Áp bộ lọc: địa điểm, khoảng lương, kỹ năng, số năm kinh nghiệm, hình thức làm việc, công ty.
4. Sắp xếp: độ liên quan (mặc định), mới nhất, lương cao nhất.
5. Phân trang; trả về kèm tổng số kết quả và facet đếm theo từng bộ lọc.
6. Nếu Elasticsearch không phản hồi hoặc baseline marker chưa hoàn tất → fallback truy vấn LIKE trên PostgreSQL. Health trả `DEGRADED` khi baseline marker thiếu/sai; sau khi baseline đã hoàn tất, lỗi Elasticsearch runtime vẫn fallback nhưng health hiện chỉ phản ánh baseline readiness nên có thể còn `UP`.
#### Luồng 4: Đồng bộ dữ liệu sang Elasticsearch
1. Mọi thay đổi job LUÔN ghi vào PostgreSQL trước (nguồn sự thật).
2. Trong cùng transaction với Job, ghi desired index state bền vững vào PostgreSQL; dispatcher chỉ đưa intent đã commit sang BullMQ nên Redis lỗi không làm mất cập nhật. Khi shutdown, dispatcher kiểm tra cả trước và sau claim, release intent nếu shutdown thắng race sau claim.
3. Worker lấy từ hàng đợi và scripted-update Elasticsearch theo cặp (`aggregateVersion`, `indexGeneration`); lỗi thì retry với backoff.

<!-- Page 20 -->

4. Không index đồng bộ trong cùng transaction — tránh trường hợp ES chậm/chết làm hỏng nghiệp vụ ghi job.
5. Có lệnh reindex toàn bộ để dựng lại chỉ mục từ Postgres khi cần; reindex dùng set-based UPSERT theo page, chỉ ghi Elasticsearch và không phát `job-events`. Service dùng cặp marker bền vững `mappings._meta.baselineVersion=3` và `baselineIndexUuid=<UUID>`, tự enqueue/resume baseline sau restart cho cả index mới và index tương thích có marker thiếu, cũ hoặc sai UUID.
#### Luồng 5: Gợi ý "Việc làm phù hợp với bạn"
1. Ứng viên mở trang chủ hoặc trang gợi ý.
2. Job & Search Service gọi AI Service: POST /ai/recommend/jobs?cv_id={cv mặc định của ứng viên}.
3. AI Service trả danh sách job_id kèm điểm tương đồng (score).
4. Job Service lọc bỏ các job không còn PUBLISHED, lấy chi tiết từ job-db theo thứ tự score.
5. Hiển thị top-N kèm % phù hợp.
6. Nếu AI Service lỗi hoặc ứng viên chưa có CV → fallback hiển thị việc mới nhất theo lĩnh vực quan tâm.

### 2. Tài liệu nghiệp vụ
### 2.1. Quy tắc nghiệp vụ (business rules)
- salary_min ≤ salary_max; nếu chọn "Thoả thuận" thì cả hai để trống.
- deadline bắt buộc và phải lớn hơn ngày hiện tại.
- Chỉ thành viên của công ty đã VERIFIED mới tạo được tin.
- MEMBER chỉ sửa/xoá tin do mình tạo; OWNER thao tác được trên mọi tin của công ty.
- Tin EXPIRED và CLOSED không nhận đơn ứng tuyển mới (Application Service kiểm tra trước khi cho nộp).
- Elasticsearch chỉ trả kết quả tìm kiếm cho tin `PUBLISHED` có `searchable=true`; `CLOSED`, `EXPIRED` và các trạng thái khác được giữ dưới dạng tombstone `searchable=false` để stale task không thể làm tin xuất hiện lại.
- PostgreSQL là nguồn sự thật duy nhất; Elasticsearch có thể dựng lại bất cứ lúc nào từ Postgres.
- Khi startup và trước khi bật writer, service phải kiểm tra strict mapping, kiểu và cờ `index`/`doc_values` của toàn bộ field bắt buộc, các thành phần analyzer/multi-field tiếng Việt bắt buộc và projection version 3; alias chỉ được trỏ đúng một concrete index tương thích, alias nhiều target phải bị từ chối.
- Chỉ dùng Elasticsearch search và trả health `UP` khi `mappings._meta.baselineVersion=3` và `baselineIndexUuid` khớp UUID vật lý trong settings. Khi hoàn tất, service refresh concrete index, ghi marker kèm UUID rồi revalidate tên index, UUID và marker; mismatch tiếp tục baseline, fallback PostgreSQL và trả health `DEGRADED`.
- Mỗi mutation dùng CAS trên `aggregate_version`; chỉ mutation thắng mới tăng version và tạo đúng một outbox event có cùng version.
- `event_id` được tạo một lần khi ghi outbox và giữ nguyên qua mọi lần retry, vì delivery Kafka là at-least-once.
- Số lượng kết quả trả về mỗi trang tối đa 50.
- Bulk detail nội bộ nhận tối đa 100 `jobIds` UUID duy nhất; chỉ trả projection công khai an toàn của `PUBLISHED`, `CLOSED`, `EXPIRED`, còn ID không tồn tại hoặc trạng thái nội bộ nằm trong `unavailableJobIds`.
### 2.2. Mô hình dữ liệu
- Job(id, company_id, created_by, title, description, requirements, benefits, salary_min, salary_max, is_negotiable, currency, location, job_type, experience_years, quantity, skills[], deadline, status, aggregate_version, published_at, created_at, updated_at)
- JobEventOutbox(event_id, job_id, aggregate_version, topic, event_key, action, payload, attempts, next_attempt_at, lease_owner, lease_expires_at, published_at, last_error, created_at) — unique(job_id, aggregate_version), payload bất biến.
- JobView(id, job_id, user_id, viewed_at) — phục vụ thống kê lượt xem
- Chỉ mục Elasticsearch: job_index_v3(_meta[projectionVersion=3, baselineVersion=3, baselineIndexUuid], jobId, aggregateVersion, indexGeneration, searchable, companyId, companyName, title, description, salaryMin, salaryMax, isNegotiable, currency, location, jobType, experienceYears, skills, deadline, status, publishedAt)
### 2.3. API chính
```text
 Endpoint                              Mô tả                                          Quyền truy cập
 POST /jobs                            Tạo tin (DRAFT)                                Recruiter
 PUT /jobs/:id                         Cập nhật tin                                   Recruiter sở hữu
 PATCH /jobs/:id/publish               Gửi duyệt để đăng                              Recruiter
 PATCH /jobs/:id/close                 Đóng tin                                       Recruiter
 PATCH /jobs/:id/approve               Duyệt tin                                      Admin (nội bộ)
 GET                                   Tìm kiếm                                       Public
 /jobs/search?q=&location=&salary=&
 skills=
 GET /jobs/:id                         Chi tiết tin                                   Public
 GET /jobs?company_id=                 Tin của một công ty                            Public
 GET                                   Việc làm phù hợp (qua AI)                      Candidate
 /jobs/recommendations?user_id=
```

<!-- Page 21 -->

```text
 Endpoint                            Mô tả                                         Quyền truy cập
 GET /jobs/:id/exists                Kiểm tra tin còn nhận đơn không               Nội bộ (Application)
 POST /jobs/details/bulk             Lấy tối đa 100 chi tiết Job cho Bookmark      Nội bộ (Application)
```


### 2.4. Sự kiện Kafka
- PRODUCE topic job-events khi tin được tạo/sửa/đóng/hết hạn.
- Contract v1: Kafka key=`job_id`; value flat snake_case gồm đúng 16 trường `{ event_id, action, job_id, company_id, title, description, skills, location, status, occurred_at, schema_version, aggregate_version, requirements, salary_min, salary_max, job_type }`. `schema_version=1`; action thuộc `CREATED|UPDATED|CLOSED|EXPIRED`; salary là chuỗi thập phân hai chữ số hoặc `null`.
- Mutation Job và bản ghi outbox nằm trong cùng transaction PostgreSQL. Publisher claim theo lease có heartbeat, giữ thứ tự tăng của `aggregate_version` trên từng job và retry Kafka có backoff/cận trên; cùng một `event_id` được gửi lại nên consumer phải idempotent. Delivery là at-least-once.
- Consumer: AI Service (chính Người 2) và Admin & Statistics Service (Người 1).
### 2.5. Phụ thuộc giữa các service
- Phụ thuộc: Company Service (kiểm tra VERIFIED), Admin Service (duyệt tin), AI Service (gợi ý).
- Được phụ thuộc bởi: Application Service (kiểm tra job còn mở), Company (trang công ty).
### 2.6. Tiêu chí hoàn thành (Definition of Done)
- Tạo tin → duyệt → tìm thấy được trên trang tìm kiếm.
- Bộ lọc và sắp xếp hoạt động đúng trên Elasticsearch.
- Scheduler chuyển tin hết hạn chạy đúng.
- job-events publish được, giữ đúng key/version/contract và Người 1 nhận được để thống kê.

### 2.7. Khoảng trống rollout/vận hành còn lại
- Database đã có dữ liệu vẫn cần baseline/replay được review nếu consumer Kafka cần historical `job-events`; migration outbox không tự backfill hoặc tự phát lại domain event lịch sử. Baseline Elasticsearch là luồng độc lập: `job_index_v3` tự enqueue/resume cho cả index mới và index tương thích thiếu/sai `mappings._meta.baselineVersion=3` hoặc `baselineIndexUuid`; trong lúc chưa hoàn tất, search dùng PostgreSQL fallback và health ở `DEGRADED`.
- Chính sách dọn bản ghi outbox đã publish (retention/cleanup) chưa triển khai.
- Hard-delete Job hiện bị các FK `RESTRICT` từ outbox và durable index-sync chặn; phải chốt soft-delete hoặc tombstone intent độc lập trước khi cho phép xóa cứng, không dùng `CASCADE` khi chưa bảo toàn sự kiện/index xóa.

<!-- Page 22 -->

## B3. Application Service
```text
 Người phụ trách              Người 2
 Công nghệ                    Spring Boot 3 (Java 21), Spring Data JPA, Spring Kafka
 Database                     PostgreSQL container riêng: application-db
 Vai trò trong hệ thống       Quản lý toàn bộ pipeline ứng tuyển. Dùng @Transactional + optimistic locking để
                              nhiều HR thao tác đồng thời không ghi đè nhau.
 Phụ thuộc                    Auth (JWT), Profile (xác minh CV + snapshot kỹ năng v2 lúc nộp), Job (kiểm tra tin
                              còn mở), Notification (qua Kafka)
```


### 1. Luồng hoạt động các chức năng
#### Luồng 1: Ứng viên nộp đơn ứng tuyển
1. Ứng viên bấm "Ứng tuyển" trên trang chi tiết job.
2. Hệ thống gọi Job & Search Service kiểm tra tin còn ở trạng thái PUBLISHED và chưa quá deadline.
3. UI lấy danh sách CV khả dụng từ Profile; khi Candidate gửi đơn, Application gọi nội bộ `POST /internal/v2/cvs/verify` bằng service key + Candidate JWT để xác minh CV và nhận snapshot kỹ năng schema 1.
4. Ứng viên chọn CV và viết cover letter (tuỳ chọn, tối đa 2000 ký tự).
5. Kiểm tra trùng: ứng viên này đã có đơn ACTIVE cho job này chưa → nếu có, chặn và báo "Bạn đã ứng tuyển vị trí này".
6. Tạo Application(status = APPLIED, applied_at = now), metadata/danh sách tên kỹ năng immutable, CV usage, ApplicationHistory và outbox trong cùng transaction; lỗi ở bất kỳ bước nào thì rollback toàn bộ.
7. Outbox publisher phát sự kiện lên topic application-events sau khi transaction commit.
8. Hiển thị xác nhận cho ứng viên; đơn xuất hiện ở màn "Việc đã ứng tuyển".
#### Luồng 2: Lưu việc yêu thích (Bookmark)
1. Ứng viên bấm biểu tượng lưu trên tin tuyển dụng.
2. Tạo bản ghi Bookmark(user_id, job_id); bấm lại thì xoá.
3. Trang "Việc đã lưu" liệt kê job_id → gọi Job Service lấy chi tiết hiển thị.
4. Tin đã lưu nhưng đã hết hạn thì vẫn hiển thị kèm nhãn "Đã hết hạn".
#### Luồng 3: HR quản lý và lọc hồ sơ ứng viên
1. HR mở màn quản lý ứng viên theo từng job.
2. Danh sách hiển thị: tên ứng viên, CV, ngày nộp, trạng thái hiện tại và `match_score` đã lưu nếu có.
3. Khi điểm chưa có hoặc cần tính lại, HR gọi `POST /applications/:id/match-score/refresh` kèm `expectedVersion`; việc nộp đơn của Candidate không gọi AI đồng bộ.
4. Application Service lấy `cv_id/job_id` từ Application, không tin dữ liệu định danh do client gửi.
5. Xác minh Recruiter là MEMBER/OWNER đúng công ty trước khi gọi AI; người ngoài công ty bị chặn trước downstream call.
6. Gọi nội bộ `POST /ai/match` bằng `X-Internal-Api-Key`; AI trả envelope có echoed IDs, score `0..1` hoặc `reason` khi embedding chưa sẵn sàng.
7. Score hợp lệ được nhân 100, làm tròn 2 chữ số và lưu bằng atomic compare-and-set; version Application tăng 1.
8. AI lỗi/payload sai/embedding chưa sẵn sàng giữ nguyên điểm cũ; refresh điểm không đổi status/`updated_at`, không ghi history hoặc outbox.
9. Lọc kỹ năng theo snapshot tại lúc nộp: `skills` có thể lặp hoặc phân tách bằng dấu phẩy, tối đa 10; khớp ANY theo tên đầy đủ không phân biệt hoa/thường, không khớp chuỗi con; kết hợp được với job/status/thời gian và phân trang ổn định.
10. HR mở CV xem trực tiếp (iframe PDF từ Cloudinary).
11. HR ghi đánh giá nội bộ rồi chuyển trạng thái đơn theo state machine ở luồng 4.
#### Luồng 4: State machine trạng thái đơn ứng tuyển
1. APPLIED — vừa nộp, chờ HR xem.
2. REVIEWING — HR đang xem xét hồ sơ.
3. INTERVIEW — đã chọn phỏng vấn (Interview Service sẽ đặt lịch dựa trên application_id này).
4. OFFER — gửi đề nghị nhận việc.
5. HIRED — ứng viên chấp nhận offer.
6. REJECTED — bị loại; có thể chuyển sang REJECTED từ BẤT KỲ trạng thái nào trước HIRED.
7. WITHDRAWN — ứng viên tự rút đơn; chỉ ứng viên thực hiện được, và chỉ khi chưa HIRED.

<!-- Page 23 -->

8. Không cho phép lùi trạng thái (VD: INTERVIEW → APPLIED). Mọi lần chuyển đều ghi ApplicationHistory và publish application-events.
#### Luồng 5: Gửi Offer
1. Từ trạng thái INTERVIEW, HR bấm "Gửi Offer".
2. Nhập mức lương dương (tối đa hai chữ số thập phân), ngày bắt đầu không ở quá khứ, vị trí chính thức, ghi chú, thời hạn phản hồi và file offer letter tuỳ chọn.
3. `file_id` và `file_url` phải cùng có hoặc cùng vắng; URL phải là HTTP(S) tuyệt đối. Xác minh canonical metadata và ownership nội bộ chờ contract File Service ở P09.
4. Mỗi Application chỉ có một Offer. Tạo Offer với `sent_by` lấy từ JWT, trạng thái `SENT`, đồng thời chuyển Application `INTERVIEW → OFFER` bằng expected version trong một transaction.
5. Publish `application-events` loại `OFFER_SENT` qua transactional outbox để Notification Service gửi thông báo trong app và email.
6. Chỉ Candidate sở hữu Application được phản hồi Offer `SENT` chưa hết hạn; request phải mang expected version của cả Offer và Application.
7. Chấp nhận chuyển Offer/Application sang `ACCEPTED/HIRED`; từ chối bắt buộc lý do và chuyển sang `DECLINED/REJECTED`. Phản hồi lặp, hết hạn hoặc concurrent đều bị chặn.
#### Luồng 6: Thống kê cho Recruiter (Dashboard nhà tuyển dụng)
1. Tổng số tin đang tuyển (lấy từ Job Service), tổng số đơn nhận được theo từng tin.
2. Số đơn theo từng trạng thái và tỷ lệ chuyển đổi APPLIED → REVIEWING → INTERVIEW → OFFER → HIRED.
3. Biểu đồ số đơn theo thời gian (ngày/tuần/tháng).
4. Nguồn ứng viên: thống kê theo trường source ghi lúc nộp đơn (tìm kiếm, gợi ý AI, trang công ty, link chia sẻ).
5. Dữ liệu tính trực tiếp trong application-db của service này (không đụng Admin Service — Admin chỉ thống kê toàn hệ thống cho quản trị viên).

### 2. Tài liệu nghiệp vụ
### 2.1. Quy tắc nghiệp vụ (business rules)
- Một ứng viên chỉ có một đơn ACTIVE cho mỗi job. Nếu bị REJECTED thì được nộp lại sau 30 ngày.
- Không nộp đơn được vào tin đã CLOSED hoặc EXPIRED.
- Bắt buộc chọn CV khi nộp đơn; cover letter là tuỳ chọn, tối đa 2000 ký tự.
- Dùng @Version (optimistic locking) trên Application — hai HR đổi trạng thái cùng lúc thì người sau nhận lỗi và phải tải lại.
- AI Match là thao tác on-demand của Recruiter, không nằm trong transaction nộp đơn; chỉ MEMBER/OWNER đúng công ty được refresh.
- Refresh `match_score` bắt buộc `expectedVersion`, ghi bằng compare-and-set và tăng version nhưng không đổi status/`updated_at`, không tạo ApplicationHistory hoặc event.
- AI trả score `0..1`; Application kiểm tra echoed `cv_id/job_id`, đổi sang `0..100` với 2 chữ số. Mọi lỗi phải giữ nguyên điểm cũ.
- Mọi lần đổi trạng thái đều ghi ApplicationHistory (ai đổi, từ trạng thái nào sang trạng thái nào, lúc nào, ghi chú) — dùng để đối soát và hiển thị timeline cho ứng viên.
- Đánh giá nội bộ của HR không bao giờ hiển thị cho ứng viên.
- Mỗi recruiter chỉ tạo một Evaluation cho mỗi đơn; recruiter khác trong cùng công ty vẫn có thể tạo đánh giá riêng. Điểm tổng và từng tiêu chí dùng thang 0–100, tối đa 2 chữ số thập phân; criteria là JSON object có 1–20 tiêu chí và note là tuỳ chọn, tối đa 2000 ký tự.
- Evaluator luôn lấy từ JWT, thời điểm tạo do Application Service sinh. Việc đánh giá không tự đổi trạng thái Application, không ghi history và không phát Kafka event.
- Mỗi Application chỉ có tối đa một Offer; MEMBER/OWNER cùng công ty chỉ được gửi Offer khi Application đang ở `INTERVIEW`, còn `sent_by` luôn lấy từ JWT subject.
- Offer phải có salary dương tối đa hai chữ số thập phân, start date không ở quá khứ, position không rỗng, note tối đa 2000 ký tự và `expires_at` ở tương lai. `file_id/file_url` là cặp tuỳ chọn và URL phải là HTTP(S) tuyệt đối.
- Application và Offer đều dùng expected version/atomic update. Chỉ đúng Candidate được phản hồi một Offer `SENT` chưa hết hạn; DECLINED bắt buộc có `response_note`.
- Tạo/phản hồi Offer, chuyển trạng thái Application, ghi ApplicationHistory và transactional outbox phải cùng commit hoặc cùng rollback.
- Application Service mới kiểm tra cấu trúc file reference; xác minh canonical file metadata, trạng thái confirm và ownership nội bộ vẫn chờ API File/Media ở P09.
- Ứng viên chỉ xem được đơn của chính mình; HR chỉ xem được đơn thuộc job của công ty mình.
- Trong Application Pipeline, cả MEMBER và OWNER được xem và xử lý đơn của mọi job thuộc công ty, kể cả job do recruiter khác tạo. Giới hạn MEMBER chỉ sửa/xoá job do mình tạo chỉ áp dụng cho Job Service.
- Snapshot chỉ gồm tên kỹ năng Candidate tự khai tại thời điểm nộp. Sửa Profile sau đó không đổi Application cũ; pipeline đọc snapshot nội bộ và không gọi live Profile.
- Snapshot không chứng minh kỹ năng có trong PDF và chỉ hỗ trợ Recruiter tìm kiếm, không được dùng làm tiêu chí tự động loại. Application legacy hoặc snapshot rỗng vẫn hiển thị khi không lọc, nhưng không khớp khi filter kỹ năng đang bật.
- Filter kỹ năng dùng ANY, exact và không phân biệt hoa/thường; không hỗ trợ substring, alias, bỏ dấu hoặc semantic match. Response không echo skill names, dùng `Cache-Control: private, no-store` và `Vary: Authorization`; root Nginx không ghi query string cho `/applications/`, còn gateway/APM bên ngoài phải giữ redaction hoặc giới hạn quyền truy cập/thời gian lưu log.
- Publish event là bước bắt buộc sau mỗi lần đổi trạng thái — Notification phụ thuộc hoàn toàn vào đây.
### 2.2. Mô hình dữ liệu
- Application(id, job_id, company_id, candidate_id, cv_id, cover_letter, status, source, match_score, profile_skill_snapshot_schema_version, profile_aggregate_version, profile_skill_snapshot_expected_count, applied_at, updated_at, version)
- ApplicationProfileSkillSnapshot(application_id, skill_name, normalized_name generated; immutable, V8 không backfill Application lịch sử)
- ApplicationHistory(id, application_id, from_status, to_status, changed_by, note, changed_at)
- Evaluation(id, application_id, evaluator_id, score, criteria_json, note, created_at)
- Offer(id, application_id, sent_by, salary, start_date, position, note, file_id, file_url, status[SENT|ACCEPTED|DECLINED], sent_at, expires_at, responded_at, response_note, version)
- Bookmark(id, user_id, job_id, created_at)
### 2.3. API chính
```text
 Endpoint                             Mô tả                                          Quyền truy cập
 POST /applications                   Nộp đơn ứng tuyển                              Candidate
 GET /applications?job_id=&status=&appliedFrom=&appliedTo=&skills=&sort=&page=&size=
                                      Danh sách/lọc pipeline theo snapshot lúc nộp   Recruiter
```

<!-- Page 24 -->

```text
 Endpoint                              Mô tả                                      Quyền truy cập
 GET /applications/my                  Đơn của tôi (timeline)                     Candidate
 GET /applications/:id                 Chi tiết đơn                               Chủ đơn / Recruiter liên
                                                                                  quan
 PATCH /applications/:id/status        Chuyển trạng thái                          Recruiter
 POST /applications/:id/evaluation     Ghi đánh giá nội bộ                        Recruiter
 POST /applications/:id/offer          Gửi offer                                  Recruiter
 PATCH /offers/:id/respond             Chấp nhận / từ chối offer                  Candidate
 PATCH /applications/:id/withdraw      Rút đơn                                    Candidate
 POST /bookmarks | DELETE              Lưu / bỏ lưu việc                          Candidate
 /bookmarks/:jobId
 GET /applications/stats?company_id=   Số liệu dashboard recruiter                Recruiter
 POST /applications/:id/match-score/refresh  Tính/làm mới điểm AI (expectedVersion)       Recruiter
```


### 2.4. Sự kiện Kafka
- PRODUCE topic application-events mỗi khi trạng thái thay đổi hoặc offer được gửi.
- Payload gợi ý: { event_id, action: STATUS_CHANGED|OFFER_SENT, application_id, job_id, job_title, candidate_id, recruiter_id, from_status, to_status, occurred_at }.
- Implementation Offer mở rộng payload bằng `actor_id`, `offer_id`, `offer_status`, `offer_version`. `recruiter_id` vẫn là recruiter gắn với Application/job; người thực hiện thao tác nằm ở `actor_id`.
- Event Offer không được chứa salary, note, lý do phản hồi, `file_id` hoặc `file_url`.
- Consumer: Notification Service (Người 3) và Admin & Statistics Service (Người 1).
- Đây là hợp đồng liên người quan trọng nhất của Người 2 — chốt schema với Người 3 trong tuần đầu.
### 2.5. Phụ thuộc giữa các service
- Phụ thuộc REST: Profile Service xác minh CV và cấp snapshot kỹ năng qua internal v2, Job Service kiểm tra tin, Company Service xác minh quyền recruiter và AI Service tính `match_score`; Offer sẽ gọi File/Media để xác minh file khi contract P09 hoàn thành.
- Rollout snapshot theo thứ tự Profile v2 → Flyway V8 → Application consumer/filter, sau đó drain replica Application còn gọi v1. Không backfill Application lịch sử bằng Profile hiện tại.
- Được phụ thuộc bởi: Interview Service (Người 3) tham chiếu application_id, Notification Service (Người 3) qua Kafka.
### 2.6. Tiêu chí hoàn thành (Definition of Done)
- Nộp đơn → HR đổi trạng thái → ứng viên thấy timeline cập nhật: chạy thông suốt.
- State machine chặn đúng các bước chuyển không hợp lệ (có unit test).
- application-events phát đúng schema đã chốt và Người 3 nhận được.
- Dashboard recruiter hiển thị đủ 4 chỉ số.
- Filter kỹ năng được kiểm chứng với ANY/exact/case-insensitive, company isolation, legacy/snapshot rỗng, filter kết hợp và phân trang deterministic; đây chưa thay thế P17 deployed cross-service E2E.

<!-- Page 25 -->

## B4. AI Service
```text
 Người phụ trách             Người 2
 Công nghệ                   Python + FastAPI, sentence-transformers (all-MiniLM-L6-v2), Anthropic Claude API
 Database                    PostgreSQL container riêng: ai-db + pgvector · Redis (lịch sử hội thoại)
 Vai trò trong hệ thống      Hai chức năng: (1) gợi ý việc làm bằng so khớp ngữ nghĩa CV ↔ Job; (2) chatbot hỗ
                             trợ ứng viên.
 Phụ thuộc                   Kafka (cv-events từ Người 1, job-events từ Người 2)
```


### 1. Luồng hoạt động các chức năng
#### Luồng 1: Cập nhật embedding CV
1. Consumer lắng nghe topic cv-events.
2. Parse contract v1/key/version. Với `UPSERTED`, gọi Media nội bộ để verify `file_id`, owner
   `candidate_id`, type `CV`, rồi lấy URL HTTPS ngắn hạn; không nhận URL từ Kafka.
3. Tải streaming có timeout/redirect-off/host allowlist và hard cap 5 MiB; trích xuất text từ PDF
   trong parser bị giới hạn. CV online cũng dùng PDF immutable, không đưa `content_json` qua Kafka.
4. Làm sạch text (bỏ ký tự thừa, chuẩn hoá khoảng trắng), cắt còn phần nội dung có nghĩa.
5. Sinh vector bằng all-MiniLM-L6-v2 (384 chiều, chạy được trên CPU).
6. Upsert vào bảng CvEmbedding (khoá là cv_id) trong PostgreSQL + pgvector.
7. `DEACTIVATED` đặt vector inactive nhưng vẫn cho `/ai/match` lịch sử; `DELETED` xoá vector và đặt
   aggregate tombstone để event cũ không thể phục hồi dữ liệu.
8. Lỗi hạ tầng Media/model/database không commit để retry; source đã mất hoặc PDF hỏng/rỗng trở
   thành terminal dead-letter chỉ chứa hash/mã lỗi để partition tiếp tục tới event mới hơn.
#### Luồng 2: Cập nhật embedding Job
1. Consumer lắng nghe topic `job-events`, bắt buộc Kafka key trùng `job_id`.
2. Ghép tiêu đề + mô tả + yêu cầu + danh sách kỹ năng từ contract v1 để tạo nội dung embedding.
3. Sinh vector 384 chiều bằng cùng model và revision bất biến để nằm chung không gian vector với CV.
4. Upsert JobEmbedding cùng metadata `location`, `salary_min`, `salary_max`, `job_type`; hai cột salary dùng `NUMERIC(15,2)` để khớp miền giá trị của Job producer.
5. Chỉ `PUBLISHED` là active; `DRAFT/PENDING_APPROVAL/CLOSED/EXPIRED` đều deactivate vector và API match phải bỏ qua.
6. Ledger chống trùng theo `event_id`; ưu tiên `aggregate_version`, fallback `occurred_at + partition + offset`.
7. Event vĩnh viễn không hợp lệ vào DLQ hash-only; không lưu raw payload, key hoặc mô tả job.
#### Luồng 3: Gợi ý việc làm phù hợp
1. Job & Search Service gọi POST /ai/recommend/jobs?cv_id=... kèm bộ lọc tuỳ chọn (location, salary tối thiểu).
2. Lấy vector của CV; nếu chưa có → trả về rỗng kèm mã lý do để bên gọi fallback.
3. Truy vấn pgvector tính cosine similarity giữa vector CV và các JobEmbedding đang hoạt động.
4. Áp bộ lọc cứng (địa điểm, mức lương) trước khi lấy top-N.
5. Trả về danh sách { job_id, score } sắp xếp giảm dần, mặc định N = 10.
6. Cache kết quả trong Redis 30 phút theo cv_id để giảm tải tính toán.
#### Luồng 4: Chatbot hỗ trợ ứng viên
1. Client gửi POST /ai/chat kèm session_id và câu hỏi.
2. Lấy lịch sử hội thoại của session từ Redis (giữ tối đa 10 lượt gần nhất).
3. Ghép system prompt chứa ngữ cảnh nghiệp vụ: đây là nền tảng tuyển dụng, các chức năng đang có, giới hạn phạm vi trả lời.
4. Gọi Anthropic Claude API.
5. Nếu câu hỏi thuộc dạng "gợi ý việc cho tôi" → gọi nội bộ luồng 3 và đưa kết quả vào câu trả lời.
6. Lưu lại lượt hỏi/đáp vào Redis, TTL 24 giờ.
7. Trả câu trả lời cho client; nếu Claude API lỗi → trả thông báo lỗi thân thiện, không để trắng màn hình.

<!-- Page 26 -->

### 2. Tài liệu nghiệp vụ
### 2.1. Quy tắc nghiệp vụ (business rules)
- AI Service KHÔNG lưu trữ nội dung CV/job gốc trong vector store, event ledger hay dead-letter — chỉ lưu vector, hash, provenance và metadata tối thiểu.
- Dùng đúng một model embedding cùng revision bất biến cho cả CV và Job; đổi model/revision thì phải reindex toàn bộ.
- Consumer Kafka phải idempotent theo `event_id`, commit offset sau durable outcome và không để event cũ ghi đè state mới.
- Chatbot chỉ trả lời trong phạm vi nghiệp vụ tuyển dụng; câu hỏi ngoài phạm vi thì lịch sự từ chối và hướng về chức năng của hệ thống.
- Không đưa thông tin cá nhân của ứng viên khác vào prompt của chatbot.
- Điểm phù hợp trả về là số thực 0–1, chuẩn hóa từ cosine bằng `(cosine_similarity + 1) / 2` (không clamp); khi hiển thị thì quy đổi ra phần trăm và làm tròn.
- `/ai/match` là API nội bộ, bắt buộc `X-Internal-Api-Key`; request dùng snake_case `{ cv_id, job_id }` và không nhận nội dung CV/job gốc.
- Response dùng envelope `{ data, meta }`, phải echo đúng `cv_id/job_id` và chỉ có một trong hai: `score` hợp lệ hoặc `reason` khác rỗng khi embedding chưa sẵn sàng.
- Thiếu embedding trả HTTP 200 với `score: null`; sai key trả 401, request sai trả 422, database/model chưa sẵn sàng trả 503. Không clamp score ngoài `0..1`.
- API key của Claude chỉ nằm trong biến môi trường của service này.
### 2.2. Mô hình dữ liệu
- CvEmbedding(cv_id, user_id, vector vector(384), text_hash, model_name, is_active, source_event_id, source_version, updated_at)
- CvAggregateOwner(cv_id, user_id, created_at) — registry bất biến, giữ lại cả sau DLQ/tombstone để chặn đổi owner
- JobEmbedding(job_id, vector vector(384), text_hash, model_name, location, salary_min NUMERIC(15,2), salary_max NUMERIC(15,2), job_type, is_active, updated_at)
- ChatSession(session_id, user_id, history_json, updated_at) — lưu chính ở Redis, đồng bộ xuống Postgres nếu cần phân tích
- EmbeddingEventLedger(event_id, topic, partition, offset, aggregate_id, version, payload_hash, state_hash, outcome, processed_at)
- EmbeddingAggregateCursor(aggregate_type, aggregate_id, last_version/occurred_at/offset, state_hash, tombstoned)
- DeadLetter(id, event_id nullable, topic, partition, offset, key_hash, payload_hash, error_code, safe_message, attempt_count, created_at) — tuyệt đối không lưu raw payload
### 2.3. API chính
```text
 Endpoint                            Mô tả                                         Quyền truy cập
 POST /ai/chat                       Hỏi đáp với chatbot                           Đã đăng nhập
 POST /ai/recommend/jobs?cv_id=      Gợi ý top-N job phù hợp                       Nội bộ (Job Service)
 POST /ai/match                      Chấm điểm phù hợp giữa 1 CV và 1 job          Nội bộ (Application)
 POST /ai/embeddings/refresh         Tính lại embedding thủ công                   Admin / nội bộ
 GET /ai/health                      Liveness của API process                     Nội bộ
 GET /ai/ready                       Kiểm tra pgvector và schema                    Nội bộ
```


### 2.4. Sự kiện Kafka
- CONSUME: cv-events (Người 1), job-events (Người 2).
- Contract `cv-events` v1: key=`cv_id`; value đúng 9 trường `event_id, action, cv_id, candidate_id,
  file_id, cv_type, occurred_at, schema_version, aggregate_version`; action là
  `UPSERTED|DEACTIVATED|DELETED` và không chứa URL/nội dung CV.
- Contract `job-events` v1: key=`job_id`; value flat snake_case gồm đúng 16 trường `event_id, action, job_id, company_id, title, description, skills, location, status, occurred_at, schema_version, aggregate_version, requirements, salary_min, salary_max, job_type`.
- Consumer xử lý at-least-once theo `event_id` và từ chối state cũ dựa trên `aggregate_version`; salary nhận chuỗi thập phân hai chữ số hoặc `null` rồi lưu bằng `NUMERIC(15,2)`.
- Không produce event. Kết quả gợi ý được lấy qua REST khi cần.
### 2.5. Phụ thuộc giữa các service
- Phụ thuộc: schema của cv-events (chốt với Người 1) và job-events (tự chốt).
- Được phụ thuộc bởi: Job & Search Service (mục "Việc làm phù hợp với bạn"), Application Service (điểm match hiển thị cho HR).
### 2.6. Tiêu chí hoàn thành (Definition of Done)
- Upload một CV mới → sau vài giây có vector trong ai-db (kiểm tra được bằng truy vấn).
- API gợi ý trả về danh sách job hợp lý cho ít nhất 3 CV mẫu khác nhau.
- Chatbot trả lời được 10 câu hỏi thường gặp về quy trình ứng tuyển.
- Có xử lý lỗi và dead-letter, không làm chết consumer khi gặp 1 event hỏng.

<!-- Page 27 -->

# V. PHẦN C — NGƯỜI 3: LUỒNG PHỎNG VẤN, GIAO TIẾP & HẠ TẦNG
Người 3 sở hữu tất cả những gì xảy ra SAU khi hồ sơ được chọn: đặt lịch phỏng vấn, phòng gọi video, nhắn tin giữa hai bên, và toàn bộ thông báo của hệ thống. Vì phụ trách ít service nghiệp vụ hơn (3 thay vì 4), Người 3 gánh thêm hạ tầng dùng chung: docker-compose, Kafka, Nginx gateway và Jitsi. Danh sách service phụ trách: Interview & Video Call Service · Chat Service · Notification Service · Hạ tầng dùng chung

## C1. Interview & Video Call Service
```text
 Người phụ trách             Người 3
 Công nghệ                   Spring Boot 3 (Java 21), Spring Data JPA, Spring Kafka, WebClient
 Database                    PostgreSQL container riêng: interview-db
 Tích hợp ngoài              Jitsi Meet self-host, nhúng qua Jitsi Meet External API
 Vai trò trong hệ thống      Gộp Interview Service và Video Call Service. Quản lý lịch phỏng vấn, kiểm tra trùng
                             lịch, tạo phòng gọi, lưu đánh giá sau phỏng vấn.
 Phụ thuộc                   Auth (JWT), Application (application_id), Notification (qua Kafka)
```


### 1. Luồng hoạt động các chức năng
#### Luồng 1: HR đặt lịch phỏng vấn
1. HR mở một đơn ứng tuyển đang ở trạng thái REVIEWING hoặc INTERVIEW, bấm "Đặt lịch phỏng vấn".
2. Gọi Application Service xác thực application_id tồn tại và thuộc công ty của HR.
3. HR chọn: ngày, giờ bắt đầu, thời lượng (30/45/60 phút), hình thức (ONLINE hoặc OFFLINE), vòng phỏng vấn (round 1, 2...), người phỏng vấn, ghi chú, địa điểm (nếu OFFLINE).
4. Kiểm tra trùng lịch: khoảng thời gian này có chồng lấn với buổi phỏng vấn nào khác của cùng người phỏng vấn hoặc cùng ứng viên không → nếu có, báo lỗi và gợi ý khung giờ trống.
5. Nếu ONLINE: sinh room_url dạng {jitsi_domain}/interview-{application_id}-{interview_id}, kèm token vào phòng có hạn dùng.
6. Lưu Interview với status = SCHEDULED trong transaction.
7. Publish sự kiện lên topic Kafka interview-events → Notification Service gửi thông báo + email kèm link phòng cho ứng viên.
8. Gợi ý HR chuyển trạng thái đơn sang INTERVIEW (gọi REST Application Service).
#### Luồng 2: Ứng viên xác nhận hoặc xin đổi lịch
1. Ứng viên nhận thông báo, mở màn chi tiết lịch phỏng vấn.
2. Chọn "Xác nhận tham gia" → status chuyển CONFIRMED, HR nhận thông báo.
3. Chọn "Xin đổi lịch" → nhập lý do và 2–3 khung giờ mong muốn → status chuyển RESCHEDULE_REQUESTED, HR nhận thông báo.
4. HR đặt lại lịch → buổi cũ chuyển CANCELLED, tạo buổi mới (giữ nguyên application_id, tăng số lần đổi lịch).
5. Quá 24 giờ trước buổi phỏng vấn mà ứng viên chưa xác nhận → hệ thống gửi nhắc lần 2.
#### Luồng 3: Tham gia phòng phỏng vấn video
1. Nút "Tham gia" mở khoá từ 15 phút trước giờ hẹn đến 60 phút sau giờ kết thúc dự kiến.
2. Frontend nhúng iframe Jitsi qua External API, truyền room name, tên hiển thị, và JWT phòng.
3. Người đầu tiên vào phòng → status chuyển IN_PROGRESS, ghi lại thời điểm.
4. Hai bên sử dụng camera, micro, chia sẻ màn hình (do Jitsi cung cấp sẵn).

<!-- Page 28 -->

5. Service KHÔNG xử lý và KHÔNG lưu luồng media — Jitsi đảm nhiệm toàn bộ signaling và truyền media.
6. Rời phòng → ghi thời điểm kết thúc.
#### Luồng 4: Đánh giá sau phỏng vấn
1. Sau buổi phỏng vấn, HR mở form đánh giá.
2. Chấm điểm theo tiêu chí (chuyên môn, giao tiếp, thái độ, phù hợp văn hoá) và viết nhận xét.
3. Kết luận: Đạt / Không đạt / Cần phỏng vấn thêm vòng nữa.
4. Lưu feedback, status chuyển COMPLETED.
5. Nếu kết luận Đạt → gợi ý HR chuyển đơn sang OFFER; nếu Không đạt → gợi ý chuyển REJECTED (thao tác thực hiện ở Application Service).
6. Đánh giá là dữ liệu nội bộ, ứng viên không xem được.
#### Luồng 5: Vắng mặt và huỷ lịch
1. Scheduler chạy mỗi 15 phút quét các buổi SCHEDULED/CONFIRMED đã quá giờ kết thúc mà chưa từng có ai vào phòng → chuyển NO_SHOW.
2. HR huỷ lịch: bắt buộc trước giờ hẹn ít nhất 2 giờ, phải nhập lý do → status CANCELLED → thông báo cho ứng viên.
3. Ứng viên huỷ: cũng phải nhập lý do, HR nhận thông báo.
4. Mọi thay đổi trạng thái đều publish interview-events.
#### Luồng 6: Xem lịch phỏng vấn
1. Ứng viên: danh sách buổi phỏng vấn sắp tới và đã qua, kèm trạng thái và link phòng.
2. HR: lịch theo tuần/tháng của cả công ty, lọc theo job hoặc theo người phỏng vấn.
3. Xem lịch sử phỏng vấn theo từng ứng viên (tất cả các vòng) hoặc theo từng tin tuyển dụng.

### 2. Tài liệu nghiệp vụ
### 2.1. Quy tắc nghiệp vụ (business rules)
- Không đặt lịch vào thời điểm trong quá khứ.
- Hai buổi phỏng vấn của cùng một người phỏng vấn không được chồng lấn thời gian; cùng một ứng viên cũng vậy.
- Huỷ lịch phải trước giờ hẹn ít nhất 2 giờ (trừ trường hợp Admin can thiệp).
- Mỗi đơn ứng tuyển có thể có nhiều buổi phỏng vấn (nhiều vòng), phân biệt bằng trường round.
- room_url gắn với application_id + interview_id để không hai buổi nào trùng phòng.
- Token vào phòng có hạn dùng, hết buổi phỏng vấn thì không dùng lại được.
- Đánh giá sau phỏng vấn chỉ HR và OWNER công ty xem được.
- Dùng @Transactional cho thao tác đặt lịch để kiểm tra trùng và ghi bản ghi diễn ra nguyên tử.
### 2.2. Mô hình dữ liệu
- Interview(id, application_id, job_id, candidate_id, interviewer_id, round, scheduled_at, duration_minutes, mode[ONLINE|OFFLINE], location, room_url, status, reschedule_count, cancel_reason, started_at, ended_at, created_at, version)
- InterviewFeedback(id, interview_id, evaluator_id, criteria_json, overall_score, comment, conclusion[PASS|FAIL|NEXT_ROUND], created_at)
- Trạng thái: SCHEDULED → CONFIRMED → IN_PROGRESS → COMPLETED; nhánh khác: RESCHEDULE_REQUESTED, CANCELLED, NO_SHOW
### 2.3. API chính

<!-- Page 29 -->

```text
 Endpoint                                 Mô tả                                   Quyền truy cập
 POST /interviews                         Đặt lịch phỏng vấn                      Recruiter
 GET /interviews?application_id=          Lịch theo đơn ứng tuyển                 Liên quan
 GET /interviews/my                       Lịch của tôi                            Candidate / Recruiter
 GET /interviews/:id                      Chi tiết buổi phỏng vấn                 Liên quan
 PATCH /interviews/:id/confirm            Ứng viên xác nhận                       Candidate
 PATCH /interviews/:id/reschedule         Xin đổi lịch / đặt lại                  Candidate / Recruiter
 PATCH /interviews/:id/cancel             Huỷ lịch (kèm lý do)                    Candidate / Recruiter
 POST /interviews/:id/join                Lấy token vào phòng Jitsi               Liên quan
 PATCH /interviews/:id/feedback           Ghi đánh giá sau phỏng vấn              Recruiter
 GET                                      Khung giờ trống                         Recruiter
 /interviews/availability?interviewer_i
 d=&date=
```


### 2.4. Sự kiện Kafka
- PRODUCE topic interview-events khi: lịch được tạo, xác nhận, đổi, huỷ, hoặc trước giờ hẹn 1 tiếng (nhắc lịch).
- Payload gợi ý: { event_id, action: SCHEDULED|CONFIRMED|RESCHEDULED|CANCELLED|REMINDER, interview_id, application_id, candidate_id, recruiter_id, scheduled_at, room_url, occurred_at }.
- Consumer: Notification Service (cùng Người 3 — thuận lợi vì không phải chốt hợp đồng liên người).
### 2.5. Phụ thuộc giữa các service
- Phụ thuộc REST: Application Service (Người 2) để xác thực application_id và gợi ý chuyển trạng thái đơn.
- Phụ thuộc hạ tầng: Jitsi self-host (chính Người 3 dựng).
### 2.6. Tiêu chí hoàn thành (Definition of Done)
- Đặt được lịch, ứng viên nhận email kèm link, hai bên vào cùng một phòng Jitsi và nhìn thấy nhau.
- Kiểm tra trùng lịch chặn đúng (có unit test).
- Scheduler NO_SHOW chạy đúng.
- interview-events phát và Notification nhận được.

<!-- Page 30 -->

## C2. Chat Service
```text
 Người phụ trách             Người 3
 Công nghệ                   Node.js + Socket.IO + Mongoose, Redis Adapter
 Database                    MongoDB (container mongo dùng riêng cho Chat)
 Vai trò trong hệ thống      Nhắn tin realtime 1-1 giữa Candidate và Recruiter. Tách riêng khỏi NestJS/Postgres vì
                             tần suất ghi cao và dữ liệu dạng document.
 Phụ thuộc                   Auth (verify JWT bằng public key), File/Media (đính kèm), Notification (qua Kafka)
```


### 1. Luồng hoạt động các chức năng
#### Luồng 1: Kết nối và xác thực socket
1. Client mở kết nối Socket.IO, truyền access token trong handshake.
2. Server verify chữ ký JWT bằng public key lấy từ Auth Service (cache trong bộ nhớ).
3. Token không hợp lệ hoặc hết hạn → từ chối kết nối.
4. Hợp lệ → lưu ánh xạ user_id → socket_id vào Redis (phục vụ biết ai đang online khi chạy nhiều instance).
5. Client join vào các room theo conversation_id mà mình tham gia.
6. Ngắt kết nối → xoá ánh xạ khỏi Redis, phát trạng thái offline.
#### Luồng 2: Khởi tạo cuộc hội thoại
1. Hội thoại được tạo tự động khi ứng viên nộp đơn (candidate ↔ recruiter phụ trách job đó), hoặc khi một trong hai bên chủ động nhắn trước.
2. Conversation lưu participants (2 user_id), job_id và application_id liên quan để hiển thị ngữ cảnh.
3. Nếu hội thoại giữa hai người cho cùng một job đã tồn tại → dùng lại, không tạo mới.
4. Danh sách hội thoại sắp xếp theo thời gian tin nhắn cuối, kèm số tin chưa đọc.
#### Luồng 3: Gửi và nhận tin nhắn
1. Client emit sự kiện message:send kèm conversation_id, nội dung, loại (TEXT/IMAGE/FILE).
2. Server kiểm tra người gửi có nằm trong participants không.
3. Lưu Message vào MongoDB, cập nhật last_message và updated_at của Conversation.
4. Phát tin nhắn tới tất cả socket đang ở trong room (message:new).
5. Kiểm tra người nhận có socket đang mở trong Redis không.
6. Nếu người nhận OFFLINE → publish sự kiện lên topic Kafka chat-events để Notification Service gửi push/email.
7. Nếu người nhận ONLINE nhưng không mở đúng hội thoại → chỉ tăng badge số tin chưa đọc, không gửi push.
#### Luồng 4: Gửi ảnh và file đính kèm
1. Client gọi File/Media Service lấy signed upload params (type = CHAT_ATTACHMENT).
2. Upload trực tiếp lên Cloudinary.
3. Emit message:send với type = IMAGE/FILE và nội dung là url + tên file + dung lượng.
4. Chat Service chỉ lưu url, KHÔNG lưu file thật.
#### Luồng 5: Trạng thái đã xem và đang nhập
1. Người nhận mở hội thoại → emit message:seen kèm id tin nhắn cuối cùng đã đọc.
2. Server cập nhật mảng seen_by của các tin nhắn liên quan và phát lại cho người gửi (message:seen).
3. Khi người dùng đang gõ → emit typing (throttle 2 giây), server broadcast tới người còn lại, không lưu database.

<!-- Page 31 -->

4. Sau 3 giây không gõ tiếp → phát sự kiện stop typing.
#### Luồng 6: Tải lịch sử hội thoại
1. Mở hội thoại → gọi REST GET /conversations/:id/messages lấy 30 tin mới nhất.
2. Cuộn lên → phân trang theo cursor (created_at của tin cũ nhất đang hiển thị), mỗi lần 30 tin.
3. Tìm kiếm trong hội thoại theo từ khoá (text index của MongoDB).

### 2. Tài liệu nghiệp vụ
### 2.1. Quy tắc nghiệp vụ (business rules)
- Chỉ hai người trong participants được đọc và gửi tin trong hội thoại đó.
- Không sửa tin đã gửi; chỉ được thu hồi trong vòng 5 phút (tin hiển thị "Tin nhắn đã thu hồi").
- Giới hạn chống spam: tối đa 20 tin trong 10 giây cho mỗi người dùng.
- Nội dung tin nhắn tối đa 2000 ký tự.
- File đính kèm tối đa 10MB, đi qua File/Media Service.
- Chỉ publish chat-events khi người nhận thật sự OFFLINE — tránh spam push khi họ đang mở app.
- Redis Adapter là bắt buộc để chạy được nhiều instance Chat Service.
- Không xoá lịch sử hội thoại khi đơn ứng tuyển kết thúc (giữ để đối soát).
### 2.2. Mô hình dữ liệu
- Conversation(_id, participants[], job_id, application_id, last_message, unread_count_map, created_at, updated_at)
- Message(_id, conversation_id, sender_id, content, type[TEXT|IMAGE|FILE], file_url, file_name, seen_by[], is_revoked, created_at)
- Redis: online:{user_id} → socket_id (dùng cho kiểm tra online/offline)
### 2.3. API chính
```text
 Endpoint                              Mô tả                                       Quyền truy cập
 socket: connect (JWT)                 Xác thực và mở kết nối                      Đã đăng nhập
 socket: message:send                  Gửi tin nhắn                                Thành viên hội thoại
 socket: message:new                   Nhận tin nhắn mới (server → client)         Thành viên hội thoại
 socket: message:seen                  Đánh dấu đã xem                             Thành viên hội thoại
 socket: typing / stop_typing          Trạng thái đang nhập                        Thành viên hội thoại
 GET /conversations                    Danh sách hội thoại                         Đã đăng nhập
 GET                                   Lịch sử tin nhắn (phân trang)               Thành viên hội thoại
 /conversations/:id/messages?cursor=
 POST /conversations                   Tạo hội thoại (nếu chưa có)                 Đã đăng nhập
```


### 2.4. Sự kiện Kafka
- PRODUCE topic chat-events khi người nhận đang offline.
- Payload gợi ý: { event_id, message_id, conversation_id, sender_id, sender_name, receiver_id, preview, occurred_at }.
- Consumer: Notification Service (cùng Người 3).
### 2.5. Phụ thuộc giữa các service
- Phụ thuộc: Auth (public key), File/Media (Người 1) cho đính kèm.

<!-- Page 32 -->

- Nếu muốn tự tạo hội thoại khi có đơn mới → có thể consume application-events (Người 2); nếu không thì tạo khi người dùng nhắn lần đầu (đơn giản hơn, khuyến nghị làm cách này trước).
### 2.6. Tiêu chí hoàn thành (Definition of Done)
- Hai trình duyệt khác nhau nhắn tin thấy nhau realtime.
- Trạng thái đã xem và đang nhập hoạt động.
- Gửi được ảnh/file qua Cloudinary.
- Người nhận offline thì nhận được push/email qua Notification.

<!-- Page 33 -->

## C3. Notification Service
```text
 Người phụ trách             Người 3
 Công nghệ                   NestJS (TypeScript) + Prisma, KafkaJS, BullMQ + Redis, Firebase Cloud Messaging,
                             Nodemailer
 Database                    PostgreSQL container riêng: notification-db (lưu log thông báo)
 Vai trò trong hệ thống      Trung tâm thông báo. Là service DUY NHẤT được gọi ra FCM và SMTP. Consume mọi
                             topic sự kiện của hệ thống.
 Phụ thuộc                   Kafka (application-events, interview-events, chat-events)
```


### 1. Luồng hoạt động các chức năng
#### Luồng 1: Tiếp nhận sự kiện và đưa vào hàng đợi
1. Consumer lắng nghe đồng thời 3 topic: application-events, interview-events, chat-events.
2. Với mỗi event: kiểm tra event_id đã xử lý chưa (chống trùng khi Kafka gửi lại).
3. Ánh xạ event sang loại thông báo và template nội dung tương ứng.
4. Xác định người nhận (ứng viên hay recruiter) và các kênh cần gửi (in-app, push, email).
5. Đẩy job vào hàng đợi BullMQ, tách hàng đợi riêng cho push và cho email.
6. Trả ack cho Kafka ngay sau khi đưa vào hàng đợi (không chờ gửi xong) để consumer không bị chậm.
#### Luồng 2: Worker xử lý và gửi thông báo
1. Tạo bản ghi Notification (in-app) với is_read = false.
2. Đẩy realtime tới client nếu người dùng đang mở app (qua kênh có sẵn hoặc polling nhẹ).
3. Gửi push qua FCM tới tất cả device token còn hiệu lực của người nhận.
4. Nếu FCM trả về token không hợp lệ → xoá token đó khỏi bảng DeviceToken.
5. Gửi email nếu loại thông báo thuộc nhóm quan trọng (lịch phỏng vấn, offer).
6. Gửi thất bại → BullMQ retry 3 lần với backoff tăng dần; vẫn lỗi thì ghi status = FAILED kèm lý do.
#### Luồng 3: Người dùng xem và quản lý thông báo
1. Mở trung tâm thông báo → GET /notifications phân trang, kèm số lượng chưa đọc.
2. Bấm vào một thông báo → đánh dấu đã đọc và điều hướng tới màn tương ứng (deep link theo payload).
3. Nút "Đánh dấu tất cả đã đọc".
4. Lọc theo loại thông báo.
#### Luồng 4: Quản lý thiết bị nhận push
1. Sau khi đăng nhập, client xin quyền thông báo và lấy FCM token.
2. Gọi POST /notifications/devices đăng ký token kèm loại thiết bị.
3. Đăng xuất → gọi DELETE để gỡ token.
4. Token trùng thì cập nhật thời điểm dùng gần nhất, không tạo bản ghi mới.
#### Luồng 5: Nhắc lịch phỏng vấn
1. Interview Service publish event REMINDER trước giờ hẹn 1 giờ (hoặc Notification tự lên lịch delayed job trong BullMQ khi nhận event SCHEDULED).
2. Worker gửi push + email nhắc kèm link phòng.
3. Nếu buổi phỏng vấn đã bị huỷ trước đó → huỷ luôn job nhắc trong hàng đợi.

### 2. Tài liệu nghiệp vụ
### 2.1. Quy tắc nghiệp vụ (business rules)

<!-- Page 34 -->

- Idempotent theo event_id — một sự kiện chỉ sinh đúng một thông báo dù Kafka gửi lại nhiều lần.
- Không gửi thông báo cho chính người đã tạo ra hành động đó (HR đổi trạng thái thì HR không nhận thông báo).
- Gộp thông báo tin nhắn: nhiều tin nhắn chưa đọc trong 5 phút từ cùng một người chỉ gửi 1 push ("Bạn có 5 tin nhắn mới").
- Email chỉ gửi cho nhóm quan trọng: lịch phỏng vấn (tạo/đổi/huỷ/nhắc) và offer. Các loại còn lại chỉ in-app + push.
- Người dùng có thể tắt từng kênh trong cài đặt (tối thiểu: bật/tắt email).
- Mọi thông báo đều lưu log để đối soát khi người dùng khiếu nại "không nhận được".
- Đây là service duy nhất giữ khoá FCM và thông tin SMTP.
### 2.2. Mô hình dữ liệu
- Notification(id, user_id, type, title, body, payload_json, channel[], is_read, created_at)
- DeviceToken(id, user_id, token, platform[WEB|ANDROID|IOS], last_used_at)
- NotificationLog(id, notification_id, channel, status[SENT|FAILED], error, sent_at)
- ProcessedEvent(event_id, topic, processed_at) — chống xử lý trùng
- NotificationSetting(user_id, email_enabled, push_enabled)
### 2.3. API chính
```text
 Endpoint                               Mô tả                                          Quyền truy cập
 GET /notifications?user_id=&page=      Danh sách thông báo                            Đã đăng nhập
 GET /notifications/unread-count        Số thông báo chưa đọc                          Đã đăng nhập
 PATCH /notifications/:id/read          Đánh dấu đã đọc                                Chủ thông báo
 PATCH /notifications/read-all          Đánh dấu tất cả đã đọc                         Chủ thông báo
 POST /notifications/devices            Đăng ký FCM token                              Đã đăng nhập
 DELETE /notifications/devices/:token   Gỡ FCM token                                   Đã đăng nhập
 PUT /notifications/settings            Bật/tắt kênh thông báo                         Đã đăng nhập
```


### 2.4. Sự kiện Kafka
- CONSUME: application-events (Người 2), interview-events (Người 3), chat-events (Người 3).
- Không produce event.
- Danh mục loại thông báo: APPLICATION_STATUS_CHANGED, OFFER_RECEIVED, INTERVIEW_SCHEDULED, INTERVIEW_RESCHEDULED, INTERVIEW_CANCELLED, INTERVIEW_REMINDER, NEW_MESSAGE, JOB_RECOMMENDATION.
### 2.5. Phụ thuộc giữa các service
- Phụ thuộc mạnh vào schema event của Người 2 (application-events) — chốt sớm nhất có thể.
- Cần tài khoản Firebase và SMTP dùng chung của nhóm.
### 2.6. Tiêu chí hoàn thành (Definition of Done)
- Đổi trạng thái đơn ở Application → ứng viên thấy thông báo in-app trong vài giây.
- Nhận được push trên trình duyệt.
- Email lịch phỏng vấn gửi được và có link phòng bấm vào được.
- Gửi lại cùng một event 2 lần chỉ sinh 1 thông báo.

<!-- Page 35 -->

## C4. Hạ tầng dùng chung
```text
 Người phụ trách             Người 3
 Phạm vi                     docker-compose tổng, Nginx API Gateway, Kafka (KRaft), Redis, Jitsi self-host, cấu hình
                             môi trường
 Vai trò trong hệ thống      Đảm bảo cả 11 service chạy được cùng lúc bằng một lệnh duy nhất và định tuyến
                             đúng.
 Thời điểm làm               Ngay tuần 1, song song với Notification Service
```


### 1. Luồng hoạt động các chức năng
#### Luồng 1: Dựng docker-compose tổng
1. Mỗi thành viên tự viết Dockerfile cho service của mình theo chuẩn thống nhất (base image, cổng, healthcheck).
2. Người 3 gộp thành một docker-compose.yml duy nhất: 10 container PostgreSQL riêng, mongo, kafka, redis, jitsi, 11 service, nginx, frontend.
3. Định nghĩa network chung và thứ tự khởi động (depends_on + healthcheck).
4. Chuẩn hoá biến môi trường: file .env chung ở gốc, mỗi service đọc biến của mình.
5. Viết file .env.example và README hướng dẫn chạy trong 3 lệnh.
#### Luồng 2: Cấu hình Nginx API Gateway
1. Định tuyến theo tiền tố đường dẫn tới đúng service phía sau (bảng dưới).
2. Cấu hình CORS thống nhất cho frontend.
3. Cấu hình proxy WebSocket riêng cho Chat Service (Upgrade header).
4. Giới hạn kích thước request (tránh upload lớn đi qua gateway).
5. Tổng hợp tài liệu OpenAPI của các service thành một trang chung (tuỳ chọn).
#### Luồng 3: Khởi tạo Kafka và các topic
1. Chạy Kafka ở chế độ KRaft (không cần Zookeeper).
2. Tạo sẵn 5 topic: job-events, cv-events, application-events, interview-events, chat-events (số partition và replication phù hợp môi trường dev).
3. Thống nhất quy ước đặt tên consumer group: {service-name}-group.
4. Cung cấp script hoặc UI (Kafka UI) để cả nhóm xem message khi debug.
#### Luồng 4: Dựng Jitsi self-host
1. Dùng docker-jitsi-meet, cấu hình domain nội bộ và cổng.
2. Bật xác thực bằng JWT để chỉ người có token mới vào được phòng.
3. Kiểm thử nhúng iframe từ frontend.
4. Nếu môi trường không chạy được Jitsi (giới hạn máy) → phương án dự phòng: dùng Jitsi public meet.jit.si với room name ngẫu nhiên, ghi rõ hạn chế trong báo cáo.

### 2. Tài liệu nghiệp vụ
### 2.1. Quy tắc nghiệp vụ (business rules)
- Toàn hệ thống phải khởi chạy được bằng: docker compose up -d.
- Không service nào được kết nối tới database của service khác — kiểm tra bằng cách rà biến môi trường.
- Mọi biến bí mật (API key, SMTP, Cloudinary, Claude) chỉ nằm trong .env, không commit lên repo.
- Cổng dịch vụ cố định và ghi rõ trong README để cả nhóm không đụng nhau.

<!-- Page 36 -->

### 2.2. Mô hình dữ liệu
- Bảng định tuyến Nginx (tham khảo): /auth → auth-service · /profile → profile-service · /files → file-service · /companies → company-service · /jobs → job-search-service · /applications, /bookmarks, /offers → application-service · /interviews → interview-video-service · /socket.io → chat-service · /conversations → chat-service · /notifications → notification-service · /ai → ai-service · /admin → admin-stats-service
### 2.3. Sự kiện Kafka
- Tạo và quản lý toàn bộ 5 topic Kafka của hệ thống.
### 2.4. Phụ thuộc giữa các service
- Cần Dockerfile từ cả 3 thành viên trước khi gộp compose.
### 2.5. Tiêu chí hoàn thành (Definition of Done)
- Một lệnh docker compose up khởi động toàn hệ thống, tất cả healthcheck xanh.
- Gọi được cả 11 service qua gateway bằng một địa chỉ duy nhất.
- 5 topic Kafka tồn tại và xem được message.
- README hướng dẫn chạy dự án từ máy trắng.

<!-- Page 37 -->

# VI. LUỒNG NGHIỆP VỤ XUYÊN SERVICE (END-TO-END)
Ba kịch bản dưới đây là bài kiểm thử tích hợp bắt buộc. Nếu cả ba chạy thông suốt thì hệ thống coi như ghép nối thành công.

### 6.1. Kịch bản 1: Ứng viên từ đăng ký đến nhận kết quả
```text
 Bước   Vai trò          Hành động                                        Service · Người phụ trách
 1      Ứng viên         Đăng ký tài khoản, nhận và nhập OTP qua email    Auth · Người 1
 2      Ứng viên         Điền hồ sơ: học vấn, kinh nghiệm, kỹ năng        Profile · Người 1
 3      Ứng viên         Upload CV PDF lên Cloudinary                     File/Media + Profile · Người 1
 4      Hệ thống         Phát cv-events, tính embedding CV                Kafka → AI · Người 1 → Người 2
 5      Ứng viên         Tìm kiếm việc làm theo từ khoá và bộ lọc         Job & Search · Người 2
 6      Hệ thống         Hiển thị mục Việc làm phù hợp với bạn            AI → Job & Search · Người 2
 7      Ứng viên         Lưu việc yêu thích                               Application (Bookmark) · Người 2
 8      Ứng viên         Bấm Ứng tuyển, chọn CV, viết cover letter        Application · Người 2
 9      Hệ thống         Phát application-events, gửi thông báo cho HR    Kafka → Notification · Người 2 →
                                                                          Người 3
 10     HR               Xem hồ sơ, đánh giá, chuyển sang REVIEWING rồi   Application · Người 2
                         INTERVIEW
 11     HR               Đặt lịch phỏng vấn, hệ thống sinh phòng Jitsi    Interview & Video · Người 3
 12     Hệ thống         Gửi email + push kèm link phòng cho ứng viên     Notification · Người 3
 13     Hai bên          Nhắn tin trao đổi trước buổi phỏng vấn           Chat · Người 3
 14     Hai bên          Vào phòng, phỏng vấn qua video                   Interview & Video · Người 3
 15     HR               Ghi đánh giá, kết luận Đạt                       Interview & Video · Người 3
 16     HR               Gửi Offer kèm lương và ngày bắt đầu              Application · Người 2
 17     Ứng viên         Nhận thông báo offer, chấp nhận                  Notification + Application · Người
                                                                          3, 2
 18     Hệ thống         Đơn chuyển HIRED, cập nhật số liệu thống kê      Application → Admin · Người 2
                                                                          → Người 1
```


### 6.2. Kịch bản 2: Nhà tuyển dụng từ lập công ty đến tuyển được người
```text
 Bước   Vai trò          Hành động                                        Service · Người phụ trách
 1      Recruiter        Đăng ký tài khoản nhà tuyển dụng                 Auth · Người 1
 2      Recruiter        Tạo hồ sơ công ty, upload logo và ảnh            Company + File/Media · Người 2,
                                                                          1
 3      Admin            Duyệt hồ sơ công ty                              Admin → Company · Người 1 →
                                                                          Người 2
 4      Recruiter        Mời đồng nghiệp vào công ty                      Company · Người 2
 5      Recruiter        Soạn tin tuyển dụng, lưu nháp rồi gửi duyệt      Job & Search · Người 2
 6      Admin            Duyệt tin, tin chuyển PUBLISHED                  Admin → Job · Người 1 → Người
                                                                          2
```

<!-- Page 38 -->

```text
Bước   Vai trò      Hành động                                           Service · Người phụ trách
7      Hệ thống     Index tin lên Elasticsearch, phát job-events        Job & Search → AI · Người 2
8      Recruiter    Nhận đơn ứng tuyển, lọc theo điểm phù hợp           Application + AI · Người 2
9      Recruiter    Đặt lịch phỏng vấn nhiều vòng                       Interview & Video · Người 3
10     Recruiter    Xem dashboard: số đơn, tỷ lệ chuyển đổi, nguồn      Application · Người 2
                    ứng viên
11     Recruiter    Đóng tin khi tuyển đủ                               Job & Search · Người 2
```


### 6.3. Kịch bản 3: Quản trị viên vận hành hệ thống
```text
Bước   Vai trò      Hành động                                           Service · Người phụ trách
1      Admin        Xem hàng chờ duyệt công ty và tin tuyển dụng        Admin · Người 1
2      Admin        Duyệt hoặc từ chối kèm lý do                        Admin → Company/Job · Người 1
                                                                        → Người 2
3      Người dùng   Báo cáo một tin tuyển dụng vi phạm                  Admin · Người 1
4      Admin        Xử lý báo cáo, gỡ tin, khoá tài khoản vi phạm       Admin → Job/Auth · Người 1
5      Hệ thống     Thu thập event từ Kafka, tổng hợp số liệu hằng      Admin · Người 1
                    ngày
6      Admin        Xem dashboard toàn hệ thống và xuất báo cáo Excel   Admin · Người 1
```

<!-- Page 39 -->

# VII. LỘ TRÌNH TRIỂN KHAI THEO TUẦN
```text
 Giai đoạn      Người 1                           Người 2                           Người 3
 Ngày 1–3 (cả   Chốt payload JWT, cấu trúc lỗi    Chốt schema job-events và         Dựng repo chung, chốt danh
 nhóm)          chung, tạo tài khoản              application-events, dựng          sách Kafka topic, quy ước
                Cloudinary                        skeleton 4 service                Dockerfile
 Tuần 1         Auth Service hoàn chỉnh (ưu       Company Service + phần CRUD       docker-compose khung, Kafka,
                tiên tuyệt đối) + File/Media      của Job Service                   Nginx gateway, Notification
                Service                                                             khung
 Tuần 2         User/Profile Service + CV         Tìm kiếm Elasticsearch +          Interview & Video Call Service
                Builder, publish cv-events        Application Service (state        + Chat Service
                                                  machine)
 Tuần 3         Admin & Statistics Service,       AI Service: embedding, gợi ý      Notification hoàn chỉnh (FCM +
                consume Kafka, export Excel       việc làm, chatbot                 email), Jitsi self-host
 Tuần 4         Hoàn thiện Admin Dashboard,       Dashboard recruiter, tối ưu tìm   Gộp docker-compose tổng,
                kiểm thử phân quyền               kiếm                              chạy 3 kịch bản end-to-end
 Tuần 5         Sửa lỗi tích hợp, viết tài liệu   Sửa lỗi tích hợp, viết tài liệu   Kiểm thử toàn hệ thống,
                phần của mình                     phần của mình                     chuẩn bị demo
```


Quy tắc chống nghẽn: nếu Auth Service chậm quá 5 ngày, Người 2 và Người 3 tạm dùng một JWT giả (fake token có cùng payload) để không bị chặn, và thay bằng verify thật khi Auth xong.

<!-- Page 40 -->

# VIII. CÁC ĐIỂM CẦN CHỐT TRƯỚC KHI CODE
Sáu điểm dưới đây là chỗ hai tài liệu đầu vào (tài liệu kiến trúc và tài liệu phân tích nghiệp vụ) chưa khớp nhau, hoặc chưa có service nào sở hữu. Cần quyết định trước, nếu không sẽ phát sinh việc giữa chừng và phá vỡ cân bằng phân công.
```text
 #    Vấn đề                     Mô tả                                        Đề xuất xử lý
 1    Trợ lý AI phỏng vấn (mục   Yêu cầu AI đọc CV ứng viên và tự tương       Cắt khỏi phạm vi bản 1. Nếu vẫn
      2.13 tài liệu nghiệp vụ)   tác phỏng vấn. Tài liệu kiến trúc KHÔNG      làm: giao AI Service (Người 2) và
                                 có service nào phụ trách chức năng này.      chuyển Company Service sang
                                 Đây là hạng mục nặng nhất trong toàn         Người 1 để cân lại khối lượng.
                                 bộ yêu cầu.
 2    Công nghệ video call       Tài liệu nghiệp vụ ghi Google Meet, tài      Chọn Jitsi: tạo phòng theo
                                 liệu kiến trúc chốt Jitsi self-host.         application_id, nhúng iframe, không
                                                                              cần quyền domain Google. Google
                                                                              Meet cần Calendar API và tài khoản
                                                                              Workspace.
 3    Dashboard của Recruiter    Tài liệu nghiệp vụ có dashboard riêng cho    Đặt thống kê recruiter trong
                                 nhà tuyển dụng, nhưng kiến trúc chỉ có       Application Service (Người 2).
                                 Admin & Statistics Service.                  Admin Service chỉ lo thống kê toàn
                                                                              hệ thống cho quản trị viên.
 4    Chỉ số nguồn ứng viên      Dashboard yêu cầu thống kê nguồn ứng         Thêm trường source vào bảng
                                 viên nhưng không có trường dữ liệu nào       Application, ghi lúc nộp đơn
                                 ghi lại nguồn.                               (SEARCH, AI_RECOMMEND,
                                                                              COMPANY_PAGE, SHARED_LINK).
 5    Deadline và tin hết hạn    Tài liệu nghiệp vụ có trường Deadline,       Thêm deadline vào bảng Job; Người
                                 mô hình Job trong kiến trúc chưa có;         2 viết scheduler chạy mỗi giờ
                                 trạng thái EXPIRED cần job quét định kỳ.     chuyển tin quá hạn sang EXPIRED và
                                                                              gỡ khỏi Elasticsearch.
 6    Gửi Offer                  Hiện chỉ là một giá trị trong enum trạng     Tách bảng Offer riêng gắn với
                                 thái, nhưng nghiệp vụ cần lương, ngày        application_id (đã đưa vào mô hình
                                 bắt đầu, file offer letter và phản hồi của   dữ liệu của Application Service ở
                                 ứng viên.                                    mục B3).
```

<!-- Page 41 -->

# IX. CHECKLIST NGHIỆM THU CHUNG
### 9.1. Với mỗi service (áp dụng cho cả 3 người)
- Có Dockerfile chạy được độc lập và khai báo healthcheck.
- Có Swagger/OpenAPI đầy đủ cho mọi endpoint công khai.
- Có Postman collection để hai người còn lại thử API mà không cần đọc code.
- Có file .env.example liệt kê đủ biến môi trường (không chứa giá trị bí mật thật).
- Kết nối đúng database riêng của mình, không đụng database service khác.
- Verify JWT bằng public key, chặn đúng theo role.
- Trả lỗi theo cấu trúc { code, message, details } đã thống nhất.
- Ghi log có mức độ (info/warn/error) và có request id để truy vết xuyên service.
- Producer Kafka gửi kèm event_id; consumer Kafka xử lý idempotent.

### 9.2. Với toàn hệ thống
- docker compose up -d khởi động toàn bộ 11 service + hạ tầng, tất cả healthcheck xanh.
- Gọi được mọi service qua một địa chỉ gateway duy nhất.
- Ba kịch bản end-to-end ở chương V chạy thông suốt.
- Tắt thử một service không cốt lõi (ví dụ AI Service) thì các luồng còn lại vẫn hoạt động (có fallback).
- Tắt Kafka thử: hệ thống không chết, event được gửi lại khi Kafka trở lại.
- Có README hướng dẫn chạy dự án từ máy trắng trong dưới 15 phút.

### 9.3. Quy tắc phối hợp nhóm
- Không sửa code trong service của người khác — phát hiện lỗi thì báo, không tự vá.
- Thay đổi hợp đồng API hoặc schema event phải báo trước ít nhất 1 ngày và cập nhật vào tài liệu này.
- Họp ngắn 15 phút mỗi ngày: hôm qua làm gì, hôm nay làm gì, đang bị chặn ở đâu.
- Mỗi cuối tuần ghép nối thử một lần, không để dồn tới tuần cuối.
- Người bị chặn quá nửa ngày phải báo ngay, không tự chờ.
