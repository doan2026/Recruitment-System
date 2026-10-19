# UX Contract

## Product context

- Audience: Candidate, Recruiter và Admin; các luồng FE của cả ba người theo tài liệu phân công.
- Primary jobs: tìm việc, ứng tuyển, theo dõi hồ sơ; quản lý công ty, tin, pipeline và offer.
- Target market: Việt Nam.
- Active locales: `vi-VN`.
- Language/content register: ngắn, trực tiếp, chuyên nghiệp; cần review tiếng Việt trước release.
- Timezone/calendar policy: hiển thị ngày theo `vi-VN`; date-only không tự đổi timezone.
- Accessibility target: WCAG 2.2 AA.

## Business-context sources

| Domain / scope | Authoritative source | Source type | Reviewed date |
|---|---|---|---|
| Phân công và permission | `Phan-cong-cong-viec-He-thong-tuyen-dung.md` | Phân công / permission evidence | 2026-08-30 |
| Trạng thái và endpoint | `TIEN_DO_DU_AN.md` P16.N2 | API/domain inventory | 2026-08-30 |
| Kiến trúc frontend | `Kien_truc_service_va_cong_nghe.md` | Architecture | 2026-08-30 |
| Nghiệp vụ | Tài liệu phân tích nghiệp vụ/chức năng tại project root | Domain specification | 2026-08-30 |
| Visual direction | `stitch_ui_ux_design_document_clone.zip` | Design reference | 2026-08-30 |

## Visual contract

- Project `DESIGN.md`: `DESIGN.md`.
- Token ownership model: existing runtime CSS variables are canonical; DESIGN.md mirrors them.
- Runtime source: `frontend/app/globals.css`.
- Mapping: DESIGN colors/rounded/spacing → CSS custom properties → shared CSS component classes.
- Token drift gate: DESIGN lint, strict UI audit and production build.
- Supported themes: light; forced-colors fallback.

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Select/Listbox | Native select baseline | UX contract | native | keyboard + browser popup |
| Date | Native date baseline | UX contract | native | locale + keyboard |
| Form | Shared `.field`/form policy | UX contract | create / edit | validation + build |
| Scrollbar | `frontend/app/globals.css` | DESIGN.md | stable gutter | computed style |
| CRUD | Route + `frontend/lib/person2Api.ts` | P16.N2 + BE DTO | explicit demo / gateway | API unit + browser API-mock E2E |
| Optimistic conflict | `frontend/lib/conflictRecovery.ts` + `ConflictRecoveryPanel` | P16.N2 | Company / Job / Application | API unit + consumer flow |
| Confirmation dialog | `frontend/components/ConfirmationDialog.tsx` | UX contract | warning / danger | keyboard + focus + build |

## Component behavior

| Component | Default | Hover | Focus | Active | Disabled | Busy | Error |
|---|---|---|---|---|---|---|---|
| Button | intent + label | tonal change | green ring | 1px press | dim/no pointer | stable label/indicator | inline/persistent |
| Input | labeled | darker border | green ring | n/a | dim | reserved adornment | text + aria association |
| Search | clear + 300ms remote debounce | border | green ring | n/a | dim | reserved status | no-results/retry |
| Textarea | resize none | darker border | green ring | n/a | dim | stable form | text + aria association |
| Table/list | bounded | row tint | control focus | n/a | n/a | stable loading region | retry/empty/no-results |

## Dataset navigation

