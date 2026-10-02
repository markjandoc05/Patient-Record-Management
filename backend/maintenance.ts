import type express from 'express';
import { db } from './database';
import { sessionIdentity } from './auth';
import { isSupportDeveloper } from '../src/rbac';
import { assertDevelopmentRole } from './developmentAccess';
export function mountMaintenanceGate(app: express.Express) {
  app.use('/api', async (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.path.startsWith('/auth/') || req.path === '/data/query') return next();
    try {
      const branding = (await db.collection('settings').doc('branding').get()).data();
      if (!branding?.maintenanceMode) return next();
      const identity = await sessionIdentity(req);
      const profile = (await db.collection('users').doc(identity.uid).get()).data();
      assertDevelopmentRole(profile?.role);
      if (profile?.active && isSupportDeveloper(profile.role)) return next();
      res.status(503).json({ error: 'The system is under maintenance. Changes are temporarily paused.' });
    } catch { res.status(503).json({ error: 'The service is temporarily unavailable' }); }
  });
}
