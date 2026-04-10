'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { UserPlus, Loader2, AlertTriangle, Check, Lock, User } from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

interface InviteInfo {
  readonly email: string;
  readonly role: string;
}

export default function AcceptInvitePage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;

  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    async function fetchInvite() {
      try {
        const res = await fetch(`${API_BASE}/auth/invite/${token}`);
        const data = await res.json();
        if (data.success && data.data) {
          setInviteInfo(data.data);
        } else {
          setError(data.error || 'Invalid or expired invitation');
        }
      } catch {
        setError('Failed to load invitation');
      } finally {
        setLoading(false);
      }
    }
    fetchInvite();
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    if (password !== confirmPassword) {
      setSubmitError('Passwords do not match');
      return;
    }
    if (password.length < 6) {
      setSubmitError('Password must be at least 6 characters');
      return;
    }
    if (!displayName.trim()) {
      setSubmitError('Display name is required');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/auth/accept-invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, displayName: displayName.trim(), password }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccess(true);
        setTimeout(() => router.push('/login'), 3000);
      } else {
        setSubmitError(data.error || 'Failed to create account');
      }
    } catch {
      setSubmitError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-3 text-on-surface-variant">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Loading invitation...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="bg-surface-container-low rounded-2xl p-8 max-w-md w-full text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-full bg-error/10 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6 text-error" />
          </div>
          <h1 className="font-headline font-bold text-on-surface text-xl">Invitation Invalid</h1>
          <p className="text-sm text-on-surface-variant">{error}</p>
          <button
            onClick={() => router.push('/login')}
            className="mt-4 px-6 py-2.5 rounded-xl bg-primary/10 text-primary text-sm font-bold hover:bg-primary/20 transition-colors"
          >
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="bg-surface-container-low rounded-2xl p-8 max-w-md w-full text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-full bg-tertiary/10 flex items-center justify-center">
            <Check className="w-6 h-6 text-tertiary" />
          </div>
          <h1 className="font-headline font-bold text-on-surface text-xl">Account Created!</h1>
          <p className="text-sm text-on-surface-variant">
            Your account has been created. Redirecting to login...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="bg-surface-container-low rounded-2xl p-8 max-w-md w-full space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <UserPlus className="w-6 h-6 text-primary" />
          </div>
          <h1 className="font-headline font-bold text-on-surface text-xl">
            Join Nucleus Portal
          </h1>
          <p className="text-sm text-on-surface-variant">
            You&apos;ve been invited as <span className="font-bold text-primary uppercase">{inviteInfo?.role}</span>
          </p>
          <p className="text-xs text-on-surface-variant/60 font-technical">
            {inviteInfo?.email}
          </p>
        </div>

        {submitError && (
          <div className="bg-error/5 border border-error/20 rounded-xl p-3 text-sm text-error">
            {submitError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm text-on-surface-variant font-medium mb-1.5 block">
              Full Name
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-outline-variant" />
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Juan Mejia Lerma"
                required
                className="w-full bg-surface-container-highest rounded-xl pl-10 pr-4 py-2.5 text-sm text-on-surface font-body focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-outline-variant"
              />
            </div>
          </div>

          <div>
            <label className="text-sm text-on-surface-variant font-medium mb-1.5 block">
              Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-outline-variant" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min 6 characters"
                required
                minLength={6}
                className="w-full bg-surface-container-highest rounded-xl pl-10 pr-4 py-2.5 text-sm text-on-surface font-body focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-outline-variant"
              />
            </div>
          </div>

          <div>
            <label className="text-sm text-on-surface-variant font-medium mb-1.5 block">
              Confirm Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-outline-variant" />
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat password"
                required
                minLength={6}
                className="w-full bg-surface-container-highest rounded-xl pl-10 pr-4 py-2.5 text-sm text-on-surface font-body focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-outline-variant"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting || !displayName.trim() || !password || !confirmPassword}
            className="w-full bg-gradient-to-br from-primary to-primary-container text-on-primary font-bold py-3 rounded-xl hover:shadow-[0_0_20px_rgba(173,198,255,0.4)] transition-all active:scale-95 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Creating Account...
              </span>
            ) : (
              'Create My Account'
            )}
          </button>
        </form>

        <p className="text-[10px] text-on-surface-variant/40 text-center font-technical">
          By creating an account you agree to the portal terms of use.
        </p>
      </div>
    </div>
  );
}
