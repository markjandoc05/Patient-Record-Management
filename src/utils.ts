import { formatActiveTimezone } from './utils/timezone';

export const formatDateTime = (dateInput: string | Date | number | null | undefined) => {
    if (!dateInput) return 'N/A';
    const dateString = typeof dateInput === 'string' ? dateInput : '';
    if (dateString.toLowerCase() === 'n/a') return 'N/A';

    // Keep date-only clinical values stable. They represent a calendar date, not
    // an instant that should shift between timezones.
    const isoDateMatch = dateString.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    
    let year: number;
    let month: number; // 0-indexed
    let day: number;

    if (isoDateMatch && isoDateMatch[4] === undefined) {
        year = parseInt(isoDateMatch[1], 10);
        month = parseInt(isoDateMatch[2], 10) - 1;
        day = parseInt(isoDateMatch[3], 10);
    } else {
        const date = dateInput instanceof Date ? new Date(dateInput.getTime()) : new Date(dateInput);
        if (isNaN(date.getTime())) return dateString || 'N/A'; // fallback to raw

        if (typeof dateInput !== 'string' || dateString.includes('T') || dateString.includes(':')) {
            return formatActiveTimezone(date);
        }
        
        year = date.getFullYear();
        month = date.getMonth();
        day = date.getDate();
        
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
    const dateFormatted = `${monthName} ${paddedDay}, ${year}`;

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
  
  export interface DataErrorInfo {
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
  
  export function handleDataError(error: unknown, operationType: OperationType, path: string | null, auth: any) {
    const errInfo: DataErrorInfo = {
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
    console.error('PostgreSQL Error: ', JSON.stringify(errInfo));
    throw new Error(JSON.stringify(errInfo));
  }
