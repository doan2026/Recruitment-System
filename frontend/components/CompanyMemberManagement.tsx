"use client";

import { useEffect, useState } from "react";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { ErrorState, LoadingState, StatusBadge } from "./ui";
import { toUserMessage } from "../lib/apiClient";
import { canManageCompanyAsOwner, roleAfterOwnershipTransfer, withoutRemovedMember } from "../lib/companyMembership";
import {
  type CompanyMember,
  type CompanyMemberRole,
  getCompanyMembers,
  getCurrentCompanyMembership,
  removeCompanyMember,
  transferCompanyOwnership,
} from "../lib/person2Api";

type PendingAction = { kind: "TRANSFER" | "REMOVE"; member: CompanyMember };

export function CompanyMemberManagement({ companyId, onRoleChange }: {
  companyId: string;
  onRoleChange: (role: CompanyMemberRole | null) => void;
}) {
  const [role, setRole] = useState<CompanyMemberRole | null>(null);
  const [members, setMembers] = useState<CompanyMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [actionError, setActionError] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    getCurrentCompanyMembership(controller.signal)
      .then(async (membershipResponse) => {
        if (!active) return;
        const nextRole = membershipResponse.data.memberRole;
        setRole(nextRole);
        onRoleChange(nextRole);
        if (!canManageCompanyAsOwner(nextRole)) {
          setMembers([]);
          return;
        }
        const memberResponse = await getCompanyMembers(companyId, controller.signal);
        if (active) setMembers(memberResponse.data);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setRole(null);
        setMembers([]);
        onRoleChange(null);
        setLoadError(reason);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [companyId, onRoleChange, reloadKey]);

  async function confirmAction() {
    if (!pendingAction || pending) return;
    const action = pendingAction;
    setPending(true);
    setActionError("");
    setStatus("");
    try {
      if (action.kind === "REMOVE") {
        const response = await removeCompanyMember(companyId, action.member.userId);
        setMembers((current) => withoutRemovedMember(current, response.data.removedUserId));
        setStatus("Đã xóa thành viên khỏi công ty.");
      } else {
        const response = await transferCompanyOwnership(companyId, action.member.userId);
        setMembers(response.data);
        const safeRole = roleAfterOwnershipTransfer(role ?? "OWNER");
        setRole(safeRole);
        onRoleChange(safeRole);
        setMembers([]);
        setStatus("Đã chuyển quyền sở hữu. Quyền OWNER của bạn đã được ẩn ngay.");
        try {
          const latest = await getCurrentCompanyMembership();
          setRole(latest.data.memberRole);
          onRoleChange(latest.data.memberRole);
        } catch {
          setActionError("Đã chuyển quyền nhưng chưa tải lại được vai trò. Giao diện tiếp tục khóa quyền OWNER để an toàn.");
        }
      }
      setPendingAction(null);
    } catch (reason: unknown) {
      setActionError(toUserMessage(reason));
    } finally {
      setPending(false);
    }
  }

  const canManage = canManageCompanyAsOwner(role);
  return (
    <section className="panel company-members" aria-labelledby="company-members-title">
      <div className="section-head">
        <div><p className="eyebrow">COMPANY · MEMBERSHIP</p><h2 id="company-members-title">Thành viên công ty</h2><p className="help">Vai trò lấy từ Company Service; nếu không xác minh được, action OWNER bị ẩn.</p></div>
        {role ? <StatusBadge tone={role === "OWNER" ? "success" : "neutral"}>{role}</StatusBadge> : null}
      </div>
      <ConfirmationDialog
        open={pendingAction !== null}
        title={pendingAction?.kind === "TRANSFER" ? "Chuyển quyền sở hữu?" : "Xóa thành viên?"}
        description={pendingAction?.kind === "TRANSFER" ? "Sau xác nhận, bạn lập tức trở thành MEMBER và mất quyền OWNER." : "Thành viên sẽ mất quyền truy cập dữ liệu công ty."}
        confirmLabel={pendingAction?.kind === "TRANSFER" ? "Chuyển quyền OWNER" : "Xóa thành viên"}
        pending={pending}
        onConfirm={() => { void confirmAction(); }}
        onCancel={() => { if (!pending) setPendingAction(null); }}
      />
      {status ? <p className="notice notice-success" role="status">{status}</p> : null}
      {actionError ? <p className="notice notice-danger" role="alert"><strong>Chưa hoàn tất thao tác.</strong> {actionError}</p> : null}
      {loading ? <LoadingState label="Đang tải vai trò và thành viên" /> : null}
      {loadError ? <ErrorState message={toUserMessage(loadError)} onRetry={() => setReloadKey((value) => value + 1)} /> : null}
      {!loading && !loadError && !canManage ? <div className="notice"><strong>Chế độ MEMBER</strong><p>Bạn có thể xem hồ sơ nhưng action mời, xóa và chuyển OWNER đã bị ẩn.</p></div> : null}
      {!loading && !loadError && canManage ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Người dùng</th><th>Vai trò</th><th>Tham gia</th><th>Thao tác</th></tr></thead>
            <tbody>{members.map((member) => (
              <tr key={member.userId}>
                <td><code>{member.userId}</code></td>
                <td><StatusBadge tone={member.role === "OWNER" ? "success" : "neutral"}>{member.role}</StatusBadge></td>
                <td>{new Date(member.joinedAt).toLocaleDateString("vi-VN")}</td>
                <td>{member.role === "MEMBER" ? <div className="btn-group">
                  <button className="btn btn-secondary" type="button" onClick={() => setPendingAction({ kind: "TRANSFER", member })}>Chuyển OWNER</button>
                  <button className="btn btn-danger" type="button" onClick={() => setPendingAction({ kind: "REMOVE", member })}>Xóa</button>
                </div> : <span className="help">OWNER hiện tại</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
