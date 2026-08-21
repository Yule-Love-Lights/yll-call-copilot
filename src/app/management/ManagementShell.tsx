import type { ReactNode } from 'react';

export default function ManagementShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--op-bg)]">
      <header className="h-[49px] border-b border-[var(--op-border)] bg-white">
        <div className="mx-auto flex h-full max-w-6xl items-center justify-between px-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="whitespace-nowrap text-sm font-bold tracking-[-.01em] text-[var(--op-text)]">
              Yule Love Lights
            </span>
            <span className="hidden h-4 w-px bg-[var(--op-border-mid)] sm:block" />
            <span className="hidden text-sm text-[var(--op-dim)] sm:inline">Operations Hub</span>
          </div>
          <span className="rounded-full bg-[var(--brand-evergreen)] px-2.5 py-1 text-xs font-semibold text-[var(--brand-cream)]">
            Management
          </span>
        </div>
      </header>
      {children}
    </div>
  );
}
