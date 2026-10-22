import { uiPermissionScope } from '../permissionState';
import { servicesRequest } from './servicesApi';

// Inventory shares the existing protected lifetime, stale-denial and CSRF path.
export function inventoryRequest(path: string, method = 'GET', body?: unknown, signal?: AbortSignal, current?: () => boolean) {
  const permissionScope = uiPermissionScope();
  return servicesRequest(path, method, body, signal, () => uiPermissionScope() === permissionScope && (!current || current()));
}

export function transferRequest(action: 'create' | 'complete', payload: Record<string, unknown>, signal?: AbortSignal, current?: () => boolean) {
  return inventoryRequest(`/api/inventory/transfers/${action}`, 'POST', payload, signal, current);
}
