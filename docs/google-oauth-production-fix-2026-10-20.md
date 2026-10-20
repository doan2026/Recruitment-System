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

Bản sửa repo **chưa tự động được áp dụng lên server**. Chép file
`infra/nginx/nginx.prod.conf` mới vào đường dẫn tương ứng của thư mục triển khai
`/home/ubuntu/careerhub` (theo workflow hiện tại), rồi chạy trên server:

```sh
cd /home/ubuntu/careerhub
docker compose -f docker-compose.prod.yml exec -T api-gateway nginx -t
# Chỉ chạy reload khi kiểm tra cú pháp phía trên thành công.
docker compose -f docker-compose.prod.yml exec -T api-gateway nginx -s reload
```

Nếu thay file bằng công cụ tạo inode mới, bind mount file cũ có thể chưa đổi;
khi đó recreate riêng gateway sau khi đã cập nhật file trên host:

```sh
docker compose -f docker-compose.prod.yml up -d --no-deps --force-recreate api-gateway
```

Không cần build lại các image ứng dụng cho bản sửa định tuyến này. Sau khi áp
dụng, bắt đầu đăng nhập Google mới từ đúng cổng Candidate/Recruiter; code cũ đã
đổi không thể dùng lại. Kiểm tra trang hồ sơ vẫn đăng nhập sau reload. Không gửi
giá trị cookie/token hoặc OAuth code khi báo kết quả.
