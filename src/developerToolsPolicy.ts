import type { AuditAction, AuditResource } from './auditPolicy';

export const developerActivityEvents = [
  'developer_cache_cleared',
  'developer_settings_refreshed',
  'developer_fault_simulated',
] as const;

export type DeveloperActivityEvent = typeof developerActivityEvents[number];

const developerActivityDefinitions: Record<DeveloperActivityEvent, {
  action: AuditAction;
  resource: AuditResource;
  resourceId: string;
}> = {
  developer_cache_cleared: { action: 'DELETE', resource: 'Settings', resourceId: 'developer_browser_cache' },
  developer_settings_refreshed: { action: 'VIEW', resource: 'Settings', resourceId: 'developer_branding' },
  developer_fault_simulated: { action: 'VIEW', resource: 'Settings', resourceId: 'developer_session_error_test' },
};

export function getDeveloperActivityDefinition(event: string) {
  return developerActivityDefinitions[event as DeveloperActivityEvent] || null;
}