- Recruiter-owned `/jobs/mine`: client filter/page because API trả toàn bộ mảng.
- Candidate search: form chỉ áp criteria sau submit; giữ `q/location/salary/skills/experience/jobType/sort/limit` xuyên suốt cursor chain, append khử trùng theo id; đổi criteria/mode/limit xóa cursor. OFFSET dừng trước cửa sổ 10.000 và cho chuyển CURSOR hoặc focus về filter.
- Public Company search: giữ signed cursor trong memory, khóa `q`/`limit` khi đang tải chuỗi và kết thúc theo `hasMore`; không hiển thị `total`/số trang.
- Public Company detail: `logoUrl=null` dùng initials placeholder; media chỉ lấy từ public response, giữ `sortOrder`, có empty state và không optimistic-insert media vừa confirm.
- Recommendation: chỉ tải dữ liệu riêng tư khi Candidate đã đăng nhập; mỗi card ghi nhãn + mô tả nguồn AI/PREFERENCES/LATEST. Sáu fallback Candidate có nội dung và CTA riêng; NO_ACTIVE_CV dẫn sang `/candidate/profile/cvs` để đọc CV đang hoạt động và hướng dẫn phần tạo/tải CV thuộc nhóm Profile, năm nhánh còn lại chủ động reload recommendation và khóa CTA khi pending. Chỉ nguồn AI có `nextCursor` mới render sentinel + nút xem thêm; fallback luôn xóa cursor và ẩn control.
- URL state: vẫn pending; adapter đã hỗ trợ API Gateway thật nhưng filter hiện giữ local state.
- Empty/no-results/error/loading: state riêng, không đổi footprint bất ngờ.
- Back/scroll restoration: route detail quay về owning list; hoàn thiện khi nối URL filter thật.

## Flow ledger

| Operation | Trigger | Pending | Success destination | Success feedback | Failure recovery | Focus outcome | Source ref |
|---|---|---|---|---|---|---|---|
| Create job | Lưu bản nháp | khóa submit | ở form/list | status DRAFT từ response + CTA kiểm tra | giữ dữ liệu + lỗi field/safe API error | field lỗi đầu tiên | P16.N2 Job |
| Job lifecycle | Gửi admin duyệt / Đóng tin | khóa action theo job | recruiter list | dùng status từ response | giữ row + safe error | action status | P16.N2 Job |
| Edit rejected job | Sửa theo góp ý / Lưu và gửi admin duyệt | khóa form; PUT rồi PATCH tuần tự | edit route | status PENDING_APPROVAL từ response | PUT đã thành công thì chỉ retry PATCH; không lưu lặp | lỗi đầu tiên hoặc action gửi lại | P16.N2 Job |
| Create company | Empty-state CTA | khóa submit | company profile | badge PENDING | giữ form + safe error | field lỗi đầu tiên | P16.N2 Company |
| Edit company | Lưu thay đổi; legal change ở VERIFIED mở dialog | khóa submit/dialog action | ở company | badge theo response + status inline | hủy giữ draft; 409 reload/merge | dialog/form | P16.N2 Company |
| Resubmit company verification | Gửi lại để xác minh | khóa nút, giữ trạng thái hiện tại | ở company | badge PENDING + status inline | 409 tải resource đúng một lần, không retry mutation | block trạng thái xác minh | P16.N2 Company |
| Search | Nhập từ khóa | list loader | cùng route | result count | clear/retry | search/list heading | P16.N2 Search |
| Public Job pagination | Áp dụng filter / đổi mode / tải thêm | giữ list cũ khi continuation | cùng route | tổng OFFSET hoặc số đã tải CURSOR | lỗi quá sâu có CTA đổi mode/lọc hẹp | filter lỗi đầu tiên hoặc list | P16.N2 Job Search |
| Cursor stale recovery | Backend báo stale search/recommendation | giữ list cũ, restart tối đa một lần | cùng route | thông báo mềm + snapshot mới | stale lặp lại mới thành error state | đầu vùng kết quả | P16.N2 Job Search |
| Recommendation fallback | CTA theo fallback reason | khóa retry trong khi tải | cùng route hoặc quản lý CV | source/reason mới từ response | giữ kết quả dự phòng + safe error | fallback card | P16.N2 Recommendation |
| AI recommendation pagination | Sentinel hoặc nút xem thêm | giữ card cũ, khóa duplicate load | cùng route | append khử trùng | stale restart một lần; lỗi khác retry page hiện tại | cuối danh sách gợi ý | P16.N2 Recommendation |
| Public company cursor search | Nhập từ khóa / tải thêm | khóa `q`/`limit` trong cursor chain | `/companies` | append theo `hasMore` | retry hoặc tìm kiếm mới | ô tìm kiếm / list heading | P16.N2 Company Search |
| Invite company member | OWNER nhập email | khóa submit | ở hồ sơ công ty | hiện token một lần để copy | giữ email + safe error; clipboard fallback | token rồi email input | P16.N2 Company Member |
| Accept company invitation | Recruiter dán token | khóa submit | route nhận lời mời | membership + CTA mở công ty | CTA riêng theo 404/410/409/403/401 | error action hoặc success heading | P16.N2 Company Member |
| Manage members | OWNER chọn member | khóa dialog action | hồ sơ công ty | cập nhật list/role | fail closed + retry | members heading | P16.N2 Company Member |
| Transfer ownership | OWNER xác nhận | khóa dialog | hồ sơ read-only MEMBER | ẩn OWNER actions ngay + re-fetch role | giữ MEMBER guard nếu re-fetch lỗi | membership status | P16.N2 Company Member |
| Replace-all media | Kéo thả/xóa rồi lưu | khóa editor khi PUT | ở company | reload library từ response | giữ draft + safe error | library heading | P16.N2 Company media |
| Upload | Chọn file / xin chữ ký | khóa action theo step | ở company | confirm rồi attach fileId | kiểm policy, xin signature mới, giữ confirmed file để retry attach | bước hiện tại | P16.N2 Media handshake |
| Cancel/back | Hủy / Quay lại | none | owning list | none | dirty guard pending | originating context | P16.N2 |

