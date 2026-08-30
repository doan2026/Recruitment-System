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
- Candidate search: offset hoặc cursor đúng hợp đồng backend; đổi filter xóa cursor.
- Recommendation: load-more chỉ khi source AI có `nextCursor`.
- URL state: vẫn pending; adapter đã hỗ trợ API Gateway thật nhưng filter hiện giữ local state.
- Empty/no-results/error/loading: state riêng, không đổi footprint bất ngờ.
- Back/scroll restoration: route detail quay về owning list; hoàn thiện khi nối URL filter thật.

## Flow ledger

| Operation | Trigger | Pending | Success destination | Success feedback | Failure recovery | Focus outcome | Source ref |
|---|---|---|---|---|---|---|---|
| Create job | Lưu bản nháp | khóa submit | ở form/list | status inline | giữ dữ liệu + lỗi field | field lỗi đầu tiên | P16.N2 Job |
| Edit company | Lưu thay đổi | khóa submit | ở company | status inline | reload/merge khi 409 | heading/form | P16.N2 Company |
| Search | Nhập từ khóa | list loader | cùng route | result count | clear/retry | search/list heading | P16.N2 Search |
| Upload | Bắt đầu tải | từng bước | ở form owner | step status | xin signature mới/retry | bước lỗi | P16.N2 Media handshake |
| Cancel/back | Hủy / Quay lại | none | owning list | none | dirty guard pending | originating context | P16.N2 |

## Navigation and responsive behavior

- Route document title: `{Page} — CareerHub`; dynamic titles bổ sung theo từng route.
- 404/403/error: dùng app-owned route state, giữ header điều hướng.
- Top navigation cuộn ngang trên mobile; không ẩn đích nghiệp vụ.
- Tables cuộn ngang; card/list reflow một cột ở mobile.
- Focus dùng `scroll-padding-top: 88px`, không bị header sticky che.

## Overlays and feedback

- Dialog primitive: chưa cần trong baseline; destructive flow thật phải dùng shared accessible dialog, không dùng browser confirm.
- Confirmation: warning cho đóng/thu hồi có thể phục hồi; danger cho xóa vĩnh viễn.
- Feedback hiện dùng inline live status; shared toast provider là task integration sau.
- Unsaved changes: bắt buộc trước khi nối router/API production cho form dài.

## Async and resilience

- Mutation mặc định pessimistic; optimistic chỉ cho state demo có rollback rõ.
- Chặn duplicate submit/request theo từng resource/session.
- 409 phải reload + so sánh + quyết định gửi lại, không retry mù.
- Shared conflict owner giữ draft trong memory, chỉ reload resource đúng một lần và không gọi lại mutation; consumer phải yêu cầu người dùng chọn bản rồi tự submit lại.
- 429/503 dùng `Retry-After` khi có; không có header thì backoff có giới hạn và nút thử lại.
- Private/no-store data không ghi localStorage và phải xóa khi logout/đổi account.
- `apiClientCore.ts` là owner của envelope, error-code mapping, timeout/abort, retry policy, UUID v4 và allowlist field.
- `NEXT_PUBLIC_API_MODE=demo|gateway` là lựa chọn tường minh; lỗi gateway không tự rơi về dữ liệu demo.
- Access token chỉ giữ trong memory qua `setApiAccessToken`; `clearApiSession` phát revision để consumer xóa state bảo vệ.

## Validation

- Baseline dùng manual typed state; schema library sẽ được chọn khi form/API mở rộng.
- Validate khi submit, sau đó khi sửa field đang lỗi.
- Form dùng `noValidate`, lỗi text + `aria-invalid` + `aria-describedby`, focus lỗi đầu tiên.
- Không hiển thị raw backend message; ánh xạ theo `code`.

## Permission and clipboard

- OWNER-only action ẩn sau khi membership được tải; 403 vẫn có trang/inline access boundary.
- Invitation token chỉ hiện một lần, copy chủ động; không đưa secret vào toast hoặc URL.

## Verification

- Required static commands: strict premium audit, anti-pattern grep, `npm test`, `npm run typecheck`, `npm run build`.
- Browser matrix: Chrome desktop + narrow viewport, keyboard, reduced motion; full E2E pending.
- Accessibility: semantic buttons/links/table, labels, focus-visible, live status.
- Canonical sibling: Candidate job list và Recruiter job list.
- CRUD full-flow/failure-path evidence: pending API integration; không tuyên bố hoàn thành từ demo state.
