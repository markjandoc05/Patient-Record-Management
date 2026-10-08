import { permissionScopeKey } from '../permissions';
export const overviewSources = ['patients', 'appointments', 'visits'] as const;
export type OverviewSource = typeof overviewSources[number];
export type OverviewState = {
  data: Record<OverviewSource, any[]>;
  ready: boolean;
  errors: Partial<Record<OverviewSource, string>>;
};
export function emptyOverviewState(): OverviewState {
  return { data: { patients: [], appointments: [], visits: [] }, ready: false, errors: {} };
}

// Descriptive profile changes do not alter authorization. Selected branches are
// display filters over these shared reads, not new session/access identities.
export function workspaceAccessScope(uid: string | undefined, profile: any): string {
  if (!uid || !profile?.active || profile.isArchived) return '';
  const branches = Array.isArray(profile.assignedBranches)
    ? [...new Set(profile.assignedBranches.filter((id: unknown) => typeof id === 'string' && id.length > 0))].sort()
    : [];
  return JSON.stringify([uid, profile.role, profile.active, profile.isArchived === true, branches, permissionScopeKey(profile)]);
}

type Subscriber = (source: OverviewSource, success: (rows: any[]) => void, failure: (error: any) => void) => () => void;
export function subscribeOverviewData(subscribe: Subscriber, publish: (state: OverviewState) => void) {
  let active = true;
  let state = emptyOverviewState();
  const received = new Set<OverviewSource>();
  const stops: (() => void)[] = [];
  publish(state);
  for (const source of overviewSources) {
    stops.push(subscribe(source, rows => {
      if (!active) return;
      received.add(source);
      const errors = { ...state.errors }; delete errors[source];
      state = { data: { ...state.data, [source]: rows }, ready: state.ready || (received.size === overviewSources.length && !Object.keys(errors).length), errors };
      publish(state);
    }, error => {
      if (!active) return;
      const denied = error?.status === 401 || error?.status === 403 || error?.code === 'permission-denied';
      if (denied) received.clear();
      state = { ...state, ...(denied ? { data: emptyOverviewState().data, ready: false } : {}), errors: { ...state.errors, [source]: `Could not refresh ${source}.` } };
      publish(state);
    }));
  }
  return () => { active = false; stops.forEach(stop => stop()); };
}