## Navigation and responsive behavior

- `SessionGate` là owner kiểm tra phiên/role; `/candidate/jobs` và chi tiết một việc làm luôn công khai theo Job Search contract. Các route Candidate khác vẫn cần role CANDIDATE; hết phiên hiển thị CTA đăng nhập trong trang, không tự điều hướng trong render.

- Route document title: `{Page} — CareerHub`; dynamic titles bổ sung theo từng route.
- 404/403/error: dùng app-owned route state, giữ header điều hướng.
- Top navigation cuộn ngang trên mobile; các đích riêng tư chỉ hiện theo role tài khoản thật, không giả lập quyền recruiter. Backend vẫn là nơi thực thi quyền.
- Tables cuộn ngang; card/list reflow một cột ở mobile. Candidate/Recruiter shell chuyển sidebar thành navigation cuộn ngang dưới header ở ≤980px; content có `min-width: 0`, form giữ document scrolling. Sidebar Candidate chỉ hiện với role CANDIDATE hoặc demo.
- Focus dùng `scroll-padding-top: 88px`, không bị header sticky che.

## Overlays and feedback

- Dialog primitive: `ConfirmationDialog` dùng native modal semantics, focus an toàn, Escape/backdrop và pending lock; mọi flow xác nhận dùng shared component, không dùng browser confirm.
- Confirmation: warning cho đóng/thu hồi có thể phục hồi; danger cho xóa vĩnh viễn.
- Feedback hiện dùng inline live status; shared toast provider là task integration sau.
- Unsaved changes: bắt buộc trước khi nối router/API production cho form dài.

## Async and resilience

