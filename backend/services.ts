import type express from 'express';
import { randomUUID } from 'node:crypto';
import { db, type RecordTransaction } from './database';
import { sessionIdentity } from './auth';
import { assertDevelopmentRole } from './developmentAccess';
import { canManageServices, canViewServices, ServiceError, serviceName, parseServicePrice, effectiveServicePrice } from '../src/servicesPolicy';

const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
function canonicalUuid(value: unknown): string {
  if (!uuid(value)) fail(400, 'INVALID_ID', 'Invalid UUID.');
  // The validated 8-4-4-4-12 representation has the same identity as PostgreSQL uuid.
  return value.toLowerCase();
}
function fail(status: number, code: string, message: string): never { throw new ServiceError(status, code, message); }
function object(v: unknown): Record<string, any> { if (!v || typeof v !== 'object' || Array.isArray(v)) fail(400, 'INVALID_BODY', 'Invalid request body.'); return v as Record<string, any>; }
function keys(p: Record<string, any>, allowed: string[]) { if (Object.keys(p).some(k => !allowed.includes(k))) fail(400, 'UNKNOWN_FIELD', 'Unknown or server-owned field.'); }
function bool(v: unknown) { if (typeof v !== 'boolean') fail(400, 'INVALID_BOOLEAN', 'Expected true or false.'); return v; }
function version(v: unknown) { if (!Number.isInteger(v) || Number(v) < 1) fail(400, 'VERSION_REQUIRED', 'A valid expectedVersion is required.'); return v; }
function serviceFields(p: Record<string, any>, old?: any) {
  const name = 'name' in p ? serviceName(p.name) : old?.name;
  const duration = 'defaultDurationMinutes' in p ? p.defaultDurationMinutes : old?.default_duration_minutes;
  if (!name) fail(400, 'INVALID_NAME', 'Enter a service name.');
  if (!Number.isInteger(duration) || duration < 1 || duration > 1440) fail(400, 'INVALID_DURATION', 'Duration must be 1–1440 whole minutes.');
  const description = 'description' in p ? p.description : old?.description ?? '';
  if (typeof description !== 'string' || description.length > 2000) fail(400, 'INVALID_DESCRIPTION', 'Description must be at most 2,000 characters.');
  const category = 'categoryId' in p ? p.categoryId : old?.category_id ?? null;
  if (category !== null && !uuid(category)) fail(400, 'INVALID_CATEGORY', 'Invalid category.');
  return { name, category_id: category === null ? null : canonicalUuid(category), description: description.trim(), default_duration_minutes: duration,
    standard_price: 'standardPrice' in p ? parseServicePrice(p.standardPrice) : old ? old.standard_price : parseServicePrice(p.standardPrice),
    active: 'active' in p ? bool(p.active) : old?.active ?? true };
}
function branchFields(p: Record<string, any>) {
  const input = p.branchSettings ?? [];
  if (!Array.isArray(input) || input.length > 500) fail(400, 'INVALID_BRANCH_SETTINGS', 'Invalid branch settings.');
  const seen = new Set<string>();
  return input.map(raw => {
    const b = object(raw); keys(b, ['branchId', 'available', 'price']);
    if (typeof b.branchId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(b.branchId) || seen.has(b.branchId)) fail(400, 'INVALID_BRANCH', 'Invalid or duplicate branch.');
    seen.add(b.branchId);
    return { branch_id: b.branchId, available: bool(b.available), price_override: parseServicePrice(b.price, true) };
  });
}
function same(a: any, b: any) { return JSON.stringify(a) === JSON.stringify(b); }
function canonical(s: any) { return { name: serviceName(s.name).toLowerCase(), category_id: s.category_id === null ? null : canonicalUuid(s.category_id), description: s.description.trim(), default_duration_minutes: s.default_duration_minutes, standard_price: s.standard_price, active: s.active }; }
function setting(s: any) { return { branch_id: s.branch_id, available: s.available, price_override: s.price_override }; }
function sameSettings(previous: any[], next: any[]) {
  if (previous.length !== next.length) return false;
  const byBranch = new Map(previous.map(row => [row.branch_id, setting(row)]));
  return next.every(row => byBranch.has(row.branch_id) && same(byBranch.get(row.branch_id), setting(row)));
}
async function audit(tx: RecordTransaction, identity: any, profile: any, resource: string, id: string, eventType: string, changes: any[], branchId: string | null = null) {
  tx.create(db.collection('audit_logs').doc(), { action: eventType.endsWith('_created') ? 'CREATE' : 'UPDATE', resource, resourceId: id, resourceName: resource,
    eventType, details: eventType.replaceAll('_', ' '), changes, branchId, timestamp: new Date().toISOString(),
    userId: identity.uid, userName: profile.fullName || identity.email, userEmail: identity.email, userRole: profile.role, source: 'trusted_server' });
}
export function mountServices(app: express.Express) {
  const route = (method: 'get' | 'post' | 'patch', path: string, write: boolean, handler: (req: express.Request, tx: RecordTransaction, actor: any) => Promise<any>) => {
    app[method](path, async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      try {
        const identity = await sessionIdentity(req);
        const result = await db.runTransaction(async tx => {
          const profile = (await tx.get(db.collection('users').doc(identity.uid))).data();
          assertDevelopmentRole(profile?.role);
          if (profile?.active !== true || !canViewServices(profile.role)) fail(403, 'FORBIDDEN', 'Your account cannot access services.');
          if (write && !canManageServices(profile.role)) fail(403, 'FORBIDDEN', 'Service changes require administrator access.');
          const global = canManageServices(profile.role);
          const assigned = Array.isArray(profile.assignedBranches) ? profile.assignedBranches.filter((v: any) => typeof v === 'string') : [];
          const branches = (await tx.sql("SELECT id, data->>'branchName' AS name, data->>'status' AS status FROM app_records WHERE collection_path='branches' AND ($1::boolean OR id=ANY($2::text[])) ORDER BY lower(data->>'branchName'),id", [global, assigned])).rows;
          return handler(req, tx, { identity, profile, global, assigned, branches });
        });
        res.status(result.status ?? 200).json(result.body ?? result);
      } catch (e: any) {
        if (e instanceof ServiceError) return res.status(e.status).json({ error: e.message, code: e.code });
        if (e.status === 403) return res.status(403).json({ error: e.message, code: 'FORBIDDEN' });
        if (e.message === 'Unauthorized') return res.status(401).json({ error: 'Please sign in again.', code: 'UNAUTHORIZED' });
        if (e.message === 'Invalid request origin or CSRF token') return res.status(403).json({ error: 'Invalid origin or CSRF token.', code: 'CSRF' });
        if (e.code === '23505') return res.status(409).json({ error: 'That name or identifier is already in use, including inactive records.', code: 'DUPLICATE' });
        if (e.code === '23503') return res.status(409).json({ error: 'A referenced category or branch changed. Reload and review.', code: 'REFERENCE_CHANGED' });
        if (['ECONNREFUSED', 'ETIMEDOUT', '57P01', '53300', '08006', '42P01'].includes(e.code)) return res.status(503).json({ error: 'Services are temporarily unavailable. Try again.', code: 'UNAVAILABLE' });
        console.error('Services request failed', e.code || e.name);
        res.status(500).json({ error: 'Services could not be saved or loaded. Try again.', code: 'SERVER_ERROR' });
      }
    });
  };
  async function detail(tx: RecordTransaction, id: string, actor: any) {
    const s = (await tx.sql('SELECT s.*,c.name AS category_name,c.active AS category_active FROM services s LEFT JOIN service_categories c ON c.id=s.category_id WHERE s.id=$1', [id])).rows[0];
    if (!s) fail(404, 'NOT_FOUND', 'Service not found.');
    const settings = (await tx.sql('SELECT * FROM service_branch_settings WHERE service_id=$1 AND ($2::boolean OR branch_id=ANY($3::text[])) ORDER BY branch_id', [id, actor.global, actor.assigned])).rows;
    return { ...s, branchSettings: settings, branches: actor.branches.map((b: any) => {
      const bs = settings.find((r: any) => r.branch_id === b.id);
      return { ...b, configured: !!bs, available: !!bs?.available, operationallyAvailable: s.active && b.status === 'Active' && bs?.available === true,
        priceOverride: bs?.price_override ?? null, effectivePrice: effectiveServicePrice(s.standard_price, bs?.price_override ?? null) };
    }) };
  }
  route('get', '/api/services', false, async (req, tx, actor) => {
    const query = req.query;
    const int = (value: unknown, fallback: number, max: number) => {
      if (value === undefined) return fallback;
      if (typeof value !== 'string' || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max) fail(400, 'INVALID_PAGINATION', 'Invalid page or page size.');
      return Number(value);
    };
    const page = int(query.page, 1, 100000), pageSize = int(query.pageSize, 25, 100);
    const q = query.q ?? ''; if (typeof q !== 'string' || q.length > 120) fail(400, 'INVALID_SEARCH', 'Search must be at most 120 characters.');
    const status = query.status ?? 'all'; if (!['all', 'active', 'inactive'].includes(String(status))) fail(400, 'INVALID_STATUS', 'Invalid status filter.');
    const category = query.categoryId ?? null; if (category !== null && !uuid(category)) fail(400, 'INVALID_CATEGORY', 'Invalid category filter.');
    const branch = query.branchId ?? null;
    if (branch !== null && (typeof branch !== 'string' || !actor.branches.some((b: any) => b.id === branch))) fail(403, 'BRANCH_FORBIDDEN', 'Branch access denied.');
    const availableOnly = query.availableOnly ?? 'false'; if (!['true', 'false'].includes(String(availableOnly))) fail(400, 'INVALID_FILTER', 'Invalid availability filter.');
    const values = [q, category, status, branch, actor.global, actor.assigned, availableOnly === 'true'];
    const where = `strpos(lower(s.name),lower($1::text))>0 AND ($2::uuid IS NULL OR s.category_id=$2) AND ($3::text='all' OR s.active=($3='active'))
      AND (NOT $7::boolean OR (s.active AND EXISTS(SELECT 1 FROM service_branch_settings bs JOIN app_records b ON b.collection_path='branches' AND b.id=bs.branch_id WHERE bs.service_id=s.id AND bs.available AND b.data->>'status'='Active' AND ($4::text IS NULL OR bs.branch_id=$4) AND ($5::boolean OR bs.branch_id=ANY($6::text[])))))`;
    const total = Number((await tx.sql(`SELECT count(*) AS count FROM services s WHERE ${where}`, values)).rows[0].count);
    const ids = (await tx.sql(`SELECT s.id FROM services s WHERE ${where} ORDER BY lower(s.name),s.id LIMIT $8 OFFSET $9`, [...values, pageSize, (page - 1) * pageSize])).rows;
    // One bounded batch, rather than one detail query per catalogue row.
    const services = ids.length ? (await tx.sql('SELECT s.*,c.name AS category_name,c.active AS category_active FROM services s LEFT JOIN service_categories c ON c.id=s.category_id WHERE s.id=ANY($1::uuid[]) ORDER BY lower(s.name),s.id', [ids.map(r => r.id)])).rows : [];
    const settings = ids.length ? (await tx.sql('SELECT * FROM service_branch_settings WHERE service_id=ANY($1::uuid[]) AND ($2::boolean OR branch_id=ANY($3::text[])) AND ($4::text IS NULL OR branch_id=$4)', [ids.map(r => r.id), actor.global, actor.assigned, branch])).rows : [];
    const branches = actor.branches.filter((b: any) => branch === null || b.id === branch);
    return { services: services.map(s => ({ ...s, branches: branches.map((b: any) => { const bs = settings.find(r => r.service_id === s.id && r.branch_id === b.id); return { ...b, available: !!bs?.available, operationallyAvailable: s.active && b.status === 'Active' && !!bs?.available, effectivePrice: effectiveServicePrice(s.standard_price, bs?.price_override ?? null) }; }) })), total, page, pageSize, branches: actor.branches };
  });
  route('get', '/api/services/:id', false, async (req, tx, actor) => {
    if (!uuid(req.params.id)) fail(400, 'INVALID_ID', 'Invalid service identifier.');
    const branch = req.query.branchId;
    if (branch !== undefined && !actor.branches.some((b: any) => b.id === branch)) fail(403, 'BRANCH_FORBIDDEN', 'Branch access denied.');
    const result = await detail(tx, req.params.id, actor);
    if (branch !== undefined) { result.branches = result.branches.filter((b: any) => b.id === branch); result.branchSettings = result.branchSettings.filter((b: any) => b.branch_id === branch); }
    return result;
  });
  for (const create of [true, false]) route(create ? 'post' : 'patch', create ? '/api/services' : '/api/services/:id', true, async (req, tx, actor) => {
    const p = object(req.body); keys(p, create ? ['id', 'name', 'categoryId', 'description', 'defaultDurationMinutes', 'standardPrice', 'active', 'branchSettings'] : ['expectedVersion', 'name', 'categoryId', 'description', 'defaultDurationMinutes', 'standardPrice', 'active', 'branchSettings']);
    const rawId = create ? p.id : req.params.id; if (!uuid(rawId)) fail(400, 'INVALID_ID', 'Use a stable UUID for this service.');
    const id = canonicalUuid(rawId);
    const old = (await tx.sql('SELECT * FROM services WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!create && !old) fail(404, 'NOT_FOUND', 'Service not found.');
    if (!create && version(p.expectedVersion) !== old.version) fail(409, 'STALE_VERSION', 'This service changed. Reload and review the latest configuration.');
    const next = serviceFields(p, create ? undefined : old), branches = branchFields(p);
    const previous = old ? (await tx.sql('SELECT * FROM service_branch_settings WHERE service_id=$1 ORDER BY branch_id', [id])).rows : [];
    if (create && old) {
      if (old.created_by !== actor.identity.uid || !same(canonical(old), canonical(next)) || !sameSettings(previous, branches)) fail(409, 'CREATE_CONFLICT', 'This create identifier already has different content. Reload the catalogue.');
      return { body: await detail(tx, id, actor), status: 200 };
    }
    if (next.category_id !== null) {
      const c = (await tx.sql('SELECT * FROM service_categories WHERE id=$1', [next.category_id])).rows[0];
      if (!c || (!c.active && next.category_id !== old?.category_id)) fail(400, 'INVALID_CATEGORY', 'Choose an active category, or retain the recorded category.');
    }
    for (const b of branches) {
      const branch = actor.branches.find((r: any) => r.id === b.branch_id);
      if (!branch) fail(400, 'INVALID_BRANCH', 'Branch not found.');
      const previousSetting = previous.find(r => r.branch_id === b.branch_id);
      if (branch.status !== 'Active' && b.available && previousSetting?.available !== true) fail(400, 'INACTIVE_BRANCH', 'An inactive branch cannot be newly enabled.');
    }
    const canonicalChanges = Object.keys(next).filter(k => !old || !same(old[k], next[k])).map(field => ({ field, before: old?.[field] ?? null, after: next[field] }));
    const branchChanges = branches.filter(b => !same(setting(previous.find(r => r.branch_id === b.branch_id) || { branch_id: b.branch_id, available: undefined, price_override: undefined }), b));
    if (!create && canonicalChanges.length === 0 && branchChanges.length === 0) return detail(tx, id, actor);
    if (create) await tx.sql('INSERT INTO services(id,name,category_id,description,default_duration_minutes,standard_price,active,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)', [id, next.name, next.category_id, next.description, next.default_duration_minutes, next.standard_price, next.active, actor.identity.uid]);
    else await tx.sql('UPDATE services SET name=$2,category_id=$3,description=$4,default_duration_minutes=$5,standard_price=$6,active=$7,version=version+1,updated_at=now(),updated_by=$8 WHERE id=$1', [id, next.name, next.category_id, next.description, next.default_duration_minutes, next.standard_price, next.active, actor.identity.uid]);
    for (const b of branchChanges) {
      await tx.sql('INSERT INTO service_branch_settings(id,service_id,branch_id,available,price_override,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$6) ON CONFLICT(service_id,branch_id) DO UPDATE SET available=EXCLUDED.available,price_override=EXCLUDED.price_override,updated_at=now(),updated_by=EXCLUDED.updated_by', [randomUUID(), id, b.branch_id, b.available, b.price_override, actor.identity.uid]);
      const before = previous.find(r => r.branch_id === b.branch_id);
      for (const [field, event] of [['available', 'service_branch_availability_changed'], ['price_override', 'service_branch_price_changed']]) if (!same(before?.[field] ?? null, b[field])) await audit(tx, actor.identity, actor.profile, 'Service', id, event, [{ field, before: before?.[field] ?? null, after: b[field] }], b.branch_id);
    }
    if (create) await audit(tx, actor.identity, actor.profile, 'Service', id, 'service_created', canonicalChanges);
    else {
      if (canonicalChanges.some(c => !['active', 'standard_price'].includes(c.field))) await audit(tx, actor.identity, actor.profile, 'Service', id, 'service_edited', canonicalChanges.filter(c => !['active', 'standard_price'].includes(c.field)));
      if (old.active !== next.active) await audit(tx, actor.identity, actor.profile, 'Service', id, next.active ? 'service_activated' : 'service_deactivated', canonicalChanges.filter(c => c.field === 'active'));
      if (old.standard_price !== next.standard_price) await audit(tx, actor.identity, actor.profile, 'Service', id, 'service_standard_price_changed', canonicalChanges.filter(c => c.field === 'standard_price'));
    }
    return { status: create ? 201 : 200, body: await detail(tx, id, actor) };
  });
  route('get', '/api/service-categories', false, async (_req, tx) => ({ categories: (await tx.sql('SELECT * FROM service_categories ORDER BY lower(name),id', [])).rows }));
  for (const create of [true, false]) route(create ? 'post' : 'patch', create ? '/api/service-categories' : '/api/service-categories/:id', true, async (req, tx, actor) => {
    const p = object(req.body); keys(p, create ? ['id', 'name', 'active'] : ['expectedVersion', 'name', 'active']);
    const rawId = create ? p.id : req.params.id; if (!uuid(rawId)) fail(400, 'INVALID_ID', 'Use a stable UUID for this category.');
    const id = canonicalUuid(rawId);
    const old = (await tx.sql('SELECT * FROM service_categories WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!create && !old) fail(404, 'NOT_FOUND', 'Category not found.');
    if (!create && version(p.expectedVersion) !== old.version) fail(409, 'STALE_VERSION', 'This category changed. Reload and review.');
    const name = 'name' in p ? serviceName(p.name, 80) : old?.name;
    if (!name) fail(400, 'INVALID_NAME', 'Enter a category name.');
    const active = 'active' in p ? bool(p.active) : old?.active ?? true;
    if (create && old) { if (old.created_by === actor.identity.uid && serviceName(old.name, 80).toLowerCase() === name.toLowerCase() && old.active === active) return old; fail(409, 'CREATE_CONFLICT', 'This category identifier already has different content.'); }
    if (!create && name === old.name && active === old.active) return old;
    const row = create ? (await tx.sql('INSERT INTO service_categories(id,name,active,created_by,updated_by) VALUES($1,$2,$3,$4,$4) RETURNING *', [id, name, active, actor.identity.uid])).rows[0]
      : (await tx.sql('UPDATE service_categories SET name=$2,active=$3,version=version+1,updated_at=now(),updated_by=$4 WHERE id=$1 RETURNING *', [id, name, active, actor.identity.uid])).rows[0];
    if (create) await audit(tx, actor.identity, actor.profile, 'Service Category', id, 'service_category_created', [{ field: 'name', before: null, after: name }, { field: 'active', before: null, after: active }]);
    else {
      if (name !== old.name) await audit(tx, actor.identity, actor.profile, 'Service Category', id, 'service_category_renamed', [{ field: 'name', before: old.name, after: name }]);
      if (active !== old.active) await audit(tx, actor.identity, actor.profile, 'Service Category', id, active ? 'service_category_reactivated' : 'service_category_deactivated', [{ field: 'active', before: old.active, after: active }]);
    }
    return { status: create ? 201 : 200, body: row };
  });
}
