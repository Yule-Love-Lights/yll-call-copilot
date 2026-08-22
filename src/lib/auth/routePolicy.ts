import {
  hasCapability,
  type Capability,
  type Department,
  type HubActor,
} from './capabilities';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type ResourceScope = 'none' | 'self' | 'team' | 'assigned' | 'resource';
export type Sensitivity = 'public' | 'internal' | 'sensitive';

export type RouteRequirement =
  | {
      readonly kind: 'public';
      readonly sensitivity: 'public';
    }
  | {
      // Authentication is implemented inside the route because the caller is a
      // webhook, Twilio, cron, or the live bridge rather than a browser actor.
      readonly kind: 'route_authenticated';
      readonly machineIdentity: string;
      readonly sensitivity: 'internal' | 'sensitive';
    }
  | {
      readonly kind: 'employee';
      readonly capabilities: readonly Capability[];
      // Management is an Owner/Admin mode, never a department membership or
      // paid-work context. A null department is therefore intentionally only
      // used by owner-only Management routes.
      readonly department: Department | null;
      readonly paidContextGate: 'legacy_pending_projection' | 'required';
      readonly resourceScope: ResourceScope;
      readonly sensitivity: 'internal' | 'sensitive';
      readonly auditBeforeFieldLaunch: boolean;
    };

export interface AppRoutePolicy {
  readonly template: string;
  readonly methods: Readonly<Partial<Record<HttpMethod, RouteRequirement>>>;
}

export interface ResolvedRoutePolicy {
  readonly template: string;
  readonly method: HttpMethod;
  readonly requirement: RouteRequirement;
}

// Exact browser-runtime assets only. Never replace this with an extension
// bypass: dynamic customer/resource identifiers may legitimately contain dots.
export const PUBLIC_RUNTIME_ASSETS = ['/favicon.ico'] as const;

export function isPublicRuntimeAsset(pathname: string): boolean {
  return (PUBLIC_RUNTIME_ASSETS as readonly string[]).includes(normalizedPath(pathname));
}

const publicRoute = (): RouteRequirement => ({
  kind: 'public',
  sensitivity: 'public',
});

const machineRoute = (
  machineIdentity: string,
  sensitivity: 'internal' | 'sensitive' = 'sensitive',
): RouteRequirement => ({
  kind: 'route_authenticated',
  machineIdentity,
  sensitivity,
});

const employeeRoute = (
  capabilities: Capability | readonly Capability[],
  options: {
    resourceScope?: ResourceScope;
    sensitivity?: 'internal' | 'sensitive';
    auditBeforeFieldLaunch?: boolean;
  } = {},
): RouteRequirement => ({
  kind: 'employee',
  capabilities: typeof capabilities === 'string' ? [capabilities] : capabilities,
  department: 'office',
  // Existing Office tools predate the canonical Quote-owned context read.
  // This is a temporary compatibility state, not a ruling that paid context
  // is unnecessary. Field provisioning remains blocked.
  paidContextGate: 'legacy_pending_projection',
  resourceScope: options.resourceScope ?? 'none',
  sensitivity: options.sensitivity ?? 'internal',
  auditBeforeFieldLaunch: options.auditBeforeFieldLaunch ?? false,
});

const managementRoute = (): RouteRequirement => ({
  kind: 'employee',
  capabilities: ['operations.admin'],
  department: null,
  paidContextGate: 'legacy_pending_projection',
  resourceScope: 'team',
  sensitivity: 'sensitive',
  auditBeforeFieldLaunch: false,
});

const getPage = (template: string, requirement: RouteRequirement): AppRoutePolicy => ({
  template,
  methods: { GET: requirement },
});

const api = (
  template: string,
  methods: Readonly<Partial<Record<HttpMethod, RouteRequirement>>>,
): AppRoutePolicy => ({ template, methods });