- Mutation mặc định pessimistic; optimistic chỉ cho state demo có rollback rõ.
- Chặn duplicate submit/request theo từng resource/session.
- 409 phải reload + so sánh + quyết định gửi lại, không retry mù.
- Shared conflict owner giữ draft trong memory, chỉ reload resource đúng một lần và không gọi lại mutation; consumer phải yêu cầu người dùng chọn bản rồi tự submit lại.
- 429/503 dùng `Retry-After` khi có; không có header thì backoff có giới hạn và nút thử lại.
- `transientRecovery.ts` chỉ auto-retry một lần khi server cấp lịch; sau đó hoặc khi thiếu header, khóa nút theo backoff 2–30 giây rồi chờ người dùng chủ động thử lại.
- `cursorRecovery.ts` chỉ nhận hai exact stale code; consumer bỏ cursor, giữ list cũ trong lúc tải trang đầu và restart đúng một lần. Scope mismatch/page-too-deep không được ngụy trang thành stale.
- Private/no-store data không ghi Web Storage/service worker; `ApiSessionBoundary` remount toàn bộ page state khi account revision đổi hoặc logout/401. Vì vậy token invitation đang dán cũng bị xóa ở 401 và người dùng phải dán lại sau khi đăng nhập.
- Upload trực tiếp provider dùng multipart với `credentials: omit`; chỉ capability public được đưa vào form, private Company signature/confirm/attach vẫn no-store qua API client.
- `apiClientCore.ts` là owner của envelope, error-code mapping, timeout/abort, retry policy, UUID v4 và allowlist field.
- `NEXT_PUBLIC_API_MODE=demo|gateway` là lựa chọn tường minh; lỗi gateway không tự rơi về dữ liệu demo.
- Access/refresh token được lưu bằng HttpOnly cookie qua `/api/auth-cookie/*`; refresh cookie scope `/api/auth-cookie` để logout thu hồi phiên máy chủ, đồng thời xóa cookie local kể cả khi upstream lỗi. Browser API luôn dùng `/api` cùng origin; `API_INTERNAL_BASE_URL` chọn Gateway ở Next server. Auth gọi `setApiSession({ token: null, accountId })` để refresh cùng account không xóa state, còn đổi account phát revision. `clearApiSession` phát revision khi vô hiệu phiên (kể cả cookie-only chưa vô hiệu), sau đó idempotent để không gây vòng lặp401.

## Validation

- Company dùng typed state; Job dùng `jobForm.ts` làm validator/normalizer dùng chung cho create/edit và bám trực tiếp `CreateJobDto`.
- Validate khi submit, sau đó khi sửa field đang lỗi.
- Job so deadline với ngày UTC như backend, omit cả hai salary field khi negotiable, NFKC/trim/khử trùng skills trước khi áp giới hạn 1–50 và gửi request.
- Form dùng `noValidate`, lỗi text + `aria-invalid` + `aria-describedby`, focus lỗi đầu tiên.
- Không hiển thị raw backend message; ánh xạ theo `code`.

## Permission and clipboard

- OWNER-only action chỉ hiện khi self-membership trả `OWNER`; role null/MEMBER/lỗi đều fail closed. Sau transfer, hạ local role trước rồi re-fetch; nếu re-fetch lỗi vẫn giữ MEMBER guard. 403 vẫn là inline access boundary cuối.
- Invitation token chỉ hiện một lần trong React memory, copy chủ động có manual fallback; không đưa secret vào toast, URL hoặc storage. Đóng panel/reload sẽ xóa token, mời lại cùng email phải cảnh báo token cũ bị vô hiệu.

## Verification

- Required static commands: strict premium audit, anti-pattern grep, `npm test`, `npm run typecheck`, `npm run build`.
- Browser matrix: Chrome desktop + narrow viewport, keyboard và các luồng thành công/lỗi với API mock. Đây không phải bằng chứng E2E hệ thống đã triển khai.
- Accessibility: semantic buttons/links/table, labels, focus-visible, live status.
- Canonical sibling: Candidate job list và Recruiter job list.
- CRUD/failure-path evidence: `frontend/tests/e2e/person2-gateway.spec.ts`, `person2-flow-fixes.spec.ts`, `company-profile-edit.spec.ts`; backend thật được kiểm tra riêng, live Docker E2E vẫn cần môi trường.

## Bổ sung sau rà soát 2026-09-10

