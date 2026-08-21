import ManagementShell from './ManagementShell';
import { HUB_SUPPORTED_OPERATIONS_VERSIONS } from '@/lib/operationsHub/compatibility';

export const dynamic = 'force-dynamic';

const departments = [
  {
    name: 'Office',
    description: 'Existing call and coaching tools remain available during redesign.',
    state: 'Preserved',
  },
  {
    name: 'Advertising',
    description: 'Campaign, Placement Run, and inventory detail are not provisioned yet.',
    state: 'Not provisioned',
  },
  {
    name: 'Installer',
    description: 'Schedule, job, and paid-context reads still require Quote Tool interfaces.',
    state: 'Waiting on Quote Tool',
  },
] as const;

const unavailable = 'Unavailable until its owner supplies an authenticated read.';

function StatusCard({
  title,
  detail,
  tone = 'neutral',
}: {
  title: string;
  detail: string;
  tone?: 'neutral' | 'attention';
}) {
  const stateClass = tone === 'attention'
    ? 'border-[rgba(232,184,98,.62)] bg-[rgba(255,249,235,.88)]'
    : 'border-[var(--op-border)] bg-white';
  return (
    <section className={`rounded-lg border p-4 shadow-[var(--shadow-1)] ${stateClass}`}>
      <p className="text-xs font-semibold uppercase tracking-[.13em] text-[var(--op-dim)]">{title}</p>
      <p className="mt-2 text-sm leading-5 text-[var(--op-text-2)]">{detail}</p>
    </section>
  );
}

export default function ManagementPage() {
  const contractVersion = HUB_SUPPORTED_OPERATIONS_VERSIONS.contractVersions[0];
  const schemaVersion = HUB_SUPPORTED_OPERATIONS_VERSIONS.schemaVersions[0];

  return (
    <ManagementShell>
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-8">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-[var(--brand-gold-deep)]">
            Owner view
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-.03em] text-[var(--op-text)]">
            Management
          </h1>
          <p className="mt-2 text-sm leading-6 text-[var(--op-text-2)]">
            A cross-department review surface for Naldo and Jason. This view never changes an employee,
            department, or paid-work context.
          </p>
        </div>

        <section className="mt-8" aria-labelledby="department-heading">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="department-heading" className="text-base font-semibold text-[var(--op-text)]">
              Department review
            </h2>
            <span className="text-xs text-[var(--op-dim)]">Management drilldowns are being built in order.</span>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {departments.map(department => (
              <section key={department.name} className="rounded-lg border border-[var(--op-border)] bg-white p-4 shadow-[var(--shadow-1)]">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-semibold text-[var(--op-text)]">{department.name}</h3>
                  <span className="shrink-0 rounded-full bg-[var(--brand-cream)] px-2 py-0.5 text-xs font-medium text-[var(--brand-evergreen-3)]">
                    {department.state}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-5 text-[var(--op-text-2)]">{department.description}</p>
              </section>
            ))}
          </div>
        </section>

        <section className="mt-8" aria-labelledby="exceptions-heading">
          <h2 id="exceptions-heading" className="text-base font-semibold text-[var(--op-text)]">
            Exceptions and readiness
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <StatusCard title="Identity and access" detail="Hub-local authorization is active. Hosted real-token persona proof remains a release gate." tone="attention" />
            <StatusCard title="Time and paid context" detail={unavailable} />
            <StatusCard title="Placement and completion" detail="Advertising and Installer operational reads are not provisioned." />
            <StatusCard title="Commands and reconciliation" detail={unavailable} />
            <StatusCard title="Inventory reconciliation" detail="No count is shown until the Hub inventory ledger exists. Stock and allocation detail belongs in Advertising." />
            <StatusCard title="Payroll readiness" detail={unavailable} />
          </div>
        </section>

        <section className="mt-8 grid gap-3 lg:grid-cols-2" aria-label="Integration health">
          <StatusCard
            title="Quote Tool lifecycle and timing"
            detail="Request-to-first-send timing, revisions, waits, and quote-linked task events are not yet supplied by Quote Tool. No metrics are estimated here."
            tone="attention"
          />
          <StatusCard
            title="Contract and deployment versions"
            detail={`Hub supports contract ${contractVersion} and schema ${schemaVersion}. Authenticated runtime version health is still pending, so Quote-derived data stays unavailable.`}
          />
        </section>
      </main>
    </ManagementShell>
  );
}
