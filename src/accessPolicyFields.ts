// Generic profile writes may never mutate authorization or account lifecycle state.
export const protectedAccessPolicyFields = new Set([
  'role', 'assignedBranches', 'assignedBranchNames', 'defaultBranchId', 'defaultBranchName',
  'staffDesignation', 'permissionOverrides', 'accessRevision', 'active', 'accountStatus', 'isArchived',
  'archivedAt', 'archivedByUid', 'archivedByName', 'restoredAt', 'restoredByUid', 'restoredByName',
]);
