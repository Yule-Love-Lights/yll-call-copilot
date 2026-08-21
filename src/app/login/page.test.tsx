import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isSupabaseConfigured: vi.fn(),
  identityConfiguration: vi.fn(),
  phoneConfiguration: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: mocks.isSupabaseConfigured,
}));

vi.mock('@/lib/auth/config', () => ({
  resolveIdentityAuthConfiguration: mocks.identityConfiguration,
}));

vi.mock('@/lib/auth/phoneAuth', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/auth/phoneAuth')>();
  return { ...original, resolvePhoneAuthConfiguration: mocks.phoneConfiguration };
});

vi.mock('next/navigation', async importOriginal => {
  const original = await importOriginal<typeof import('next/navigation')>();
  return { ...original, redirect: mocks.redirect };
});

import ForgotPasswordPage from '../forgot-password/page';
import ResetPasswordPage from '../reset-password/page';
import LoginForm from './LoginForm';
import LoginPage from './page';
import PhoneLoginForm from './PhoneLoginForm';

function findElement(node: ReactNode, type: unknown): ReactElement | null {
  if (!isValidElement(node)) return null;
  if (node.type === type) return node;
  const children = (node.props as { children?: ReactNode }).children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const match = findElement(child, type);
      if (match) return match;
    }
    return null;
  }
  return findElement(children, type);
}

describe('authentication page mode selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isSupabaseConfigured.mockReturnValue(true);
    mocks.identityConfiguration.mockReturnValue({
      ok: true,
      source: 'hub',
      url: 'https://hub-auth.supabase.co/',
      anonKey: 'sb_publishable_1234567890abcdefghij',
    });
    mocks.redirect.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT');
    });
  });

  it('renders phone OTP only for a complete preview-phone configuration', async () => {
    mocks.phoneConfiguration.mockReturnValue({
      mode: 'enabled',
      turnstileSiteKey: 'site-key',
    });

    const page = await LoginPage({ searchParams: Promise.resolve({ denied: '1' }) });
    const phoneForm = findElement(page, PhoneLoginForm);

    expect(phoneForm?.props).toEqual(expect.objectContaining({
      denied: true,
      turnstileSiteKey: 'site-key',
    }));
    expect(findElement(page, LoginForm)).toBeNull();
  });

  it('preserves the password bootstrap only while phone mode is disabled', async () => {
    mocks.phoneConfiguration.mockReturnValue({ mode: 'disabled' });

    const page = await LoginPage({ searchParams: Promise.resolve({}) });

    expect(findElement(page, LoginForm)).not.toBeNull();
    expect(findElement(page, PhoneLoginForm)).toBeNull();
    expect(findElement(page, LoginForm)?.props).toEqual(expect.objectContaining({
      passwordRecoveryAvailable: true,
    }));
  });

  it('does not render either login form for malformed phone-auth configuration', async () => {
    mocks.phoneConfiguration.mockReturnValue({ mode: 'unavailable' });

    const page = await LoginPage({ searchParams: Promise.resolve({}) });

    expect(findElement(page, LoginForm)).toBeNull();
    expect(findElement(page, PhoneLoginForm)).toBeNull();
  });

  it('removes employee password recovery surfaces whenever phone mode is active', () => {
    mocks.phoneConfiguration.mockReturnValue({ mode: 'enabled', turnstileSiteKey: 'site-key' });

    expect(() => ForgotPasswordPage()).toThrow('NEXT_REDIRECT');
    expect(() => ResetPasswordPage()).toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenNthCalledWith(1, '/login');
    expect(mocks.redirect).toHaveBeenNthCalledWith(2, '/login');
  });

  it('keeps Quote Tool password recovery owned by the Quote Tool', async () => {
    mocks.phoneConfiguration.mockReturnValue({ mode: 'disabled' });
    mocks.identityConfiguration.mockReturnValue({
      ok: true,
      source: 'quote_tool',
      url: 'https://quote-auth.supabase.co/',
      anonKey: 'sb_publishable_1234567890abcdefghij',
    });

    const page = await LoginPage({ searchParams: Promise.resolve({}) });

    expect(findElement(page, LoginForm)?.props).toEqual(expect.objectContaining({
      passwordRecoveryAvailable: false,
    }));
    expect(() => ForgotPasswordPage()).toThrow('NEXT_REDIRECT');
    expect(() => ResetPasswordPage()).toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenNthCalledWith(1, '/login');
    expect(mocks.redirect).toHaveBeenNthCalledWith(2, '/login');
  });
});
