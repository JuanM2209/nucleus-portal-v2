import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api, ApiError } from '@/lib/api';

// ---------- Types ----------

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  tenantId: string;
  roles: string[];
}

interface LoginResponse {
  success: boolean;
  data: {
    accessToken: string;
    refreshToken: string;
    user: AuthUser;
  };
}

interface AuthState {
  // Data
  isAuthenticated: boolean;
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;

  // Hydration flag -- true once zustand has rehydrated from localStorage
  isHydrated: boolean;

  // Actions
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setHydrated: () => void;
}

// ---------- Store ----------

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      isAuthenticated: false,
      user: null,
      accessToken: null,
      refreshToken: null,
      isHydrated: false,

      setHydrated: () => set({ isHydrated: true }),

      login: async (email: string, password: string) => {
        const response = await api.post<LoginResponse>('/auth/login', {
          email,
          password,
        });

        const { accessToken, refreshToken, user } = response.data;

        set({
          isAuthenticated: true,
          user,
          accessToken,
          refreshToken,
        });
      },

      logout: async () => {
        // Best-effort backend logout (invalidate refresh token server-side)
        const { refreshToken } = get();
        try {
          if (refreshToken) {
            await api.post('/auth/logout', { refreshToken });
          }
        } catch {
          // Swallow -- we clear local state regardless
        }

        set({
          isAuthenticated: false,
          user: null,
          accessToken: null,
          refreshToken: null,
        });
      },
    }),
    {
      name: 'nucleus-auth',
      partialize: (state) => ({
        isAuthenticated: state.isAuthenticated,
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
      }),
      onRehydrateStorage: () => (state, error) => {
        // Mark hydration complete so layout guards can safely check auth.
        // If state is undefined (no stored data) or rehydration errored,
        // still mark hydrated so the app doesn't stay stuck on loading.
        if (state) {
          state.setHydrated();
        } else {
          useAuthStore.setState({ isHydrated: true });
        }
      },
    },
  ),
);

// Re-export ApiError for convenience
export { ApiError };
