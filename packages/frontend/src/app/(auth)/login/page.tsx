'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore, ApiError } from '@/stores/auth-store';
import { LoginSphere } from '@/components/login-sphere';
import {
  Lock,
  ShieldCheck,
  Info,
  Radio,
  Terminal,
  Network,
  Activity,
  Eye,
  MonitorSmartphone,
} from 'lucide-react';

/* ────────────────────────────────────────────────────── */
/*  Validation helpers                                    */
/* ────────────────────────────────────────────────────── */

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getLoginErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'Invalid email or password.';
    if (err.status === 429) return 'Too many login attempts. Please wait and try again.';
    if (err.status >= 500) return 'Server error. Please try again later.';
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return 'An unexpected error occurred. Please try again.';
}

/* ────────────────────────────────────────────────────── */
/*  Rotating micro-copy hook                              */
/* ────────────────────────────────────────────────────── */

const ROTATING_LINES = [
  'Unified access to your Nucleus infrastructure',
  'Secure visibility into devices, services & network ops',
  'Engineering-grade remote access and diagnostics',
  'Operational awareness for connected field assets',
  'Real-time telemetry across your device fleet',
];

function useRotatingText(lines: readonly string[], interval = 4000) {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIndex((prev) => (prev + 1) % lines.length);
        setVisible(true);
      }, 500);
    }, interval);
    return () => clearInterval(timer);
  }, [lines, interval]);

  return { text: lines[index], visible };
}

/* ────────────────────────────────────────────────────── */
/*  Trust indicators data                                 */
/* ────────────────────────────────────────────────────── */

const TRUST_ITEMS = [
  { icon: ShieldCheck, label: 'Secure Auth' },
  { icon: Eye,         label: 'Live Visibility' },
  { icon: Network,     label: 'Port Access' },
  { icon: Activity,    label: 'Diagnostics' },
] as const;

const CAPABILITY_ITEMS = [
  { icon: MonitorSmartphone, label: 'Device Visibility' },
  { icon: Radio,             label: 'Adapter Scanning' },
  { icon: Terminal,           label: 'Session Control' },
  { icon: ShieldCheck,       label: 'Audit Logging' },
] as const;

/* ────────────────────────────────────────────────────── */
/*  LoginPage                                             */
/* ────────────────────────────────────────────────────── */

