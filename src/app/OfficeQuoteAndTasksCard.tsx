export default function OfficeQuoteAndTasksCard() {
  return (
    <section
      className="mt-4 rounded-lg border border-[var(--op-border)] bg-white p-4 shadow-[var(--shadow-1)]"
      aria-labelledby="office-quote-and-tasks-heading"
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.14em] text-[var(--op-dim)]">Quote and task work</p>
          <h2 id="office-quote-and-tasks-heading" className="mt-1 text-base font-semibold text-[var(--op-text)]">
            Quote timing and Hub tasks are not connected yet
          </h2>
          <p className="mt-1 text-sm leading-5 text-[var(--op-text-2)]">
            Quote Tool must first publish its approved lifecycle event feed. Until then, this Hub does not estimate turnaround, workload, promises, or task ownership from inbox and contact data.
          </p>
        </div>
        <span className="w-fit shrink-0 rounded-full bg-[var(--brand-cream)] px-2.5 py-1 text-xs font-medium text-[var(--brand-evergreen-3)]">
          Unavailable
        </span>
      </div>
    </section>
  );
}
