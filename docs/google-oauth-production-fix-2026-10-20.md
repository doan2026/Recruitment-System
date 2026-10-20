# Google đăng nhập xong nhưng trang hồ sơ yêu cầu đăng nhập lại

Ngày kiểm tra: 20/10/2026, GMT+7. Domain: `https://doantvv.ddns.net`.

## Nguyên nhân đã xác định

Trình duyệt gọi `/auth/google/exchange` để đổi code một lần từ Google thành phiên
CareerHub. Next route tại đường dẫn này gọi Auth, tạo `careerhub_token` và
`careerhub_refresh` dạng HttpOnly, rồi chỉ trả thông tin user về JavaScript.

Nginx production có `location /auth/` chuyển tới Auth. Khi không có ngoại lệ chính
xác cho exchange, request công khai bỏ qua Next và nhận response token trực tiếp
từ Spring. Callback vẫn có thể đọc user và chuyển trang, nhưng cookie đăng nhập
CareerHub chưa được tạo. Trang riêng tư sau đó không nhận diện được phiên.

Kiểm tra công khai với payload rỗng, không dùng tài khoản/code/secret thật:

- `GET /auth/callback`: HTTP 200, HTML Next trên server tại thời điểm kiểm tra.
- `POST /auth/google/exchange` với code rỗng: HTTP 400, body có
  `code/message/details`, tương ứng response trực tiếp của Auth.
- `POST /api/auth-cookie/verify` với dữ liệu rỗng: HTTP 400, body chỉ có `code`,
  tương ứng lớp cookie proxy Next hiện có.

Điều này xác nhận exchange công khai đang bỏ qua lớp tạo cookie. File cấu hình
trong repo cũng cần khai báo riêng `/auth/callback` để trang này không bị route
`/auth/` của Spring che khuất khi triển khai lại.

## Thay đổi

Trong `infra/nginx/nginx.prod.conf`:

| Request | Đích |
| --- | --- |
| HTTPS 443 `/auth/callback` | Trang callback Next |
| HTTPS 443 `/auth/google/exchange` | Cookie proxy Next |
| HTTP nội bộ 8080 `/auth/google/exchange` | Auth Service |
| Các route Google authorization/provider callback | Auth Service như trước |

Phải phân biệt hai chặng exchange. Nếu cả HTTPS và HTTP nội bộ đều chuyển tới
Next, cookie proxy sẽ gọi ngược chính nó qua gateway và tạo vòng lặp. Cổng 8080
chỉ phục vụ trong mạng Docker, không publish ra host trong Compose production.

Không thay đổi logic tài khoản, role, state/binder một lần, JWT hoặc dữ liệu DB.

## Kiểm chứng

Đã chạy **28/28 test đạt** trên desktop/mobile:

- 18 test hiện có về cookie login/refresh/logout, OTP, binder Google và WebSocket.
- 10 test mới với **nginx production thật + TLS thật + Next cookie proxy thật**;
  Auth dùng fixture, không gọi Google hoặc dùng credential cloud.
- Google exchange công khai tạo Secure/HttpOnly cookie, không trả token về JS.
- Candidate/Recruiter đọc lại `/api/auth/me` đúng role.
- Candidate mở trang hồ sơ và reload vẫn giữ phiên.
- Callback thuộc Next; authorization vẫn thuộc Auth; exchange nội bộ tới Auth
  đúng một lần, không lặp qua Next.
- `nginx -t` đạt cho cấu hình fixture dựa trực tiếp trên file production.
- TypeScript typecheck đạt.

Tái chạy từ `frontend` khi Docker, Chrome và OpenSSL đã sẵn sàng:

```powershell
$env:PRODUCTION_PROXY_TEST='1'
npx.cmd playwright test tests/e2e/production-google-proxy.spec.ts tests/e2e/auth-cookie-proxy.spec.ts
npm.cmd run typecheck
```

Fixture dùng container/port riêng và tự dọn container. Chứng thư tự ký thử nằm
trong `.cache` bị Git bỏ qua. Trên Windows, test mặc định dùng OpenSSL của Git;
có thể đặt `OPENSSL_BIN` nếu cài ở vị trí khác.

## Áp dụng lên server

Release `v1.0.9` (`56b4988`, chứa commit `91b69ea`) đã được workflow deploy báo
thành công: https://github.com/vuongptit/Recruitment-System/actions/runs/39372046817.
Tuy nhiên, lần kiểm tra domain sau đó vẫn nhận callback có
`Cache-Control: s-maxage=31536000, stale-while-revalidate` và exchange lỗi có đủ
`code/message/details`. Đây là dấu hiệu cấu hình đang phục vụ chưa dùng location
mới. Chưa có SSH để xác định chắc chắn là mount/master nginx cũ hay domain đang
trỏ tới instance khác; không thể kết luận chỉ từ trạng thái xanh của workflow.

Trên server, xác nhận file `infra/nginx/nginx.prod.conf` đã chứa location exchange
và map theo cổng của bản sửa, sau đó kiểm tra cấu hình từ mount mới:

```sh
cd /home/ubuntu/careerhub
docker compose -f docker-compose.prod.yml run --rm --no-deps -T api-gateway nginx -t
```

Nếu kiểm tra đạt, recreate riêng gateway để dùng file cấu hình trên host và master
nginx mới. Thao tác này có thể làm gián đoạn web ngắn; không xóa volume hoặc DB:

```sh
docker compose -f docker-compose.prod.yml up -d --no-deps --force-recreate api-gateway
docker compose -f docker-compose.prod.yml exec -T api-gateway nginx -t
```

