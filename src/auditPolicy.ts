export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'VIEW' | 'AUTH';
export type AuditResource = 'Patient' | 'Appointment' | 'Visit' | 'User' | 'Settings' | 'Branch' | 'Service' | 'Service Category';

export const AUDIT_QUERY_LIMIT = 250;

/**
 * The audit trail records all durable clinical, access, configuration, and
 * attachment changes. Routine reads remain excluded because they do not alter
 * a patient or appointment record.
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
  if (options.action === 'VIEW') return typeof options.eventType === 'string'
    && options.eventType.startsWith('developer_');
  if (options.action === 'AUTH') return options.resource === 'User';

  return ['CREATE', 'UPDATE', 'DELETE'].includes(options.action);
}
