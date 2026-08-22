import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildHubActor } from './capabilities';
import {
  APP_ROUTE_POLICIES,
  isPublicRuntimeAsset,
  PUBLIC_RUNTIME_ASSETS,
  actorMeetsRouteRequirement,
  matchesTemplate,
  resolveRoutePolicy,
  type HttpMethod,
} from './routePolicy';

interface DiscoveredSurface {
  template: string;
  methods: HttpMethod[];
}

describe('route authorization policy', () => {
  it('declares every page and every exported API handler method exactly once', () => {
    const discovered = discoverAppSurfaces();
    const declaredTemplates = APP_ROUTE_POLICIES.map(policy => policy.template);

    expect(new Set(declaredTemplates).size).toBe(declaredTemplates.length);
    expect([...declaredTemplates].sort()).toEqual(discovered.map(surface => surface.template).sort());

    for (const surface of discovered) {
      const policy = APP_ROUTE_POLICIES.find(candidate => candidate.template === surface.template);
      expect(policy, `missing policy for ${surface.template}`).toBeDefined();
      expect(Object.keys(policy?.methods ?? {}).sort()).toEqual([...surface.methods].sort());

      for (const method of surface.methods) {
        const resolved = resolveRoutePolicy(materialize(surface.template), method);
        expect(resolved?.template, `${method} ${surface.template}`).toBe(surface.template);
      }
    }
  });

  it('denies unknown paths, undeclared methods, and malformed methods', () => {
    expect(resolveRoutePolicy('/api/future-field-route', 'GET')).toBeNull();
    expect(resolveRoutePolicy('/api/health/private', 'GET')).toBeNull();
    expect(resolveRoutePolicy('/api/health', 'POST')).toBeNull();
    expect(resolveRoutePolicy('/api/health', 'OPTIONS')).toBeNull();
  });

  it('allows only exact declared browser runtime assets', () => {
    expect(isPublicRuntimeAsset('/favicon.ico')).toBe(true);
    expect(isPublicRuntimeAsset('/favicon.ico/extra')).toBe(false);
    expect(isPublicRuntimeAsset('/manifest.webmanifest')).toBe(false);
    expect(isPublicRuntimeAsset('/api/leads/image.png')).toBe(false);
  });

  it('forces every checked-in public-folder asset into the exact registry', () => {
    const publicRoot = join(process.cwd(), 'public');
    const publicFiles = existsSync(publicRoot)
      ? walk(publicRoot).map(file => `/${relative(publicRoot, file).split(sep).join('/')}`)
      : [];
    const appMetadataAssets = existsSync(join(process.cwd(), 'src', 'app', 'favicon.ico'))
      ? ['/favicon.ico']
      : [];

    expect([...PUBLIC_RUNTIME_ASSETS].sort()).toEqual(
      [...publicFiles, ...appMetadataAssets].sort(),
    );
  });

  it('uses the most specific static route instead of a dynamic sibling', () => {
    expect(resolveRoutePolicy('/api/digest/generate', 'POST')?.template).toBe(
      '/api/digest/generate',
    );
    expect(resolveRoutePolicy('/api/second-mile/cold-snap', 'POST')?.template).toBe(
      '/api/second-mile/cold-snap',
    );
    expect(resolveRoutePolicy('/api/digest/generate', 'GET')).toBeNull();
  });

  it('normalizes trailing slashes and HEAD requests without broad prefix matches', () => {
    expect(resolveRoutePolicy('/scoreboard/', 'HEAD')?.template).toBe('/scoreboard');
    expect(matchesTemplate('/api/health/private', '/api/health')).toBe(false);
    expect(matchesTemplate('/api/leads/image.png', '/api/leads/:id')).toBe(true);
  });

  it('requires every capability in a multi-capability route policy', () => {
    const requirement = resolveRoutePolicy('/api/verticals/abc/generate', 'POST')?.requirement;
    expect(requirement?.kind).toBe('employee');
    if (!requirement || requirement.kind !== 'employee') throw new Error('expected employee policy');

    const officeActor = actor('rep');
    const ownerActor = actor('owner');
    expect(actorMeetsRouteRequirement(officeActor, requirement)).toBe(false);
    expect(actorMeetsRouteRequirement(ownerActor, requirement)).toBe(true);
  });

  it('keeps Advertising and Installer actors out of every existing Office surface', () => {
    for (const role of ['advertising', 'installer'] as const) {
      const fieldActor = actor(role);
      for (const policy of APP_ROUTE_POLICIES) {
        for (const requirement of Object.values(policy.methods)) {
          if (requirement?.kind === 'employee') {
            expect(
              actorMeetsRouteRequirement(fieldActor, requirement),
              `${role} unexpectedly reached ${policy.template}`,
            ).toBe(false);
          }
        }
      }
    }
  });

  it('allows Office employees only their explicit capabilities', () => {
    const officeActor = actor('office');
    const home = resolveRoutePolicy('/', 'GET')?.requirement;
    const settings = resolveRoutePolicy('/api/rubric', 'POST')?.requirement;
    const tasks = resolveRoutePolicy('/api/tasks', 'POST')?.requirement;
    if (!home || !settings || !tasks) throw new Error('expected declared routes');

    expect(actorMeetsRouteRequirement(officeActor, home)).toBe(true);
    expect(actorMeetsRouteRequirement(officeActor, settings)).toBe(false);
    expect(actorMeetsRouteRequirement(officeActor, tasks)).toBe(true);
    expect(actorMeetsRouteRequirement(actor('advertising'), tasks)).toBe(false);
    expect(actorMeetsRouteRequirement(actor('installer'), tasks)).toBe(false);
  });

  it('keeps Management owner-only without making it a department route', () => {
    const management = resolveRoutePolicy('/management', 'GET')?.requirement;
    if (!management || management.kind !== 'employee') throw new Error('expected Management policy');

    expect(management.department).toBeNull();
    expect(actorMeetsRouteRequirement(actor('owner'), management)).toBe(true);
    expect(actorMeetsRouteRequirement(actor('office'), management)).toBe(false);
    expect(actorMeetsRouteRequirement(actor('advertising'), management)).toBe(false);
    expect(actorMeetsRouteRequirement(actor('installer'), management)).toBe(false);
  });
});

