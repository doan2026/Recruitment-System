"use client";
import { useEffect, useState, type FormEvent } from "react";
import { requestApi } from "../../lib/apiClient";
import { person1Error, saveBlob } from "../../lib/person1Api";
import { ConfirmationDialog } from "../../components/ConfirmationDialog";
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
const metricNames: Record<string, string> = {
  JOBS_PUBLISHED: "Tin đã đăng",
  APPLIED: "Đơn ứng tuyển",
  INTERVIEW: "Phỏng vấn",
  OFFER: "Đề nghị",
  HIRED: "Đã tuyển",
};
const navIcons: Record<Tab, string> = {
  stats: "/figma/admin/375c7.svg",
  users: "/figma/admin/af4a8.svg",
  companies: "/figma/admin/fdcad.svg",
  jobs: "/figma/admin/7e3f5.svg",
  reports: "/figma/admin/55bb8.svg",
  audit: "/figma/admin/2d2e0.svg",
};
const today = () => new Date().toISOString().slice(0, 10);
export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("stats");
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
      <div className="page-header">
        <div>
          <p className="eyebrow">QUẢN TRỊ</p>
          <h1>{tab === "stats" ? "Tổng quan hệ thống" : labels[tab]}</h1>
        </div>
        <button
          className="btn"
          disabled={loading || pending}
          onClick={() => setReload((n) => n + 1)}
        >
          Tải lại dữ liệu
        </button>
      </div>
      <nav className="btn-group admin-sidebar" aria-label="Chức năng quản trị">
        <a className="admin-brand" href="/" aria-label="CareerHub"><img src="/figma/admin/6aca2.png" alt="CareerHub" width="117" height="32" /></a>
        <div className="admin-identity"><img src="/figma/admin/28322.png" alt="" /><span><strong>CareerHub Admin</strong><small>System Administrator</small></span></div>
        {(Object.keys(labels) as Tab[]).map((key) => (
          <button
            className={"btn" + (tab === key ? " btn-primary" : "")}
            aria-current={tab === key ? "page" : undefined}
            key={key}
            disabled={pending}
            onClick={() => {
              setTab(key);
              setPage(1);
              setNotice("");
              setReason("");
            }}
          >
            <img className="admin-nav-icon" src={navIcons[key]} alt="" aria-hidden="true" />
            <span>{labels[key]}</span>
          </button>
        ))}
      </nav>
      {tab === "stats" ? (
        <section className="card form-stack">
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
          {!loading && overview ? (
            <>
              <div className="person1-grid">
                {Object.entries(metricNames).map(([key, label]) => (
                  <article className="card" key={key}>
                    <h2>{label}</h2>
                    <strong className="person1-number">
                      {overview.totals[key] ?? 0}
                    </strong>
                  </article>
                ))}
              </div>
              <h2>Đơn ứng tuyển theo ngày</h2>
              {trend.length ? (
                <svg
                  viewBox="0 0 600 160"
                  role="img"
                  aria-label="Biểu đồ số đơn ứng tuyển theo ngày"
                  className="person1-chart"
                >
                  <polyline
                    fill="none"
                    stroke="#006e2e"
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
                      fill="#006e2e"
                    >
                      <title>
                        {String(r.stat_date)}: {String(r.value)}
                      </title>
                    </circle>
                  ))}
                </svg>
              ) : (
                <p>Chưa có số liệu tổng hợp trong khoảng này.</p>
              )}
              <h2>Tỷ lệ chuyển đổi</h2>
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
            </>
          ) : null}
        </section>
      ) : null}
      {tab === "users" ? (
        <form
          className="card btn-group"
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
              <option>CANDIDATE</option>
              <option>RECRUITER</option>
              <option>ADMIN</option>
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
                  {s || "Tất cả"}
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
                  {s || "Tất cả"}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      {["companies", "jobs", "users", "reports"].includes(tab) ? (
        <label className="field">
          Lý do / kết quả xử lý
          <textarea
            className="textarea"
            maxLength={500}
            value={reason}
            disabled={pending}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Bắt buộc khi từ chối, khóa tài khoản hoặc xử lý báo cáo"
          />
        </label>
      ) : null}
      {loading ? (
        <p role="status">Đang tải dữ liệu…</p>
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
                      <p>
                        {String(row.role)} ·{" "}
                        {row.is_locked ? "Đã khóa" : "Đang mở"} ·{" "}
                        {row.is_verified ? "Đã xác minh" : "Chưa xác minh"}
                      </p>
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
                      <p>
                        {String(row.target_type)} · {String(row.target_id)} ·{" "}
                        {String(row.status)}
                      </p>
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
            <p className="card">Không có dữ liệu phù hợp.</p>
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