const OFFICE_TOOLS = employeeRoute('office.tools.use');
const MANAGEMENT = managementRoute();
const ANALYTICS = employeeRoute('office.analytics.read', {
  resourceScope: 'team',
  sensitivity: 'sensitive',
  auditBeforeFieldLaunch: true,
});
const CALLS = employeeRoute('office.calls.work', {
  resourceScope: 'resource',
  sensitivity: 'sensitive',
  auditBeforeFieldLaunch: true,
});
const CUSTOMER_SEARCH = employeeRoute('office.customer.search', {
  resourceScope: 'resource',
  sensitivity: 'sensitive',
  auditBeforeFieldLaunch: true,
});
const COACHING_SELF = employeeRoute('office.coaching.self', {
  resourceScope: 'self',
  sensitivity: 'sensitive',
});
const COACHING_TEAM = employeeRoute('office.coaching.team.read', {
  resourceScope: 'team',
  sensitivity: 'sensitive',
  auditBeforeFieldLaunch: true,
});
const COACHING_SETTINGS = employeeRoute('office.coaching.settings.manage', {
  resourceScope: 'team',
  sensitivity: 'sensitive',
  auditBeforeFieldLaunch: true,
});
const KNOWLEDGE_READ = employeeRoute('office.knowledge.read', {
  resourceScope: 'team',
});
const KNOWLEDGE_MANAGE = employeeRoute('office.knowledge.manage', {
  resourceScope: 'team',
  sensitivity: 'sensitive',
  auditBeforeFieldLaunch: true,
});
const PIPELINE_RUN = employeeRoute('office.pipeline.run', {
  resourceScope: 'team',
  sensitivity: 'sensitive',
  auditBeforeFieldLaunch: true,
});
const KNOWLEDGE_PIPELINE = employeeRoute(
  ['office.knowledge.manage', 'office.pipeline.run'],
  {
    resourceScope: 'team',
    sensitivity: 'sensitive',
    auditBeforeFieldLaunch: true,
  },
);
const SCOREBOARD = employeeRoute('office.scoreboard.self', {
  resourceScope: 'self',
  sensitivity: 'sensitive',
});
const SCOREBOARD_MANAGE = employeeRoute('office.scoreboard.manage', {
  resourceScope: 'team',
  sensitivity: 'sensitive',
  auditBeforeFieldLaunch: true,
});
const SECOND_MILE = employeeRoute('office.second_mile.work', {
  // This module is intentionally one shared Office work queue.
  resourceScope: 'team',
  sensitivity: 'sensitive',
});
const SECOND_MILE_SEND = employeeRoute('office.second_mile.send', {
  resourceScope: 'team',
  sensitivity: 'sensitive',
  auditBeforeFieldLaunch: true,
});
const TASKS = employeeRoute('office.tasks.work', {
  resourceScope: 'self',
  sensitivity: 'internal',
});

