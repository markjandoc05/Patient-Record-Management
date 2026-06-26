export type Role = 'admin' | 'doctor' | 'staff' | 'manager' | 'support_developer';

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

export const RBAC: RBACConfig = {
  admin: {
    patientRecord: { create: true, read: true, update: true, delete: true },
    appointment: { create: true, read: true, update: true, delete: true },
    visitHistory: { create: true, read: true, update: true, delete: true },
  },
  doctor: {
    patientRecord: { create: true, read: true, update: true, delete: false },
    appointment: { create: true, read: true, update: true, delete: false },
    visitHistory: { create: false, read: true, update: true, delete: false },
  },
  staff: {
    patientRecord: { create: false, read: true, update: false, delete: false },
    appointment: { create: true, read: true, update: true, delete: false },
    visitHistory: { create: false, read: true, update: false, delete: false },
  },
  manager: {
    patientRecord: { create: true, read: true, update: true, delete: false },
    appointment: { create: true, read: true, update: true, delete: false },
    visitHistory: { create: true, read: true, update: true, delete: false },
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
