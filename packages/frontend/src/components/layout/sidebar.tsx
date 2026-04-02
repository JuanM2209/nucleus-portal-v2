'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  Home,
  ArrowLeftRight,
  Radar,
  BarChart3,
  ScrollText,
  Settings,
  LogOut,
  HelpCircle,
  Menu,
  X,
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { useSidebarStore } from '@/stores/sidebar-store';

interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: React.ComponentType<{ className?: string }>;
}

const mainNavItems: readonly NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: Home },
  { href: '/devices', label: 'Devices', icon: Radar },
  { href: '/sessions', label: 'Sessions', icon: ArrowLeftRight },
  { href: '/logs', label: 'Logs', icon: ScrollText },
  { href: '/admin', label: 'Admin Overview', icon: BarChart3 },
] as const;

const bottomNavItems: readonly NavItem[] = [
  { href: '/support', label: 'Support', icon: HelpCircle },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const;

/* ── Mobile Menu Button (rendered outside sidebar) ── */

export function MobileMenuButton() {
  const open = useSidebarStore((s) => s.open);

  return (
    <button
      onClick={open}
      className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-lg bg-surface-container-high text-on-surface hover:bg-surface-bright transition-colors"
      aria-label="Open menu"
    >
      <Menu className="w-5 h-5" />
    </button>
  );
}

/* ── Sidebar ── */

export function Sidebar() {
  const pathname = usePathname();
  const logout = useAuthStore((s) => s.logout);
  const { isOpen, close } = useSidebarStore();

  return (
    <>
      {/* Mobile backdrop overlay */}
      {isOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
          onClick={close}
        />
      )}

      {/* Sidebar panel */}
      <aside
        className={`fixed left-0 top-0 h-full w-64 bg-surface-container-low flex flex-col py-5 z-50 border-r border-outline-variant/10 overflow-y-auto transition-transform duration-300 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0`}
      >
        {/* Mobile close button */}
        <button
          onClick={close}
          className="lg:hidden absolute top-4 right-3 p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
          aria-label="Close menu"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Tyrion Integration Logo */}
        <div className="mb-6 px-3">
          <Image
            src="/tyrion-logo.png"
            alt="Tyrion Integration"
            width={180}
            height={47}
            className="w-full h-auto"
            priority
          />
        </div>

        {/* Main Navigation */}
        <nav className="flex-1 w-full px-3 space-y-0.5">
          {mainNavItems.map((item) => {
            const isActive = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={close}
                className={`rounded-xl flex items-center gap-3 h-10 w-full px-3 transition-colors text-sm ${
                  isActive
                    ? 'bg-primary-container/10 text-primary font-medium'
                    : 'text-on-surface-variant/60 hover:text-on-surface hover:bg-surface-container-high'
                }`}
              >
                <Icon className="w-[18px] h-[18px] flex-shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Bottom Navigation */}
        <div className="mt-auto w-full px-3 space-y-0.5 border-t border-outline-variant/10 pt-4">
          {bottomNavItems.map((item) => {
            const isActive = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={close}
                className={`rounded-xl flex items-center gap-3 h-10 w-full px-3 transition-colors text-sm ${
                  isActive
                    ? 'bg-primary-container/10 text-primary font-medium'
                    : 'text-on-surface-variant/60 hover:text-on-surface hover:bg-surface-container-high'
                }`}
              >
                <Icon className="w-[18px] h-[18px] flex-shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}

          <button
            onClick={logout}
            className="rounded-xl flex items-center gap-3 h-10 w-full px-3 transition-colors text-sm text-on-surface-variant/60 hover:text-on-surface hover:bg-surface-container-high"
          >
            <LogOut className="w-[18px] h-[18px] flex-shrink-0" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>
    </>
  );
}
