// Packages share the Services transport's protected account/access generation,
// CSRF handling and stale-denial protection. No second cache or auth path.
import { servicesRequest } from './servicesApi';
import { uiPermissionScope } from '../permissionState';
export function packagesRequest(path: string, method = 'GET', body?: unknown, signal?: AbortSignal, current?: () => boolean) {
  const permissionScope = uiPermissionScope();
  return servicesRequest(path, method, body, signal, () => uiPermissionScope() === permissionScope && (!current || current()));
}