- **Auth integration:** `authSession.ts` gọi JSON API Auth có sẵn. Access/refresh token chỉ giữ trong memory, không giả định có HttpOnly cookie; tải lại trang phải đăng nhập lại. `SessionGate` bảo vệ các route riêng tư, và `ApiSessionBoundary` xóa state khi đổi/vô hiệu phiên.
- Request private phải kiểm revision sau các await và trước retry; response của phiên cũ bị hủy. Refresh single-flight gắn revision. Login/refresh/logout không đính kèm access token cũ. Đổi role khi refresh buộc đăng nhập lại.
- **Company/Job CAS:** `expectedVersion` lấy từ bản đã mở trong form. Company dùng phiên bản >=0, Job >=1. Update media không tự nâng baseline của form Công ty đang sửa; 409 reload/compare rồi mới cho người dùng chọn bản và gửi lại.
- **Company edit:** đủ name/taxCode/description/industry/size/address/website. Website rỗng gửi null; hủy bản nháp bẩn có xác nhận. Chặn rời route từ mọi link/browser-back vẫn là hạng mục riêng, chưa tuyên bố hoàn thành.
- **Job:** bốn loại việc FULL_TIME/PART_TIME/REMOTE/INTERNSHIP; đơn vị tiền từ BE/form, không ép USD thành VND. Cho sửa theo trạng thái BE cho phép; tin công khai đổi nội dung phải xác nhận khả năng gửi duyệt lại.
- **Public detail:** Job công khai không phụ thuộc request recommendation. Candidate chưa đăng nhập có CTA đăng nhập, không tự gọi API gợi ý/CV riêng tư.
- **Application:** chọn CV active từ `GET /profile/cvs`, giữ source của link, gửi một lần; theo dõi detail/coverLetter/timeline từ BE. Chỉ đọc/chọn CV, không triển khai CRUD CV của nhóm khác.
- **Bookmark:** POST lưu, DELETE bỏ lưu (204 không yêu cầu JSON), thao tác lỗi phải đọc lại hoặc cho retry; không suy đoán trạng thái đã lưu.
- **Offer:** vào từ offerId của Application → GET Offer có quyền → phản hồi với cả hai phiên bản. Dialog xác nhận kiểm lại hạn và trạng thái ngay trước POST; BE là quyết định cuối. Evaluation đọc lại bằng GET được cấp quyền, không chỉ giữ flag cục bộ.
- **Visual reconciliation:** giữ nguyên DESIGN.md, token CSS, native select/date và ngôn ngữ vi-VN. Chỉ mở rộng shared confirmation/session/API primitives; không thay palette hoặc typography.


## Đồng bộ luồng ba người — 19/10/2026