// This registry is the server-side inventory for every page and route handler
// in src/app. New files fail the completeness test until they declare a policy.
// Unknown paths and undeclared methods are denied by the proxy.
export const APP_ROUTE_POLICIES: readonly AppRoutePolicy[] = [
  getPage('/login', publicRoute()),
  getPage('/forgot-password', publicRoute()),
  getPage('/reset-password', publicRoute()),
  api('/api/health', { GET: publicRoute() }),

  api('/api/webhooks/ghl', { POST: machineRoute('ghl_webhook') }),
  api('/api/twilio/voice', { POST: machineRoute('twilio_voice') }),
  api('/api/twilio/whisper', { POST: machineRoute('twilio_whisper') }),
  api('/api/live/stream/authorize', { POST: machineRoute('live_bridge') }),
  api('/api/live/segment', { POST: machineRoute('live_bridge') }),
  api('/api/cron/brain-review', { GET: machineRoute('cron_brain_review') }),
  api('/api/cron/extract-commitments', { GET: machineRoute('cron_extract_commitments') }),
  api('/api/cron/score-calls', { GET: machineRoute('cron_score_calls') }),
  api('/api/cron/second-mile', { GET: machineRoute('cron_second_mile') }),
  api('/api/cron/sync-recordings', { GET: machineRoute('cron_sync_recordings') }),
  api('/api/cron/weekly-digest', { GET: machineRoute('cron_weekly_digest') }),

  getPage('/', OFFICE_TOOLS),
  getPage('/management', MANAGEMENT),
  getPage('/analytics', ANALYTICS),
  getPage('/brain', KNOWLEDGE_READ),
  getPage('/brain/interview', KNOWLEDGE_MANAGE),
  getPage('/brain/seed', KNOWLEDGE_MANAGE),
  getPage('/call/:leadId', CALLS),
  getPage('/call/:leadId/live', CALLS),
  getPage('/coach', COACHING_SELF),
  getPage('/coach/calls', COACHING_TEAM),
  getPage('/coach/offer', COACHING_SELF),
  getPage('/coach/rubric', COACHING_SELF),
  getPage('/contacts', CUSTOMER_SEARCH),
  getPage('/digest', COACHING_TEAM),
  getPage('/practice', COACHING_SELF),
  getPage('/practice/:id', COACHING_SELF),
  getPage('/queue', CALLS),
  getPage('/recordings', CALLS),
  getPage('/scoreboard', SCOREBOARD),
  getPage('/second-mile', SECOND_MILE),
  getPage('/verticals', KNOWLEDGE_READ),
  getPage('/verticals/:id', KNOWLEDGE_READ),

  api('/api/analytics', { GET: ANALYTICS }),
  api('/api/brain', { GET: KNOWLEDGE_READ }),
  api('/api/brain/insights', { GET: KNOWLEDGE_READ, POST: KNOWLEDGE_MANAGE }),
  api('/api/brain/insights/:id', { DELETE: KNOWLEDGE_MANAGE }),
  api('/api/brain/interview', { POST: KNOWLEDGE_MANAGE }),
  api('/api/calls', { POST: CALLS }),
  api('/api/coach/calls', { GET: COACHING_TEAM }),
  api('/api/coach/calls/:id', { GET: COACHING_TEAM }),
  api('/api/coach/calls/:id/audio', { GET: COACHING_TEAM }),
  api('/api/coaching/:id/rate', { POST: COACHING_SELF }),
  api('/api/dashboard/summary', { GET: OFFICE_TOOLS }),
  api('/api/digest', { GET: COACHING_TEAM }),
  api('/api/digest/:id', { GET: COACHING_TEAM }),
  api('/api/digest/generate', { POST: COACHING_SETTINGS }),
  api('/api/documents/:id', { DELETE: KNOWLEDGE_MANAGE }),
  api('/api/feedback', { GET: COACHING_SELF }),
  api('/api/feedback/:id/seen', { POST: COACHING_SELF }),
  api('/api/feedback/unseen-count', { GET: COACHING_SELF }),
  api('/api/followups/:id', { PUT: CALLS }),
  api('/api/followups/:id/send', { POST: CALLS }),
  api('/api/ghl/contacts/search', { GET: CUSTOMER_SEARCH }),
  api('/api/inbound/recent', { GET: CALLS }),
  api('/api/ingest/continue', { POST: PIPELINE_RUN }),
  api('/api/ingest/jobs/:id', { GET: PIPELINE_RUN }),
  api('/api/ingest/transcripts', { POST: PIPELINE_RUN }),
  api('/api/leads/:id', { GET: CALLS }),
  api('/api/leads/:id/decide', { POST: CALLS }),
  api('/api/live/end', { POST: CALLS }),
  api('/api/live/abort', { POST: CALLS }),
  api('/api/live/events', { GET: CALLS }),
  api('/api/live/start', { POST: CALLS }),
  api('/api/offer', { GET: COACHING_SELF, POST: COACHING_SETTINGS }),
  api('/api/offer/rollback', { POST: COACHING_SETTINGS }),
  api('/api/practice', { GET: COACHING_SELF }),
  api('/api/practice/start', { POST: COACHING_SELF }),
  api('/api/practice/:id', { GET: COACHING_SELF }),
  api('/api/practice/:id/end', { POST: COACHING_SELF }),
  api('/api/practice/:id/turn', { POST: COACHING_SELF }),
  api('/api/proposals/:id/decide', { POST: KNOWLEDGE_MANAGE }),
  api('/api/queue', { GET: CALLS }),
  api('/api/queue/build', { POST: PIPELINE_RUN }),
  api('/api/recordings', { GET: CALLS }),
  api('/api/recordings/continue', { POST: PIPELINE_RUN }),
  api('/api/rubric', { GET: COACHING_SELF, POST: COACHING_SETTINGS }),
  api('/api/scoreboard', { GET: SCOREBOARD }),
  api('/api/scoreboard/settings', { POST: SCOREBOARD_MANAGE }),
  api('/api/scores', { GET: COACHING_SELF }),
  api('/api/scores/continue', { POST: PIPELINE_RUN }),
  api('/api/second-mile', { GET: SECOND_MILE }),
  api('/api/second-mile/:id/decide', { POST: SECOND_MILE }),
  api('/api/second-mile/:id/draft', { POST: SECOND_MILE }),
  api('/api/second-mile/:id/send', { POST: SECOND_MILE_SEND }),
  api('/api/second-mile/cold-snap', { POST: SECOND_MILE_SEND }),
  api('/api/twilio/token', { GET: CALLS }),
  api('/api/tasks', { GET: TASKS, POST: TASKS }),
  api('/api/tasks/:id', { PATCH: TASKS }),
  api('/api/verticals', { GET: KNOWLEDGE_READ, POST: KNOWLEDGE_MANAGE }),
  api('/api/verticals/seed', { POST: KNOWLEDGE_MANAGE }),
  api('/api/verticals/:id', { GET: KNOWLEDGE_READ, PUT: KNOWLEDGE_MANAGE }),
  api('/api/verticals/:id/brain-review', {
    GET: KNOWLEDGE_READ,
    POST: KNOWLEDGE_PIPELINE,
  }),
  api('/api/verticals/:id/distill', { POST: KNOWLEDGE_PIPELINE }),
  api('/api/verticals/:id/documents', {
    GET: KNOWLEDGE_READ,
    POST: KNOWLEDGE_MANAGE,
  }),
  api('/api/verticals/:id/generate', { POST: KNOWLEDGE_PIPELINE }),
  api('/api/verticals/:id/insights', { GET: KNOWLEDGE_READ }),
  api('/api/verticals/:id/playbook', { PUT: KNOWLEDGE_MANAGE }),
];

