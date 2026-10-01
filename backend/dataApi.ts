import type express from 'express';
import { db, RecordQuery, DocumentReference, resolveData } from './database';
import { sessionIdentity, trustedWriteOrigin } from './auth';
const publicSettings = new Set(['branding', 'timezone', 'footer', 'media']);
const roles = new Set(['admin', 'manager', 'staff', 'doctor', 'support_developer']);
const globalRoles = new Set(['admin', 'support_developer']);
const inventoryCollections = new Set(['inventory_items', 'inventory_stocks', 'suppliers', 'stock_transfers']);
export function parseRecordPath(value: unknown, document: boolean) {
  if (typeof value !== 'string' || value.length > 500 || !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(value)) throw new Error('Invalid record path');
  const parts = value.split('/');
  if ((document && parts.length % 2 !== 0) || (!document && parts.length % 2 !== 1)) throw new Error('Invalid record path');
  return parts;
}
function forbidden(message = 'Insufficient permissions') { throw Object.assign(new Error(message), { status: 403 }); }
export function assertProfileWrite(actorId: string, role: string, targetId: string, old: any, updates: any) {
  const keys = Object.keys(updates);
  const selfFields = ['fullName', 'birthdate', 'contactNumber', 'lastUpdatedBy', 'lastUpdatedDate'];
  if (targetId === actorId && keys.every(key => selfFields.includes(key))) {
    if (updates.lastUpdatedBy !== actorId || Object.values(updates).some(value => typeof value !== 'string') || (updates.fullName !== undefined && (!updates.fullName.trim() || updates.fullName.length > 120))) forbidden('Invalid profile update'); return;
  }
  if (!globalRoles.has(role)) forbidden();
  if (role !== 'support_developer' && (old?.role === 'support_developer' || updates.role === 'support_developer')) forbidden();
  const permitted = ['role', 'assignedBranches', 'assignedBranchNames', 'defaultBranchId', 'defaultBranchName'];
  if (keys.some(key => !permitted.includes(key))) forbidden('Use the dedicated account lifecycle endpoint');
  if (updates.role !== undefined && !roles.has(updates.role)) forbidden('Invalid role');
  if (targetId === actorId && updates.role && updates.role !== old.role) forbidden('Cannot change your own role');
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
      let role = ''; let userId = '';
      const publicRead = isDocument && collection === 'settings' && publicSettings.has(id);
      if (!publicRead) {
        const identity = await sessionIdentity(req); userId = identity.uid;
        const profile = (await db.collection('users').doc(userId).get()).data();
        role = profile?.role || '';
        const ownProfile = isDocument && collection === 'users' && id === userId;
        if (!ownProfile && (!profile?.active || !roles.has(role))) forbidden('Account is not approved or active');
        if (collection === 'users' && !ownProfile && !roles.has(role)) forbidden();
        if (['patients', 'appointments', 'visits', 'branches', 'users'].includes(collection)) { /* preserve shared clinic continuity reads */ }
        else if (collection === 'audit_logs' || inventoryCollections.has(collection)) { if (!globalRoles.has(role)) forbidden(); }
        else if (/^patients\/[A-Za-z0-9_-]+\/privateNotes$/.test(collection)) { if (!['admin', 'doctor', 'support_developer'].includes(role)) forbidden(); }
        else forbidden();
      }
      if (isDocument) {
        const snapshot = await new DocumentReference(collection, id).get();
        return res.json({ document: { id, data: snapshot.data() || null } });
      }
      let query: RecordQuery = db.collection(collection);
      const constraints = req.body.constraints || [];
      if (!Array.isArray(constraints) || constraints.length > 10) throw new Error('Invalid constraints');
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
      const snapshot = await query.get();
      res.json({ documents: snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() })) });
    } catch (error: any) { res.status(error.status || (error.message === 'Unauthorized' ? 401 : 400)).json({ error: error.status ? error.message : 'Data query failed' }); }
  });
  app.post('/api/data/write', async (req, res) => {
    try {
      const identity = await sessionIdentity(req);
      const operations = req.body.operations;
      if (!Array.isArray(operations) || operations.length < 1 || operations.length > 500) throw new Error('Invalid write batch');
      await db.runTransaction(async tx => {
        const profile = (await tx.get(db.collection('users').doc(identity.uid))).data();
        if (!profile?.active || !roles.has(profile.role)) forbidden('Account is not approved or active');
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
            assertProfileWrite(identity.uid, profile.role, id, old, data);
            if (next.assignedBranches) {
              if (!Array.isArray(next.assignedBranches) || next.assignedBranches.some((branch: any) => typeof branch !== 'string')) throw new Error('Invalid branches');
              for (const branch of next.assignedBranches) { if (!(await tx.get(db.collection('branches').doc(branch))).exists) throw new Error('Branch not found'); }
              if (next.defaultBranchId && !next.assignedBranches.includes(next.defaultBranchId)) throw new Error('Default branch must be assigned');
            }
            resource = 'User';
          } else if (collection === 'settings') {
            if (!globalRoles.has(profile.role) || !publicSettings.has(id) || operation.mode === 'delete' || ('maintenanceMode' in data && data.maintenanceMode !== old?.maintenanceMode) || (old?.maintenanceMode !== undefined && next.maintenanceMode !== old.maintenanceMode)) forbidden();
          } else if (collection === 'branches') {
            if (!globalRoles.has(profile.role)) forbidden(); resource = 'Branch'; branchId = id;
            if (operation.mode === 'delete') {
              for (const [name, field] of [['patients', 'homeBranchId'], ['appointments', 'branchId'], ['visits', 'branchId'], ['inventory_stocks', 'branchId'], ['stock_transfers', 'fromBranchId'], ['stock_transfers', 'toBranchId']]) {
                if (!(await tx.get(db.collection(name).where(field, '==', id).limit(1))).empty) forbidden('Branch has linked records; deactivate it instead');
              }
            } else if (!next.branchName?.trim() || !['Active', 'Inactive'].includes(next.status)) throw new Error('Invalid branch');
          } else if (/^patients\/[A-Za-z0-9_-]+\/privateNotes$/.test(collection)) {
            if (!['admin', 'doctor', 'support_developer'].includes(profile.role) || operation.mode !== 'create') forbidden();
            const patientId = parts[1];
            if (!(await tx.get(db.collection('patients').doc(patientId))).exists || typeof data.note !== 'string' || !data.note.trim() || data.note.length > 10000) throw new Error('Invalid note');
            Object.assign(data, { patientId, authorId: identity.uid, authorName: profile.fullName, createdAt: { __operation: 'timestamp' } }); resource = 'Patient';
          } else if (inventoryCollections.has(collection)) {
            if (!globalRoles.has(profile.role) || operation.mode !== 'create' || !['inventory_items', 'suppliers'].includes(collection)) forbidden('Use inventory endpoints');
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
