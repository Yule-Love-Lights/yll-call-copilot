export default function OfficeWorkdayCard() {
  return (
    <section className="mt-6 rounded-lg border border-[var(--op-border)] bg-white p-4 shadow-[var(--shadow-1)]" aria-labelledby="office-workday-heading">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.14em] text-[var(--op-dim)]">Office workday</p>
          <h2 id="office-workday-heading" className="mt-1 text-base font-semibold text-[var(--op-text)]">
            Time and breaks are not connected yet
          </h2>
          <p className="mt-1 text-sm leading-5 text-[var(--op-text-2)]">
            The canonical day clock and paid department context remain owned by Quote Tool. This Hub does not estimate, store, or display a second time record.
          </p>
        </div>
        <span className="w-fit shrink-0 rounded-full bg-[var(--brand-cream)] px-2.5 py-1 text-xs font-medium text-[var(--brand-evergreen-3)]">
          Unavailable
        </span>
      </div>
    </section>
  );
}
