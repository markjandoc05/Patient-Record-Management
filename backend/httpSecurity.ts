import type express from 'express';

export function mountHttpSecurity(app: express.Express) {
  app.disable('x-powered-by');
  // Dokploy terminates TLS through one reverse-proxy hop. Do not trust every
  // forwarded address, since client-supplied headers must not bypass limits.
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));
  const windows = new Map<string, { count: number; expires: number }>();
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' https: data: blob:; connect-src 'self'; worker-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
    }
    const authStart = req.path === '/api/auth/google';
    const upload = req.path.endsWith('/upload');
    if (!authStart && !upload) return next();
    const now = Date.now();
    const key = `${authStart ? 'auth' : 'upload'}:${req.ip || req.socket.remoteAddress}`;
    const maximum = authStart ? 20 : 30;
    const duration = authStart ? 15 * 60_000 : 60_000;
    let entry = windows.get(key);
    if (!entry || entry.expires <= now) {
      if (windows.size >= 10000) {
        for (const [key, value] of windows) if (value.expires <= now) windows.delete(key);
        if (windows.size >= 10000) return res.status(503).json({ error: 'Please try again shortly' });
      }
      entry = { count: 0, expires: now + duration }; windows.set(key, entry);
    }
    if (++entry.count > maximum) {
      res.setHeader('Retry-After', String(Math.ceil((entry.expires - now) / 1000)));
      return res.status(429).json({ error: 'Too many requests; please try again later' });
    }
    next();
  });
}
