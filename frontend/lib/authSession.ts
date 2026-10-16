import {
  ApiClientError, clearApiSession, configureApiSessionRefresh,
  getApiSessionAccountId, getApiSessionRevision, requestApi,
  setApiSession, subscribeToApiSession,
} from "./apiClientCore";

export interface CurrentAccount {
  id: string;
  email: string;
  role: "CANDIDATE" | "RECRUITER" | "ADMIN";
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  user: CurrentAccount;
}

export interface LoginResponse { user: CurrentAccount }
let account: CurrentAccount | null = null;
// A one-time Google exchange starts immediately on this page. Anonymous cookie
// hydration must not invalidate its in-flight request before the code is used.
let hydrating = typeof window !== "undefined" && window.location.pathname !== "/auth/callback";

export function getCurrentAccount(): CurrentAccount | null | undefined {
  if (hydrating) return undefined;
  return account?.id === getApiSessionAccountId() ? account : null;
}

subscribeToApiSession(() => {
  if (!getApiSessionAccountId()) account = null;
});

function validateLoginResponse(value: LoginResponse): void {
  if (!value || !value.user?.id || !value.user.email
    || !["CANDIDATE", "RECRUITER", "ADMIN"].includes(value.user.role)) {
    throw new ApiClientError({ code: "INVALID_API_RESPONSE" });
  }
}

export async function refreshAuthSession() {
  const current = getCurrentAccount();
  if (!current) return null;
  const revision = getApiSessionRevision();
  const options = {
    method: "POST" as const, privateData: true,
    authRecovery: false, attachAccessToken: false, maxRetries: 0,
  };
  const result = await requestApi<LoginResponse>("/auth-cookie/refresh", { ...options, body: {} });
  validateLoginResponse(result.data);
  if (getApiSessionRevision() !== revision || result.data.user.id !== current.id) {
    throw new ApiClientError({ code: "REQUEST_CANCELLED" });
  }
  return { token: null, accountId: current.id };
}

export function establishSession(response: LoginResponse): CurrentAccount {
  validateLoginResponse(response);
  account = response.user;
  hydrating = false;
  configureApiSessionRefresh(refreshAuthSession);
  setApiSession({ token: null, accountId: account.id });
  return account;
}

async function hydrateSession(): Promise<void> {
  if (typeof window === "undefined" || !hydrating) return;
  const revision = getApiSessionRevision();
  try {
    let user: CurrentAccount;
    try {
      const result = await requestApi<CurrentAccount>("/auth/me", {
        privateData: true, authRecovery: false, maxRetries: 0,
      });
      user = result.data;
    } catch (error) {
      if (!(error instanceof ApiClientError) || error.status !== 401) throw error;
      const refreshed = await requestApi<LoginResponse>("/auth-cookie/refresh", {
        method: "POST", body: {}, privateData: true,
        authRecovery: false, attachAccessToken: false, maxRetries: 0,
      });
      user = refreshed.data.user;
    }
    validateLoginResponse({ user });
    if (getApiSessionRevision() !== revision) return;
    account = user;
    hydrating = false;
    setApiSession({ token: null, accountId: user.id });
  } catch (error) {
    if (getApiSessionRevision() !== revision) return;
    hydrating = false;
    if (error instanceof ApiClientError && error.code === "REQUEST_CANCELLED") return;
    clearApiSession();
  }
}

configureApiSessionRefresh(refreshAuthSession);
void hydrateSession();

export async function signIn(email: string, password: string): Promise<CurrentAccount> {
  const response = await requestApi<LoginResponse>("/auth-cookie/login", {
    method: "POST", body: { email: email.trim(), password }, privateData: true,
    authRecovery: false, attachAccessToken: false, maxRetries: 0,
  });
  return establishSession(response.data);
}

export async function signOut(): Promise<void> {
  clearApiSession();
  await requestApi<void>("/auth-cookie/logout", {
    method: "POST", body: {},
    privateData: true, authRecovery: false, attachAccessToken: false, maxRetries: 0,
  });
}
