export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'VIEW' | 'AUTH';
export type AuditResource = 'Patient' | 'Appointment' | 'Visit' | 'User' | 'Settings' | 'Branch';

export const AUDIT_EXCLUDED_ROLE = 'support_developer';
export const AUDIT_QUERY_LIMIT = 250;

/**
 * The audit trail is deliberately selective. It records durable clinical,
 * access, and configuration changes, but excludes routine reads and attachment
 * uploads. Attachment deletion remains auditable because it is destructive.
 *
 * This policy is shared by the browser (to avoid unnecessary requests) and the
 * trusted server (the authoritative enforcement point).
 */
export function shouldRecordAuditEvent(options: {
  actorRole?: string | null;
  action: AuditAction;
  resource: AuditResource;
  eventType?: string;
}) {
  if (options.actorRole === AUDIT_EXCLUDED_ROLE) return false;
  if (options.action === 'VIEW') return false;
  if (options.eventType === 'attachment_uploaded') return false;
  if (options.action === 'AUTH') return options.resource === 'User';

  return ['CREATE', 'UPDATE', 'DELETE'].includes(options.action);
}
