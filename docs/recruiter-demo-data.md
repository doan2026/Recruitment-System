# Dữ liệu mẫu nhà tuyển dụng cho Docker local

Lệnh seed tại thư mục gốc repository:

```powershell
# Xem số lượng, chưa thay dữ liệu
node scripts/seed-recruiter-demo.cjs

# Tạo dữ liệu trên Docker local đang chạy
node scripts/seed-recruiter-demo.cjs --apply-local
```

Script chỉ kết nối gateway `127.0.0.1:8080` và kiểm tra Docker engine local.
Cần Compose PostgreSQL, Auth, Company, Media, Admin và Job Search đang hoạt động,
Cloudinary đã cấu hình, Chrome, dependencies frontend và JDK 17 trở lên. Thư viện
Spring Security Crypto 6.x được tìm trong Maven cache sau khi build Auth; có thể
chỉ định đường dẫn jar bằng `SPRING_SECURITY_CRYPTO_JAR`.

## Nội dung

| Công ty hư cấu (Demo) | Nhà tuyển dụng | Email đăng nhập | Tin đang tuyển |
| --- | --- | --- | --- |
| An Việt Digital | Nguyễn Minh Anh | recruiter01@demo.careerhub.test | 4 |
| Mây Xanh Cloud | Trần Hoàng Nam | recruiter02@demo.careerhub.test | 5 |
| Lúa Vàng Commerce | Lê Thùy Linh | recruiter03@demo.careerhub.test | 3 |
| Bắc Nam Logistics | Phạm Đức Huy | recruiter04@demo.careerhub.test | 4 |
| Sao Mai Learning | Vũ Ngọc Hà | recruiter05@demo.careerhub.test | 5 |
| Ánh Dương Health | Đặng Thanh Tâm | recruiter06@demo.careerhub.test | 3 |
| Thành Phố Xanh Energy | Bùi Gia Bảo | recruiter07@demo.careerhub.test | 4 |
| Nét Việt Studio | Đỗ Mai Phương | recruiter08@demo.careerhub.test | 5 |
| Sông Hàn Travel | Hoàng Hải Yến | recruiter09@demo.careerhub.test | 3 |
| Bình Minh Foods | Trương Quốc Khánh | recruiter10@demo.careerhub.test | 4 |
| **Tổng** | **10 tài khoản OWNER** | | **40** |

- Tài khoản có email, mật khẩu BCrypt cost 10, role RECRUITER, trạng thái email
  đã xác minh và tên/số điện thoại nhà tuyển dụng trong Auth. Đây là các trường
  hồ sơ nhà tuyển dụng mà hệ thống hiện hỗ trợ; không tạo hồ sơ ứng viên cho họ.
- Công ty có tên, mô tả, lĩnh vực, quy mô, địa chỉ, website, mã số thuế mẫu,
  logo riêng và hai hình minh họa về môi trường làm việc/quyền lợi. Toàn bộ 30
  hình được dựng từ SVG rồi tải lên Cloudinary qua Company/Media Service.
- Tin có mô tả trách nhiệm, yêu cầu, quyền lợi, khoảng lương VND, địa điểm,
  hình thức, kinh nghiệm, số lượng, kỹ năng và hạn nộp 60–88 ngày sau ngày seed.
  Có cả vị trí thực tập và làm từ xa. Tất cả tin thuộc đúng công ty tương ứng.
- Các tên, thông tin liên hệ, mã số thuế, email `.test` và website `.example`
  là hư cấu. Nhãn Demo và mô tả ghi rõ đây là dữ liệu thử local; không gửi OTP,
  email tuyển dụng hoặc liên hệ đến các địa chỉ/số điện thoại mẫu.

## Quy trình và khả năng chạy lại

Chỉ bước tạo tài khoản email mẫu dùng SQL vào Auth, vì email `.test` không nhận
OTP. SQL không cập nhật tài khoản trùng, không đặt lại mật khẩu tài khoản có sẵn.
Các bước tiếp theo dùng API thật:

1. Đăng nhập và cập nhật tên/số điện thoại nhà tuyển dụng.
2. Tạo công ty và OWNER membership bằng Company Service.
3. Xin chữ ký upload, upload Cloudinary, confirm và gắn media vào hồ sơ.
4. Admin local duyệt công ty từ PENDING sang VERIFIED.
5. Nhà tuyển dụng tạo tin DRAFT, gửi PENDING_APPROVAL; Admin duyệt PUBLISHED.
6. Kiểm tra hồ sơ công khai, logo/gallery, danh sách công ty và tất cả tin qua
   bộ lọc `companyId`, chờ Elasticsearch cập nhật trước khi báo hoàn tất.

Script dùng Admin test có sẵn trong file ignored
`.cache/google-local-accounts-20261020.json` hoặc `.cache/system-accounts.json`.
Ở checkout khác, đặt `DEMO_ADMIN_EMAIL`/`DEMO_ADMIN_PASSWORD` cho một tài khoản
Admin local đã có. Script không tạo Admin hay thay đổi phân quyền hiện tại.

Checkpoint lưu tại `.cache/recruiter-demo/manifest.json`. Chạy lại sẽ dùng đúng
10 tài khoản, công ty và tin đã ghi nhận, không tạo thêm ảnh đã attach hoặc tin
cùng tên. Không mở lại tin đã đóng/hết hạn và không sửa nội dung tin đã có.
Không xóa manifest khi muốn tiếp tục lượt seed bị gián đoạn.

## Đăng nhập và xem dữ liệu

- Nhà tuyển dụng: http://localhost:3000/recruiter/login
- Công ty dành cho ứng viên: http://localhost:3000/candidate/companies
- Mật khẩu chung sinh ngẫu nhiên và bảng tài khoản nằm trong
  [accounts.md](../.cache/recruiter-demo/accounts.md) và
  [accounts.csv](../.cache/recruiter-demo/accounts.csv) sau khi seed hoàn tất.
  Có thể đặt `RECRUITER_DEMO_PASSWORD` trước lần chạy đầu nếu muốn tự chọn.
- Các file chứa credential và ảnh tạo ra nằm trong `.cache` đã được Git ignore.
  Không có API key, mật khẩu hay token được ghi vào source hoặc log.

## Kết quả thực thi ngày 22/10/2026 (GMT+7)

- Đã seed vào Docker local đang chạy, không cần build lại service.
- Đã chạy lại seed: PostgreSQL vẫn có đúng 10 tài khoản demo với contact đầy đủ,
  10 OWNER membership, 10 công ty VERIFIED, 10 logo, 20 ảnh gallery và 40 tin
  PUBLISHED còn hạn trong bộ dữ liệu này.
- Chrome đăng nhập thực tế cả 10 tài khoản qua HttpOnly cookie; xem được hồ sơ
  công ty, quyền OWNER, đúng 3–5 tin quản lý và giữ phiên sau reload.
- Chrome phía ứng viên xem đủ 10 công ty công khai, đúng tin của từng công ty,
  cả 30 ảnh Cloudinary tải thành công; kiểm tra desktop/mobile và mở chi tiết
  tin với `source=COMPANY_PAGE` đạt.
- Không thay mã backend, cấu hình secret hay tạo commit. Dữ liệu ngoài bộ Demo
  được giữ nguyên. Các ảnh/log kiểm tra nằm trong `.cache/recruiter-demo` và
  `.cache/recruiter-demo-browser-20261022.log`.