function actor(role: 'rep' | 'office' | 'advertising' | 'installer' | 'owner') {
  const employeeRole = role === 'rep' ? 'office' : role;
  const result = buildHubActor({
    authUserId: `auth-${role}`,
    employeeId: `employee-${role}`,
    compatibilityEmail: `${role}@example.com`,
    employeeRole,
    memberships: employeeRole === 'owner'
      ? ['office', 'advertising', 'installer']
      : [employeeRole],
    membershipVersion: 1,
  });
  if (!result) throw new Error(`expected actor for ${role}`);
  return result;
}

function discoverAppSurfaces(): DiscoveredSurface[] {
  const appRoot = join(process.cwd(), 'src', 'app');
  const files = walk(appRoot).filter(file => file.endsWith(`${sep}page.tsx`) || file.endsWith(`${sep}route.ts`));

  return files
    .map(file => {
      const template = toTemplate(relative(appRoot, file));
      if (file.endsWith(`${sep}page.tsx`)) return { template, methods: ['GET' as const] };

      const source = readFileSync(file, 'utf8');
      const methods = [...source.matchAll(/export\s+(?:async\s+function|function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)]
        .map(match => match[1] as HttpMethod);
      expect(methods.length, `${template} exports no recognized HTTP handler`).toBeGreaterThan(0);
      return { template, methods };
    })
    .sort((left, right) => left.template.localeCompare(right.template));
}

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function toTemplate(relativeFile: string): string {
  const normalized = relativeFile.split(sep).join('/');
  const withoutLeaf = normalized.replace(/(?:^|\/)(?:page\.tsx|route\.ts)$/, '');
  const withParameters = withoutLeaf.replace(/\[([^\]]+)\]/g, ':$1');
  return withParameters ? `/${withParameters}` : '/';
}

function materialize(template: string): string {
  return template.replace(/:[^/]+/g, 'example.png');
}
