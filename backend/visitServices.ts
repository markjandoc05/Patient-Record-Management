import type { RecordTransaction } from './database';
import { appointmentServiceSnapshot, type AppointmentServiceSelection } from './appointmentServices';

// The same four fields on a Visit describe performance; on an Appointment they
// describe booking. Linked appointment snapshots are never updated here.
export async function applyVisitServiceSelection(tx: RecordTransaction, selection: AppointmentServiceSelection,
  payload: Record<string, unknown>, updates: Record<string, any>, previous?: Record<string, any>) {
  const snapshot = await appointmentServiceSnapshot(tx, selection, updates.branchId, previous);
  Object.assign(updates, snapshot);
  if (selection) {
    updates.treatmentService = snapshot.serviceNameSnapshot;
  } else if (selection === null && previous?.serviceId) {
    // Clear the canonical alias only. A distinct imported clinical description
    // remains historical free text even when its canonical reference is removed.
    if (previous.treatmentService === previous.serviceNameSnapshot) updates.treatmentService = '';
    else if (Object.hasOwn(previous, 'treatmentService')) updates.treatmentService = previous.treatmentService;
    else delete updates.treatmentService;
  } else if (previous && (previous.serviceId || !Object.hasOwn(payload, 'treatmentService')
    || payload.treatmentService === previous.treatmentService)) {
    // Preserve untouched text byte-for-byte, even though ordinary changed text
    // follows the existing parser's trimming/length rules. A retained canonical
    // mirror cannot be replaced by an arbitrary caller label.
    if (Object.hasOwn(previous, 'treatmentService')) updates.treatmentService = previous.treatmentService;
    else delete updates.treatmentService;
  }
}