- Nguồn nghiệp vụ: `Phan-cong-cong-viec-He-thong-tuyen-dung.md` §II và §VI (ba hành trình Candidate/Recruiter/Admin); trạng thái triển khai và giới hạn ghi tại `TIEN_DO_DU_AN.md` §2.61.
- Các wrapper vai trò dùng `WorkspaceShell` làm owner khung; `CandidateShell` dùng lại `CandidateWorkspace`, context tự tránh bọc hai lần. Khung chỉ hiện identity/sidebar Candidate với tài khoản CANDIDATE; public jobs vẫn đọc được khi anonymous hoặc vai trò khác.
- Recruiter login/register không dùng sidebar riêng tư. Khi chưa có phiên/không đủ quyền, giữ khung điều hướng và hiển thị gate có CTA. Mọi sidebar đánh dấu vị trí hiện tại và có đường đến tin nhắn/thông báo; trên mobile, thanh menu cuộn ngang tới mục đang mở mà không cuộn trang. Header của cả ba vai trò dành một hàng riêng cho menu công khai khi màn hình hẹp.
- `loginDestination` kiểm tra đích cùng origin và role, giữ query/hash qua login/register/OTP, hỗ trợ `/messages`, `/notifications`, `/reports` và phòng gọi `/interviews/:id/room` theo role. Google callback hiện vẫn về trang mặc định; không coi đây là hỗ trợ returnTo qua OAuth.
- `SessionGate`/`Person1Gate` dùng `LoadingState` trong lúc hydrate và giữ query của đích khi yêu cầu đăng nhập lại.
- `person1FormError` giữ ràng buộc native để kiểm tra nhưng hiển thị lỗi trong trang và focus ô đầu tiên; form khai báo `noValidate`. Ngày hồ sơ được kiểm tra trước khi gửi, không lưu khoảng thời gian ngược.
- Rút hồ sơ: mở `ConfirmationDialog`, hủy không gọi API, xác nhận mới tải version rồi gửi mutation. Lỗi nằm trong dialog để có thể thử lại; không bỏ draft khi lỗi.
- Mở chat từ job/pipeline: khóa nút khi đang tạo hội thoại, báo lỗi tại chỗ; chỉ điều hướng khi API trả thành công. Không dùng browser alert.
- Chat history dùng `cursor` timestamp đúng contract Go. Gộp tin theo id/client_message_id và conversation_id; không đưa tin của hội thoại khác vào khung hiện tại. Gửi lỗi giữ draft và client_message_id cho lần thử lại cùng nội dung.
- WebSocket và SSE đi qua `/api` cùng origin với cookie đăng nhập. Chat có reconnect/catch-up HTTP. Inbox gộp SSE theo id và đọc lại unread-count từ API; GET đang chạy không được ghi đè SSE hoặc trạng thái đã đọc vừa lưu; lỗi tải/đánh dấu có phản hồi và nút thử lại. Nội dung thông báo có liên kết đến luồng ứng tuyển/chat khi metadata có đủ thông tin.
- Ngắt kết nối hoặc người tham gia rời LiveKit không tự kết thúc cuộc gọi cho mọi người. Chỉ chủ cuộc gọi có thao tác kết thúc; quyền cuối cùng do Video service kiểm tra. Marker chat không tự đóng phòng: chỉ phát sự kiện sau khi Video xác nhận ID không có trong danh sách đầy đủ dưới 50 cuộc gọi đang mở; dữ liệu lỗi hoặc danh sách bị giới hạn thì giữ phòng/lời mời. UUID marker được chuẩn hóa trước khi đối chiếu.
- Bằng chứng mới: `frontend/tests/e2e/cross-team-navigation.spec.ts`, `communication-flows.spec.ts`, các regression bổ sung trong `person1-flows.spec.ts` và `person2-gateway.spec.ts`. Đây là browser/API-mock tests; không thay thế E2E với Kafka, SMTP, Cloudinary và LiveKit thật.

## Đồng bộ hình thức toàn bộ màn hình — 19/10/2026

- Canonical owner: `WorkspaceShell` cho ba vai trò, `PublicShell` cho trang công khai, `AuthFrame` cho xác thực. Các role wrapper chỉ cung cấp cấu hình; không tự tạo thêm header/sidebar. `PageHeader`, `Metric`, `Card`, control/table/status trong `globals.css` là nguồn dùng chung.
- Đã chuyển Candidate dashboard/profile/CV/settings/interviews, Admin dashboard/tabs, Recruiter dashboard/company/jobs/applications/recommendations và Notifications/Messages/Reports về cùng mẫu; giữ các thao tác và gate quyền hiện có.
- Desktop: header ≥76px, sidebar248px, gutter32px; ≤980px tất cả vai trò dùng menu cuộn ngang, ≤680px gutter16px. Tiêu đề28px/24px mobile, control46px, card16px. Auth dùng card/form đồng nhất cho cả ba cổng, register/recovery/callback.
- Nhãn trạng thái Company/Job/Application và vai trò thành viên dùng tiếng Việt từ `recruitmentLabels.ts`. Các enum, cursor/version và thuật ngữ nội bộ không phải nội dung chính của màn hình. Thông báo suy giảm dữ liệu vẫn phải hiển thị khi ảnh hưởng đến tính đầy đủ của kết quả.
- Preview tin tuyển dụng đọc đúng tin theo ID, hiển thị lỗi/loading/empty theo cùng mẫu và dẫn về sửa/quản lý; không dùng tin mẫu hoặc nút ứng tuyển không hoạt động.
- Verification: `auth-consistency.spec.ts` so sánh hình học giữa các màn xác thực; `workspace-consistency.spec.ts` kiểm tra một shell, trạng thái active, keyboard navigation, overflow và ảnh desktop/mobile theo vai trò. Full-suite result ghi tại TIEN_DO_DU_AN.md §2.63. Dữ liệu browser test là fixture, không thay thế E2E dịch vụ thật.
