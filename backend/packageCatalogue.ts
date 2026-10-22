import type express from 'express';
import { createHash } from 'node:crypto';
import { db, type RecordTransaction } from './database';
import { currentActor, assertCapability } from './permissions';
import { hasBranchScope } from '../src/permissions';
import { ledgerFail, ledgerUuid, ledgerRecordId, TreatmentLedgerError } from '../src/treatmentLedgerPolicy';
import { parsePackageDefinition, type CataloguePackage, type CatalogueSelection } from '../src/packageCataloguePolicy';
import { appointmentServiceSnapshot } from './appointmentServices';

type Actor = Awaited<ReturnType<typeof currentActor>>;
export function assertPackageRead(actor: Actor) {
  assertCapability(actor.profile, 'packages.view');
  assertCapability(actor.profile, 'services.view');
}
async function assertPackageBranch(tx: RecordTransaction, actor: Actor, value: unknown) {
  const branchId = ledgerRecordId(value);
  if (!hasBranchScope(actor.profile, branchId)) ledgerFail(403, 'BRANCH_FORBIDDEN', 'Package access denied for this clinic.');
  const row = (await tx.get(db.collection('branches').doc(branchId))).data();
  if (!row) ledgerFail(404, 'NOT_FOUND', 'Clinic not found.');
  return branchId;
}
async function readPackage(tx: RecordTransaction, id: string, branchId: string | null, version?: number): Promise<CataloguePackage> {
  const p = (await tx.sql(`SELECT v.*,p.version AS current_version,p.active AS current_active FROM package_catalogue p
    JOIN package_catalogue_versions v ON v.package_id=p.id AND v.version=COALESCE($2::integer,p.version) WHERE p.id=$1`, [id, version ?? null])).rows[0];
  if (!p) ledgerFail(404, 'NOT_FOUND', 'Package not found.');
  const lines = (await tx.sql(`SELECT l.*,s.name AS current_name,s.version AS current_version,s.active,
    bs.available,COALESCE(bs.price_override,s.standard_price) IS NOT NULL AS priced,
    b.data->>'status' AS branch_status FROM package_catalogue_lines l JOIN services s ON s.id=l.service_id
    LEFT JOIN service_branch_settings bs ON bs.service_id=s.id AND bs.branch_id=$3
    LEFT JOIN app_records b ON b.collection_path='branches' AND b.id=$3
    WHERE l.package_id=$1 AND l.version=$2 ORDER BY l.service_id`, [id, p.version, branchId])).rows;
  return { id, name: p.name, description: p.description, active: p.active, version: p.version,
    actor: p.actor, recordedAt: new Date(p.recorded_at).toISOString(),
    lines: lines.map(l => ({ serviceId: l.service_id, serviceName: l.service_name_snapshot, serviceCatalogueVersion: l.service_catalogue_version,
      sessions: l.sessions, currentServiceVersion: l.current_version, currentServiceName: l.current_name, serviceActive: l.active })),
    eligible: branchId === null ? null : p.current_active && p.active && p.version === p.current_version && lines.length > 0
      && lines.every(l => l.active && l.available === true && l.priced && l.branch_status === 'Active') };
}
export async function resolveCataloguePurchase(tx: RecordTransaction, actor: Actor, branchId: string, selection: CatalogueSelection) {
  assertPackageRead(actor); await assertPackageBranch(tx, actor, branchId);
  const p = await readPackage(tx, selection.packageId, branchId);
  if (p.version !== selection.expectedVersion) ledgerFail(409, 'PACKAGE_VERSION_CHANGED', 'This package changed. Reload the package and review its contents before saving.');
  if (!p.active || !p.eligible) ledgerFail(409, 'PACKAGE_UNAVAILABLE', 'This package or an included Service is unavailable at the purchase clinic. Choose another package or use a manual purchase.');
  if (p.lines.length !== selection.serviceVersions.length || p.lines.some(l => !selection.serviceVersions.some(s => s.serviceId === l.serviceId))) {
    ledgerFail(400, 'PACKAGE_CONTENT_CHANGED', 'Review every included Service. Package session allowances cannot be overridden.');
  }
  const lines = [];
  for (const l of p.lines) {
    const selected = selection.serviceVersions.find(s => s.serviceId === l.serviceId)!;
    const snapshot = await appointmentServiceSnapshot(tx, { serviceId: l.serviceId, expectedVersion: selected.expectedServiceVersion }, branchId);
    lines.push({ serviceId: l.serviceId, expectedServiceVersion: snapshot.serviceCatalogueVersion, purchasedSessions: l.sessions });
  }
  return { packageName: p.name, lines, catalogue: { packageId: p.id, version: p.version } };
}

