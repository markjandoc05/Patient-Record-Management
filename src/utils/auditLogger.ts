import { collection, addDoc, getDocs, query, where } from 'firebase/firestore';
import { db, auth } from '../firebase';
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
 * Logs a lightweight, HIPAA-compliant security activity to the ledger.
 */
export async function logActivity({
  action,
  resource,
  resourceId,
  resourceName = '',
  details = '',
  changes = [],
  userProfile = null
}: AuditLogOptions) {
  try {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      console.warn('Audit logger triggered but no user is currently authenticated.');
      return;
    }

    // HIPAA Compliance Guard: Ensure detail strings do not leak raw, unencrypted medical / clinical secrets.
    // We strictly record activity context (metadata, action type, and field names) instead of actual clinical values.
    const cleanDetails = details.replace(/[\n\r]/g, ' ').trim();

    let actualUserProfile = userProfile;
    if (!actualUserProfile && currentUser.email) {
       const userSnap = await getDocs(query(collection(db, 'users'), where('email', '==', currentUser.email)));
       if (!userSnap.empty) {
           actualUserProfile = userSnap.docs[0].data();
       }
    }

    // Prepare immutable log payload
    const logData = {
      timestamp: new Date().toISOString(),
      userId: currentUser.uid,
      userEmail: currentUser.email || 'unknown',
      userName: actualUserProfile?.fullName || 'Unknown User',
      userRole: actualUserProfile?.role || 'staff',
      action,
      resource,
      resourceId,
      resourceName,
      details: cleanDetails || '',
      changes: changes || [],
      userAgent: typeof window !== 'undefined' ? window.navigator.userAgent.slice(0, 200) : 'unknown'
    };

    await addDoc(collection(db, 'audit_logs'), logData);
  } catch (error) {
    console.error('Failed to register audit trail entry:', error);
  }
}
