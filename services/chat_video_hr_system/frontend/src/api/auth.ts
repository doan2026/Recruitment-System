import { apiFetch, setAccessToken } from './client';

export interface User {
  id: string;
  email: string;
  full_name: string;
  created_at: string;
}

export interface AuthResponse {
  user: User;
  access_token: string;
}

export const authApi = {
  async register(email: string, password: string, fullName: string): Promise<AuthResponse> {
    const data = await apiFetch<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, full_name: fullName }),
    });
    setAccessToken(data.access_token);
    return data;
  },

  async login(email: string, password: string): Promise<AuthResponse> {
    const data = await apiFetch<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setAccessToken(data.access_token);
    return data;
  },

  async refresh(): Promise<string> {
    const data = await apiFetch<{ access_token: string }>('/auth/refresh', {
      method: 'POST',
    });
    setAccessToken(data.access_token);
    return data.access_token;
  },

  async logout(): Promise<void> {
    await apiFetch('/auth/logout', { method: 'POST' }).catch(() => {});
    setAccessToken(null);
  },

  async getMe(): Promise<User> {
    return apiFetch<User>('/auth/me');
  },

  async listUsers(): Promise<User[]> {
    return apiFetch<User[]>('/auth/users');
  },
};
