/**
 * @vitest-environment jsdom
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TurnstileGate from './TurnstileGate';

type TurnstileOptions = {
  callback: (token: string) => void;
  'expired-callback': () => void;
  'error-callback': () => void;
  sitekey: string;
};

describe('TurnstileGate', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    document.head.replaceChildren();
    document.body.replaceChildren();
    delete window.turnstile;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    delete window.turnstile;
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it('fails closed on a script error and creates a fresh retry script', () => {
    const onToken = vi.fn();
    act(() => root.render(<TurnstileGate siteKey="site-key" onToken={onToken} />));

    const firstScript = document.querySelector<HTMLScriptElement>('#yll-turnstile-script');
    expect(firstScript?.src).toBe('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');

    act(() => firstScript?.dispatchEvent(new Event('error')));

    expect(onToken).toHaveBeenLastCalledWith(null);
    expect(document.querySelector('#yll-turnstile-script')).toBeNull();
    expect(container.textContent).toContain('The security check could not load.');

    const retry = [...container.querySelectorAll('button')]
      .find(button => button.textContent === 'Retry security check');
    act(() => retry?.click());

    const retryScript = document.querySelector<HTMLScriptElement>('#yll-turnstile-script');
    expect(retryScript).not.toBeNull();
    expect(retryScript).not.toBe(firstScript);
  });

  it('renders after retry and clears or invalidates tokens through provider callbacks', () => {
    const onToken = vi.fn();
    act(() => root.render(<TurnstileGate siteKey="site-key" onToken={onToken} />));
    const firstScript = document.querySelector<HTMLScriptElement>('#yll-turnstile-script');
    act(() => firstScript?.dispatchEvent(new Event('error')));
    const retry = [...container.querySelectorAll('button')]
      .find(button => button.textContent === 'Retry security check');
    act(() => retry?.click());

    let callbacks: TurnstileOptions | null = null;
    const render = vi.fn((_element: HTMLElement, options: TurnstileOptions) => {
      callbacks = options;
      return 'widget-1';
    });
    const remove = vi.fn();
    window.turnstile = { render, remove };
    const retryScript = document.querySelector<HTMLScriptElement>('#yll-turnstile-script');
    act(() => retryScript?.dispatchEvent(new Event('load')));

    expect(render).toHaveBeenCalledOnce();
    expect(callbacks).toEqual(expect.objectContaining({ sitekey: 'site-key' }));

    act(() => callbacks?.callback('captcha-token'));
    expect(onToken).toHaveBeenLastCalledWith('captcha-token');
    act(() => callbacks?.['expired-callback']());
    expect(onToken).toHaveBeenLastCalledWith(null);
    act(() => callbacks?.['error-callback']());
    expect(onToken).toHaveBeenLastCalledWith(null);
    expect(container.textContent).toContain('Retry security check');

    act(() => root.unmount());
    expect(remove).toHaveBeenCalledWith('widget-1');
    root = createRoot(container);
  });
});
