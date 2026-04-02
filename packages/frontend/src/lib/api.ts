const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

let isRefreshing = false;
let refreshPromise: Promise<string | null> | null = null;

// ---------- Zustand store bridge ----------
// Lazily imported to avoid circular dependency (auth-store imports api)

let _storeModule: typeof import('@/stores/auth-store') | null = null;

async function getAuthStore() {
  if (!_storeModule) {
    _storeModule = await import('@/stores/auth-store');
  }
  return _storeModule.useAuthStore;
}

function getTokensFromStore(): { accessToken: string; refreshToken: string } | null {
  // Synchronous read from Zustand store (no async import needed after first call)
  if (!_storeModule) {
    // Fallback: read from localStorage directly during initial load
    try {
      const raw = localStorage.getItem('nucleus-auth');
      if (!raw) return null;
      const stored = JSON.parse(raw);
      const accessToken = stored?.state?.accessToken;
      const refreshToken = stored?.state?.refreshToken;
      if (!accessToken || !refreshToken) return null;
      return { accessToken, refreshToken };
    } catch {
      return null;
    }
  }
  const state = _storeModule.useAuthStore.getState();
  if (!state.accessToken || !state.refreshToken) return null;
  return { accessToken: state.accessToken, refreshToken: state.refreshToken };
}

function clearAuth(): void {
  if (_storeModule) {
    _storeModule.useAuthStore.setState({
      isAuthenticated: false,
      user: null,
      accessToken: null,
      refreshToken: null,
    });
  } else {
    localStorage.removeItem('nucleus-auth');
  }
  if (typeof window !== 'undefined') {
    window.location.href = '/login';
  }
}

// ---------- JWT expiry check ----------

function isTokenExpiringSoon(token: string, thresholdMs = 60_000): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const expiresAt = payload.exp * 1000;
    return expiresAt - Date.now() < thresholdMs;
  } catch {
    return false;
  }
}

// ---------- Token refresh ----------

async function refreshAccessToken(): Promise<string | null> {
  const tokens = getTokensFromStore();
  if (!tokens?.refreshToken) return null;

  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    });

    if (!res.ok) {
      clearAuth();
      return null;
    }

    const data = await res.json();

    if (data.success && data.data) {
      // Update tokens through Zustand store (keeps in-memory + localStorage in sync)
      const store = await getAuthStore();
      store.setState({
        accessToken: data.data.accessToken,
        refreshToken: data.data.refreshToken,
      });
      return data.data.accessToken as string;
    }

    clearAuth();
    return null;
  } catch {
    clearAuth();
    return null;
  }
}

// ---------- Get a valid (or proactively refreshed) token ----------

async function getValidToken(): Promise<string | null> {
  const tokens = getTokensFromStore();
  if (!tokens?.accessToken) return null;

  if (isTokenExpiringSoon(tokens.accessToken)) {
    if (!isRefreshing) {
      isRefreshing = true;
      refreshPromise = refreshAccessToken().finally(() => {
        isRefreshing = false;
        refreshPromise = null;
      });
    }
    return refreshPromise;
  }

  return tokens.accessToken;
}

// ---------- Custom error class ----------

export class ApiError extends Error {
  public readonly status: number;
  public readonly data: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

// ---------- Core request function with 401 retry ----------

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getValidToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  // On 401 attempt a single refresh-and-retry cycle
  if (res.status === 401 && token) {
    if (!isRefreshing) {
      isRefreshing = true;
      refreshPromise = refreshAccessToken().finally(() => {
        isRefreshing = false;
        refreshPromise = null;
      });
    }

    const newToken = await refreshPromise;

    if (newToken) {
      headers['Authorization'] = `Bearer ${newToken}`;
      res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    } else {
      throw new ApiError('Session expired. Please login again.', 401);
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message =
      (body as Record<string, string>).error ??
      (body as Record<string, string>).message ??
      `Request failed: ${res.status}`;
    throw new ApiError(message, res.status, body);
  }

  return res.json() as Promise<T>;
}

// ---------- Public API surface ----------

export const api = {
  get: <T>(path: string) => request<T>(path),

  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    }),

  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    }),

  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
