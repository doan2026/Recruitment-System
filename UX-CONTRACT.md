# UX Contract

## Product context

- Audience: Candidate và Recruiter trong phạm vi bốn service Người 2.
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
| CRUD | Route + `frontend/lib/person2Api.ts` | P16.N2 | explicit demo / gateway | API unit + full-flow E2E pending |
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
- Recommendation: load-more chỉ khi source AI có `nextCursor`.
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
| Public company cursor search | Nhập từ khóa / tải thêm | khóa `q`/`limit` trong cursor chain | `/companies` | append theo `hasMore` | retry hoặc tìm kiếm mới | ô tìm kiếm / list heading | P16.N2 Company Search |
| Invite company member | OWNER nhập email | khóa submit | ở hồ sơ công ty | hiện token một lần để copy | giữ email + safe error; clipboard fallback | token rồi email input | P16.N2 Company Member |
| Accept company invitation | Recruiter dán token | khóa submit | route nhận lời mời | membership + CTA mở công ty | CTA riêng theo 404/410/409/403/401 | error action hoặc success heading | P16.N2 Company Member |
| Manage members | OWNER chọn member | khóa dialog action | hồ sơ công ty | cập nhật list/role | fail closed + retry | members heading | P16.N2 Company Member |
| Transfer ownership | OWNER xác nhận | khóa dialog | hồ sơ read-only MEMBER | ẩn OWNER actions ngay + re-fetch role | giữ MEMBER guard nếu re-fetch lỗi | membership status | P16.N2 Company Member |
| Replace-all media | Kéo thả/xóa rồi lưu | khóa editor khi PUT | ở company | reload library từ response | giữ draft + safe error | library heading | P16.N2 Company media |
| Upload | Chọn file / xin chữ ký | khóa action theo step | ở company | confirm rồi attach fileId | kiểm policy, xin signature mới, giữ confirmed file để retry attach | bước hiện tại | P16.N2 Media handshake |
| Cancel/back | Hủy / Quay lại | none | owning list | none | dirty guard pending | originating context | P16.N2 |

## Navigation and responsive behavior

- Route document title: `{Page} — CareerHub`; dynamic titles bổ sung theo từng route.
- 404/403/error: dùng app-owned route state, giữ header điều hướng.
- Top navigation cuộn ngang trên mobile; không ẩn đích nghiệp vụ.
- Tables cuộn ngang; card/list reflow một cột ở mobile.
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
- Private/no-store data không ghi Web Storage/service worker; `ApiSessionBoundary` remount toàn bộ page state khi account revision đổi hoặc logout/401. Vì vậy token invitation đang dán cũng bị xóa ở 401 và người dùng phải dán lại sau khi đăng nhập.
- Upload trực tiếp provider dùng multipart với `credentials: omit`; chỉ capability public được đưa vào form, private Company signature/confirm/attach vẫn no-store qua API client.
- `apiClientCore.ts` là owner của envelope, error-code mapping, timeout/abort, retry policy, UUID v4 và allowlist field.
- `NEXT_PUBLIC_API_MODE=demo|gateway` là lựa chọn tường minh; lỗi gateway không tự rơi về dữ liệu demo.
- Access token chỉ giữ trong memory; Auth gọi `setApiSession({ token?, accountId })` để refresh cùng account không xóa state, còn đổi account phát revision. `clearApiSession` luôn phát revision kể cả cookie-only.

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
- Browser matrix: Chrome desktop + narrow viewport, keyboard, reduced motion; full E2E pending.
- Accessibility: semantic buttons/links/table, labels, focus-visible, live status.
- Canonical sibling: Candidate job list và Recruiter job list.
- CRUD full-flow/failure-path evidence: pending API integration; không tuyên bố hoàn thành từ demo state.
