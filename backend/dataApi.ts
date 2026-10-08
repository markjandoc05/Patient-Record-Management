import { activeAccount, hasCapability, hasGlobalBranchScope, type PermissionId } from '../src/permissions';
import { assertCapability } from './permissions';
import { protectedAccessPolicyFields } from '../src/accessPolicyFields';
import { redactClinicalData, assertClinicalQuery } from './clinicalRedaction';
import type express from 'express';
import { db, RecordQuery, DocumentReference, resolveData } from './database';
import { sessionIdentity, trustedWriteOrigin } from './auth';
import { RBAC, SUPPORT_DEVELOPER, administrativeRoles, clinicalPatientRoles, isSupportDeveloper } from '../src/rbac';
import { assertDevelopmentRole } from './developmentAccess';
import { assertAppointmentRead, scopeAppointmentRead } from './appointmentReadAccess';
const publicSettings = new Set(['branding', 'timezone', 'footer', 'media']);
const roles = new Set(Object.keys(RBAC));
const globalRoles = new Set<string>(administrativeRoles);
const inventoryCollections = new Set(['inventory_items', 'inventory_stocks', 'suppliers', 'stock_transfers']);
export function parseRecordPath(value: unknown, document: boolean) {
  if (typeof value !== 'string' || value.length > 500 || !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(value)) throw new Error('Invalid record path');
  const parts = value.split('/');
  if ((document && parts.length % 2 !== 0) || (!document && parts.length % 2 !== 1)) throw new Error('Invalid record path');
  return parts;
}
function forbidden(message = 'Insufficient permissions') { throw Object.assign(new Error(message), { status: 403 }); }
export function assertProfileWrite(actorId: string, actor: any, targetId: string, old: any, updates: any) {
  const profile = typeof actor === 'string' ? { role: actor, active: true } : actor;
  const role = profile.role;
  const keys = Object.keys(updates);
  if (keys.some(key => protectedAccessPolicyFields.has(key))) forbidden('Use the access policy endpoint');
  const selfFields = ['fullName', 'birthdate', 'contactNumber', 'lastUpdatedBy', 'lastUpdatedDate'];
  if (targetId === actorId && keys.every(key => selfFields.includes(key))) {
    if (updates.lastUpdatedBy !== actorId || Object.values(updates).some(value => typeof value !== 'string') || (updates.fullName !== undefined && (!updates.fullName.trim() || updates.fullName.length > 120))) forbidden('Invalid profile update'); return;
  }
  if (keys.every(key => selfFields.includes(key))) {
    assertCapability(profile, 'users.manage');
    assertDevelopmentRole(old?.role);
    if (isSupportDeveloper(old?.role) && !isSupportDeveloper(role)) forbidden();
    if (Object.values(updates).some(value => typeof value !== 'string') || (updates.fullName !== undefined && (!updates.fullName.trim() || updates.fullName.length > 120))) forbidden('Invalid user details');
    return;
  }
  forbidden('Use the dedicated access policy or account lifecycle endpoint');
}
export function mountDataApi(app: express.Express) {
  app.post('/api/data/query', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (!trustedWriteOrigin(req)) forbidden('Invalid origin');
      const kind = req.body.kind; const isDocument = kind === 'document';
      if (!isDocument && kind !== 'collection') throw new Error('Invalid query kind');
      const parts = parseRecordPath(req.body.path, isDocument);
      const collection = isDocument ? parts.slice(0, -1).join('/') : parts.join('/');
      const id = isDocument ? parts.at(-1)! : '';
      const publicRead = isDocument && collection === 'settings' && publicSettings.has(id);
      const identity = publicRead ? null : await sessionIdentity(req);
      const initialProfile = identity ? (await db.collection('users').doc(identity.uid).get()).data() : null;
      const execute = async (tx?: any) => {
        const read = (target: any) => tx ? tx.get(target) : target.get();
        const currentIdentity = !publicRead && tx ? await sessionIdentity(req, tx) : identity;
        const userId = currentIdentity?.uid || '';
        if (identity && currentIdentity?.uid !== identity.uid) forbidden('Account scope changed');
        const profile = tx ? (await read(db.collection('users').doc(userId))).data() : initialProfile;
        if (initialProfile?.role === SUPPORT_DEVELOPER && profile?.role !== SUPPORT_DEVELOPER) forbidden('Account scope changed');
        const role = profile?.role || '';
        const ownProfile = isDocument && collection === 'users' && id === userId;
        if (!publicRead) {
          assertDevelopmentRole(role);
          if (!ownProfile && (!activeAccount(profile))) forbidden('Account is not approved or active');
          const readPermissions: Record<string, PermissionId> = { patients: 'patients.view', appointments: 'appointments.view', visits: 'visits.view', branches: 'branches.view', users: 'users.view', audit_logs: 'audit.view' };
          if (readPermissions[collection]) { if (!ownProfile) assertCapability(profile, readPermissions[collection]); }
          else if (inventoryCollections.has(collection)) assertCapability(profile, 'inventory.view');
          else if (/^patients\/[A-Za-z0-9_-]+\/privateNotes$/.test(collection)) {
            assertCapability(profile, 'patients.view'); assertCapability(profile, 'clinical.view'); assertCapability(profile, 'clinical.private_notes.view');
          } else forbidden();
        }
        if (isDocument) {
          const snapshot = await read(new DocumentReference(collection, id));
          const data = snapshot.data();
          if (collection === 'appointments' && data) assertAppointmentRead(profile, data);
          if (collection === 'inventory_stocks' && data) assertCapability(profile, 'inventory.view', { branchId: data.branchId });
          if (collection === 'stock_transfers' && data) { assertCapability(profile, 'inventory.view', { branchId: data.fromBranchId }); assertCapability(profile, 'inventory.view', { branchId: data.toBranchId }); }
          return { document: { id, data: redactClinicalData(collection, data || null, profile) } };
        }
        let query: RecordQuery = db.collection(collection);
        const constraints = req.body.constraints || [];
        if (!Array.isArray(constraints) || constraints.length > 10) throw new Error('Invalid constraints');
        if (collection === 'appointments') query = scopeAppointmentRead(query, profile);
        assertClinicalQuery(profile, collection, constraints);
        if (!hasGlobalBranchScope(profile)) {
          const assigned = Array.isArray(profile.assignedBranches) ? profile.assignedBranches : [];
          if (collection === 'inventory_stocks') query = query.where('branchId', 'string-in', assigned);
          if (collection === 'stock_transfers') query = query.where('fromBranchId', 'string-in', assigned).where('toBranchId', 'string-in', assigned);
        }
        for (const constraint of constraints) {
          if (constraint.type === 'where') query = query.where(constraint.field, constraint.operator, constraint.value);
          else if (constraint.type === 'orderBy') {
            if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(constraint.field)) throw new Error('Invalid order field');
            query = query.orderBy(constraint.field, constraint.direction);
          } else if (constraint.type === 'limit') {
            if (!Number.isInteger(constraint.value) || constraint.value < 1 || constraint.value > 10000) throw new Error('Invalid limit');
            query = query.limit(constraint.value);
          } else throw new Error('Invalid constraint');
        }
        const snapshot = await read(query);
        return { documents: snapshot.docs.map((doc: any) => ({ id: doc.id, data: redactClinicalData(collection, doc.data(), profile) })) };
      };
      // Re-read scope under the same lock used by profile/assignment writes.
      const result = publicRead ? await execute() : await db.runTransaction(execute);
      res.json(result);
    } catch (error: any) { res.status(error.status || (error.message === 'Unauthorized' ? 401 : 400)).json({ error: error.status ? error.message : 'Data query failed' }); }
  });
  app.post('/api/data/write', async (req, res) => {
    try {
      const identity = await sessionIdentity(req);
      const operations = req.body.operations;
      if (!Array.isArray(operations) || operations.length < 1 || operations.length > 500) throw new Error('Invalid write batch');
      await db.runTransaction(async tx => {
        const currentIdentity = await sessionIdentity(req, tx);
        if (currentIdentity.uid !== identity.uid) forbidden('Account scope changed');
        const profile = (await tx.get(db.collection('users').doc(identity.uid))).data();
        assertDevelopmentRole(profile?.role);
        if (!activeAccount(profile)) forbidden('Account is not approved or active');
        const seen = new Set<string>();
        for (const operation of operations) {
          if (seen.has(operation.path)) throw new Error('Duplicate batch target'); seen.add(operation.path);
          const parts = parseRecordPath(operation.path, true); const id = parts.at(-1)!; const collection = parts.slice(0, -1).join('/');
          const ref = db.collection(collection).doc(id); const snapshot = await tx.get(ref); const old = snapshot.data();
          const data = operation.data || {};
          if (!['set', 'update', 'create', 'delete'].includes(operation.mode) || !data || Array.isArray(data) || typeof data !== 'object') throw new Error('Invalid operation');
          const next = resolveData(data, operation.mode === 'update' || operation.merge ? old : {});
          let resource = 'Settings'; let branchId: string | null = null;
          if (collection === 'users') {
            if (!snapshot.exists || operation.mode !== 'update' && !(operation.mode === 'set' && operation.merge)) forbidden();
            assertProfileWrite(identity.uid, profile, id, old, data);
            resource = 'User';
          } else if (collection === 'settings') {
            if (!hasCapability(profile, 'settings.manage') || !publicSettings.has(id) || operation.mode === 'delete' || ('maintenanceMode' in data && data.maintenanceMode !== old?.maintenanceMode) || (old?.maintenanceMode !== undefined && next.maintenanceMode !== old.maintenanceMode)) forbidden();
          } else if (collection === 'branches') {
            assertCapability(profile, 'branches.manage');
            assertCapability(profile, 'access.manage'); resource = 'Branch'; branchId = id;
            if (operation.mode === 'delete') {
              if ((await tx.sql('SELECT 1 FROM service_branch_settings WHERE branch_id=$1 LIMIT 1', [id])).rows.length) forbidden('Branch has service configuration; deactivate it instead');
              for (const [name, field] of [['patients', 'homeBranchId'], ['appointments', 'branchId'], ['visits', 'branchId'], ['inventory_stocks', 'branchId'], ['stock_transfers', 'fromBranchId'], ['stock_transfers', 'toBranchId']]) {
                if (!(await tx.get(db.collection(name).where(field, '==', id).limit(1))).empty) forbidden('Branch has linked records; deactivate it instead');
              }
            } else if (!next.branchName?.trim() || !['Active', 'Inactive'].includes(next.status)) throw new Error('Invalid branch');
          } else if (/^patients\/[A-Za-z0-9_-]+\/privateNotes$/.test(collection)) {
            assertCapability(profile, 'patients.view'); assertCapability(profile, 'clinical.view'); assertCapability(profile, 'clinical.edit_draft'); assertCapability(profile, 'clinical.private_notes.create');
            if (operation.mode !== 'create') forbidden();
            const patientId = parts[1];
            if (!(await tx.get(db.collection('patients').doc(patientId))).exists || typeof data.note !== 'string' || !data.note.trim() || data.note.length > 10000) throw new Error('Invalid note');
            Object.assign(data, { patientId, authorId: identity.uid, authorName: profile.fullName, createdAt: { __operation: 'timestamp' } }); resource = 'Patient';
          } else if (inventoryCollections.has(collection)) {
            if (!hasCapability(profile, 'inventory.manage') || operation.mode !== 'create' || !['inventory_items', 'suppliers'].includes(collection)) forbidden('Use inventory endpoints');
            if (typeof data.name !== 'string' || !data.name.trim() || data.name.length > 200) throw new Error('Invalid item or supplier name');
            if (collection === 'inventory_items') {
              if (typeof data.sku !== 'string' || !data.sku.trim() || !Number.isFinite(data.lowStockThreshold) || data.lowStockThreshold < 0) throw new Error('Invalid inventory item');
              if (!(await tx.get(db.collection(collection).where('sku', '==', data.sku))).empty) throw new Error('SKU already exists');
            }
            resource = 'Inventory';
          } else forbidden('Use the dedicated record endpoint');
          if (operation.mode === 'delete') tx.delete(ref);
          else if (operation.mode === 'create') tx.create(ref, data);
          else if (operation.mode === 'update') tx.update(ref, data);
          else tx.set(ref, data, { merge: operation.merge });
          tx.create(db.collection('audit_logs').doc(), {
            action: operation.mode === 'delete' ? 'DELETE' : snapshot.exists ? 'UPDATE' : 'CREATE', resource,
            resourceId: collection.includes('/privateNotes') ? parts[1] : id,
            userId: identity.uid, userName: profile.fullName || identity.email, userEmail: identity.email, userRole: profile.role,
            timestamp: new Date().toISOString(), branchId, source: 'trusted_server', eventType: 'configuration_or_note_changed',
            details: `Updated ${resource.toLowerCase()}`, changes: Object.keys(data).map(field => ({ field })),
          });
        }
      });
      res.json({ ok: true });
    } catch (error: any) { res.status(error.status || (error.message === 'Unauthorized' ? 401 : 400)).json({ error: error.status ? error.message : 'Data write failed' }); }
  });
}
