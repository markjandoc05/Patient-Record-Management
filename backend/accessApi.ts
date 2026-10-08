import type express from 'express';
import { db } from './database';
import { currentActor, assertAccessTarget, stageAccessAudit } from './permissions';
import { normalizePermissionOverrides, isPermissionId } from '../src/permissions';
import { RBAC } from '../src/rbac';
import { assignmentIssues } from '../src/utils/userActivation';

export function mountAccessApi(app: express.Express) {
  app.patch('/api/users/:id/access', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(req.params.id)) throw Object.assign(new Error('Invalid user ID'), { status: 400 });
      const body = req.body;
      if (!body || Array.isArray(body) || Object.keys(body).some(key => !['expectedAccessRevision', 'role', 'assignedBranches', 'defaultBranchId', 'permissionChanges'].includes(key))
        || !Number.isSafeInteger(body.expectedAccessRevision) || body.expectedAccessRevision < 0) throw Object.assign(new Error('A valid access revision and access fields are required'), { status: 400 });
      const result = await db.runTransaction(async tx => {
        const { identity, profile } = await currentActor(req, tx);
        const ref = db.collection('users').doc(req.params.id);
        const old = (await tx.get(ref)).data();
        if (!old) throw Object.assign(new Error('User not found'), { status: 404 });
        // Authorize before validation/conflict details about the target policy.
        assertAccessTarget(identity, profile, ref.id, old, body.permissionChanges === undefined ? body : { ...body, permissionOverrides: true });
        if (old.isArchived) throw Object.assign(new Error('Restore the account before changing access'), { status: 409 });
        if ((old.accessRevision ?? 0) !== body.expectedAccessRevision) throw Object.assign(new Error('Access changed. Reload the user and review again.'), { status: 409 });
        if (body.role !== undefined && (typeof body.role !== 'string' || !Object.hasOwn(RBAC, body.role))) throw Object.assign(new Error('Invalid role'), { status: 400 });
        const next = { ...old };
        for (const key of ['role', 'assignedBranches', 'defaultBranchId']) if (Object.hasOwn(body, key)) next[key] = body[key];
        if (body.permissionChanges !== undefined) {
          normalizePermissionOverrides(body.permissionChanges);
          const overrides = old.permissionOverrides === undefined ? {} : normalizePermissionOverrides(old.permissionOverrides);
          for (const [key, value] of Object.entries(body.permissionChanges)) {
            if (!isPermissionId(key)) throw new Error('Invalid permission');
            if (value === 'inherit') delete overrides[key]; else overrides[key] = value as 'allow' | 'deny';
          }
          next.permissionOverrides = overrides;
        }
        const ids = Array.isArray(next.assignedBranches) ? next.assignedBranches : [];
        const branches = [];
        for (const id of ids) {
          if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw Object.assign(new Error('Invalid branch assignment'), { status: 400 });
          const branch = (await tx.get(db.collection('branches').doc(id))).data();
          if (branch) branches.push({ ...branch, id });
        }
        const issues = assignmentIssues(next, branches);
        if (issues.length) throw Object.assign(new Error(issues[0]), { status: 400 });
        next.assignedBranchNames = ids.map((id: string) => branches.find(branch => branch.id === id)?.branchName || '');
        next.defaultBranchName = branches.find(branch => branch.id === next.defaultBranchId)?.branchName || null;
        next.accessRevision = stageAccessAudit(tx, identity, profile, ref.id, old, next);
        tx.update(ref, { role: next.role, assignedBranches: next.assignedBranches || [], assignedBranchNames: next.assignedBranchNames,
          defaultBranchId: next.defaultBranchId ?? null, defaultBranchName: next.defaultBranchName,
          ...(body.permissionChanges !== undefined ? { permissionOverrides: next.permissionOverrides } : {}), accessRevision: next.accessRevision });
        return { id: ref.id, accessRevision: next.accessRevision, permissionOverrides: next.permissionOverrides || {} };
      });
      res.json(result);
    } catch (error: any) {
      res.status(error.status || (error.message === 'Unauthorized' ? 401 : 400)).json({ error: error.message === 'Unauthorized' ? 'Please sign in again.' : error.message });
    }
  });
}
