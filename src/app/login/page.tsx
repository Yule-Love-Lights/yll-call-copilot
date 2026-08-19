// /login — staff sign-in (email + password, no self-signup). Server
// component so we can check Supabase config server-side and show the friendly
// banner instead of a broken form (same pattern as /contacts and /verticals).
// The ?denied=1 flag comes from the proxy when a signed-in email is not in
// app_users; searchParams is a Promise in Next 16, hence the await.

import { isSupabaseConfigured } from '@/lib/supabase';
import { resolvePhoneAuthConfiguration } from '@/lib/auth/phoneAuth';
import LoginForm from './LoginForm';
import PhoneLoginForm from './PhoneLoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const { denied } = await searchParams;
  const configured = isSupabaseConfigured();
  const phoneAuth = resolvePhoneAuthConfiguration();

  return (
    <main className="mx-auto w-full max-w-sm px-6 py-16">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-zinc-500">Staff access to Yule Love Lights Operations Hub.</p>

      <div className="mt-8">
        {configured && phoneAuth.mode === 'enabled' ? (
          <PhoneLoginForm
            denied={denied === '1'}
            turnstileSiteKey={phoneAuth.turnstileSiteKey}
          />
        ) : configured && phoneAuth.mode === 'disabled' ? (
          <LoginForm denied={denied === '1'} />
        ) : (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
            {process.env.NODE_ENV === 'development'
              ? 'Authentication is not fully configured. Check the Supabase and staging phone-auth variables in .env.local.'
              : 'Authentication is temporarily unavailable. Please try again later.'}
          </div>
        )}
      </div>
    </main>
  );
}
