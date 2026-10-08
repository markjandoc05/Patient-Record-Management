export const appointmentSources = ['appointments', 'visits', 'patients', 'users', 'branches'] as const;
export type AppointmentSource = typeof appointmentSources[number];
export type AppointmentLoadState = {
  data: Record<AppointmentSource, any[]>;
  ready: boolean;
  errors: Partial<Record<AppointmentSource, string>>;
};
export function emptyAppointmentState(): AppointmentLoadState {
  return { data: { appointments: [], visits: [], patients: [], users: [], branches: [] }, ready: false, errors: {} };
}
export type AppointmentSubscriber = (source: AppointmentSource, success: (rows: any[]) => void, failure: (error: any) => void) => () => void;

// Each generation owns its callbacks. Disposal invalidates them before cleanup,
// including callbacks from requests that were already in flight.
export function subscribeAppointmentData(
  subscribe: AppointmentSubscriber,
  publish: (state: AppointmentLoadState) => void,
  previous = emptyAppointmentState(),
) {
  let active = true;
  let state: AppointmentLoadState = { ...previous, errors: {} };
  const received = new Set<AppointmentSource>();
  const stops: (() => void)[] = [];
  publish(state);
  for (const source of appointmentSources) {
    try {
      stops.push(subscribe(source, rows => {
        if (!active) return;
        received.add(source);
        const errors = { ...state.errors }; delete errors[source];
        state = { data: { ...state.data, [source]: rows }, ready: state.ready || (received.size === appointmentSources.length && Object.keys(errors).length === 0), errors };
        publish(state);
      }, error => {
        if (!active) return;
        // Never display retained clinical data after an authorization failure.
        const denied = error?.code === 'permission-denied' || error?.status === 401 || error?.status === 403;
        state = { ...state, ...(denied ? { data: emptyAppointmentState().data, ready: false } : {}), errors: { ...state.errors, [source]: 'Could not refresh ' + source + '.' } };
        if (denied) received.clear();
        publish(state);
      }));
    } catch {
      if (active) {
        state = { ...state, errors: { ...state.errors, [source]: 'Could not load ' + source + '.' } };
        publish(state);
      }
    }
  }
  return () => { active = false; stops.forEach(stop => stop()); };
}