export function resolveRoutePolicy(
  pathname: string,
  requestMethod: string,
): ResolvedRoutePolicy | null {
  const method = normalizeMethod(requestMethod);
  if (!method) return null;

  const candidates = APP_ROUTE_POLICIES
    .filter(policy => matchesTemplate(pathname, policy.template))
    .sort((left, right) => templateSpecificity(right.template) - templateSpecificity(left.template));
  if (candidates.length === 0) return null;

  // Once a more-specific pathname matches, an undeclared method must deny. It
  // must not inherit a method from a less-specific dynamic sibling.
  const highestSpecificity = templateSpecificity(candidates[0].template);
  for (const candidate of candidates.filter(
    policy => templateSpecificity(policy.template) === highestSpecificity,
  )) {
    const requirement = candidate.methods[method];
    if (requirement) return { template: candidate.template, method, requirement };
  }
  return null;
}

export function actorMeetsRouteRequirement(
  actor: HubActor,
  requirement: RouteRequirement,
): boolean {
  if (requirement.kind !== 'employee' || !actor.active) return false;
  if (requirement.department !== null && !actor.memberships.includes(requirement.department)) {
    return false;
  }
  if (
    requirement.paidContextGate === 'required' &&
    actor.activeDepartmentContext !== requirement.department
  ) {
    return false;
  }
  return requirement.capabilities.every(capability => hasCapability(actor, capability));
}

export function matchesTemplate(pathname: string, template: string): boolean {
  const pathSegments = normalizedPath(pathname).split('/');
  const templateSegments = normalizedPath(template).split('/');
  if (pathSegments.length !== templateSegments.length) return false;

  return templateSegments.every((segment, index) =>
    segment.startsWith(':') ? pathSegments[index].length > 0 : pathSegments[index] === segment,
  );
}

function normalizedPath(pathname: string): string {
  if (pathname === '/') return pathname;
  return pathname.replace(/\/+$/, '') || '/';
}

function normalizeMethod(method: string): HttpMethod | null {
  const normalized = method.toUpperCase() === 'HEAD' ? 'GET' : method.toUpperCase();
  return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(normalized)
    ? (normalized as HttpMethod)
    : null;
}

function templateSpecificity(template: string): number {
  return template
    .split('/')
    .reduce((score, segment) => score + (segment.startsWith(':') ? 1 : 10), 0);
}