Riêng bản sửa nginx không cần build image ứng dụng. Phần bảo vệ frontend bổ sung
bên dưới cần build và triển khai image frontend mới. Sau khi áp dụng, bắt đầu
đăng nhập Google mới từ đúng cổng Candidate/Recruiter; code cũ đã
đổi không thể dùng lại. Kiểm tra trang hồ sơ vẫn đăng nhập sau reload. Không gửi
giá trị cookie/token hoặc OAuth code khi báo kết quả.

## Kiểm tra hợp đồng token và cookie ở frontend

- Spring `GoogleOAuthController` trả `AuthTokenResponse` gồm access/refresh token
  và user cho chặng nội bộ. Auth vẫn là nơi duy nhất phát hành JWT.
- Next route `/auth/google/exchange` gọi `proxyAuthCookie`, nhận token phía server
  rồi trả JSON `{data:{user},meta:null}`. JavaScript không cần nhận JWT.
- `careerhub_token`: HttpOnly, SameSite=Lax, Path=/, Secure khi HTTPS.
- `careerhub_refresh`: HttpOnly, SameSite=Lax, Path=/api/auth-cookie, Secure khi
  HTTPS. Refresh/logout đọc cookie phía server. Không lưu token ở localStorage
  hoặc sessionStorage; tùy chọn nhớ email chỉ lưu email.
- Request dùng `credentials: include`; Next middleware chuyển access cookie thành
  Authorization nội bộ khi gọi `/api/*`.
- Trước đây callback chỉ đọc được user là chuyển trang, kể cả response Auth trả
  token trực tiếp vì gateway route sai. Nay `exchangeGoogle` từ chối response chứa
  token; sau response user-only, nó gọi cùng origin `/api/auth/me` để xác nhận
  cookie hoạt động và id/role khớp rồi mới tạo trạng thái đăng nhập và chuyển trang.
- Không tự refresh hoặc gửi lại exchange code đã dùng. Cookie không dùng được,
  account/role không khớp hoặc gateway route sai đều giữ callback và báo lỗi.

Đây là kiểm tra bổ sung để không báo thành công giả. Nó không thay thế việc áp
dụng cấu hình gateway đúng trên domain production. Chưa kiểm tra đăng nhập Google
trực tiếp với tài khoản người dùng trên production trong lần audit này.

### Kết quả kiểm tra bổ sung

- `npm.cmd test`: **151/151 đạt**; `npm.cmd run typecheck`: đạt.
- **54 ca trình duyệt đạt** trên desktop/mobile, gồm các ca callback Google và
  cookie proxy. Test mới dùng Next thật, Auth fixture: exchange đúng một lần,
  cookie HttpOnly, `/api/auth/me` qua middleware, vào hồ sơ và reload giữ phiên.
- Các ca lỗi mới xác nhận không chuyển trang khi nhận raw token response, không
  có cookie hợp lệ, sai account/role hoặc chưa xác nhận xong phiên.
- Lượt chạy có bật `PRODUCTION_PROXY_TEST=1` không hoàn tất nhóm TLS: Docker
  Desktop daemon không khả dụng (`dockerDesktopLinuxEngine` không tồn tại), khiến
  setup TLS thất bại trên 2 project và 8 ca còn lại không chạy. Đây không phải kết
  quả TLS đạt cho bản frontend mới; kết quả 28/28 phía trên thuộc lượt kiểm tra
  nginx trước đó. Không tự bật toàn bộ stack Docker trong lần audit bổ sung.

### Chạy lại trên Docker local sau khi người dùng bật Docker

- **30/30 ca đạt** trong `production-google-proxy.spec.ts` và
  `auth-cookie-proxy.spec.ts`, gồm Nginx production/TLS thật, Next thật và Auth
  fixture; cookie Secure/HttpOnly, user-only response, Candidate/Recruiter identity,
  callback và reload giữ phiên. Container fixture được dọn sau kiểm tra.
- Đã build lại image `recruitment-system-frontend` từ commit `bc6528b`, recreate
  riêng frontend bằng Compose chính và chờ healthy tại `http://localhost:3000`.
  Không thay image/source các backend hoặc xóa volume.
- Bộ fixture hệ thống cũ không còn trong DB local hiện tại. Đã tạo ba tài khoản
  fixture mới, mật khẩu ngẫu nhiên bcrypt cost 10; không đổi tài khoản có sẵn.
  Credential chỉ nằm trong file ignored `.cache/google-local-accounts-20261020.json`.
- Smoke Chrome với **backend Compose thật đạt 15 bước**: login UI ba vai trò,
  JSON chỉ có user, HttpOnly cookies, reload, khôi phục access cookie bằng refresh,
  logout và `/api/auth/me` trả 401 sau logout; exchange code rỗng đi qua Next;
  Candidate/Recruiter redirect tới Google với callback localhost đúng.
- Smoke chờ trang tải xong trước khi chủ động xóa access cookie để thử refresh;
  không kiểm chứng phối hợp refresh giữa nhiều tab hoặc reload giữa request đang
  xoay refresh token.
- Kiểm tra cuối: frontend, gateway và các HTTP backend có healthcheck đều healthy.
  Hai worker AI embedding đang restarting; không thuộc luồng đăng nhập đang kiểm
  thử, chưa xử lý hoặc xác nhận chức năng embedding trong lượt này.
- Chưa tự thực hiện bước chọn tài khoản/chấp thuận tại Google bằng tài khoản thật.
  Người dùng có thể thử tại `/login` hoặc `/recruiter/login` trên cổng 3000, rồi
  reload trang sau khi đăng nhập. Kết quả local không xác nhận cấu hình trên domain
  production đã được cập nhật.
