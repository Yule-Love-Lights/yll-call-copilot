'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import {
  OTP_RESEND_COOLDOWN_MS,
  otpResendSecondsRemaining,
  requestPhoneOtp,
  verifyPhoneOtp,
} from '@/lib/auth/phoneAuth';
import TurnstileGate from './TurnstileGate';

const inputClass =
  'mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-zinc-700';

export default function PhoneLoginForm({
  denied,
  turnstileSiteKey,
}: {
  denied: boolean;
  turnstileSiteKey: string;
}) {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [submittedPhone, setSubmittedPhone] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaCycle, setCaptchaCycle] = useState(0);
  const [nextResendAt, setNextResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const resendSeconds = otpResendSecondsRemaining(nextResendAt, now);

  useEffect(() => {
    if (!submittedPhone || resendSeconds === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [resendSeconds, submittedPhone]);

  async function submitOtpRequest(rawPhone: string) {
    setError(null);
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setError('Authentication is temporarily unavailable. Please try again later.');
      return;
    }

    setSubmitting(true);
    const result = await requestPhoneOtp(supabase, { phone: rawPhone, captchaToken });
    setSubmitting(false);

    if (result.status === 'invalid_phone') {
      setError('Enter a valid phone number.');
      return;
    }
    if (result.status === 'captcha_required') {
      setError('Complete the security check.');
      return;
    }

    const requestedAt = Date.now();
    setSubmittedPhone(result.phone);
    setPhone(result.phone);
    setCode('');
    setNextResendAt(requestedAt + OTP_RESEND_COOLDOWN_MS);
    setNow(requestedAt);
    setCaptchaToken(null);
    setCaptchaCycle(current => current + 1);
  }

  async function handleRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitOtpRequest(phone);
  }

  async function handleVerify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !submittedPhone) {
      setError('Authentication is temporarily unavailable. Please try again later.');
      return;
    }

    setSubmitting(true);
    const result = await verifyPhoneOtp(supabase, { phone: submittedPhone, code });
    setSubmitting(false);
    if (result.status !== 'signed_in') {
      setError('That code could not be verified. Request a new code and try again.');
      return;
    }

    router.push('/');
    router.refresh();
  }

  async function handleResend() {
    if (!submittedPhone || resendSeconds > 0 || submitting) return;
    await submitOtpRequest(submittedPhone);
  }

  function editPhone() {
    setSubmittedPhone(null);
    setCode('');
    setError(null);
    setCaptchaToken(null);
    setCaptchaCycle(current => current + 1);
  }

  if (!submittedPhone) {
    return (
      <form onSubmit={handleRequest} className="space-y-4">
        {denied && <AccessDeniedBanner />}
        <div>
          <label htmlFor="phone" className="block text-sm font-medium">
            Mobile phone
          </label>
          <input
            id="phone"
            type="tel"
            required
            autoComplete="tel"
            inputMode="tel"
            value={phone}
            onChange={event => setPhone(event.target.value)}
            placeholder="(555) 123-4567"
            className={inputClass}
          />
        </div>
        <TurnstileGate
          key={captchaCycle}
          siteKey={turnstileSiteKey}
          onToken={setCaptchaToken}
        />
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={submitting || !captchaToken}
          className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? 'Sending…' : 'Text me a code'}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleVerify} className="space-y-4">
      {denied && <AccessDeniedBanner />}
      <div className="rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
        If this number is authorized, a code was sent to {submittedPhone}.
      </div>
      <div>
        <label htmlFor="code" className="block text-sm font-medium">
          Six-digit code
        </label>
        <input
          id="code"
          type="text"
          required
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          value={code}
          onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          className={inputClass}
        />
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={submitting || code.length !== 6}
        className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {submitting ? 'Checking…' : 'Sign in'}
      </button>
      <div className="space-y-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <TurnstileGate
          key={captchaCycle}
          siteKey={turnstileSiteKey}
          onToken={setCaptchaToken}
        />
        <button
          type="button"
          onClick={handleResend}
          disabled={submitting || resendSeconds > 0 || !captchaToken}
          className="w-full text-sm text-[var(--op-dim)] hover:underline disabled:no-underline disabled:opacity-50"
        >
          {resendSeconds > 0 ? `Send another code in ${resendSeconds}s` : 'Send another code'}
        </button>
        <button
          type="button"
          onClick={editPhone}
          className="w-full text-sm text-[var(--op-dim)] hover:underline"
        >
          Use a different phone number
        </button>
      </div>
    </form>
  );
}

function AccessDeniedBanner() {
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
      This account cannot access Operations Hub.
    </div>
  );
}
