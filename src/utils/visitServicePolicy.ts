// Historical labels use recorded data only, never today's catalogue.
export function performedServiceLabel(visit: any, fallback = 'Consultation'): string {
  return (visit?.serviceId && visit.serviceNameSnapshot) || visit?.treatmentService || visit?.servicePerformed || fallback;
}

// Completed is the existing operational status, not a clinical signature.
// No signing/amendment flow is introduced. Explicitly sealed imported records
// are read-only until a separately designed amendment workflow exists.
export function isVisitClinicallySealed(visit: any): boolean {
  return Boolean(visit && (visit.isSigned === true || visit.isFinalized === true
    || visit.signedAt || visit.finalizedAt || ['Signed', 'Finalized'].includes(visit.status)));
}
