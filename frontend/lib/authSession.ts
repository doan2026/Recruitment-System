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

let account: CurrentAccount | null = null;
let initialized = false;
let hydrating = typeof window !== "undefined";

export function getCurrentAccount(): CurrentAccount | null | undefined {
  if (hydrating) return undefined;
  return account?.id === getApiSessionAccountId() ? account : null;
}

subscribeToApiSession(() => {
  if (!getApiSessionAccountId()) {
    account = null;
  }
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
  
  // We don't have the refresh token on client, the proxy route will read it from cookies
  const result = await requestApi<LoginResponse>("/auth-cookie/refresh", {
    method: "POST", body: {}, privateData: true,
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
    
    if (result.data?.id) {
      validateLoginResponse({ user: result.data });
      account = result.data;
      hydrating = false;
      setApiSession({ token: null, accountId: account.id });
    } else {
      hydrating = false;
      clearApiSession();
    }
  } catch (error) {
    hydrating = false;
    // A newer login owns the session when the hydration request was cancelled.
    if (error instanceof ApiClientError && error.code === "REQUEST_CANCELLED") return;
    clearApiSession();
  }
}

// Call hydration on load
hydrateSession();

export async function signIn(email: string, password: string): Promise<CurrentAccount> {
  const response = await requestApi<LoginResponse>("/auth-cookie/login", {
    method: "POST", body: { email: email.trim(), password }, privateData: true,
    authRecovery: false, attachAccessToken: false, maxRetries: 0,
  });
  validateLoginResponse(response.data);
  hydrating = false;
  account = response.data.user;
  setApiSession({ token: null, accountId: account.id });
  return account;
}

export async function signOut(): Promise<void> {
  clearApiSession();
  await requestApi<void>("/auth-cookie/logout", {
    method: "POST", body: {}, privateData: true, authRecovery: false, attachAccessToken: false, maxRetries: 0,
  });
}
