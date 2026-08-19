/**
 * @vitest-environment jsdom
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSupabaseBrowserClient: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

vi.mock('@/lib/supabase-browser', () => ({
  getSupabaseBrowserClient: mocks.getSupabaseBrowserClient,
}));

vi.mock('./TurnstileGate', () => ({
  default: ({
    onToken,
    siteKey,
  }: {
    onToken: (token: string | null) => void;
    siteKey: string;
  }) => (
    <button type="button" data-site-key={siteKey} onClick={() => onToken('captcha-token')}>
      Complete security check
    </button>
  ),
}));

import PhoneLoginForm from './PhoneLoginForm';

function changeInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function buttonWithText(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find(button => button.textContent === text);
}

describe('PhoneLoginForm', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    document.body.replaceChildren();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it('sends a captcha-bound invite-only OTP without exposing provider errors', async () => {
    const signInWithOtp = vi.fn(async () => ({
      data: {},
      error: { code: 'otp_disabled', message: 'sensitive provider detail' },
    }));
    mocks.getSupabaseBrowserClient.mockReturnValue({ auth: { signInWithOtp } });
    act(() => root.render(<PhoneLoginForm denied={false} turnstileSiteKey="site-key" />));

    expect(container.querySelector('[data-site-key="site-key"]')).not.toBeNull();
    act(() => buttonWithText(container, 'Complete security check')?.click());
    const phone = container.querySelector<HTMLInputElement>('#phone');
    act(() => changeInput(phone!, '(631) 555-0123'));
    await act(async () => {
      container.querySelector('form')?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
    });

    expect(signInWithOtp).toHaveBeenCalledWith({
      phone: '+16315550123',
      options: { captchaToken: 'captcha-token', shouldCreateUser: false },
    });
    expect(container.textContent).toContain('If this number is authorized, a code was sent');
    expect(container.textContent).not.toContain('sensitive provider detail');
    expect(container.textContent).toContain('Send another code in 60s');
  });

  it('verifies a six-digit SMS OTP and navigates only after Supabase returns a session', async () => {
    const signInWithOtp = vi.fn(async () => ({ data: {}, error: null }));
    const verifyOtp = vi.fn(async () => ({
      data: { session: { access_token: 'redacted' }, user: { id: 'auth-user-1' } },
      error: null,
    }));
    mocks.getSupabaseBrowserClient.mockReturnValue({ auth: { signInWithOtp, verifyOtp } });
    act(() => root.render(<PhoneLoginForm denied={false} turnstileSiteKey="site-key" />));

    act(() => buttonWithText(container, 'Complete security check')?.click());
    act(() => changeInput(container.querySelector<HTMLInputElement>('#phone')!, '6315550123'));
    await act(async () => {
      container.querySelector('form')?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
    });

    const code = container.querySelector<HTMLInputElement>('#code');
    act(() => changeInput(code!, '123456'));
    await act(async () => {
      container.querySelector('form')?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
    });

    expect(verifyOtp).toHaveBeenCalledWith({
      phone: '+16315550123',
      token: '123456',
      type: 'sms',
    });
    expect(mocks.push).toHaveBeenCalledWith('/');
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
});
