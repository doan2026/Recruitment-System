"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { requestApi } from "../lib/apiClient";
import { person1Error, saveBlob } from "../lib/person1Api";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { EmptyState, LoadingState, Metric, PageHeader, StatusBadge } from "./ui";
type Row = Record<string, unknown>;
type Tab = "stats" | "companies" | "jobs" | "users" | "reports" | "audit";
type Command = { path: string; body: unknown; label: string };
const labels: Record<Tab, string> = {
  stats: "Thống kê",
  companies: "Duyệt công ty",
  jobs: "Duyệt tin",
  users: "Người dùng",
  reports: "Báo cáo vi phạm",
  audit: "Nhật ký",
};
const tabRoutes: Record<Tab, string> = {
  stats: "/admin",
  companies: "/admin/companies",
  jobs: "/admin/jobs",
  users: "/admin/users",
  reports: "/admin/reports",
  audit: "/admin?tab=audit",
};
const metricNames: Record<string, string> = {
  JOBS_PUBLISHED: "Tin đã đăng",
  APPLIED: "Đơn ứng tuyển",
  INTERVIEW: "Phỏng vấn",
  OFFER: "Đề nghị",
  HIRED: "Đã tuyển",
};
const roleLabels: Record<string, string> = { CANDIDATE: "Ứng viên", RECRUITER: "Nhà tuyển dụng", ADMIN: "Quản trị viên" };
const reportStatusLabels: Record<string, string> = { OPEN: "Mới gửi", PROCESSING: "Đang xử lý", RESOLVED: "Đã xử lý", DISMISSED: "Đã bỏ qua" };
const targetLabels: Record<string, string> = { JOB: "Tin tuyển dụng", COMPANY: "Công ty", USER: "Tài khoản" };
const today = () => new Date().toISOString().slice(0, 10);
export function AdminWorkspace({ initialTab = "stats" }: { initialTab?: Tab }) {
  const router = useRouter();
  const tab = initialTab;
  const [rows, setRows] = useState<Row[]>([]);
  const [overview, setOverview] = useState<{
    daily: Row[];
    totals: Record<string, number>;
  } | null>(null);
  const [funnel, setFunnel] = useState<
    { stage: string; count: number; rate: number }[]
  >([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [from, setFrom] = useState(() => today().slice(0, 8) + "01");
  const [to, setTo] = useState(today);
  const [email, setEmail] = useState("");
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");
  const [locked, setLocked] = useState("");
  const [status, setStatus] = useState("OPEN");
  const [targetType, setTargetType] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const [command, setCommand] = useState<Command | null>(null);
  const [detail, setDetail] = useState<Row | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setRows([]);
    setDetail(null);
    setOverview(null);
    setFunnel([]);
    async function load() {
      if (tab === "stats") {
        const [o, f] = await Promise.all([
          requestApi<{ daily: Row[]; totals: Record<string, number> }>(
            "/admin/stats/overview",
            {
              privateData: true,
              query: { from, to },
              signal: controller.signal,
            },
          ),
          requestApi<typeof funnel>("/admin/stats/funnel", {
            privateData: true,
            query: { from, to },
            signal: controller.signal,
          }),
        ]);
        setOverview(o.data);
        setFunnel(f.data);
      } else {
        const paths = {
          companies: "companies/pending",
          jobs: "jobs/pending",
          users: "users",
          reports: "reports",
          audit: "audit-logs",
        };
        const result = await requestApi<Row[]>("/admin/" + paths[tab], {
          privateData: true,
          signal: controller.signal,
          query: {
            ...(tab !== "jobs" ? { page, limit: 20 } : {}),
            ...(tab === "users"
              ? {
                  email: query,
                  role: role || undefined,
                  locked: locked || undefined,
                }
              : {}),
            ...(tab === "reports"
              ? { status: status || undefined, type: targetType || undefined }
              : {}),
          },
        });
        setRows(result.data);
        setTotal(Number(result.meta?.total ?? result.data.length));
      }
    }
    load()
      .catch((e) => {
        if (!controller.signal.aborted) setError(person1Error(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [tab, page, query, role, locked, status, targetType, from, to, reload]);
  function choose(
    path: string,
    body: unknown,
    label: string,
    needsReason = false,
  ) {
    if (needsReason && reason.trim().length < 3) {
      setError("Nhập lý do ít nhất 3 ký tự trước khi xử lý.");
      return;
    }
    setCommand({ path, body, label });
  }
  async function execute() {
    if (!command || pending) return;
    setPending(true);
    setError("");
    setNotice("");
    try {
      await requestApi("/admin/" + command.path, {
        method: "PATCH",
        privateData: true,
        body: command.body,
      });
      setNotice("Đã hoàn tất: " + command.label);
      setCommand(null);
      setReason("");
      setReload((n) => n + 1);
    } catch (e) {
      setError(person1Error(e));
      setCommand(null);
    } finally {
      setPending(false);
    }
  }
  async function exportFile(type: "csv" | "xlsx") {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const result = await requestApi<Blob>("/admin/stats/export", {
        privateData: true,
        query: { type, from, to },
        responseType: "blob",
      });
      saveBlob(result.data, `thong-ke-${from}-${to}.${type}`);
    } catch (e) {
      setError(person1Error(e));
    } finally {
      setPending(false);
    }
  }
  const trend = overview?.daily.filter((row) => row.metric === "APPLIED") ?? [];
  const maximum = Math.max(1, ...trend.map((r) => Number(r.value)));
  return (
    <main className="admin-workspace">
      <PageHeader eyebrow="QUẢN TRỊ" title={tab === "stats" ? "Tổng quan hệ thống" : labels[tab]}
        description={tab === "stats" ? "Theo dõi số liệu tuyển dụng và tỷ lệ chuyển đổi trong khoảng thời gian bạn chọn." : "Xem thông tin, kiểm tra nội dung và xử lý yêu cầu trong hệ thống."}
        action={<button className="btn" disabled={loading || pending} onClick={() => setReload((n) => n + 1)}>Tải lại dữ liệu</button>} />
      <nav className="admin-workspace-tabs" aria-label="Chức năng quản trị">
        {(Object.keys(labels) as Tab[]).map((key) => (
          <button
            className={"btn" + (tab === key ? " btn-primary" : "")}
            aria-current={tab === key ? "page" : undefined}
            key={key}
            disabled={pending}
            onClick={() => {
              setPage(1);
              setNotice("");
              setReason("");
              router.push(tabRoutes[key]);
            }}
          >
            <span>{labels[key]}</span>
          </button>
        ))}
      </nav>
      {tab === "stats" ? (
        <>
        <section className="panel form-stack">
          <div className="btn-group">
            <label className="field">
              Từ ngày
              <input
                className="input"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label className="field">
              Đến ngày
              <input
                className="input"
                type="date"
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
            <button
              className="btn"
              disabled={pending || loading}
              onClick={() => void exportFile("xlsx")}
            >
              Xuất Excel
            </button>
            <button
              className="btn"
              disabled={pending || loading}
              onClick={() => void exportFile("csv")}
            >
              Xuất CSV
            </button>
          </div>
          <p className="help">
            Số liệu tổng hợp theo ngày UTC, cập nhật sau 00:15 hôm sau. Số người
            dùng mới và công ty mới chưa có nguồn dữ liệu.
          </p>
        </section>
          {!loading && overview ? (
            <>
              <section className="metric-grid metric-grid-auto" aria-label="Thống kê tuyển dụng">
                {Object.entries(metricNames).map(([key, label]) => <Metric key={key} label={label} value={String(overview.totals[key] ?? 0)} />)}
              </section>
              <section className="panel form-stack">
              <div className="section-head"><h2>Đơn ứng tuyển theo ngày</h2></div>
              {trend.length ? (
                <svg
                  viewBox="0 0 600 160"
                  role="img"
                  aria-label="Biểu đồ số đơn ứng tuyển theo ngày"
                  className="person1-chart"
                >
                  <polyline
                    fill="none"
                    stroke="var(--primary)"
                    strokeWidth="3"
                    points={trend
                      .map(
                        (r, i) =>
                          `${20 + (i * 560) / Math.max(1, trend.length - 1)},${140 - (Number(r.value) * 120) / maximum}`,
                      )
                      .join(" ")}
                  />
                  {trend.map((r, i) => (
                    <circle
                      key={i}
                      cx={20 + (i * 560) / Math.max(1, trend.length - 1)}
                      cy={140 - (Number(r.value) * 120) / maximum}
                      r={4}
                      fill="var(--primary)"
                    >
                      <title>
                        {String(r.stat_date)}: {String(r.value)}
                      </title>
                    </circle>
                  ))}
                </svg>
              ) : (
                <EmptyState title="Chưa có số liệu trong khoảng này" description="Chọn khoảng thời gian khác để xem số đơn ứng tuyển theo ngày." />
              )}
              </section>
              <section className="panel form-stack">
              <div className="section-head"><h2>Tỷ lệ chuyển đổi</h2></div>
              <p className="help">
                Theo nhóm ứng tuyển lần đầu trong khoảng ngày đã chọn; tính đến
                hết ngày cuối.
              </p>
              {funnel.map((item) => (
                <div key={item.stage}>
                  <p>
                    {metricNames[item.stage]}: {item.count} (
                    {item.rate.toFixed(1)}%)
                  </p>
                  <progress
                    aria-label={metricNames[item.stage]}
                    max={100}
                    value={item.rate}
                  />
                </div>
              ))}
              <details>
                <summary>Xem bảng số liệu</summary>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Ngày</th>
                        <th>Chỉ số</th>
                        <th>Số lượng</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.daily.map((r, i) => (
                        <tr key={i}>
                          <td>{String(r.stat_date)}</td>
                          <td>{metricNames[String(r.metric)]}</td>
                          <td>{String(r.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
              </section>
            </>
          ) : null}
        </>
      ) : null}
      {tab === "users" ? (
        <form
          className="card btn-group"
          noValidate
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            setPage(1);
            setQuery(email);
          }}
        >
          <label className="field">
            Email
            <input
              className="input"
              type="search"
              maxLength={200}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="field">
            Vai trò
            <select
              className="select"
              value={role}
              onChange={(e) => {
                setRole(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Tất cả</option>
              <option value="CANDIDATE">Ứng viên</option>
              <option value="RECRUITER">Nhà tuyển dụng</option>
              <option value="ADMIN">Quản trị viên</option>
            </select>
          </label>
          <label className="field">
            Trạng thái
            <select
              className="select"
              value={locked}
              onChange={(e) => {
                setLocked(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Tất cả</option>
              <option value="true">Đã khóa</option>
              <option value="false">Đang mở</option>
            </select>
          </label>
          <button className="btn btn-primary">Tìm người dùng</button>
        </form>
      ) : null}
      {tab === "reports" ? (
        <div className="card btn-group">
          <label className="field">
            Trạng thái
            <select
              className="select"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              {["", "OPEN", "PROCESSING", "RESOLVED", "DISMISSED"].map((s) => (
                <option key={s} value={s}>
                  {reportStatusLabels[s] || "Tất cả"}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Đối tượng
            <select
              className="select"
              value={targetType}
              onChange={(e) => {
                setTargetType(e.target.value);
                setPage(1);
              }}
            >
              {["", "JOB", "COMPANY", "USER"].map((s) => (
                <option key={s} value={s}>
                  {targetLabels[s] || "Tất cả"}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      {["companies", "jobs", "users", "reports"].includes(tab) ? (
        <section className="card"><label className="field">
          Lý do / kết quả xử lý
          <textarea
            className="textarea resize-none"
            maxLength={500}
            value={reason}
            disabled={pending}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Bắt buộc khi từ chối, khóa tài khoản hoặc xử lý báo cáo"
          />
        </label></section>
      ) : null}
      {loading ? (
        <LoadingState label="Đang tải dữ liệu…" />
      ) : tab !== "stats" ? (
        <section className="form-stack">
          {rows.length ? (
            rows.map((row, index) => {
              const id = String(row.id);
              return (
                <article className="card form-stack" key={id + index}>
                  <h2>
                    {String(
                      row.name ??
                        row.title ??
                        row.email ??
                        (tab === "reports" ? row.reason : row.action) ??
                        id,
                    )}
                  </h2>
                  {tab === "companies" ? (
                    <>
                      <p>{String(row.description ?? "")}</p>
                      <div className="btn-group">
                        <button
                          className="btn"
                          disabled={pending}
                          onClick={() => setDetail(row)}
                        >
                          Xem chi tiết
                        </button>
                        <button
                          className="btn btn-primary"
                          disabled={pending}
                          onClick={() =>
                            choose(
                              "companies/" + id + "/verify",
                              { decision: "APPROVE" },
                              "Duyệt công ty",
                            )
                          }
                        >
                          Duyệt
                        </button>
                        <button
                          className="btn btn-danger"
                          disabled={pending}
                          onClick={() =>
                            choose(
                              "companies/" + id + "/verify",
                              { decision: "REJECT", reason },
                              "Từ chối công ty",
                              true,
                            )
                          }
                        >
                          Từ chối
                        </button>
                      </div>
                    </>
                  ) : null}
                  {tab === "jobs" ? (
                    <>
                      <p>{String(row.description ?? "")}</p>
                      <p>{String(row.requirements ?? "")}</p>
                      <p>
                        {String(row.location ?? "")} · Hạn:{" "}
                        {String(row.deadline ?? "")}
                      </p>
                      <div className="btn-group">
                        <button
                          className="btn btn-primary"
                          disabled={pending}
                          onClick={() =>
                            choose("jobs/" + id + "/approve", {}, "Duyệt tin")
                          }
                        >
                          Duyệt
                        </button>
                        <button
                          className="btn btn-danger"
                          disabled={pending}
                          onClick={() =>
                            choose(
                              "jobs/" + id + "/reject",
                              { reason },
                              "Từ chối tin",
                              true,
                            )
                          }
                        >
                          Từ chối
                        </button>
                      </div>
                    </>
                  ) : null}
                  {tab === "users" ? (
                    <>
                      <div className="chip-list">
                        <StatusBadge tone="neutral">{roleLabels[String(row.role)] ?? String(row.role)}</StatusBadge>
                        <StatusBadge tone={row.is_locked ? "danger" : "success"}>{row.is_locked ? "Đã khóa" : "Đang mở"}</StatusBadge>
                        <StatusBadge tone={row.is_verified ? "success" : "warning"}>{row.is_verified ? "Đã xác minh" : "Chưa xác minh"}</StatusBadge>
                      </div>
                      <p>{String(row.locked_reason ?? "")}</p>
                      <button
                        className="btn"
                        disabled={pending || row.role === "ADMIN"}
                        onClick={() =>
                          choose(
                            "users/" + id + "/lock",
                            row.is_locked
                              ? { locked: false }
                              : { locked: true, reason },
                            row.is_locked
                              ? "Mở khóa tài khoản"
                              : "Khóa tài khoản",
                            !row.is_locked,
                          )
                        }
                      >
                        {row.is_locked ? "Mở khóa" : "Khóa tài khoản"}
                      </button>
                    </>
                  ) : null}
                  {tab === "reports" ? (
                    <>
                      <div className="chip-list"><StatusBadge tone="neutral">{targetLabels[String(row.target_type)] ?? String(row.target_type)}</StatusBadge><StatusBadge tone={row.status === "OPEN" ? "warning" : "neutral"}>{reportStatusLabels[String(row.status)] ?? String(row.status)}</StatusBadge></div>
                      <p className="help">Mã đối tượng: {String(row.target_id)}</p>
                      <p>{String(row.description ?? "")}</p>
                      <p>{String(row.resolution ?? "")}</p>
                      {row.status === "OPEN" ? (
                        <div className="btn-group">
                          <button
                            className="btn"
                            disabled={pending}
                            onClick={() =>
                              choose(
                                "reports/" + id,
                                {
                                  status: "DISMISSED",
                                  resolution: reason,
                                  expectedVersion: row.version,
                                },
                                "Bỏ qua báo cáo",
                                true,
                              )
                            }
                          >
                            Bỏ qua
                          </button>
                          <button
                            className="btn btn-danger"
                            disabled={pending || row.target_type !== "USER"}
                            onClick={() =>
                              choose(
                                "reports/" + id,
                                {
                                  status: "RESOLVED",
                                  resolution: reason,
                                  expectedVersion: row.version,
                                },
                                "Chấp nhận báo cáo và khóa tài khoản",
                                true,
                              )
                            }
                          >
                            Chấp nhận và khóa tài khoản
                          </button>
                        </div>
                      ) : null}
                      {row.target_type !== "USER" ? (
                        <p className="help">
                          Báo cáo tin/công ty cần kết nối chức năng gỡ nội dung
                          để xử lý hoàn tất.
                        </p>
                      ) : null}
                      {row.status === "PROCESSING" ? (
                        <p className="notice notice-warning">
                          Thao tác đang chờ đối soát. Kiểm tra nhật ký và trạng
                          thái tài khoản trước khi tiếp tục.
                        </p>
                      ) : null}
                    </>
                  ) : null}
                  {tab === "audit" ? (
                    <>
                      <p>
                        {String(row.outcome)} · {String(row.target_type)} ·{" "}
                        {String(row.target_id)}
                      </p>
                      <p>Quản trị viên: {String(row.admin_id)}</p>
                      <p>{String(row.reason ?? "")}</p>
                      <time>
                        {new Date(String(row.created_at)).toLocaleString(
                          "vi-VN",
                        )}
                      </time>
                    </>
                  ) : null}
                </article>
              );
            })
          ) : (
            <section className="card"><EmptyState title="Không có dữ liệu phù hợp" description="Thử thay đổi bộ lọc hoặc tải lại để xem các cập nhật mới." /></section>
          )}
        </section>
      ) : null}
      {!loading && ["companies", "users", "reports", "audit"].includes(tab) ? (
        <div className="btn-group">
          <button
            className="btn"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Trang trước
          </button>
          <span>Trang {page}</span>
          <button
            className="btn"
            disabled={tab === "audit" ? rows.length < 20 : page * 20 >= total}
            onClick={() => setPage((p) => p + 1)}
          >
            Trang sau
          </button>
        </div>
      ) : null}
      {detail ? (
        <section className="card form-stack">
          <h2>{String(detail.name ?? "Chi tiết công ty")}</h2>
          {[
            "description",
            "industry",
            "size",
            "address",
            "website",
            "taxCode",
            "verifiedStatus",
          ].map((key) =>
            detail[key] ? <p key={key}>{String(detail[key])}</p> : null,
          )}
          {typeof detail.logoUrl === "string" ? (
            <img
              src={detail.logoUrl}
              width={100}
              height={100}
              alt="Logo công ty"
            />
          ) : null}
          <button className="btn" onClick={() => setDetail(null)}>
            Đóng chi tiết
          </button>
        </section>
      ) : null}
      {error ? (
        <p className="notice notice-danger" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="notice" role="status">
          {notice}
        </p>
      ) : null}
      <ConfirmationDialog
        open={!!command}
        title={command?.label ?? "Xác nhận"}
        description="Thao tác sẽ được ghi vào nhật ký quản trị."
        confirmLabel="Xác nhận"
        pending={pending}
        onConfirm={() => void execute()}
        onCancel={() => setCommand(null)}
      />
    </main>
  );
}
