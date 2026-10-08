export const SUPPORT_DEVELOPER = 'SUPPORT_DEVELOPER' as const;
export type Role = 'admin' | 'doctor' | 'staff' | 'manager' | 'support_developer' | typeof SUPPORT_DEVELOPER;

export const developerRoles = ['support_developer', SUPPORT_DEVELOPER] as const;
export const administrativeRoles = ['admin', ...developerRoles] as const;
export const clinicalPatientRoles = ['admin', 'doctor', ...developerRoles] as const;
export const isSupportDeveloper = (role: unknown) => typeof role === 'string' && (developerRoles as readonly string[]).includes(role);
export const hasAdministrativeAccess = (role: unknown) => typeof role === 'string' && (administrativeRoles as readonly string[]).includes(role);

export const roleLabel = (role: string) => role === SUPPORT_DEVELOPER ? 'Support / Developer' : role === 'support_developer' ? 'Support / Developer (legacy)' : role;

export type Permission = 'create' | 'read' | 'update' | 'delete';

export type ModulePermissions = {
  [key in Permission]?: boolean;
};

export type RBACConfig = {
  [key in Role]: {
    patientRecord: ModulePermissions;
    appointment: ModulePermissions;
    visitHistory: ModulePermissions;
  };
};

export type PatientEditScope = 'none' | 'demographic' | 'operational' | 'full';

export const RBAC: RBACConfig = {
  SUPPORT_DEVELOPER: {
    patientRecord: { create: true, read: true, update: true, delete: true },
    appointment: { create: true, read: true, update: true, delete: true },
    visitHistory: { create: true, read: true, update: true, delete: true },
  },
  admin: {
    patientRecord: { create: true, read: true, update: true, delete: true },
    appointment: { create: true, read: true, update: true, delete: true },
    visitHistory: { create: true, read: true, update: true, delete: true },
  },
  doctor: {
    patientRecord: { create: true, read: true, update: true, delete: false },
    appointment: { create: true, read: true, update: true, delete: false },
    visitHistory: { create: true, read: true, update: true, delete: false },
  },
  staff: {
    patientRecord: { create: true, read: true, update: false, delete: false },
    appointment: { create: true, read: true, update: true, delete: false },
    visitHistory: { create: false, read: true, update: false, delete: false },
  },
  manager: {
    patientRecord: { create: true, read: true, update: true, delete: false },
    appointment: { create: true, read: true, update: true, delete: false },
    visitHistory: { create: false, read: true, update: false, delete: false },
  },
  support_developer: {
    patientRecord: { create: true, read: true, update: true, delete: true },
    appointment: { create: true, read: true, update: true, delete: true },
    visitHistory: { create: true, read: true, update: true, delete: true },
  }
};

export const hasPermission = (role: Role, module: keyof RBACConfig[Role], permission: Permission): boolean => {
  return !!RBAC[role]?.[module]?.[permission];
};

export const getPatientEditScope = (role: Role): PatientEditScope => {
  if (role === 'admin' || role === 'doctor' || isSupportDeveloper(role)) return 'full';
  if (role === 'manager') return 'operational';
  if (role === 'staff') return 'demographic';
  return 'none';
};

export const canEditPatient = (role: Role): boolean => getPatientEditScope(role) !== 'none';

// Both support identifiers now expose the full existing feature set. Server-side
// authorization keeps SUPPORT_DEVELOPER limited to isolated development.
export function canAccessView(_role: string | null, _view: string): boolean { return true; }
export const canReadPatientClinicalData = (role?: string) => !!role;
