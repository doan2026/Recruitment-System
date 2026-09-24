import {
  ApiClientError, clearApiSession, configureApiSessionRefresh,
  getApiSessionAccountId, requestApi, setApiSession, subscribeToApiSession,
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

// Auth currently returns tokens in JSON, not HttpOnly cookies. Keep both tokens
// in memory only; a full reload intentionally requires signing in again.
let account: CurrentAccount | null = null;
let refreshToken: string | null = null;

export function getCurrentAccount(): CurrentAccount | null {
  return account?.id === getApiSessionAccountId() ? account : null;
}

subscribeToApiSession(() => {
  if (!getApiSessionAccountId()) {
    account = null;
    refreshToken = null;
    configureApiSessionRefresh(null);
  }
});

function validateTokens(value: TokenResponse): void {
  if (!value || !value.accessToken || !value.refreshToken || value.tokenType !== "Bearer"
    || !value.user?.id || !value.user.email
    || !["CANDIDATE", "RECRUITER", "ADMIN"].includes(value.user.role)) {
    throw new ApiClientError({ code: "INVALID_API_RESPONSE" });
  }
}

export async function signIn(email: string, password: string): Promise<CurrentAccount> {
  const response = await requestApi<TokenResponse>("/auth/login", {
    method: "POST", body: { email: email.trim(), password }, privateData: true,
    authRecovery: false, attachAccessToken: false, maxRetries: 0,
  });
  validateTokens(response.data);
  return establishSession(response.data);
}

export function establishSession(tokens: TokenResponse): CurrentAccount {
  validateTokens(tokens);
  account = tokens.user;
  refreshToken = tokens.refreshToken;
  setApiSession({ token: tokens.accessToken, accountId: account.id });
  configureApiSessionRefresh(async () => {
    const current = getCurrentAccount();
    const presented = refreshToken;
    if (!current || !presented) return null;
    const result = await requestApi<TokenResponse>("/auth/refresh", {
      method: "POST", body: { refreshToken: presented }, privateData: true,
      authRecovery: false, attachAccessToken: false, maxRetries: 0,
    });
    validateTokens(result.data);
    if (getCurrentAccount()?.id !== current.id || result.data.user.id !== current.id
      || refreshToken !== presented) return null;
    if (result.data.user.role !== current.role) {
      clearApiSession();
      return null;
    }
    account = result.data.user;
    refreshToken = result.data.refreshToken;
    return { token: result.data.accessToken, accountId: account.id };
  });
  return account;
}

export async function signOut(): Promise<void> {
  const presented = refreshToken;
  // Clear private UI even if server logout fails. Do not replay a mutation.
  clearApiSession();
  if (presented) await requestApi<void>("/auth/logout", {
    method: "POST", body: { refreshToken: presented },
    privateData: true, authRecovery: false, attachAccessToken: false, maxRetries: 0,
  });
}
