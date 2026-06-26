export const formatDateTime = (dateString: string) => {
    if (!dateString) return 'N/A';
    if (dateString.toLowerCase() === 'n/a') return 'N/A';

    // Parse timezone-safely for ISO dates (like YYYY-MM-DD or YYYY-MM-DDThh:mm)
    const isoDateMatch = dateString.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    
    let year: number;
    let month: number; // 0-indexed
    let day: number;
    let hasTime = false;
    let hour = 0;
    let minute = 0;

    if (isoDateMatch) {
        year = parseInt(isoDateMatch[1], 10);
        month = parseInt(isoDateMatch[2], 10) - 1;
        day = parseInt(isoDateMatch[3], 10);
        if (isoDateMatch[4] !== undefined && isoDateMatch[5] !== undefined) {
            hasTime = true;
            hour = parseInt(isoDateMatch[4], 10);
            minute = parseInt(isoDateMatch[5], 10);
        }
    } else {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return dateString; // fallback to raw
        
        year = date.getFullYear();
        month = date.getMonth();
        day = date.getDate();
        
        // If there's time indicator, render time too
        if (dateString.includes('T') || dateString.includes(':')) {
            hasTime = true;
            hour = date.getHours();
            minute = date.getMinutes();
        }
    }

    const months = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];

    if (month < 0 || month > 11 || isNaN(day) || isNaN(year)) {
        return dateString;
    }

    const monthName = months[month];
    const paddedDay = String(day).padStart(2, '0');
    const dateFormatted = `${monthName} ${paddedDay} ${year}`;

    if (hasTime) {
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const displayHour = hour % 12 === 0 ? 12 : hour % 12;
        const paddedHour = String(displayHour).padStart(2, '0');
        const paddedMinute = String(minute).padStart(2, '0');
        return `${dateFormatted}, ${paddedHour}:${paddedMinute} ${ampm}`;
    }

    return dateFormatted;
};

export enum OperationType {
    CREATE = 'create',
    UPDATE = 'update',
    DELETE = 'delete',
    LIST = 'list',
    GET = 'get',
    WRITE = 'write',
  }
  
  export interface FirestoreErrorInfo {
    error: string;
    operationType: OperationType;
    path: string | null;
    authInfo: {
      userId?: string | null;
      email?: string | null;
      emailVerified?: boolean | null;
      isAnonymous?: boolean | null;
      tenantId?: string | null;
      providerInfo?: {
        providerId?: string | null;
        email?: string | null;
      }[];
    }
  }
  
  export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null, auth: any) {
    const errInfo: FirestoreErrorInfo = {
      error: error instanceof Error ? error.message : String(error),
      authInfo: {
        userId: auth.currentUser?.uid,
        email: auth.currentUser?.email,
        emailVerified: auth.currentUser?.emailVerified,
        isAnonymous: auth.currentUser?.isAnonymous,
        tenantId: auth.currentUser?.tenantId,
        providerInfo: auth.currentUser?.providerData?.map((provider: any) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || []
      },
      operationType,
      path
    }
    console.error('Firestore Error: ', JSON.stringify(errInfo));
    throw new Error(JSON.stringify(errInfo));
  }
