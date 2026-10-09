import {
  ApiClientError, clearApiSession, configureApiSessionRefresh,
  getApiSessionAccountId, requestApi, setApiSession, subscribeToApiSession,
} from "./apiClientCore";

export interface CurrentAccount {
  id: string;
  email: string;
  role: "CANDIDATE" | "RECRUITER" | "ADMIN";
}

interface LoginResponse {
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

configureApiSessionRefresh(async () => {
  const current = getCurrentAccount();
  if (!current) return null;
  
  // We don't have the refresh token on client, the proxy route will read it from cookies
  const result = await requestApi<LoginResponse>("/auth-cookie/refresh", {
    method: "POST", body: {}, privateData: true,
    authRecovery: false, attachAccessToken: false, maxRetries: 0,
  });
  
  validateLoginResponse(result.data);
  if (getCurrentAccount()?.id !== current.id || result.data.user.id !== current.id) return null;
  if (result.data.user.role !== current.role) {
    clearApiSession();
    return null;
  }
  account = result.data.user;
  return { token: null, accountId: account.id }; // Token is handled by cookies
});

export async function hydrateSession(): Promise<void> {
  if (initialized) return;
  initialized = true;
  if (typeof window === "undefined") return;
  
  try {
    const result = await requestApi<CurrentAccount>("/auth/me", {
      privateData: true, authRecovery: false, attachAccessToken: false, maxRetries: 0,
    });
    
    if (result.data?.id) {
      account = result.data;
      hydrating = false;
      setApiSession({ token: null, accountId: account.id });
    } else {
      hydrating = false;
      clearApiSession();
    }
  } catch (error) {
    // Not logged in or expired
    hydrating = false;
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