export function mountPackageCatalogue(app: express.Express) {
  const route = (method: 'get' | 'post' | 'patch', path: string, write: boolean, handler: (req: express.Request, tx: RecordTransaction, actor: Actor) => Promise<any>) => {
    app[method](path, async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      try {
        const out = await db.runTransaction(async tx => {
          const actor = await currentActor(req, tx); assertPackageRead(actor);
          if (write) assertCapability(actor.profile, 'packages.manage');
          return handler(req, tx, actor);
        });
        res.status(out.status ?? 200).json(out.body ?? out);
      } catch (error: any) {
        if (error instanceof TreatmentLedgerError || typeof error.status === 'number') return res.status(error.status).json({ error: error.message, code: error.code || 'FORBIDDEN' });
        if (error.message === 'Unauthorized') return res.status(401).json({ error: 'Please sign in again.', code: 'UNAUTHORIZED' });
        if (error.message === 'Invalid request origin or CSRF token') return res.status(403).json({ error: 'Invalid origin or CSRF token.', code: 'CSRF' });
        if (['23505', '23503', '23514'].includes(error.code)) return res.status(409).json({ error: 'The package name, version or referenced Service changed. Reload and review.', code: 'PACKAGE_CONFLICT' });
        if (['ECONNREFUSED', 'ETIMEDOUT', '57P01', '53300', '08006', '42P01'].includes(error.code)) return res.status(503).json({ error: 'Packages are temporarily unavailable. Retry loading.', code: 'UNAVAILABLE' });
        console.error('Package catalogue request failed', error.code || error.name);
        res.status(500).json({ error: 'Packages could not be loaded or saved. Retry or reload to inspect the saved version.', code: 'SERVER_ERROR' });
      }
    });
  };
  const page = (value: unknown) => {
    if (value === undefined) return 1;
    if (typeof value !== 'string' || !/^[1-9][0-9]{0,5}$/.test(value)) ledgerFail(400, 'INVALID_PAGE', 'Choose a valid package page.');
    return Number(value);
  };
  route('get', '/api/packages', false, async (req, tx, actor) => {
    const branchId = req.query.branchId === undefined ? null : await assertPackageBranch(tx, actor, req.query.branchId);
    const selectable = req.query.selectableOnly === 'true';
    if (req.query.selectableOnly !== undefined && !['true', 'false'].includes(String(req.query.selectableOnly))) ledgerFail(400, 'INVALID_FILTER', 'Invalid package filter.');
    if (selectable && !branchId) ledgerFail(400, 'BRANCH_REQUIRED', 'Select a purchase clinic first.');
    const status = req.query.status ?? 'all'; if (typeof status !== 'string' || !['all', 'active', 'inactive'].includes(status)) ledgerFail(400, 'INVALID_FILTER', 'Invalid package status.');
    const q = req.query.q ?? ''; if (typeof q !== 'string' || q.length > 120) ledgerFail(400, 'INVALID_SEARCH', 'Search must contain at most 120 characters.');
    const number = page(req.query.page);
    const where = `($1='all' OR p.active=($1='active')) AND p.name ILIKE $2 AND (NOT $4::boolean OR (p.active AND NOT EXISTS (
      SELECT 1 FROM package_catalogue_lines l JOIN services s ON s.id=l.service_id
      LEFT JOIN service_branch_settings bs ON bs.service_id=s.id AND bs.branch_id=$3
      LEFT JOIN app_records b ON b.collection_path='branches' AND b.id=$3
      WHERE l.package_id=p.id AND l.version=p.version AND (NOT s.active OR bs.available IS DISTINCT FROM true OR
        COALESCE(bs.price_override,s.standard_price) IS NULL OR b.data->>'status' IS DISTINCT FROM 'Active'))))`;
    const values = [status, '%' + q.trim() + '%', branchId, selectable];
    const total = Number((await tx.sql('SELECT count(*) FROM package_catalogue p WHERE ' + where, values)).rows[0].count);
    const ids = (await tx.sql('SELECT p.id FROM package_catalogue p WHERE ' + where + ' ORDER BY lower(p.name),p.id LIMIT 25 OFFSET $5', [...values, (number - 1) * 25])).rows;
    const packages = []; for (const row of ids) packages.push(await readPackage(tx, row.id, branchId));
    return { packages, total, page: number };
  });
  route('get', '/api/packages/:id', false, async (req, tx, actor) => {
    const branchId = req.query.branchId === undefined ? null : await assertPackageBranch(tx, actor, req.query.branchId);
    return readPackage(tx, ledgerUuid(req.params.id), branchId);
  });
  route('get', '/api/packages/:id/versions', false, async (req, tx) => {
    const id = ledgerUuid(req.params.id), number = page(req.query.page);
    const rows = (await tx.sql('SELECT version FROM package_catalogue_versions WHERE package_id=$1 ORDER BY version DESC LIMIT 25 OFFSET $2', [id, (number - 1) * 25])).rows;
    const versions = []; for (const row of rows) versions.push(await readPackage(tx, id, null, row.version));
    return { versions, page: number, total: Number((await tx.sql('SELECT count(*) FROM package_catalogue_versions WHERE package_id=$1', [id])).rows[0].count) };
  });
  for (const create of [true, false]) route(create ? 'post' : 'patch', create ? '/api/packages' : '/api/packages/:id', true, async (req, tx, actor) => {
    const p = parsePackageDefinition(req.body, create);
    if (!create && ledgerUuid(req.params.id) !== p.id) ledgerFail(400, 'INVALID_ID', 'Package identifiers must match.');
    const requestHash = createHash('sha256').update(JSON.stringify([create ? 'create' : 'edit', p])).digest('hex');
    const prior = (await tx.sql('SELECT package_id,actor,request_hash FROM package_catalogue_versions WHERE command_id=$1', [p.commandId])).rows[0];
    if (prior) {
      if (prior.request_hash !== requestHash || prior.actor.uid !== actor.identity.uid) ledgerFail(409, 'COMMAND_CONFLICT', 'This command identifier has already been used with different content or by another actor.');
      return { ...(await readPackage(tx, p.id, null)), replayed: true };
    }
    const old = (await tx.sql('SELECT * FROM package_catalogue WHERE id=$1 FOR UPDATE', [p.id])).rows[0];
    if (create && old || !create && (!old || old.version !== p.expectedVersion)) ledgerFail(409, 'PACKAGE_VERSION_CHANGED', 'This package changed. Reload and review before saving.');
    const lines = [];
    for (const selected of p.lines) {
      const s = (await tx.sql('SELECT id,name,version FROM services WHERE id=$1', [selected.serviceId])).rows[0];
      if (!s) ledgerFail(400, 'SERVICE_NOT_FOUND', 'An included Service no longer exists.');
      if (s.version !== selected.expectedServiceVersion) ledgerFail(409, 'SERVICE_VERSION_CHANGED', 'An included Service changed. Reload and review the package before saving.');
      lines.push({ ...selected, name: s.name });
    }
    const version = create ? 1 : old.version + 1;
    if (create) await tx.sql('INSERT INTO package_catalogue(id,name,active,version) VALUES($1,$2,$3,1)', [p.id, p.name, p.active]);
    else await tx.sql('UPDATE package_catalogue SET name=$2,active=$3,version=$4 WHERE id=$1', [p.id, p.name, p.active, version]);
    const snapshot = { uid: actor.identity.uid, name: String(actor.profile.fullName || actor.identity.email).slice(0, 120), role: actor.profile.role };
    await tx.sql(`INSERT INTO package_catalogue_versions(package_id,version,name,description,active,command_id,request_hash,actor)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, [p.id, version, p.name, p.description, p.active, p.commandId, requestHash, JSON.stringify(snapshot)]);
    for (const line of lines) await tx.sql(`INSERT INTO package_catalogue_lines(package_id,version,service_id,service_name_snapshot,service_catalogue_version,sessions)
      VALUES($1,$2,$3,$4,$5,$6)`, [p.id, version, line.serviceId, line.name, line.expectedServiceVersion, line.sessions]);
    await tx.sql('UPDATE package_catalogue_versions SET sealed=true WHERE package_id=$1 AND version=$2', [p.id, version]);
    tx.create(db.collection('audit_logs').doc(), { action: create ? 'CREATE' : 'UPDATE', resource: 'Package Catalogue', resourceId: p.id,
      eventType: create ? 'package_created' : 'package_version_created', branchId: null, timestamp: new Date().toISOString(),
      userId: actor.identity.uid, userName: snapshot.name, userRole: snapshot.role, source: 'trusted_server',
      details: 'Package catalogue version recorded', changes: [{ field: 'packageVersion', before: old?.version ?? 0, after: version }] });
    return { status: create ? 201 : 200, body: await readPackage(tx, p.id, null) };
  });
}
