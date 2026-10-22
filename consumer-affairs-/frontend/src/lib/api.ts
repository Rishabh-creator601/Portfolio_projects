import axios, {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  InternalAxiosRequestConfig,
} from 'axios';
import { API_URL } from './constants';

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  meta?: { page?: number; limit?: number; total?: number; totalPages?: number; version?: string };
  error?: { message: string; code?: number; reason?: string; details?: unknown };
}

export class ApiError extends Error {
  status: number;
  reason?: string;
  details?: unknown;

  constructor(message: string, status: number, reason?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.reason = reason;
    this.details = details;
  }
}

/**
 * The access token is held in module memory only - never in localStorage, so a
 * stored XSS payload cannot read it back. Session continuity across reloads
 * comes from the httpOnly refresh cookie via /auth/refresh.
 */
let accessToken: string | null = null;
let onSessionExpired: (() => void) | null = null;

export const setAccessToken = (token: string | null) => {
  accessToken = token;
};
export const getAccessToken = () => accessToken;
export const setSessionExpiredHandler = (handler: (() => void) | null) => {
  onSessionExpired = handler;
};

export const api: AxiosInstance = axios.create({
  baseURL: API_URL,
  withCredentials: true, // required for the refresh cookie
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

type RetriableConfig = AxiosRequestConfig & { _retried?: boolean };

// Single-flight refresh: concurrent 401s wait on one refresh call.
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = axios
      .post<ApiEnvelope<{ accessToken: string }>>(
        `${API_URL}/auth/refresh`,
        {},
        { withCredentials: true, timeout: 15000 }
      )
      .then((res) => res.data?.data?.accessToken ?? null)
      .catch(() => null)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiEnvelope<unknown>>) => {
    const original = error.config as RetriableConfig | undefined;
    const status = error.response?.status ?? 0;
    const reason = error.response?.data?.error?.reason;
    const url = original?.url || '';

    const isAuthEndpoint = url.includes('/auth/refresh') || url.includes('/auth/login');

    // An expired access token is recoverable: refresh once, then replay.
    if (status === 401 && original && !original._retried && !isAuthEndpoint) {
      original._retried = true;
      const fresh = await refreshAccessToken();

      if (fresh) {
        setAccessToken(fresh);
        original.headers = { ...original.headers, Authorization: `Bearer ${fresh}` };
        return api.request(original);
      }

      setAccessToken(null);
      onSessionExpired?.();
    }

    if (!error.response) {
      return Promise.reject(
        new ApiError(
          error.code === 'ECONNABORTED'
            ? 'The request timed out. Please try again.'
            : 'Cannot reach the LM-Verify API. Check that the backend is running.',
          0,
          'NETWORK'
        )
      );
    }

    return Promise.reject(
      new ApiError(
        error.response.data?.error?.message || error.message || 'Unexpected server error',
        status,
        reason,
        error.response.data?.error?.details
      )
    );
  }
);

/** Unwraps the { success, data } envelope the API returns. */
async function unwrap<T>(promise: Promise<{ data: ApiEnvelope<T> }>): Promise<T> {
  const response = await promise;
  return response.data.data;
}

async function unwrapWithMeta<T>(
  promise: Promise<{ data: ApiEnvelope<T> }>
): Promise<{ data: T; meta: ApiEnvelope<T>['meta'] }> {
  const response = await promise;
  return { data: response.data.data, meta: response.data.meta };
}

export const get = <T>(url: string, config?: AxiosRequestConfig) =>
  unwrap<T>(api.get<ApiEnvelope<T>>(url, config));

export const getPaged = <T>(url: string, config?: AxiosRequestConfig) =>
  unwrapWithMeta<T>(api.get<ApiEnvelope<T>>(url, config));

export const post = <T>(url: string, body?: unknown, config?: AxiosRequestConfig) =>
  unwrap<T>(api.post<ApiEnvelope<T>>(url, body, config));

export const put = <T>(url: string, body?: unknown, config?: AxiosRequestConfig) =>
  unwrap<T>(api.put<ApiEnvelope<T>>(url, body, config));

export const del = <T>(url: string, config?: AxiosRequestConfig) =>
  unwrap<T>(api.delete<ApiEnvelope<T>>(url, config));

export { refreshAccessToken };
