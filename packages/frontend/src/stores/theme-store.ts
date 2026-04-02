import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ThemeState {
  readonly theme: 'dark' | 'light';
  readonly setTheme: (theme: 'dark' | 'light') => void;
  readonly toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'dark',
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
    }),
    { name: 'nucleus-theme' },
  ),
);
