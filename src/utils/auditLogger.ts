import { auth } from '../firebase';
import { ChangeDetail } from './diffUtils';

export interface AuditLogOptions {
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'VIEW' | 'AUTH';
  resource: 'Patient' | 'Appointment' | 'Visit' | 'User' | 'Settings' | 'Branch';
  resourceId: string;
  resourceName?: string; // Minimizing PHI: e.g. "PT-1004" or Patient initials
  details?: string; // e.g. "Updated status from Confirmed to Arrived"
  changes?: ChangeDetail[];
  userProfile?: { role?: string; email?: string; fullName?: string } | null;
}

/**
 * Reports a security event to the trusted server. Actor identity, time,
 * branch, safe resource label, and display details are derived server-side.
 * Only changed field names are transmitted; old/new values stay out of logs.
 */
export async function logActivity({
  action,
  resource,
  resourceId,
  resourceName: _resourceName = '',
  details: _details = '',
  changes = [],
  userProfile: _userProfile = null
}: AuditLogOptions) {
  try {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      console.warn('Audit logger triggered but no user is currently authenticated.');
      return;
    }

    const token = await currentUser.getIdToken();
    const response = await fetch('/api/audit-events', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
      action,
      resource,
      resourceId,
        changeFields: (changes || []).map(change => change.field)
      })
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error || 'Audit event was rejected');
    }
  } catch (error) {
    console.error('Failed to register audit trail entry:', error);
  }
}
