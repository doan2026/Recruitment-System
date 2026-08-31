import type { CompanyMemberRole } from "./person2Api";

export function canManageCompanyAsOwner(role: CompanyMemberRole | null): boolean {
  return role === "OWNER";
}

export function roleAfterOwnershipTransfer(currentRole: CompanyMemberRole): CompanyMemberRole {
  return currentRole === "OWNER" ? "MEMBER" : currentRole;
}

export function withoutRemovedMember<T extends { userId: string }>(
  members: readonly T[],
  removedUserId: string,
): T[] {
  return members.filter((member) => member.userId !== removedUserId);
}
