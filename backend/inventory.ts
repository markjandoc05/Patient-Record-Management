import type express from 'express';
import { db } from './database';
import { sessionIdentity } from './auth';
import { hasAdministrativeAccess } from '../src/rbac';
import { assertDevelopmentRole } from './developmentAccess';
export function mountInventory(app: express.Express) {
  for (const action of ['create', 'complete']) {
    app.post(`/api/inventory/transfers/${action}`, async (req, res) => {
      try {
        const identity = await sessionIdentity(req);
        const result = await db.runTransaction(async tx => {
          const profile = (await tx.get(db.collection('users').doc(identity.uid))).data();
          assertDevelopmentRole(profile?.role);
          if (!profile?.active || !hasAdministrativeAccess(profile.role)) throw Object.assign(new Error('Insufficient permissions'), { status: 403 });
          const ref = db.collection('stock_transfers').doc(action === 'complete' ? String(req.body.id) : undefined);
          const existing = action === 'complete' ? (await tx.get(ref)).data() : undefined;
          if (action === 'complete' && !existing) throw new Error('Transfer not found');
          if (existing?.status === 'completed') return { id: ref.id, alreadyCompleted: true };
          if (existing && existing.status !== 'pending') throw new Error('Transfer is not pending');
          const transfer = existing || req.body;
          const { itemId, fromBranchId, toBranchId, quantity } = transfer;
          if (![itemId, fromBranchId, toBranchId].every(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id)) || fromBranchId === toBranchId || !Number.isFinite(quantity) || quantity <= 0) throw new Error('Invalid transfer');
          if (!(await tx.get(db.collection('inventory_items').doc(itemId))).exists) throw new Error('Item not found');
          for (const branchId of [fromBranchId, toBranchId]) {
            const branch = (await tx.get(db.collection('branches').doc(branchId))).data();
            if (branch?.status !== 'Active') throw new Error('Branch is inactive or missing');
          }
          const source = await tx.get(db.collection('inventory_stocks').where('itemId', '==', itemId).where('branchId', '==', fromBranchId));
          if (source.size !== 1 || !Number.isFinite(source.docs[0].data()?.quantity) || source.docs[0].data()!.quantity < quantity) throw new Error('Insufficient or ambiguous source stock');
          if (action === 'create') {
            tx.create(ref, { itemId, fromBranchId, toBranchId, quantity, status: 'pending', createdAt: { __operation: 'timestamp' }, createdBy: identity.uid });
          } else {
            const destination = await tx.get(db.collection('inventory_stocks').where('itemId', '==', itemId).where('branchId', '==', toBranchId));
            if (destination.size > 1) throw new Error('Ambiguous destination stock');
            tx.update(db.collection('inventory_stocks').doc(source.docs[0].id), { quantity: source.docs[0].data()!.quantity - quantity });
            if (destination.empty) tx.create(db.collection('inventory_stocks').doc(), { itemId, branchId: toBranchId, quantity });
            else tx.update(db.collection('inventory_stocks').doc(destination.docs[0].id), { quantity: Number(destination.docs[0].data()?.quantity || 0) + quantity });
            tx.update(ref, { status: 'completed', completedAt: new Date().toISOString(), completedBy: identity.uid });
          }
          tx.create(db.collection('audit_logs').doc(), { timestamp: new Date().toISOString(), action: action === 'create' ? 'CREATE' : 'UPDATE', resource: 'Inventory', resourceId: ref.id, branchId: fromBranchId, userId: identity.uid, userName: profile.fullName, userEmail: identity.email, userRole: profile.role, details: `Stock transfer ${action === 'create' ? 'created' : 'completed'}`, source: 'trusted_server' });
          return { id: ref.id };
        });
        res.json(result);
      } catch (error: any) { res.status(error.status || (error.message === 'Unauthorized' ? 401 : 400)).json({ error: error.message === 'Unauthorized' ? 'Unauthorized' : error.message }); }
    });
  }
}
