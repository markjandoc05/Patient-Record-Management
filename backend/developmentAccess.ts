import { SUPPORT_DEVELOPER } from '../src/rbac';

export function developmentAccessEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    const database = new URL(env.DATABASE_URL || '');
    const app = new URL(env.APP_URL || 'http://localhost:3000');
    return env.NODE_ENV !== 'production'
      && database.hostname === '127.0.0.1' && database.pathname === '/vine_development'
      && database.username === 'vine_dev'
      && ['localhost', '127.0.0.1'].includes(app.hostname) && app.protocol === 'http:';
  } catch { return false; }
}

export function assertDevelopmentRole(role: unknown) {
  if (role === SUPPORT_DEVELOPER && !developmentAccessEnabled()) {
    throw Object.assign(new Error('Support / Developer is enabled only in isolated local development'), { status: 403 });
  }
}