export default function LoginPage() {
  const router = useRouter();
  const login = useAuthStore((s) => s.login);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isHydrated = useAuthStore((s) => s.isHydrated);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [loading, setLoading] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  const { text: rotatingText, visible: rotatingVisible } = useRotatingText(ROTATING_LINES);

  // Redirect if already authenticated
  useEffect(() => {
    if (isHydrated && isAuthenticated) {
      router.replace('/dashboard');
    }
  }, [isHydrated, isAuthenticated, router]);

  const validate = (): boolean => {
    const errors: { email?: string; password?: string } = {};
    if (!email.trim()) errors.email = 'Email is required.';
    else if (!isValidEmail(email)) errors.email = 'Please enter a valid email address.';
    if (!password) errors.password = 'Password is required.';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!validate()) return;
    setLoading(true);
    try {
      await login(email, password);
      router.push('/dashboard');
    } catch (err: unknown) {
      setError(getLoginErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-background text-on-surface font-body">

      {/* ── Ambient background layers ── */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
        {/* Dot grid */}
        <div className="absolute inset-0 network-grid opacity-30" />

        {/* Gradient blobs */}
        <div className="absolute top-[-15%] left-[20%] w-[700px] h-[700px] rounded-full bg-primary/8 blur-[160px]" />
        <div className="absolute bottom-[-20%] right-[-5%] w-[500px] h-[500px] rounded-full bg-tertiary/5 blur-[140px]" />
        <div className="absolute top-[40%] left-[-10%] w-[400px] h-[400px] rounded-full bg-primary/4 blur-[120px]" />

        {/* Animated accent nodes */}
        <div className="absolute top-[18%] right-[25%] hidden lg:block">
          <div className="w-1 h-1 bg-tertiary/40 rounded-full animate-pulse" />
          <div className="absolute top-0 left-0 w-24 h-[1px] bg-gradient-to-r from-tertiary/20 to-transparent rotate-[30deg]" />
        </div>
        <div className="absolute bottom-[22%] left-[15%] hidden lg:block">
          <div className="w-1.5 h-1.5 bg-primary/30 rounded-full animate-pulse" style={{ animationDelay: '1s' }} />
          <div className="absolute top-0 left-0 w-16 h-[1px] bg-gradient-to-r from-primary/15 to-transparent -rotate-45" />
        </div>
        <div className="absolute top-[60%] right-[10%] hidden lg:block">
          <div className="w-1 h-1 bg-primary/25 rounded-full animate-pulse" style={{ animationDelay: '2s' }} />
        </div>
      </div>

      {/* ── Main content ── */}
      <main className="relative z-10 flex flex-col min-h-screen">
        <div className="flex-grow flex items-center justify-center p-6 md:p-8 lg:p-6 xl:p-8">
          <div className="
            w-full max-w-[1500px]
            grid grid-cols-1 lg:grid-cols-12
            items-center gap-6 lg:gap-4
            animate-[fadeInUp_0.8s_ease-out_both]
          ">

            {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
            {/*  LEFT: Login Form  (5 cols — shifted left)        */}
            {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
            <div
              ref={formRef}
              className="
                w-full max-w-[400px] mx-auto lg:mx-0
                lg:col-span-4 lg:col-start-1
                order-2 lg:order-1
                animate-[fadeInLeft_0.8s_ease-out_0.2s_both]
              "
            >
              {/* Mobile hero */}
              <div className="lg:hidden mb-10 flex flex-col items-center text-center">
                <div className="w-48 h-48 mb-4">
                  <LoginSphere className="w-full h-full" />
                </div>
                <div className="text-2xl font-headline font-extrabold tracking-tight text-primary">
                  Nucleus
                </div>
                <div className="text-on-surface-variant text-sm mt-1">
                  Secure Industrial Remote Access
                </div>
              </div>

              {/* ── Form card ── */}
              <div className="
                bg-surface-container-low/80 backdrop-blur-xl
                p-8 md:p-10 rounded-2xl
                border border-outline-variant/10
                shadow-[0_0_60px_rgba(0,26,66,0.2),0_0_20px_rgba(77,142,255,0.05)]
              ">
                {/* Header */}
                <div className="mb-8">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Lock className="w-4 h-4 text-primary" />
                    </div>
                    <h2 className="text-xl font-headline font-bold text-on-surface">
                      Operator Authentication
                    </h2>
                  </div>
                  <p className="text-on-surface-variant text-sm leading-relaxed">
                    Enter your credentials to access the Nucleus command center.
                  </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                  {error && (
                    <div className="rounded-xl px-4 py-3 text-sm bg-error-container/20 border border-error/20 text-error flex items-center gap-2">
                      <Info className="w-4 h-4 flex-shrink-0" />
                      {error}
                    </div>
                  )}

                  {/* Email */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold text-on-surface-variant/80 uppercase tracking-wider ml-1" htmlFor="email">
                      Work Email
                    </label>
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: undefined }));
                      }}
                      className={`
                        w-full bg-surface-container-highest/80
                        border border-outline-variant/15
                        focus:border-primary/40 focus:ring-1 focus:ring-primary/20
                        rounded-xl py-3.5 px-4
                        text-on-surface text-sm
                        transition-all duration-200
                        placeholder:text-outline/30 outline-none
                        ${fieldErrors.email ? 'border-error/40 ring-1 ring-error/20' : ''}
                      `}
                      placeholder="operator@nexus-corp.com"
                      autoComplete="email"
                    />
                    {fieldErrors.email && (
                      <p className="text-xs text-error ml-1">{fieldErrors.email}</p>
                    )}
                  </div>

                  {/* Password */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <label className="text-[11px] font-semibold text-on-surface-variant/80 uppercase tracking-wider ml-1" htmlFor="password">
                        Password
                      </label>
                      <a className="text-[11px] font-medium text-primary/70 hover:text-primary transition-colors" href="#">
                        Forgot Password?
                      </a>
                    </div>
                    <input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (fieldErrors.password) setFieldErrors((prev) => ({ ...prev, password: undefined }));
                      }}
                      className={`
                        w-full bg-surface-container-highest/80
                        border border-outline-variant/15
                        focus:border-primary/40 focus:ring-1 focus:ring-primary/20
                        rounded-xl py-3.5 px-4
                        text-on-surface text-sm
                        transition-all duration-200
                        placeholder:text-outline/30 outline-none
                        ${fieldErrors.password ? 'border-error/40 ring-1 ring-error/20' : ''}
                      `}
                      placeholder="Enter your password"
                      autoComplete="current-password"
                    />
                    {fieldErrors.password && (
                      <p className="text-xs text-error ml-1">{fieldErrors.password}</p>
                    )}
                  </div>

                  {/* Remember device */}
                  <div className="flex items-center gap-2.5">
                    <input
                      id="remember"
                      type="checkbox"
                      checked={rememberDevice}
                      onChange={(e) => setRememberDevice(e.target.checked)}
                      className="w-4 h-4 rounded bg-surface-container-highest border-outline-variant/30 text-primary focus:ring-primary/30 focus:ring-offset-0"
                    />
                    <label className="text-sm text-on-surface-variant/70" htmlFor="remember">
                      Remember this device for 30 days
                    </label>
                  </div>

                  {/* Sign In */}
                  <button
                    type="submit"
                    disabled={loading}
                    className="
                      w-full py-4 px-6 rounded-xl
                      text-on-primary font-bold text-sm uppercase tracking-wide
                      gradient-button
                      hover:shadow-[0_4px_24px_rgba(77,142,255,0.35)]
                      focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-background
                      transition-all duration-300 active:scale-[0.98]
                      disabled:opacity-50 disabled:cursor-not-allowed
                    "
                  >
                    {loading ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Authenticating&hellip;
                      </span>
                    ) : (
                      'Sign In'
                    )}
                  </button>

                  {/* Separator */}
                  <div className="relative py-1">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-outline-variant/15" />
                    </div>
                    <div className="relative flex justify-center">
                      <span className="bg-surface-container-low/80 px-4 text-[10px] font-technical text-outline/50 uppercase tracking-widest">
                        Or Identity Provider
                      </span>
                    </div>
                  </div>

                  {/* SAML */}
                  <button
                    type="button"
                    className="
                      w-full flex items-center justify-center gap-3
                      bg-transparent border border-outline-variant/20 py-3.5 rounded-xl
                      text-on-surface/80 font-medium text-sm
                      hover:bg-surface-variant/30 hover:border-outline-variant/30
                      transition-all duration-300
                    "
                  >
                    <ShieldCheck className="w-4 h-4" />
                    Sign in with SAML
                  </button>
                </form>

                {/* Security notice */}
                <div className="mt-6 pt-4">
                  <div className="flex items-start gap-3 p-3.5 rounded-xl bg-surface-container-lowest/40">
                    <Info className="w-4 h-4 text-primary/50 flex-shrink-0 mt-0.5" />
                    <p className="text-[11px] text-on-surface-variant/60 leading-relaxed">
                      Unauthorized access is strictly prohibited and monitored.
                      All sessions are logged for audit compliance.
                    </p>
                  </div>
                </div>
              </div>

              {/* Capabilities row below form (desktop only) */}
              <div className="hidden lg:flex items-center justify-between mt-6 px-2">
                {CAPABILITY_ITEMS.map((item) => (
                  <div key={item.label} className="flex items-center gap-2 text-on-surface-variant/40">
                    <item.icon className="w-3.5 h-3.5" />
                    <span className="text-[10px] font-technical uppercase tracking-wider">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
            {/*  RIGHT: Hero Sphere + Branding  (7 cols)          */}
            {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
            <div className="
              hidden lg:flex flex-col items-center
              lg:col-span-8 lg:col-start-5
              order-1 lg:order-2
              animate-[fadeInRight_0.8s_ease-out_0.3s_both]
            ">
              {/* Sphere container — seamless blend into background */}
              <div className="relative w-full max-w-[660px] -mt-4" style={{ aspectRatio: '1 / 1' }}>
                {/* Ambient glow behind sphere — soft radial, no box edge */}
                <div className="absolute inset-[-15%] rounded-full bg-primary/5 blur-[120px]" />
                <div className="absolute inset-[-10%] rounded-full bg-tertiary/3 blur-[140px]" />

                {/* Canvas with feathered mask so edges dissolve into page */}
                <div className="absolute inset-0" style={{
                  maskImage: 'radial-gradient(ellipse 70% 70% at 50% 50%, black 55%, transparent 100%)',
                  WebkitMaskImage: 'radial-gradient(ellipse 70% 70% at 50% 50%, black 55%, transparent 100%)',
                }}>
                  <LoginSphere className="w-full h-full relative z-10" />
                </div>

                {/* Status indicator */}
                <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-3 z-20">
                  <div className="w-1.5 h-1.5 rounded-full bg-tertiary pulse-glow" />
                  <span className="font-technical text-[10px] text-tertiary/70 uppercase tracking-widest">
                    System Nominal
                  </span>
                </div>

                {/* Click hint */}
                <div className="absolute top-6 right-8 z-20">
                  <span className="font-technical text-[9px] text-on-surface-variant/25 uppercase tracking-widest">
                    Click sphere to interact
                  </span>
                </div>
              </div>

              {/* Branding text below sphere */}
              <div className="text-center -mt-4 max-w-lg">
                <h1 className="font-headline text-4xl xl:text-5xl font-extrabold tracking-tight text-on-surface leading-tight">
                  Nucleus Remote{' '}
                  <span className="text-primary">Access</span>
                </h1>

                {/* Rotating micro-copy */}
                <div className="h-7 mt-4 flex items-center justify-center overflow-hidden">
                  <p className={`
                    text-on-surface-variant/60 text-sm font-body leading-relaxed
                    transition-all duration-500 ease-in-out
                    ${rotatingVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}
                  `}>
                    {rotatingText}
                  </p>
                </div>

                {/* Trust badges */}
                <div className="flex items-center justify-center gap-5 mt-6">
                  {TRUST_ITEMS.map((item) => (
                    <div
                      key={item.label}
                      className="
                        flex items-center gap-2 px-3.5 py-1.5
                        rounded-full bg-surface-container-low/60
                        border border-outline-variant/10
                      "
                    >
                      <item.icon className="w-3.5 h-3.5 text-tertiary/60" />
                      <span className="font-technical text-[9px] tracking-wider uppercase text-on-surface-variant/50">
                        {item.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* ── Footer ── */}
        <footer className="
          w-full py-5 px-8
          flex flex-col md:flex-row justify-between items-center gap-3
          border-t border-outline-variant/8 mt-auto
        ">
          <div className="flex items-center gap-5">
            <span className="font-technical text-[10px] text-outline/50">
              VERSION v2.4.0
            </span>
            <span className="w-[1px] h-3 bg-outline/10 hidden md:block" />
            <div className="flex gap-4">
              {['Support', 'Security', 'Legal'].map((link) => (
                <a key={link} className="text-[11px] font-medium text-outline/50 hover:text-on-surface/70 transition-colors" href="#">
                  {link}
                </a>
              ))}
            </div>
          </div>
          <div className="text-[10px] font-technical text-outline/35 uppercase tracking-widest">
            &copy; 2024 Nucleus Industrial Systems
          </div>
        </footer>
      </main>
    </div>
  );
}
