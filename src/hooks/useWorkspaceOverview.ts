import { hasCapability, type PermissionId } from '../permissions';
import { useEffect, useState } from 'react';
import { db } from '../platform';
import { hasPermission, Role } from '../rbac';
import { subscribeToSharedCollection } from '../utils/branchAccess';
import { emptyOverviewState, subscribeOverviewData, workspaceAccessScope } from '../utils/workspaceOverview';

// Owned by App above the module switch: returning to Overview reuses live,
// validated data. No browser persistence or retained-page cache is added.
export function useWorkspaceOverview(uid: string | undefined, profile: any) {
  const scope = workspaceAccessScope(uid, profile);
  const [load, setLoad] = useState(() => ({ scope, ...emptyOverviewState() }));
  useEffect(() => {
    if (!scope) { setLoad({ scope, ...emptyOverviewState() }); return; }
    return subscribeOverviewData((source, success, failure) => {
      if (!hasCapability(profile, `${source}.view` as PermissionId)) {
        success([]); return () => {};
      }
      return subscribeToSharedCollection(db, source, success, failure);
    }, state => setLoad({ scope, ...state }));
  }, [scope]);
  // Clear old protected rows during render, before a changed-scope effect runs.
  return load.scope === scope ? load : { scope, ...emptyOverviewState() };
}
