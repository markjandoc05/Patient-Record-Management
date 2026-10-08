import type { RecordTransaction } from './database';

export class AppointmentServiceError extends Error {
  constructor(public status: number, message: string, public code = 'SERVICE_SELECTION_INVALID') { super(message); }
}
const snapshotFields = ['serviceId', 'serviceNameSnapshot', 'serviceDurationMinutesSnapshot', 'serviceCatalogueVersion'] as const;
export type AppointmentServiceSelection = { serviceId: string; expectedVersion: number } | null | undefined;

// Omitted = retain history; null = explicitly remove; object = new selection.
export function parseAppointmentServiceSelection(payload: Record<string, unknown>): AppointmentServiceSelection {
  if (snapshotFields.some(field => field in payload)) throw new AppointmentServiceError(400, 'Service snapshots are server-owned.');
  if (!Object.hasOwn(payload, 'serviceSelection')) return undefined;
  const value = payload.serviceSelection;
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppointmentServiceError(400, 'Invalid Service selection.');
  const selection = value as Record<string, unknown>;
  if (Object.keys(selection).some(key => !['serviceId', 'expectedVersion'].includes(key))
    || typeof selection.serviceId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selection.serviceId)
    || !Number.isSafeInteger(selection.expectedVersion) || Number(selection.expectedVersion) < 1) {
    throw new AppointmentServiceError(400, 'Select a Service with its current catalogue version.');
  }
  return { serviceId: selection.serviceId.toLowerCase(), expectedVersion: Number(selection.expectedVersion) };
}

export async function appointmentServiceSnapshot(tx: RecordTransaction, selection: AppointmentServiceSelection, branchId: string, previous?: Record<string, any>) {
  if (selection === undefined) {
    if (previous?.serviceId && previous.branchId !== branchId) throw new AppointmentServiceError(409, 'Choose a Service for the new clinic, or explicitly continue without a Service.');
    return {};
  }
  if (selection === null) return Object.fromEntries(snapshotFields.map(field => [field, null]));
  // Appointment and Services writes share the existing transaction advisory lock.
  // Availability, price eligibility and version are read in the same transaction
  // as the appointment/audit write. Price is never copied into the appointment.
  const service = (await tx.sql(`SELECT s.id, s.name, s.default_duration_minutes, s.version, s.active,
    bs.available, COALESCE(bs.price_override, s.standard_price) IS NOT NULL AS priced,
    b.data->>'status' AS branch_status
    FROM services s
    LEFT JOIN service_branch_settings bs ON bs.service_id=s.id AND bs.branch_id=$2
    LEFT JOIN app_records b ON b.collection_path='branches' AND b.id=$2
    WHERE s.id=$1`, [selection.serviceId, branchId])).rows[0];
  if (!service) throw new AppointmentServiceError(400, 'The selected Service no longer exists. Choose another Service.');
  if (service.version !== selection.expectedVersion) throw new AppointmentServiceError(409, 'This Service changed. Reload Services and choose it again.', 'SERVICE_VERSION_CHANGED');
  if (!service.active || !service.available || service.branch_status !== 'Active' || !service.priced) {
    throw new AppointmentServiceError(400, 'Select an active, available Service with a configured price or Free.');
  }
  return { serviceId: service.id, serviceNameSnapshot: service.name,
    serviceDurationMinutesSnapshot: service.default_duration_minutes, serviceCatalogueVersion: service.version };
}
