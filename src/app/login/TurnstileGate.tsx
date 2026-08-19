'use client';

import { useEffect, useRef, useState } from 'react';

const TURNSTILE_SCRIPT_ID = 'yll-turnstile-script';
const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

type TurnstileApi = {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
      theme: 'auto';
    },
  ): string;
  remove(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export default function TurnstileGate({
  siteKey,
  onToken,
}: {
  siteKey: string;
  onToken: (token: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let scriptElement = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null;

    const markUnavailable = () => {
      if (cancelled) return;
      onToken(null);
      setUnavailable(true);
      if (scriptElement && !window.turnstile) {
        scriptElement.remove();
      }
    };

    const renderWidget = () => {
      if (cancelled || !containerRef.current || !window.turnstile || widgetIdRef.current) return;
      try {
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: token => {
            if (cancelled) return;
            setUnavailable(false);
            onToken(token);
          },
          'expired-callback': () => {
            if (!cancelled) onToken(null);
          },
          'error-callback': markUnavailable,
          theme: 'auto',
        });
      } catch {
        markUnavailable();
      }
    };

    const handleScriptLoad = () => {
      if (scriptElement) scriptElement.dataset.yllTurnstileState = 'loaded';
      if (window.turnstile) renderWidget();
      else markUnavailable();
    };

    if (window.turnstile) {
      renderWidget();
    } else if (scriptElement) {
      if (scriptElement.dataset.yllTurnstileState === 'loaded') {
        markUnavailable();
      } else {
        scriptElement.addEventListener('load', handleScriptLoad);
      }
      scriptElement.addEventListener('error', markUnavailable);
    } else {
      const script = document.createElement('script');
      script.id = TURNSTILE_SCRIPT_ID;
      script.src = TURNSTILE_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.dataset.yllTurnstileState = 'loading';
      script.addEventListener('load', handleScriptLoad);
      script.addEventListener('error', markUnavailable);
      scriptElement = script;
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
      scriptElement?.removeEventListener('load', handleScriptLoad);
      scriptElement?.removeEventListener('error', markUnavailable);
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // The widget may already have removed itself after a provider error.
        }
      }
      widgetIdRef.current = null;
    };
  }, [loadAttempt, onToken, siteKey]);

  return (
    <div className="min-h-[65px]">
      <div ref={containerRef} aria-label="Security check" />
      {unavailable && (
        <div className="space-y-2 text-sm text-red-600 dark:text-red-400" role="alert">
          <p>The security check could not load.</p>
          <button
            type="button"
            className="font-medium underline"
            onClick={() => {
              setUnavailable(false);
              setLoadAttempt(current => current + 1);
            }}
          >
            Retry security check
          </button>
        </div>
      )}
    </div>
  );
}
