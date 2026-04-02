'use client';

import { useAuthStore } from '@/stores/auth-store';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Sidebar, MobileMenuButton } from '@/components/layout/sidebar';
import { ErrorBoundary } from '@/components/ui/error-boundary';

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const router = useRouter();

  useEffect(() => {
    // Only redirect once zustand has rehydrated from localStorage.
    // Before hydration, isAuthenticated is the initial default (false) and
    // doesn't reflect what is actually stored.
    if (isHydrated && !isAuthenticated) {
      router.push('/login');
    }
  }, [isHydrated, isAuthenticated, router]);

  // While hydrating, show a lightweight loading indicator instead of a blank
  // screen. This avoids the flash-of-login-page issue.
  if (!isHydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-dim">
        <div className="flex flex-col items-center gap-3">
          <svg
            className="h-8 w-8 animate-spin text-primary"
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <span className="text-sm text-on-surface-variant font-technical tracking-wide">
            Loading&hellip;
          </span>
        </div>
      </div>
    );
  }

  // After hydration, if not authenticated we render nothing while the redirect
  // fires (prevents children from flashing).
  if (!isAuthenticated) return null;

  return (
    <div className="min-h-screen bg-surface-dim">
      <Sidebar />
      <MobileMenuButton />
      <main className="lg:ml-64 min-h-screen">
        <div className="p-6 pt-14 lg:pt-2 max-w-7xl mx-auto">
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </div>
      </main>
    </div>
  );
}
