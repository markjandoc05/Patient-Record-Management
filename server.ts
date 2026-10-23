import { activeAccount, hasCapability, type PermissionId } from './src/permissions';
import { assertCapability, currentActor } from './backend/permissions';
import { redactClinicalData, protectClinicalWrite, clinicalWriteFields } from './backend/clinicalRedaction';
import { mountAccessApi } from './backend/accessApi';
import { applyVisitServiceSelection } from './backend/visitServices';
import { isVisitClinicallySealed } from './src/utils/visitServicePolicy';
import { assertVisitSaveVersion, nextVisitVersion, visitVersion, VisitVersionError } from './src/utils/visitVersionPolicy';
import { ASSISTING_STAFF_MAX_LENGTH, isEligibleVisitPerformer, visitDoctorIds, visitPerformerSnapshotFields } from './src/utils/visitPerformerPolicy';
import { AppointmentServiceError, parseAppointmentServiceSelection, appointmentServiceSnapshot } from './backend/appointmentServices';
import { AppointmentSpecialPriceError, parseSpecialPriceCommand, appointmentSpecialPriceUpdates, parseExpectedPricingRevision, assertSpecialPriceRevision } from './backend/appointmentSpecialPrice';
import { AppointmentBookingQuoteError, assertBookingQuoteServerOwned, appointmentBookingQuoteUpdates } from './backend/appointmentBookingQuote';
import { VisitPricingError, parseVisitSpecialPriceCommand, assertExpectedBookingContext, visitPriceQuoteUpdates } from './backend/visitPricing';
import { mountServices } from './backend/services';
import { mountPackageCatalogue } from './backend/packageCatalogue';
import { mountClinicalCharts } from './backend/clinicalCharts';
import { mountTreatmentLedger, applyVisitSessionUsage } from './backend/treatmentLedger';
import { TreatmentLedgerError } from './src/treatmentLedgerPolicy';
import { parseEmergencyContact } from './src/utils/emergencyContact';
import { parseClinicalFindings } from './src/utils/clinicalFindings';
import { assertPatientHistoryMetadata, patientHistoryAttribution, patientHistoryInput, PatientHistoryError } from './backend/patientMedicalHistory';
import { parsePatientBirth } from './src/utils/patientBirth';
import express from "express";
import { mountHttpSecurity } from "./backend/httpSecurity";
import path from "path";
import { createServer as createViteServer } from "vite";
import { db, pool, FieldValue, RecordTransaction, DocumentReference } from "./backend/database";
import { mountAuth, sessionIdentity, SessionIdentity } from "./backend/auth";
import { storageBucket } from "./backend/storage";
import { mountMaintenanceGate } from "./backend/maintenance";
import { mountInventory } from "./backend/inventory";
import { mountDataApi } from "./backend/dataApi";
import { assertAppointmentRead } from "./backend/appointmentReadAccess";
import { assertDevelopmentRole } from "./backend/developmentAccess";
import { activationIssues } from "./src/utils/userActivation";
import multer from "multer";
import { createHash, randomUUID } from "crypto";
import { readFile } from "fs/promises";

import { canEditPatient, hasPermission, RBAC, Role, SUPPORT_DEVELOPER, developerRoles, administrativeRoles, clinicalPatientRoles, isSupportDeveloper } from "./src/rbac";
import { IMAGE_OPTIMIZATION, normalizeMediaSettings } from "./src/mediaSettings";
import { GALLERY_PHOTO_LIMIT, GalleryPhotoInputError, galleryPhotoCount, isGalleryImage, parsePhotoInput, type GalleryPhotoMetadata } from './src/patientGalleryPolicy';
import { AuditAction, AuditResource, shouldRecordAuditEvent } from "./src/auditPolicy";
import { getDeveloperActivityDefinition } from "./src/developerToolsPolicy";
import { describeLoginUserAgent, shouldRecordLoginActivity } from "./src/loginActivityPolicy";

export const app = express();
mountHttpSecurity(app);
app.use(express.json({ limit: "1mb" }));
app.use((_req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex');
    next();
});
const PORT = Number(process.env.PORT) || 3000;
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024, files: 1 }
});
const uploadSingleFile: express.RequestHandler = async (req, res, next) => {
    const authorization = await authorizeRequest(req, res, req.path === "/api/branding/upload" ? administrativeRoles : applicationRoles);
    if (!authorization) return;
    upload.single('file')(req, res, error => {
        if (error instanceof multer.MulterError) {
            const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
            res.status(status).json({
                error: error.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : error.message
            });
            return;
        }
        if (error) return next(error);
        next();
    });
};
mountAuth(app);
mountMaintenanceGate(app);
mountDataApi(app);
mountAccessApi(app);
mountInventory(app);
mountServices(app);
mountPackageCatalogue(app);
mountClinicalCharts(app);
mountTreatmentLedger(app);
app.get("/api/health", async (_req, res) => {
  try { await pool.query("SELECT 1"); res.json({ status: "ok", database: "postgresql" }); }
  catch { res.status(503).json({ status: "unavailable" }); }
});
app.get("/api/branding/content", async (req, res) => {
  try {
    const name = String(req.query.path || "");
    if (!/^branding\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(name)) return res.sendStatus(400);
    const file = storageBucket.file(name); const [metadata] = await file.getMetadata();
    res.setHeader("Content-Type", metadata.contentType); res.setHeader("X-Content-Type-Options", "nosniff");
    file.createReadStream().on("error", () => res.destroy()).pipe(res);
  } catch { res.sendStatus(404); }
});
const applicationRoles = Object.keys(RBAC) as Role[];
const globalBranchRoles = new Set<string>(administrativeRoles);
const developerRequestWindowMs = 60_000;
const developerRequestLimit = 30;
const developerRequestWindows = new Map<string, { startedAt: number; count: number }>();
const loginActivityLocationCache = new Map<string, { location: string; expiresAt: number }>();
const loginActivityLocationCacheTtlMs = 24 * 60 * 60 * 1000;
const recentLoginActivityWrites = new Map<string, number>();

function getAssignedBranchIds(userProfile: Record<string, unknown>) {
    if (!Array.isArray(userProfile.assignedBranches)) return [];
    return [...new Set(userProfile.assignedBranches.filter(
        (branchId): branchId is string => typeof branchId === 'string' && branchId.length > 0
    ))];
}

function getClientIpAddress(req: express.Request) {
    const rawIp = req.ip || req.socket.remoteAddress || '';
    return rawIp.replace(/^::ffff:/, '').slice(0, 64) || 'Unavailable';
}

function isPublicIpAddress(ipAddress: string) {
    if (!ipAddress || ipAddress === 'Unavailable' || ipAddress === '::1') return false;
    if (/^(10\.|127\.|192\.168\.|169\.254\.|0\.)/.test(ipAddress)) return false;
    const private172 = /^172\.(\d{1,3})\./.exec(ipAddress);
    return !private172 || Number(private172[1]) < 16 || Number(private172[1]) > 31;
}

async function getApproximateIpLocation(ipAddress: string) {
    if (!isPublicIpAddress(ipAddress)) return 'Unavailable';
    const cached = loginActivityLocationCache.get(ipAddress);
    if (cached && cached.expiresAt > Date.now()) return cached.location;

    try {
        const response = await fetch(`https://ipwho.is/${encodeURIComponent(ipAddress)}?fields=success,country,region,city`, {
            signal: AbortSignal.timeout(1500),
            headers: { Accept: 'application/json' }
        });
        const data = await response.json() as { success?: boolean; city?: unknown; region?: unknown; country?: unknown };
        const parts = [data.city, data.region, data.country]
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
            .map(value => value.trim().slice(0, 100));
        const location = data.success === true && parts.length > 0 ? parts.join(', ') : 'Unavailable';
        if (loginActivityLocationCache.size >= 500) loginActivityLocationCache.delete(loginActivityLocationCache.keys().next().value!);
        loginActivityLocationCache.set(ipAddress, { location, expiresAt: Date.now() + loginActivityLocationCacheTtlMs });
        return location;
    } catch (error) {
        console.warn('IP location lookup unavailable', error instanceof Error ? error.message : error);
        return 'Unavailable';
    }
}

type ResourceType = 'patient' | 'appointment' | 'visit';
type RecordKind = 'patients' | 'appointments' | 'visits';
const resourceCollections: Record<ResourceType, string> = {
    patient: 'patients',
    appointment: 'appointments',
    visit: 'visits'
};

const archiveRecordConfig: Record<RecordKind, {
    resource: 'Patient' | 'Appointment' | 'Visit';
    branchField: 'homeBranchId' | 'branchId';
}> = {
    patients: { resource: 'Patient', branchField: 'homeBranchId' },
    appointments: { resource: 'Appointment', branchField: 'branchId' },
    visits: { resource: 'Visit', branchField: 'branchId' }
};

const attachmentWriteRoles: Record<ResourceType, readonly string[]> = {
    patient: clinicalPatientRoles,
    appointment: applicationRoles,
    visit: clinicalPatientRoles
};
const auditActions = new Set<AuditAction>(['CREATE', 'UPDATE', 'DELETE', 'VIEW', 'AUTH']);
const auditResources = new Set<AuditResource>(['Patient', 'Appointment', 'Visit', 'User', 'Settings', 'Branch']);
const rolesWithPermission = (module: 'patientRecord' | 'appointment' | 'visitHistory', permission: 'create' | 'read' | 'update' | 'delete') =>
    applicationRoles.filter(role => hasPermission(role, module, permission));
const auditActionRoles: Record<'Patient' | 'Appointment' | 'Visit', Record<Exclude<AuditAction, 'AUTH'>, readonly string[]>> = {
    Patient: {
        CREATE: rolesWithPermission('patientRecord', 'create'),
        UPDATE: applicationRoles.filter(canEditPatient),
        DELETE: rolesWithPermission('patientRecord', 'delete'),
        VIEW: rolesWithPermission('patientRecord', 'read')
    },
    Appointment: {
        CREATE: rolesWithPermission('appointment', 'create'),
        UPDATE: rolesWithPermission('appointment', 'update'),
        DELETE: rolesWithPermission('appointment', 'delete'),
        VIEW: rolesWithPermission('appointment', 'read')
    },
    Visit: {
        CREATE: rolesWithPermission('visitHistory', 'create'),
        UPDATE: rolesWithPermission('visitHistory', 'update'),
        DELETE: rolesWithPermission('visitHistory', 'delete'),
        VIEW: rolesWithPermission('visitHistory', 'read')
    }
};

const allowedAttachmentTypes: Record<string, { extensions: string[], signature: (buffer: Buffer) => boolean }> = {
    'image/jpeg': {
        extensions: ['.jpg', '.jpeg'],
        signature: buffer => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
    },
    'image/png': {
        extensions: ['.png'],
        signature: buffer => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    },
    'image/webp': {
        extensions: ['.webp'],
        signature: buffer => buffer.length >= 12
            && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
            && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    },
    'image/x-icon': {
        extensions: ['.ico'],
        signature: buffer => buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x00, 0x00, 0x01, 0x00]))
    },
    'application/pdf': {
        extensions: ['.pdf'],
        signature: buffer => buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-'
    }
};

function isValidDocumentId(value: unknown): value is string {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function getFileExtension(fileName: string) {
    const extensionIndex = fileName.lastIndexOf('.');
    return extensionIndex >= 0 ? fileName.slice(extensionIndex).toLowerCase() : '';
}

function sanitizeFileName(fileName: string) {
    const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 150);
    return sanitized || 'attachment';
}

function canAccessBranch(userProfile: Record<string, any>, branchId: unknown) {
    return typeof userProfile.role === 'string'
        && typeof branchId === 'string'
        && (
            globalBranchRoles.has(userProfile.role)
            || getAssignedBranchIds(userProfile).includes(branchId)
        );
}

function canWriteAttachments(userProfile: Record<string, any>, resourceType: ResourceType) {
    return hasCapability(userProfile, 'clinical.view')
        && hasCapability(userProfile, `${resourceCollections[resourceType]}.view` as PermissionId)
        && hasCapability(userProfile, `${resourceCollections[resourceType]}.attachments.manage` as PermissionId);
}

async function authorizeAttachmentResource(
    userProfile: Record<string, any>,
    patientId: string,
    resourceType: ResourceType,
    resourceId: string,
    requireWrite: boolean
) {
    if (!hasCapability(userProfile, 'clinical.view') || !hasCapability(userProfile, `${resourceCollections[resourceType]}.view` as PermissionId)) return null;
    if (requireWrite && !canWriteAttachments(userProfile, resourceType)) return null;

    const patientRef = db.collection('patients').doc(patientId);
    const resourceRef = db.collection(resourceCollections[resourceType]).doc(resourceId);
    const [patientSnapshot, resourceSnapshot] = resourceType === 'patient'
        ? await Promise.all([patientRef.get(), patientRef.get()])
        : await Promise.all([patientRef.get(), resourceRef.get()]);

    if (!patientSnapshot.exists || !resourceSnapshot.exists) return null;
    const patientData = patientSnapshot.data() || {};
    const resourceData = resourceSnapshot.data() || {};
    if (requireWrite && (patientData.isArchived === true || resourceData.isArchived === true)) return null;
    if (resourceType === 'patient' && resourceId !== patientId) return null;
    if (resourceType !== 'patient' && resourceData.patientId !== patientId) return null;

    const resourceBranchId = resourceType === 'patient' ? patientData.homeBranchId : resourceData.branchId;
    if (!requireWrite && resourceType === 'appointment') {
        try { assertAppointmentRead(userProfile, resourceData); }
        catch { return null; }
    }
    // Patient identity and longitudinal history are shared across clinics.
    // Writes to an appointment or visit remain scoped to its operating branch.
    if (requireWrite && resourceType !== 'patient' && !canAccessBranch(userProfile, resourceBranchId)) return null;

    return { patientRef, resourceRef, patientData, resourceData, branchId: resourceBranchId };
}

async function refreshAttachmentWriteContext(
    transaction: RecordTransaction,
    authorization: { decodedToken: SessionIdentity, userProfile: Record<string, any> },
    patientId: string,
    resourceType: ResourceType,
    resourceId: string
) {
    await refreshSupportAuthorization(transaction, authorization);
    if (!canWriteAttachments(authorization.userProfile, resourceType)) throw new RequestError(403, 'Attachment access changed');
    const patientRef = db.collection('patients').doc(patientId);
    const resourceRef = db.collection(resourceCollections[resourceType]).doc(resourceId);
    const patientSnapshot = await transaction.get(patientRef);
    const resourceSnapshot = resourceType === 'patient' ? patientSnapshot : await transaction.get(resourceRef);
    if (!patientSnapshot.exists || !resourceSnapshot.exists) throw new RequestError(404, 'Attachment resource no longer exists');
    const patientData = patientSnapshot.data() || {};
    const resourceData = resourceSnapshot.data() || {};
    const branchId = resourceType === 'patient' ? patientData.homeBranchId : resourceData.branchId;
    if (patientData.isArchived === true || resourceData.isArchived === true
        || (resourceType === 'patient' && resourceId !== patientId)
        || (resourceType !== 'patient' && (resourceData.patientId !== patientId || !canAccessBranch(authorization.userProfile, branchId)))) {
        throw new RequestError(403, 'Attachment access changed');
    }
    return { patientData, resourceData, branchId, resourceRef };
}

function validGalleryTimezone(value: unknown): value is string {
    if (typeof value !== 'string' || value.length > 100) return false;
    try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true; }
    catch { return false; }
}

async function galleryTimezone(transaction: RecordTransaction, visit: Record<string, any>) {
    if (validGalleryTimezone(visit.timezoneSnapshot)) return visit.timezoneSnapshot;
    const branch = (await transaction.get(db.collection('branches').doc(visit.branchId))).data() || {};
    if (validGalleryTimezone(branch.timezone)) return branch.timezone;
    const settings = (await transaction.get(db.collection('settings').doc('timezone'))).data() || {};
    return validGalleryTimezone(settings.timezone) ? settings.timezone : 'Asia/Manila';
}

function parseAttachmentPath(storagePath: unknown) {
    if (typeof storagePath !== 'string') return null;
    const match = storagePath.match(/^uploads\/([A-Za-z0-9_-]{1,128})\/(general|appointments|visits)\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9._-]{1,220})$/);
    if (!match) return null;
    const [, patientId, folder, resourceId] = match;
    const resourceType: ResourceType = folder === 'general' ? 'patient' : folder === 'appointments' ? 'appointment' : 'visit';
    return { patientId, resourceType, resourceId };
}

async function getMediaSettings() {
    const snapshot = await db.collection('settings').doc('media').get();
    const settings = normalizeMediaSettings(snapshot.data());
    return {
        configuredExtensions: settings.allowedExtensions,
        maxBytes: Math.floor(settings.maxFileSizeMB * 1024 * 1024),
        maxFiles: settings.maxFilesPerRecord
    };
}

function publicStorageUrl(storagePath: string) {
    return `/api/branding/content?path=${encodeURIComponent(storagePath)}`;
}

class RequestError extends Error {
    constructor(public status: number, message: string) {
        super(message);
    }
}

const patientTextLimits: Record<string, number> = {
    name: 120,
    contactNumber: 40,
    email: 160,
    gender: 20,
    address: 300,
    emergencyContact: 160,
    mainConcern: 2000,
    skinType: 30,
    allergies: 1000,
    medications: 2000,
    medicalConditions: 2000,
    notes: 3000,
    status: 30
};
const appointmentTextLimits: Record<string, number> = {
    visitType: 80,
    mainConcern: 2000,
    notes: 3000,
    status: 30
};
const visitTextLimits: Record<string, number> = {
    visitType: 80,
    treatmentService: 120,
    mainConcern: 2000,
    notes: 5000,
    diagnosis: 3000,
    treatmentPlan: 5000,
    visitOutcome: 100,
    visitSource: 30,
    nextVisitDate: 40,
    followUpInstructions: 2000
};
const appointmentStatuses = new Set(['Scheduled', 'Confirmed', 'Arrived', 'Completed', 'Cancelled', 'No Show']);
const patientStatuses = new Set(['Active', 'Ongoing Treatment', 'Completed', 'Inactive']);
const visitTypes = new Set(['Initial Consultation', 'Follow-up', 'Treatment Session', 'Assessment']);
const demographicPatientFields = new Set([
    'name', 'contactNumber', 'email', 'birthday', 'gender', 'address', 'emergencyContact',
    'emergencyContactName', 'emergencyContactRelationship', 'emergencyContactNumber',
    'birthDateStatus', 'estimatedAge', 'estimatedAgeAsOf', 'estimatedBirthYear', 'expectedLastUpdatedAt'
]);
const operationalPatientFields = new Set([
    ...demographicPatientFields, 'homeBranchId', 'status'
]);

function cleanRecordText(payload: Record<string, unknown>, limits: Record<string, number>): Record<string, string> {
    return Object.fromEntries(Object.entries(limits).map(([field, maxLength]) => {
        const value = payload[field];
        if (value === undefined || value === null) return [field, ''];
        if (typeof value !== 'string') throw new RequestError(400, `${field} must be text`);
        const cleaned = value.replace(/\u0000/g, '').trim();
        if (cleaned.length > maxLength) throw new RequestError(400, `${field} is too long`);
        return [field, cleaned];
    }));
}

function requireRecordFields(data: Record<string, any>, fields: string[]) {
    const missing = fields.find(field => typeof data[field] !== 'string' || data[field].length === 0);
    if (missing) throw new RequestError(400, `${missing} is required`);
}

function isValidLocalDateTime(value: unknown): value is string {
    return typeof value === 'string'
        && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(value)
        && !Number.isNaN(new Date(value).getTime());
}

function normalizeLocalDateTime(value: string) {
    return value.slice(0, 16);
}

function isValidDate(value: unknown): value is string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function calculateAge(birthday: string) {
    const birthDate = new Date(`${birthday}T00:00:00`);
    if (Number.isNaN(birthDate.getTime())) throw new RequestError(400, 'Invalid birthday');
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDifference = today.getMonth() - birthDate.getMonth();
    if (monthDifference < 0 || (monthDifference === 0 && today.getDate() < birthDate.getDate())) age -= 1;
    if (age < 0 || age > 130) throw new RequestError(400, 'Invalid birthday');
    return age;
}

function patientIdentityKey(patient: Record<string, any>) {
    const normalizedName = String(patient.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const normalizedContact = String(patient.contactNumber || '').replace(/\D/g, '')
        || String(patient.contactNumber || '').trim().toLowerCase();
    const normalizedEmail = String(patient.email || '').trim().toLowerCase();
    const birthday = patient.birthday ? String(patient.birthday) : JSON.stringify([patient.birthDateStatus || 'unknown', patient.estimatedAge ?? null, patient.estimatedAgeAsOf || '', patient.estimatedBirthYear ?? null]);
    return createHash('sha256')
        .update([normalizedName, normalizedContact, normalizedEmail, birthday].join('\u001f'))
        .digest('hex');
}

function getChangedFieldNames(before: Record<string, any>, updates: Record<string, any>) {
    return Object.keys(updates).filter(field => JSON.stringify(before[field]) !== JSON.stringify(updates[field]));
}

function trustedUserName(authorization: { decodedToken: SessionIdentity, userProfile: Record<string, any> }) {
    return typeof authorization.userProfile.fullName === 'string'
        ? authorization.userProfile.fullName.slice(0, 120)
        : authorization.decodedToken.email || 'Unknown User';
}

function capabilityForRoles(allowedRoles: readonly string[]): PermissionId | undefined {
    for (const [resource, prefix] of [['Patient', 'patients'], ['Appointment', 'appointments'], ['Visit', 'visits']] as const) {
        for (const [action, verb] of [['CREATE', 'create'], ['UPDATE', 'edit'], ['DELETE', 'archive'], ['VIEW', 'view']] as const) {
            if (auditActionRoles[resource][action] === allowedRoles) return `${prefix}.${verb}` as PermissionId;
        }
    }
}
function requireRole(userProfile: Record<string, any>, allowedRoles: readonly string[]) {
    const permission = capabilityForRoles(allowedRoles);
    if (permission) { assertCapability(userProfile, permission); return; }
    if (!activeAccount(userProfile) || !allowedRoles.includes(userProfile.role)) throw new RequestError(403, 'Insufficient permissions');
}
function requestPermission(req: express.Request): PermissionId | undefined {
    if (req.path === '/api/patients') return 'patients.view';
    const record = /^\/api\/records\/(patients|appointments|visits)(?:\/[^/]+)?(\/restore)?$/.exec(req.path);
    if (record) return `${record[1]}.${req.method === 'DELETE' || record[2] ? 'archive' : req.method === 'POST' ? 'create' : 'edit'}` as PermissionId;
    if (req.path.startsWith('/api/developer/')) return 'developer.access';
    if (req.path.startsWith('/api/users/')) return 'access.manage';
    if (req.path === '/api/login-activity') return 'audit.view';
    if (req.path === '/api/branding/upload') return 'settings.manage';
    if (req.path.startsWith('/api/attachments')) return 'clinical.view';
}

async function assertDoctorAvailability(
    transaction: RecordTransaction,
    doctorId: string | null,
    dateTime: string,
    exclusions: { appointmentId?: string | null, visitId?: string | null } = {}
) {
    if (!doctorId) return;
    const minutePrefix = normalizeLocalDateTime(dateTime);
    const appointmentQuery = db.collection('appointments')
        .where('appointmentDate', '>=', minutePrefix)
        .where('appointmentDate', '<', `${minutePrefix}\uf8ff`);
    const visitQuery = db.collection('visits')
        .where('visitDate', '>=', minutePrefix)
        .where('visitDate', '<', `${minutePrefix}\uf8ff`);
    const [appointments, visits] = await Promise.all([
        transaction.get(appointmentQuery),
        transaction.get(visitQuery)
    ]);
    const appointmentConflict = appointments.docs.some(document =>
        document.id !== exclusions.appointmentId
        && document.data().doctorId === doctorId
        && document.data().isArchived !== true
        && document.data().status !== 'Cancelled'
        && typeof document.data().appointmentDate === 'string'
        && normalizeLocalDateTime(document.data().appointmentDate) === normalizeLocalDateTime(dateTime)
    );
    const visitConflict = visits.docs.some(document =>
        document.id !== exclusions.visitId
        && visitDoctorIds(document.data()).includes(doctorId)
        && document.data().isArchived !== true
        && document.data().status !== 'Cancelled'
        && (!exclusions.appointmentId || document.data().appointmentId !== exclusions.appointmentId)
        && typeof document.data().visitDate === 'string'
        && normalizeLocalDateTime(document.data().visitDate) === normalizeLocalDateTime(dateTime)
    );
    if (appointmentConflict || visitConflict) throw new RequestError(409, 'Doctor already has a booking at this time');
}

function sendRecordError(res: express.Response, error: unknown, operation: string) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    if (error instanceof AppointmentServiceError) return res.status(error.status).json({ error: error.message, code: error.code });
    if (error instanceof AppointmentSpecialPriceError) return res.status(error.status).json({ error: error.message, code: error.code });
    if (error instanceof AppointmentBookingQuoteError) return res.status(error.status).json({ error: error.message, code: error.code });
    if (error instanceof VisitPricingError) return res.status(error.status).json({ error: error.message, code: error.code });
    if (error instanceof PatientHistoryError) return res.status(error.status).json({ error: error.message, code: error.code });
    if (error instanceof TreatmentLedgerError) return res.status(error.status).json({ error: error.message, code: error.code });
    if (error instanceof VisitVersionError) return res.status(error.status).json({ error: error.message, code: error.code });
    if (error instanceof RequestError) return res.status(error.status).json({ error: error.message });
    if (error instanceof Error && (error as any).status === 403) return res.status(403).json({ error: error.message });
    console.error(`${operation} failed`, error);
    return res.status(500).json({ error: `${operation} failed` });
}

function requestPayload(req: express.Request) {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        throw new RequestError(400, 'Invalid request body');
    }
    return req.body as Record<string, unknown>;
}

// Only opt-in session redemptions need a retry identity for Visit creation.
// Persist the complete submitted intent: a retry cannot create a second Visit or
// silently accept a different clinical draft after an ambiguous response.
function visitCreationIntent(payload: Record<string, unknown>): string {
    const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
        : value && typeof value === 'object'
            ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
    return createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex');
}

function visitCreatedRecordIntent(visit: Record<string, any>): string {
    const fields = [...Object.keys(visitTextLimits), 'patientId', 'branchId', 'doctorId', 'visitDate',
        'appointmentId', 'followUpRequired', 'status', 'serviceId', 'serviceNameSnapshot',
        'serviceDurationMinutesSnapshot', 'serviceCatalogueVersion', 'performedByUserId',
        ...visitPerformerSnapshotFields, 'assistingStaffText'];
    // Pre-quote Visits retain their original retry fingerprint without backfill.
    // Quote-aware records still bind the field, including an explicit null.
    if (Object.hasOwn(visit, 'visitQuote')) fields.push('visitQuote');
    return visitCreationIntent(Object.fromEntries(fields.map(field => [field, visit[field] ?? null])));
}

function parsePatientPayload(payload: Record<string, unknown>, operationalOnly = false): Record<string, any> {
    const data = cleanRecordText(payload, patientTextLimits);
    requireRecordFields(data, ['name', 'contactNumber', 'gender', ...(operationalOnly ? [] : ['mainConcern'])]);
    if (!isValidDocumentId(payload.homeBranchId)) throw new RequestError(400, 'homeBranchId is required');
    let birth;
    try { birth = parsePatientBirth(payload, new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })); }
    catch (error: any) { throw new RequestError(400, error.message); }
    let emergency;
    try { emergency = parseEmergencyContact(payload); }
    catch (error: any) { throw new RequestError(400, error.message); }
    let findings;
    try { findings = parseClinicalFindings({ ...payload, ...data }); }
    catch (error: any) { throw new RequestError(400, error.message); }
    if (data.name.length < 2) throw new RequestError(400, 'Patient name is too short');
    const contactDigits = data.contactNumber.replace(/\D/g, '');
    if (contactDigits.length < 7 || contactDigits.length > 15) throw new RequestError(400, 'Invalid contact number');
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) throw new RequestError(400, 'Invalid email address');
    if (!['Male', 'Female', 'Other'].includes(data.gender)) throw new RequestError(400, 'Invalid gender');
    if (!patientStatuses.has(data.status || 'Active')) throw new RequestError(400, 'Invalid patient status');
    return {
        ...data,
        email: data.email.toLowerCase(),
        ...birth,
        ...findings,
        ...emergency,
        status: data.status || 'Active',
        homeBranchId: payload.homeBranchId
    };
}

function assertOnlyAllowedPatientFields(payload: Record<string, unknown>, allowedFields: Set<string>) {
    const forbiddenField = Object.keys(payload).find(field => !allowedFields.has(field));
    if (forbiddenField) throw new RequestError(403, `${forbiddenField} cannot be changed by this role`);
}

function parseLimitedPatientPayload(
    payload: Record<string, unknown>,
    patientData: Record<string, any>,
    role: 'staff' | 'manager'
) {
    const allowedFields = role === 'staff' ? demographicPatientFields : operationalPatientFields;
    assertOnlyAllowedPatientFields(payload, allowedFields);
    const mergedPayload = { ...patientData, ...payload };
    const parsed = parsePatientPayload(mergedPayload, true);
    const result: Record<string, any> = {
        name: parsed.name,
        contactNumber: parsed.contactNumber,
        email: parsed.email,
        birthday: parsed.birthday,
        age: parsed.age,
        birthDateStatus: parsed.birthDateStatus,
        estimatedAge: parsed.estimatedAge,
        estimatedAgeAsOf: parsed.estimatedAgeAsOf,
        estimatedBirthYear: parsed.estimatedBirthYear,
        gender: parsed.gender,
        address: parsed.address,
        emergencyContact: parsed.emergencyContact,
        emergencyContactName: parsed.emergencyContactName,
        emergencyContactRelationship: parsed.emergencyContactRelationship,
        emergencyContactNumber: parsed.emergencyContactNumber
    };
    if (role === 'manager') {
        result.homeBranchId = parsed.homeBranchId;
        result.status = parsed.status;
    }
    return result;
}

function parseArchiveReason(payload: Record<string, unknown>) {
    if (typeof payload.reason !== 'string') throw new RequestError(400, 'An archive reason is required');
    const reason = payload.reason.replace(/\u0000/g, '').trim();
    if (reason.length < 5) throw new RequestError(400, 'Archive reason must be at least 5 characters');
    if (reason.length > 500) throw new RequestError(400, 'Archive reason is too long');
    return reason;
}

function isRecordKind(value: unknown): value is RecordKind {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(archiveRecordConfig, value);
}

async function patientVisitSummary(
    transaction: RecordTransaction,
    patientId: string,
    archivedOverride?: { visitId: string, isArchived: boolean }
) {
    const snapshot = await transaction.get(db.collection('visits').where('patientId', '==', patientId));
    const activeVisits = snapshot.docs
        .map(document => ({
            id: document.id,
            ...document.data(),
            ...(archivedOverride?.visitId === document.id ? { isArchived: archivedOverride.isArchived } : {})
        }) as Record<string, any> & { id: string })
        .filter(visit => visit.isArchived !== true && isValidLocalDateTime(visit.visitDate))
        .sort((left, right) => String(left.visitDate).localeCompare(String(right.visitDate)));
    const firstVisit = activeVisits[0];
    const lastVisit = activeVisits[activeVisits.length - 1];
    let lastVisitBranch = '';
    if (lastVisit && isValidDocumentId(lastVisit.branchId)) {
        const branchSnapshot = await transaction.get(db.collection('branches').doc(lastVisit.branchId));
        lastVisitBranch = typeof branchSnapshot.data()?.branchName === 'string'
            ? branchSnapshot.data()!.branchName
            : '';
    }
    return {
        totalVisits: activeVisits.length,
        totalCompletedVisits: activeVisits.filter(visit => visit.status === 'Completed').length,
        totalNoShowVisits: activeVisits.filter(visit => visit.status === 'No Show').length,
        firstVisitDate: firstVisit?.visitDate || null,
        lastVisitDate: lastVisit?.visitDate || null,
        lastVisitBranch,
        currentPatientStatus: lastVisit?.status || null
    };
}

function parseAppointmentPayload(payload: Record<string, unknown>, previous?: Record<string, any>): Record<string, any> {
    const data = cleanRecordText(payload, appointmentTextLimits);
    if (!isValidDocumentId(payload.patientId)) throw new RequestError(400, 'patientId is required');
    if (!isValidDocumentId(payload.branchId)) throw new RequestError(400, 'branchId is required');
    const doctorId = optionalDoctorId(Object.hasOwn(payload, 'doctorId') ? payload.doctorId : previous?.doctorId);
    if (!isValidLocalDateTime(payload.appointmentDate)) throw new RequestError(400, 'Invalid appointment date');
    const appointmentTime = normalizeLocalDateTime(payload.appointmentDate).slice(11, 16);
    if (!/^((1[0-8]):(00|30)|19:00)$/.test(appointmentTime)) {
        throw new RequestError(400, 'Appointments must use an available clinic time slot');
    }
    requireRecordFields(data, ['visitType', 'status']);
    if (!visitTypes.has(data.visitType)) throw new RequestError(400, 'Invalid visit type');
    if (!appointmentStatuses.has(data.status)) throw new RequestError(400, 'Invalid appointment status');
    if (data.status === 'Completed' && (!data.mainConcern || !data.notes)) {
        throw new RequestError(400, 'Main concern and clinical notes are required before completion');
    }
    return {
        ...data,
        patientId: payload.patientId,
        branchId: payload.branchId,
        doctorId,
        appointmentDate: normalizeLocalDateTime(payload.appointmentDate)
    };
}

function optionalDoctorId(value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null;
    if (!isValidDocumentId(value)) throw new RequestError(400, 'Invalid doctorId');
    return value as string;
}

function parseVisitPayload(payload: Record<string, unknown>, previous?: Record<string, any>): Record<string, any> {
    if (Object.hasOwn(payload, 'visitVersion')) throw new VisitVersionError(400, 'VISIT_VERSION_METADATA', 'Visit version is supplied by the server');
    if (['creationIntentHash', 'creationRecordHash', 'sessionUsageSnapshot'].some(field => Object.hasOwn(payload, field))) {
        throw new RequestError(400, 'Visit retry and session snapshots are supplied by the server');
    }
    if (visitPerformerSnapshotFields.some(field => Object.hasOwn(payload, field))) {
        throw new RequestError(400, 'Performer snapshots are supplied by the server');
    }
    // Retained historical text is not a new write: do not trim or reject an
    // imported value against today's limit. Selection mirroring happens later.
    const retainText = previous && (previous.serviceId
        || !Object.hasOwn(payload, 'treatmentService') || payload.treatmentService === previous.treatmentService);
    const data = cleanRecordText(retainText ? { ...payload, treatmentService: undefined } : payload, visitTextLimits);
    if (!isValidDocumentId(payload.patientId)) throw new RequestError(400, 'patientId is required');
    if (!isValidDocumentId(payload.branchId)) throw new RequestError(400, 'branchId is required');
    const doctorId = optionalDoctorId(Object.hasOwn(payload, 'doctorId') ? payload.doctorId : previous?.doctorId);
    if (!isValidLocalDateTime(payload.visitDate)) throw new RequestError(400, 'Invalid visit date');
    requireRecordFields(data, ['visitType']);
    if (!visitTypes.has(data.visitType)) throw new RequestError(400, 'Invalid visit type');
    if (payload.appointmentId !== null && payload.appointmentId !== undefined
        && !isValidDocumentId(payload.appointmentId)) {
        throw new RequestError(400, 'Invalid appointmentId');
    }
    if (data.nextVisitDate && !isValidDate(data.nextVisitDate)) throw new RequestError(400, 'Invalid follow-up date');
    let assistants: Record<string, string> = {};
    if (Object.hasOwn(payload, 'assistingStaffText')) {
        if (previous && payload.assistingStaffText === previous.assistingStaffText) {
            // Unchanged imported attribution remains byte-for-byte historical.
            assistants = {};
        } else {
            if (typeof payload.assistingStaffText !== 'string'
                || payload.assistingStaffText.length > ASSISTING_STAFF_MAX_LENGTH) {
                throw new RequestError(400, `Assisting staff must contain at most ${ASSISTING_STAFF_MAX_LENGTH} characters`);
            }
            assistants = { assistingStaffText: payload.assistingStaffText.trim() };
        }
    } else if (!previous) assistants = { assistingStaffText: '' };
    return {
        ...data,
        ...assistants,
        patientId: payload.patientId,
        branchId: payload.branchId,
        doctorId,
        visitDate: normalizeLocalDateTime(payload.visitDate),
        appointmentId: (payload.appointmentId || null) as string | null,
        followUpRequired: payload.followUpRequired === true,
        status: 'Completed'
    };
}

async function applyVisitPerformer(
    transaction: RecordTransaction,
    payload: Record<string, unknown>,
    visit: Record<string, any>,
    previous?: Record<string, any>
) {
    const explicit = Object.hasOwn(payload, 'performedByUserId');
    if (explicit && !isValidDocumentId(payload.performedByUserId)) {
        throw new RequestError(400, 'Select a performer for this Visit');
    }
    const performerId = explicit ? payload.performedByUserId as string
        : previous ? previous.performedByUserId : visit.doctorId;
    // Legacy edits retain their original doctor-based attribution. Old doctor-only
    // create clients still resolve a real eligible performer on the server.
    if (previous && !explicit && !performerId) return;
    if (!isValidDocumentId(performerId)) throw new RequestError(400, 'Select a performer for this Visit');
    const retained = previous?.performedByUserId === performerId;
    if (retained && previous.branchId === visit.branchId && previous.visitDate === visit.visitDate
        && optionalDoctorId(previous.doctorId) === visit.doctorId) return;
    const performerSnapshot = await transaction.get(db.collection('users').doc(performerId));
    const performer = performerSnapshot.data();
    if (!performerSnapshot.exists || !isEligibleVisitPerformer(performer, visit.branchId)) {
        throw new RequestError(400, 'Performer is not active or eligible in the selected branch');
    }
    if (!visit.doctorId && performer!.role === 'doctor') visit.doctorId = performerId;
    if (!retained) {
        Object.assign(visit, {
            performedByUserId: performerId,
            performedByNameSnapshot: typeof performer!.fullName === 'string' ? performer!.fullName
                : typeof performer!.name === 'string' ? performer!.name : '',
            performedByRoleSnapshot: performer!.role,
            performedByDesignationSnapshot: performer!.role === 'staff' ? performer!.staffDesignation : null
        });
    }
}

function assertVisitDoctorOwnership(authorization: { decodedToken: SessionIdentity, userProfile: Record<string, any> }, doctorId: string | null) {
    if (authorization.userProfile.role === 'doctor' && doctorId !== authorization.decodedToken.uid) {
        throw new RequestError(403, 'Doctors can only write their own visit records');
    }
}

async function assertVisitDoctorAvailability(transaction: RecordTransaction, visit: Record<string, any>, exclusions: { appointmentId?: string | null, visitId?: string | null }) {
    for (const doctorId of visitDoctorIds(visit)) {
        await assertDoctorAvailability(transaction, doctorId, visit.visitDate, exclusions);
    }
}

function matchesLinkedAppointmentDoctor(appointment: Record<string, any>, visit: Record<string, any>) {
    const bookedDoctorId = optionalDoctorId(appointment.doctorId);
    return bookedDoctorId ? bookedDoctorId === visit.doctorId
        : visit.doctorId === (visit.performedByRoleSnapshot === 'doctor' ? visit.performedByUserId : null);
}

async function refreshSupportAuthorization(transaction: RecordTransaction, authorization: { decodedToken: SessionIdentity, userProfile: Record<string, any> }) {
    const request = (authorization as any).request as express.Request;
    const { identity, profile } = await currentActor(request, transaction);
    if (identity.uid !== authorization.decodedToken.uid || authorization.userProfile.role === SUPPORT_DEVELOPER && profile.role !== SUPPORT_DEVELOPER) throw new RequestError(403, 'Account scope changed');
    const permission = requestPermission(request);
    if (permission) assertCapability(profile, permission);
    authorization.userProfile = profile;
}

async function refreshAppointmentAuthorization(transaction: RecordTransaction, authorization: { decodedToken: SessionIdentity, userProfile: Record<string, any> }, permission: 'CREATE' | 'UPDATE') {
    await refreshSupportAuthorization(transaction, authorization);
    const profile = authorization.userProfile;
    assertDevelopmentRole(profile?.role);
    if (profile?.active !== true) throw new RequestError(403, 'Account scope changed');
    requireRole(profile, auditActionRoles.Appointment[permission]);
    authorization.userProfile = profile;
}

async function refreshVisitAuthorization(transaction: RecordTransaction, authorization: { decodedToken: SessionIdentity, userProfile: Record<string, any> }, permission: 'CREATE' | 'UPDATE') {
    await refreshSupportAuthorization(transaction, authorization);
    const profile = authorization.userProfile;
    assertDevelopmentRole(profile?.role);
    if (profile?.active !== true) throw new RequestError(403, 'Account scope changed');
    requireRole(profile, auditActionRoles.Visit[permission]);
    assertCapability(profile, 'clinical.view');
    assertCapability(profile, 'clinical.edit_draft');
    authorization.userProfile = profile;
}

async function transactionRecordContext(
    transaction: RecordTransaction,
    authorization: { decodedToken: SessionIdentity, userProfile: Record<string, any> },
    patientId: string,
    branchId: string,
    doctorId: string | null,
    retainedDoctor = false
) {
    await refreshSupportAuthorization(transaction, authorization);
    const patientRef = db.collection('patients').doc(patientId);
    const branchRef = db.collection('branches').doc(branchId);
    const doctorRef = doctorId ? db.collection('users').doc(doctorId) : null;
    const [patientSnapshot, branchSnapshot, doctorSnapshot] = await Promise.all([
        transaction.get(patientRef),
        transaction.get(branchRef),
        doctorRef ? transaction.get(doctorRef) : Promise.resolve(null)
    ]);
    if (!patientSnapshot.exists) throw new RequestError(404, 'Patient not found');
    if (!branchSnapshot.exists) throw new RequestError(400, 'Branch not found');
    const patientData = patientSnapshot.data() || {};
    const branchData = branchSnapshot.data() || {};
    const doctorData = doctorSnapshot?.data() || {};
    if (!canAccessBranch(authorization.userProfile, branchId)) {
        throw new RequestError(403, 'Branch access denied');
    }
    if (patientData.isArchived === true) throw new RequestError(409, 'Patient is archived');
    if (doctorId && !retainedDoctor && (!doctorSnapshot?.exists || !isEligibleVisitPerformer(doctorData, branchId)
        || doctorData.role !== 'doctor')) {
        throw new RequestError(400, 'Doctor is not active in the selected branch');
    }
    return { patientRef, patientData, branchRef, branchData, doctorRef, doctorData };
}

function getSafeChangeFields(value: unknown) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((field): field is string =>
        typeof field === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(field)
    ))].slice(0, 30);
}

function buildAuditLogData(options: {
    authorization: { decodedToken: SessionIdentity, userProfile: Record<string, any> };
    action: AuditAction;
    resource: AuditResource;
    resourceId: string;
    resourceName?: string;
    branchId?: string | null;
    changeFields?: string[];
    eventType?: string;
    reason?: string;
}) {
    const changeFields = getSafeChangeFields(options.changeFields);
    const verb: Record<AuditAction, string> = {
        CREATE: 'Created',
        UPDATE: 'Updated',
        DELETE: 'Deleted',
        VIEW: 'Viewed',
        AUTH: 'Authenticated for'
    };
    const detailSuffix = changeFields.length > 0 ? `. Fields: ${changeFields.join(', ')}` : '';
    const eventDetails: Record<string, string> = {
        attachment_uploaded: `Uploaded attachment for ${options.resource.toLowerCase()} record`,
        attachment_deleted: `Deleted attachment from ${options.resource.toLowerCase()} record`,
        attachment_photo_updated: 'Updated Visit photo details',
        appointment_completed_from_visit: 'Completed appointment when its linked visit was created',
        developer_metrics_view: 'Viewed developer metrics',
        developer_diagnostics_run: 'Ran trusted service diagnostics',
        developer_maintenance_changed: 'Changed maintenance mode',
        developer_cache_cleared: 'Cleared Vine browser storage',
        developer_settings_refreshed: 'Refreshed application settings',
        developer_fault_simulated: 'Ran browser error-capture test',
        record_archived: `Archived ${options.resource.toLowerCase()} record`,
        record_restored: `Restored ${options.resource.toLowerCase()} record`,
        user_archived: 'Archived user account',
        user_restored: 'Restored user account',
        user_activated: 'Activated pending user account',
        user_deactivated: 'Deactivated user account',
        user_deleted: 'Deleted user account'
    };
    return {
        timestamp: new Date().toISOString(),
        recordedAt: FieldValue.serverTimestamp(),
        userId: options.authorization.decodedToken.uid,
        userEmail: options.authorization.decodedToken.email || 'unknown',
        userName: typeof options.authorization.userProfile.fullName === 'string'
            ? options.authorization.userProfile.fullName.slice(0, 120)
            : 'Unknown User',
        userRole: options.authorization.userProfile.role,
        action: options.action,
        resource: options.resource,
        resourceId: options.resourceId,
        resourceName: options.resourceName || '',
        details: `${eventDetails[options.eventType || '']
            || `${verb[options.action]} ${options.resource.toLowerCase()} record${detailSuffix}`}${
                options.reason ? `. Reason: ${options.reason.replace(/[\r\n]/g, ' ').slice(0, 500)}` : ''
            }`,
        changes: changeFields.map(field => ({ field })),
        branchId: options.branchId || null,
        eventType: options.eventType || 'record_activity',
        source: 'trusted_server',
        integrityVersion: 1
    };
}

function stageAuditLog(
    transaction: RecordTransaction,
    options: Parameters<typeof buildAuditLogData>[0]
) {
    if (!shouldRecordAuditEvent({
        actorRole: options.authorization.userProfile.role,
        action: options.action,
        resource: options.resource,
        eventType: options.eventType
    })) return;

    transaction.set(db.collection('audit_logs').doc(), buildAuditLogData(options));
}

async function authorizeAuditResource(
    authorization: { decodedToken: SessionIdentity, userProfile: Record<string, any> },
    action: AuditAction,
    resource: AuditResource,
    resourceId: string
) {
    const role = authorization.userProfile.role as string;
    const hasGlobalAccess = globalBranchRoles.has(role);

    if (resource === 'Settings') {
        return hasGlobalAccess ? { branchId: null, resourceName: '' } : null;
    }
    if (resource === 'Branch') {
        if (!hasGlobalAccess) return null;
        const snapshot = await db.collection('branches').doc(resourceId).get();
        const branchName = snapshot.exists && typeof snapshot.data()?.branchName === 'string'
            ? snapshot.data()!.branchName.slice(0, 120)
            : '';
        return { branchId: resourceId, resourceName: branchName };
    }
    if (resource === 'User') {
        if (authorization.decodedToken.uid !== resourceId && !hasGlobalAccess) return null;
        if (!hasGlobalAccess && !['UPDATE', 'VIEW', 'AUTH'].includes(action)) return null;
        const snapshot = await db.collection('users').doc(resourceId).get();
        const data = snapshot.data() || {};
        const branchId = typeof data.defaultBranchId === 'string' ? data.defaultBranchId : null;
        return { branchId, resourceName: '' };
    }

    if (action === 'AUTH' || !auditActionRoles[resource].hasOwnProperty(action)
        || !hasCapability(authorization.userProfile, capabilityForRoles(auditActionRoles[resource][action as Exclude<AuditAction, 'AUTH'>])!)) {
        return null;
    }

    const collectionName = resource === 'Patient' ? 'patients' : resource === 'Appointment' ? 'appointments' : 'visits';
    const snapshot = await db.collection(collectionName).doc(resourceId).get();
    if (!snapshot.exists) {
        return action === 'DELETE' && hasGlobalAccess ? { branchId: null, resourceName: '' } : null;
    }
    const data = snapshot.data() || {};
    const branchId = resource === 'Patient' ? data.homeBranchId : data.branchId;
    if (role === SUPPORT_DEVELOPER && !canAccessBranch(authorization.userProfile, branchId)) return null;
    if (resource !== 'Patient' && action !== 'VIEW'
        && !canAccessBranch(authorization.userProfile, branchId)) return null;

    let resourceName = resource === 'Patient' && typeof data.patientID === 'string' ? data.patientID.slice(0, 80) : '';
    if (resource !== 'Patient' && typeof data.patientId === 'string') {
        const patientSnapshot = await db.collection('patients').doc(data.patientId).get();
        const patientData = patientSnapshot.data() || {};
        resourceName = typeof patientData.patientID === 'string' ? patientData.patientID.slice(0, 80) : '';
    }
    return { branchId, resourceName };
}

async function authorizeRequest(
    req: express.Request,
    res: express.Response,
    allowedRoles: readonly string[]
) {
    const authorization = req.headers.authorization;
    const match = authorization?.match(/^Bearer\s+(.+)$/i);

    if (!match) {
        res.status(401).json({ error: "Unauthorized" });
        return null;
    }

    try {
        const decodedToken = await sessionIdentity(req);
        if (decodedToken.provider !== 'google') {
            res.status(403).json({ error: 'Google sign-in is required' });
            return null;
        }
        const userSnapshot = await db.collection("users").doc(decodedToken.uid).get();
        const userProfile = userSnapshot.data();

        if (!userSnapshot.exists || !activeAccount(userProfile)) {
            res.status(403).json({ error: "Account is not approved or active" });
            return null;
        }

        assertDevelopmentRole(userProfile.role);
        const permission = requestPermission(req);
        if (permission) assertCapability(userProfile, permission);
        if (!permission && (typeof userProfile.role !== 'string' || !allowedRoles.includes(userProfile.role))) {
            res.status(403).json({ error: "Insufficient permissions" });
            return null;
        }

        return { decodedToken, userProfile, request: req };
    } catch (error) {
        console.error("Request authentication failed", error);
        res.status((error as any)?.status || 401).json({ error: (error as any)?.status ? (error as Error).message : "Unauthorized" });
        return null;
    }
}

// Google OAuth creates a pending profile; this endpoint preserves the existing
// activation workflow and never grants privileged access.
app.post('/api/auth/register-pending-profile', async (req, res) => {
    const authorization = req.headers.authorization;
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    if (!match) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const decodedToken = await sessionIdentity(req);
        if (decodedToken.provider !== 'google') {
            return res.status(403).json({ error: 'Google sign-in is required' });
        }

        const email = typeof decodedToken.email === 'string' ? decodedToken.email.trim() : '';
        if (!email) return res.status(400).json({ error: 'A Google email address is required' });

        const tokenName = typeof decodedToken.name === 'string' ? decodedToken.name.trim() : '';
        const fullName = (tokenName || email.split('@')[0] || 'Google User').slice(0, 120);
        const userRef = db.collection('users').doc(decodedToken.uid);
        let created = false;

        await db.runTransaction(async transaction => {
            const existing = await transaction.get(userRef);
            if (existing.exists) return;
            created = true;
            transaction.create(userRef, {
                email,
                fullName,
                role: 'staff',
                active: false,
                accountStatus: 'pending_activation',
                assignedBranches: [],
                assignedBranchNames: [],
                defaultBranchId: null,
                defaultBranchName: null,
                createdAt: new Date().toISOString()
            });
        });

        const profile = await userRef.get();
        res.status(created ? 201 : 200).json({
            id: userRef.id,
            created,
            accountStatus: profile.data()?.accountStatus || 'pending_activation',
            active: profile.data()?.active === true
        });
    } catch (error) {
        console.error('Pending profile registration failed', error);
        res.status(401).json({ error: 'Unable to register this Google account' });
    }
});

function allowDeveloperRequest(userId: string) {
    const now = Date.now();
    const existing = developerRequestWindows.get(userId);
    if (!existing || now - existing.startedAt >= developerRequestWindowMs) {
        developerRequestWindows.set(userId, { startedAt: now, count: 1 });
        return true;
    }
    if (existing.count >= developerRequestLimit) return false;
    existing.count += 1;
    return true;
}

function authorizeDeveloperRequest(
    authorization: { decodedToken: SessionIdentity, userProfile: Record<string, any> },
    res: express.Response
) {
    if (allowDeveloperRequest(authorization.decodedToken.uid)) return true;
    res.status(429).json({ error: 'Diagnostic request limit reached. Please wait one minute before trying again.' });
    return false;
}

// Clients may report that an event occurred, but all identity, role, time,
// branch, and safe resource-label fields are derived by this trusted server.
app.post("/api/audit-events", async (req, res) => {
    const authorization = await authorizeRequest(req, res, applicationRoles);
    if (!authorization) return;

    const { action, resource, resourceId } = req.body as Record<string, unknown>;
    if (!auditActions.has(action as AuditAction)
        || !auditResources.has(resource as AuditResource)
        || !isValidDocumentId(resourceId)) {
        return res.status(400).json({ error: "Invalid audit event" });
    }

    try {
        const typedAction = action as AuditAction;
        const typedResource = resource as AuditResource;
        if (!shouldRecordAuditEvent({
            actorRole: authorization.userProfile.role,
            action: typedAction,
            resource: typedResource
        })) {
            return res.status(200).json({ recorded: false });
        }
        const context = await authorizeAuditResource(
            authorization,
            typedAction,
            typedResource,
            resourceId
        );
        if (!context) return res.status(403).json({ error: "Audit resource access denied" });

        const log = buildAuditLogData({
            authorization,
            action: typedAction,
            resource: typedResource,
            resourceId,
            resourceName: context.resourceName,
            branchId: context.branchId,
            changeFields: getSafeChangeFields(req.body.changeFields)
        });
        const logRef = await db.collection('audit_logs').add(log);
        res.status(201).json({ id: logRef.id });
    } catch (error) {
        console.error("Audit event creation failed", error);
        res.status(500).json({ error: "Audit event creation failed" });
    }
});

// Login activity is written only after an active Google-authenticated account
// reaches the application. The browser never submits IP, location, or device
// fields; those are derived on the trusted server.
app.post('/api/login-activity/record', async (req, res) => {
    const authorization = await authorizeRequest(req, res, applicationRoles);
    if (!authorization) return;

    const role = authorization.userProfile.role;
    if (!shouldRecordLoginActivity(role)) return res.status(200).json({ recorded: false });
    const now = Date.now();
    const previousWrite = recentLoginActivityWrites.get(authorization.decodedToken.uid) || 0;
    if (now - previousWrite < 10_000) return res.status(200).json({ recorded: false });
    recentLoginActivityWrites.set(authorization.decodedToken.uid, now);

    const ipAddress = getClientIpAddress(req);
    const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : '';
    try {
        const location = await getApproximateIpLocation(ipAddress);
        const device = describeLoginUserAgent(userAgent);
        await db.collection('login_activity').add({
            userId: authorization.decodedToken.uid,
            userName: trustedUserName(authorization),
            userEmail: authorization.decodedToken.email || '',
            userRole: role,
            timestamp: new Date().toISOString(),
            recordedAt: FieldValue.serverTimestamp(),
            ipAddress,
            location,
            ...device,
            source: 'trusted_server'
        });
        res.status(201).json({ recorded: true });
    } catch (error) {
        recentLoginActivityWrites.delete(authorization.decodedToken.uid);
        console.error('Login activity recording failed', error);
        res.status(500).json({ error: 'Login activity recording failed' });
    }
});

app.get('/api/login-activity', async (req, res) => {
    const authorization = await authorizeRequest(req, res, administrativeRoles);
    if (!authorization) return;

    try {
        const snapshot = await db.collection('login_activity').orderBy('timestamp', 'desc').limit(100).get();
        const rawRecords: Array<Record<string, unknown> & { id: string }> = snapshot.docs
            .map(document => ({ id: document.id, ...(document.data() as Record<string, unknown>) }));
        const records = rawRecords
            .filter(record => record.userRole !== 'support_developer')
            .map(record => ({
                id: record.id,
                userName: typeof record.userName === 'string' ? record.userName : 'Unknown user',
                userEmail: typeof record.userEmail === 'string' ? record.userEmail : '',
                timestamp: typeof record.timestamp === 'string' ? record.timestamp : '',
                ipAddress: typeof record.ipAddress === 'string' ? record.ipAddress : 'Unavailable',
                location: typeof record.location === 'string' ? record.location : 'Unavailable',
                browser: typeof record.browser === 'string' ? record.browser : 'Other browser',
                operatingSystem: typeof record.operatingSystem === 'string' ? record.operatingSystem : 'Other OS',
                deviceType: typeof record.deviceType === 'string' ? record.deviceType : 'Desktop',
            }));
        res.json({ records });
    } catch (error) {
        console.error('Login activity retrieval failed', error);
        res.status(500).json({ error: 'Login activity retrieval failed' });
    }
});

function canManageUserTarget(
    authorization: { decodedToken: SessionIdentity, userProfile: Record<string, any> },
    userId: string,
    targetProfile: Record<string, any>
) {
    if (authorization.decodedToken.uid === userId) {
        throw new RequestError(403, 'You cannot manage your own account with this action');
    }
    if (authorization.userProfile.role === 'admin' && isSupportDeveloper(targetProfile.role)) {
        throw new RequestError(403, 'Administrators cannot manage Support / Developer accounts');
    }
}

async function getManagedUser(
    authorization: { decodedToken: SessionIdentity, userProfile: Record<string, any> },
    userId: string,
    transaction?: RecordTransaction
) {
    if (!isValidDocumentId(userId)) throw new RequestError(400, 'Invalid user ID');
    if (transaction) {
        await refreshSupportAuthorization(transaction, authorization);
        const actor = authorization.userProfile;
        assertCapability(actor, 'access.manage');
        assertCapability(actor, 'users.manage');
        assertDevelopmentRole(actor.role);
        authorization = { ...authorization, userProfile: actor };
    }
    const userRef = db.collection('users').doc(userId);
    const snapshot = transaction ? await transaction.get(userRef) : await userRef.get();
    if (!snapshot.exists) throw new RequestError(404, 'User account not found');
    const targetProfile = snapshot.data() || {};
    canManageUserTarget(authorization, userId, targetProfile);
    return { userRef, targetProfile, authorization };
}

async function validateUserActivationTarget(targetProfile: Record<string, any>, userId: string, transaction: RecordTransaction) {
    const role = targetProfile.role;
    assertDevelopmentRole(role);
    if (role === SUPPORT_DEVELOPER) {
        const identity = await transaction.sql('SELECT 1 FROM auth_identities WHERE user_id = $1', [userId]);
        if (!identity.rows.length) throw new RequestError(400, 'Sign in with a dedicated Google test identity before activation');
    }
    const branchIds = getAssignedBranchIds(targetProfile);
    const branches = [];
    for (const id of branchIds) {
        const branch = await transaction.get(db.collection('branches').doc(id));
        if (branch.exists) branches.push({ ...branch.data(), id });
    }
    const issues = activationIssues(targetProfile, branches);
    if (issues.length) throw new RequestError(400, issues[0]);
}

// User archive/delete operations intentionally never touch clinical records or
// prior audit events. Archive retains the profile for later restoration; delete
// removes only the authentication identity and current user profile.
app.post('/api/users/:userId/archive', async (req, res) => {
    const authorization = await authorizeRequest(req, res, administrativeRoles);
    if (!authorization) return;

    try {
        const now = new Date().toISOString();
        await db.runTransaction(async transaction => {
            const { userRef, targetProfile, authorization: currentAuthorization } = await getManagedUser(authorization, req.params.userId, transaction);
            if (targetProfile.isArchived === true) throw new RequestError(409, 'User account is already archived');
            await transaction.sql('DELETE FROM auth_sessions WHERE user_id = $1', [userRef.id]);
            transaction.update(userRef, {
                active: false,
                isArchived: true,
                accountStatus: 'archived',
                archivedAt: now,
                archivedByUid: authorization.decodedToken.uid,
                archivedByName: trustedUserName(currentAuthorization)
            });
            transaction.set(db.collection('audit_logs').doc(), buildAuditLogData({
                authorization: currentAuthorization,
                action: 'UPDATE',
                resource: 'User',
                resourceId: userRef.id,
                eventType: 'user_archived',
                changeFields: ['active', 'isArchived', 'accountStatus']
            }));
        });
        res.status(200).json({ id: req.params.userId, archivedAt: now });
    } catch (error) {
        return sendRecordError(res, error, 'User archive');
    }
});

app.post('/api/users/:userId/restore', async (req, res) => {
    const authorization = await authorizeRequest(req, res, administrativeRoles);
    if (!authorization) return;

    try {
        const now = new Date().toISOString();
        await db.runTransaction(async transaction => {
            const { userRef, targetProfile, authorization: currentAuthorization } = await getManagedUser(authorization, req.params.userId, transaction);
            if (targetProfile.isArchived !== true) throw new RequestError(409, 'Only archived user accounts can be restored');
            await validateUserActivationTarget(targetProfile, userRef.id, transaction);
            transaction.update(userRef, {
                active: true,
                isArchived: false,
                accountStatus: 'active',
                archivedAt: FieldValue.delete(),
                archivedByUid: FieldValue.delete(),
                archivedByName: FieldValue.delete(),
                restoredAt: now,
                restoredByUid: authorization.decodedToken.uid,
                restoredByName: trustedUserName(currentAuthorization)
            });
            transaction.set(db.collection('audit_logs').doc(), buildAuditLogData({
                authorization: currentAuthorization,
                action: 'UPDATE',
                resource: 'User',
                resourceId: userRef.id,
                eventType: 'user_restored',
                changeFields: ['active', 'isArchived', 'accountStatus']
            }));
        });
        res.status(200).json({ id: req.params.userId, restoredAt: now });
    } catch (error) {
        return sendRecordError(res, error, 'User restore');
    }
});

app.post('/api/users/:userId/activate', async (req, res) => {
    const authorization = await authorizeRequest(req, res, administrativeRoles);
    if (!authorization) return;

    try {
        const now = new Date().toISOString();
        await db.runTransaction(async transaction => {
            const { userRef, targetProfile, authorization: currentAuthorization } = await getManagedUser(authorization, req.params.userId, transaction);
            if (targetProfile.isArchived === true) throw new RequestError(409, 'Archived users must be restored before activation');
            if (targetProfile.active === true) throw new RequestError(409, 'User account is already active');
            await validateUserActivationTarget(targetProfile, userRef.id, transaction);
            transaction.update(userRef, {
                active: true,
                accountStatus: 'active',
                activatedAt: now,
                activatedByUid: authorization.decodedToken.uid,
                activatedByName: trustedUserName(currentAuthorization)
            });
            transaction.set(db.collection('audit_logs').doc(), buildAuditLogData({
                authorization: currentAuthorization,
                action: 'UPDATE',
                resource: 'User',
                resourceId: userRef.id,
                eventType: 'user_activated',
                changeFields: ['active', 'accountStatus']
            }));
        });
        res.status(200).json({ id: req.params.userId, activatedAt: now });
    } catch (error) {
        return sendRecordError(res, error, 'User activation');
    }
});

app.post('/api/users/:userId/deactivate', async (req, res) => {
    const authorization = await authorizeRequest(req, res, administrativeRoles);
    if (!authorization) return;

    try {
        const now = new Date().toISOString();
        await db.runTransaction(async transaction => {
            const { userRef, targetProfile, authorization: currentAuthorization } = await getManagedUser(authorization, req.params.userId, transaction);
            if (targetProfile.isArchived === true) throw new RequestError(409, 'Archived user accounts are already inactive');
            if (targetProfile.active !== true) throw new RequestError(409, 'User account is already inactive');
            await transaction.sql('DELETE FROM auth_sessions WHERE user_id = $1', [userRef.id]);
            transaction.update(userRef, {
                active: false,
                accountStatus: 'inactive',
                deactivatedAt: now,
                deactivatedByUid: authorization.decodedToken.uid,
                deactivatedByName: trustedUserName(currentAuthorization)
            });
            transaction.set(db.collection('audit_logs').doc(), buildAuditLogData({
                authorization: currentAuthorization,
                action: 'UPDATE',
                resource: 'User',
                resourceId: userRef.id,
                eventType: 'user_deactivated',
                changeFields: ['active', 'accountStatus']
            }));
        });
        res.status(200).json({ id: req.params.userId, deactivatedAt: now });
    } catch (error) {
        return sendRecordError(res, error, 'User deactivation');
    }
});

app.delete('/api/users/:userId', async (req, res) => {
    const authorization = await authorizeRequest(req, res, administrativeRoles);
    if (!authorization) return;

    try {
        await db.runTransaction(async transaction => {
            const { userRef, authorization: currentAuthorization } = await getManagedUser(authorization, req.params.userId, transaction);
            await transaction.sql("DELETE FROM auth_sessions WHERE user_id = $1", [userRef.id]);
            await transaction.sql("DELETE FROM auth_identities WHERE user_id = $1", [userRef.id]);
            transaction.delete(userRef);
            // This audit entry is intentionally written in the same transaction
            // as the profile deletion and is retained after the account is gone.
            transaction.set(db.collection('audit_logs').doc(), buildAuditLogData({
                authorization: currentAuthorization,
                action: 'DELETE',
                resource: 'User',
                resourceId: userRef.id,
                eventType: 'user_deleted'
            }));
        });
        res.status(204).send();
    } catch (error) {
        return sendRecordError(res, error, 'User deletion');
    }
});

// Developer Tools use server-side aggregates and diagnostics so the browser
// never downloads full clinical collections merely to display an operational
// count. These routes are intentionally narrower than general admin access.
app.get('/api/developer/metrics', async (req, res) => {
    const authorization = await authorizeRequest(req, res, developerRoles);
    if (!authorization) return;
    if (!authorizeDeveloperRequest(authorization, res)) return;

    try {
        const [users, patients, appointments, visits] = await Promise.all([
            db.collection('users').count().get(),
            db.collection('patients').count().get(),
            db.collection('appointments').count().get(),
            db.collection('visits').count().get()
        ]);
        const metrics = {
            users: users.data().count,
            patients: patients.data().count,
            appointments: appointments.data().count,
            visits: visits.data().count
        };
        await db.collection('audit_logs').add(buildAuditLogData({
            authorization,
            action: 'VIEW',
            resource: 'Settings',
            resourceId: 'developer_metrics',
            eventType: 'developer_metrics_view'
        }));
        res.json(metrics);
    } catch (error) {
        console.error('Developer metrics failed', error);
        res.status(500).json({ error: 'Developer metrics failed' });
    }
});

app.post('/api/developer/diagnostics', async (req, res) => {
    const authorization = await authorizeRequest(req, res, developerRoles);
    if (!authorization) return;
    if (!authorizeDeveloperRequest(authorization, res)) return;

    try {
        const startedAt = Date.now();
        await db.collection('settings').doc('branding').get();
        const databaseLatencyMs = Date.now() - startedAt;
        await db.collection('audit_logs').add(buildAuditLogData({
            authorization,
            action: 'VIEW',
            resource: 'Settings',
            resourceId: 'developer_diagnostics',
            eventType: 'developer_diagnostics_run'
        }));
        res.json({ databaseLatencyMs, serverTime: new Date().toISOString() });
    } catch (error) {
        console.error('Developer diagnostics failed', error);
        res.status(500).json({ error: 'Developer diagnostics failed' });
    }
});

app.post('/api/developer/maintenance', async (req, res) => {
    const authorization = await authorizeRequest(req, res, developerRoles);
    if (!authorization) return;
    if (!authorizeDeveloperRequest(authorization, res)) return;

    try {
        const payload = requestPayload(req);
        if (typeof payload.maintenanceMode !== 'boolean') {
            throw new RequestError(400, 'maintenanceMode must be true or false');
        }
        const brandingRef = db.collection('settings').doc('branding');
        await db.runTransaction(async transaction => {
            await refreshSupportAuthorization(transaction, authorization);
            transaction.set(brandingRef, { maintenanceMode: payload.maintenanceMode }, { merge: true });
            stageAuditLog(transaction, {
                authorization,
                action: 'UPDATE',
                resource: 'Settings',
                resourceId: 'maintenance_status',
                eventType: 'developer_maintenance_changed',
                changeFields: ['maintenanceMode']
            });
        });
        res.json({ maintenanceMode: payload.maintenanceMode });
    } catch (error) {
        return sendRecordError(res, error, 'Maintenance mode update');
    }
});

app.post('/api/developer/activity', async (req, res) => {
    const authorization = await authorizeRequest(req, res, developerRoles);
    if (!authorization) return;
    if (!authorizeDeveloperRequest(authorization, res)) return;

    const payload = requestPayload(req);
    const event = typeof payload.event === 'string' ? payload.event : '';
    const definition = getDeveloperActivityDefinition(event);
    if (!definition) return res.status(400).json({ error: 'Unsupported Developer Tools activity' });

    try {
        await db.collection('audit_logs').add(buildAuditLogData({
            authorization,
            action: definition.action,
            resource: definition.resource,
            resourceId: definition.resourceId,
            eventType: event
        }));
        res.status(201).json({ recorded: true });
    } catch (error) {
        console.error('Developer activity logging failed', error);
        res.status(500).json({ error: 'Developer activity logging failed' });
    }
});

// Branding remains publicly readable, but only this trusted endpoint may write it.
app.post("/api/branding/upload", uploadSingleFile, async (req, res) => {
    const authorization = await authorizeRequest(req, res, administrativeRoles);
    if (!authorization) return;

    try {
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });
        const folder = typeof req.body.folder === 'string' && /^[a-z0-9-]{1,40}$/.test(req.body.folder)
            ? req.body.folder
            : 'misc';
        const extension = getFileExtension(req.file.originalname);
        const detectedType = Object.entries(allowedAttachmentTypes).find(([, rule]) =>
            rule.extensions.includes(extension) && rule.signature(req.file!.buffer)
        )?.[0];
        if (!detectedType || !detectedType.startsWith('image/')) {
            return res.status(400).json({ error: "Only valid JPG, PNG, WebP, and ICO images are allowed" });
        }
        if (req.file.size > 500 * 1024) {
            return res.status(400).json({ error: "Branding images must be 500 KB or smaller" });
        }

        const storagePath = `branding/${folder}/${Date.now()}_${randomUUID()}${extension}`;
        const bucket = storageBucket;
        const file = bucket.file(storagePath);
        await file.save(req.file.buffer, {
            resumable: false,
            contentType: detectedType,
            metadata: {
                cacheControl: 'public, max-age=3600',
                metadata: { uploadedByUid: authorization.decodedToken.uid }
            }
        });
        res.json({ downloadUrl: publicStorageUrl(storagePath), storagePath });
    } catch (error: any) {
        console.error("Branding upload failed", error);
        res.status(500).json({ error: "Branding upload failed" });
    }
});

app.post("/api/attachments/upload", uploadSingleFile, async (req, res) => {
    const authorization = await authorizeRequest(req, res, applicationRoles);
    if (!authorization) return;

    let storedFile: any;
    try {
        const { patientId, resourceType, resourceId } = req.body as Record<string, unknown>;
        if (!req.file || !isValidDocumentId(patientId) || !isValidDocumentId(resourceId)
            || !['patient', 'appointment', 'visit'].includes(String(resourceType))) {
            return res.status(400).json({ error: "Invalid attachment request" });
        }

        const typedResource = resourceType as ResourceType;
        const context = await authorizeAttachmentResource(
            authorization.userProfile,
            patientId,
            typedResource,
            resourceId,
            true
        );
        if (!context) return res.status(403).json({ error: "Attachment access denied" });

        const settings = await getMediaSettings();
        const existingAttachments = Array.isArray(context.resourceData.attachments) ? context.resourceData.attachments : [];
        if (existingAttachments.length >= settings.maxFiles) {
            return res.status(409).json({ error: "Maximum attachment count reached" });
        }
        const extension = getFileExtension(req.file.originalname);
        const detectedType = Object.entries(allowedAttachmentTypes).find(([, rule]) =>
            rule.extensions.includes(extension) && rule.signature(req.file!.buffer)
        )?.[0];
        if (!detectedType || !settings.configuredExtensions.includes(extension)) {
            return res.status(400).json({ error: "File type is not allowed" });
        }
        if (req.file.size > settings.maxBytes) {
            return res.status(400).json({ error: "File exceeds the configured size limit" });
        }
        if (detectedType.startsWith('image/') && req.file.size > Math.min(settings.maxBytes, IMAGE_OPTIMIZATION.maxStoredBytes)) {
            return res.status(400).json({ error: "Image was not optimized below the 500 KB storage limit" });
        }

        const hasPhotoInput = ['photoStage', 'photoTakenAt', 'photoArea'].some(key => req.body[key] !== undefined);
        if (hasPhotoInput && (typedResource !== 'visit' || !detectedType.startsWith('image/'))) {
            return res.status(400).json({ error: 'Photo details are only allowed on Visit images' });
        }
        const photoInput = hasPhotoInput ? parsePhotoInput({
            stage: req.body.photoStage, takenAt: req.body.photoTakenAt, area: req.body.photoArea, note: req.body.note
        }) : null;
        if (typedResource === 'visit' && detectedType.startsWith('image/') && galleryPhotoCount(existingAttachments) >= GALLERY_PHOTO_LIMIT) {
            return res.status(409).json({ error: `Maximum ${GALLERY_PHOTO_LIMIT} photos per Visit reached` });
        }

        const safeName = sanitizeFileName(req.file.originalname);
        const fileId = `${Date.now()}_${randomUUID()}${extension}`;
        const folder = typedResource === 'patient' ? 'general' : `${typedResource}s`;
        const storagePath = `uploads/${patientId}/${folder}/${resourceId}/${fileId}`;
        const note = photoInput?.note ?? (typeof req.body.note === 'string' ? req.body.note.replace(/[\r\n]/g, ' ').trim().slice(0, 500) : '');
        const attachment: { id: string; name: string; storagePath: string; note: string; contentType: string; size: number; uploadedAt: string; uploadedByUid: string; photo?: GalleryPhotoMetadata } = {
            id: fileId,
            name: safeName,
            storagePath,
            note,
            contentType: detectedType,
            size: req.file.size,
            uploadedAt: new Date().toISOString(),
            uploadedByUid: authorization.decodedToken.uid
        };

        const bucket = storageBucket;
        storedFile = bucket.file(storagePath);
        await storedFile.save(req.file.buffer, {
            resumable: false,
            contentType: detectedType,
            metadata: {
                cacheControl: 'private, no-store',
                contentDisposition: `inline; filename="${safeName.replace(/"/g, '')}"`,
                metadata: {
                    patientId,
                    resourceType: typedResource,
                    resourceId,
                    branchId: context.branchId,
                    uploadedByUid: authorization.decodedToken.uid
                }
            }
        });

        await db.runTransaction(async transaction => {
            const { resourceData: data, branchId } = await refreshAttachmentWriteContext(transaction, authorization, patientId, typedResource, resourceId);
            const attachments = Array.isArray(data.attachments) ? data.attachments : [];
            if (attachments.length >= settings.maxFiles) throw new RequestError(409, 'Maximum attachment count reached');
            if (typedResource === 'visit' && isGalleryImage(attachment) && galleryPhotoCount(attachments) >= GALLERY_PHOTO_LIMIT) {
                throw new RequestError(409, `Maximum ${GALLERY_PHOTO_LIMIT} photos per Visit reached`);
            }
            if (photoInput) attachment.photo = {
                schemaVersion: 1, stage: photoInput.stage, takenAt: photoInput.takenAt, area: photoInput.area,
                timezone: await galleryTimezone(transaction, data), version: 1,
                updatedAt: new Date().toISOString(), updatedByUid: authorization.decodedToken.uid
            };
            transaction.update(context.resourceRef, { attachments: [...attachments, attachment] });
            stageAuditLog(transaction, {
                authorization,
                action: 'UPDATE',
                resource: typedResource === 'patient' ? 'Patient' : typedResource === 'appointment' ? 'Appointment' : 'Visit',
                resourceId,
                resourceName: typeof context.patientData.patientID === 'string' ? context.patientData.patientID.slice(0, 80) : '',
                branchId,
                eventType: 'attachment_uploaded'
            });
        });

        res.status(201).json({ attachment });
    } catch (error: any) {
        if (storedFile) await storedFile.delete({ ignoreNotFound: true }).catch(() => undefined);
        console.error("Attachment upload failed", error);
        res.status(error.status || (error instanceof RequestError ? error.status : 500)).json({
            error: error instanceof RequestError || error instanceof GalleryPhotoInputError ? error.message : "Attachment upload failed"
        });
    }
});

app.patch('/api/attachments/photo', async (req, res) => {
    const authorization = await authorizeRequest(req, res, applicationRoles);
    if (!authorization) return;
    try {
        const storagePath = req.body?.storagePath;
        const parsed = parseAttachmentPath(storagePath);
        if (!parsed || parsed.resourceType !== 'visit') throw new RequestError(400, 'Photo details require a Visit attachment');
        const expectedVersion = req.body?.expectedVersion;
        if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new RequestError(400, 'Photo version is required');
        const photoInput = parsePhotoInput(req.body);
        const context = await authorizeAttachmentResource(authorization.userProfile, parsed.patientId, 'visit', parsed.resourceId, true);
        if (!context) throw new RequestError(403, 'Attachment access denied');
        const attachment = await db.runTransaction(async transaction => {
            const { resourceData, resourceRef, branchId, patientData } = await refreshAttachmentWriteContext(transaction, authorization, parsed.patientId, 'visit', parsed.resourceId);
            const attachments = Array.isArray(resourceData.attachments) ? resourceData.attachments : [];
            const index = attachments.findIndex((file: any) => file?.storagePath === storagePath);
            if (index < 0) throw new RequestError(404, 'Attachment is not registered on this record');
            const existing = attachments[index];
            if (!isGalleryImage(existing)) throw new RequestError(400, 'Only image attachments have photo details');
            const currentVersion = existing.photo?.version ?? 0;
            if (currentVersion !== expectedVersion) throw new RequestError(409, 'Photo details changed. Reload the Gallery before saving.');
            const photo: GalleryPhotoMetadata = {
                schemaVersion: 1, stage: photoInput.stage, takenAt: photoInput.takenAt, area: photoInput.area,
                timezone: validGalleryTimezone(existing.photo?.timezone) ? existing.photo.timezone : await galleryTimezone(transaction, resourceData),
                version: currentVersion + 1, updatedAt: new Date().toISOString(), updatedByUid: authorization.decodedToken.uid
            };
            const updated = { ...existing, note: photoInput.note, photo };
            transaction.update(resourceRef, { attachments: attachments.map((file: any, position: number) => position === index ? updated : file) });
            stageAuditLog(transaction, {
                authorization, action: 'UPDATE', resource: 'Visit', resourceId: parsed.resourceId, branchId,
                resourceName: typeof patientData.patientID === 'string' ? patientData.patientID.slice(0, 80) : '',
                eventType: 'attachment_photo_updated', changeFields: ['photo', 'note']
            });
            return updated;
        });
        res.json({ attachment });
    } catch (error: any) {
        if (!(error instanceof RequestError || error instanceof GalleryPhotoInputError)) console.error('Photo details update failed', error);
        res.status(error.status || 500).json({ error: error.status ? error.message : 'Photo details update failed' });
    }
});

app.get("/api/attachments/content", async (req, res) => {
    const authorization = await authorizeRequest(req, res, applicationRoles);
    if (!authorization) return;

    const storagePath = req.query.path;
    const parsed = parseAttachmentPath(storagePath);
    if (!parsed) return res.status(400).json({ error: "Invalid attachment path" });

    const context = await authorizeAttachmentResource(
        authorization.userProfile,
        parsed.patientId,
        parsed.resourceType,
        parsed.resourceId,
        false
    );
    if (!context) return res.status(403).json({ error: "Attachment access denied" });

    const registeredAttachments = Array.isArray(context.resourceData.attachments)
        ? context.resourceData.attachments
        : [];
    if (!registeredAttachments.some((attachment: any) => attachment?.storagePath === storagePath)) {
        return res.status(404).json({ error: "Attachment is not registered on this record" });
    }

    const file = storageBucket.file(storagePath as string);
    try {
        const [metadata] = await file.getMetadata();
        if (metadata.metadata?.patientId && metadata.metadata.patientId !== parsed.patientId) {
            return res.status(403).json({ error: "Attachment metadata mismatch" });
        }
        res.setHeader('Content-Type', metadata.contentType || 'application/octet-stream');
        if (metadata.size) res.setHeader('Content-Length', String(metadata.size));
        res.setHeader('Content-Disposition', req.query.download === '1'
            ? `attachment; filename="${path.basename(file.name).replace(/"/g, '')}"`
            : (metadata.contentDisposition || 'inline'));
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        file.createReadStream()
            .on('error', error => {
                console.error('Attachment stream failed', error);
                if (!res.headersSent) res.status(404).json({ error: 'Attachment not found' });
                else res.destroy(error);
            })
            .pipe(res);
    } catch (error: any) {
        if (error?.code === 404) return res.status(404).json({ error: "Attachment not found" });
        console.error("Attachment download failed", error);
        res.status(500).json({ error: "Attachment download failed" });
    }
});

app.delete("/api/attachments", async (req, res) => {
    const authorization = await authorizeRequest(req, res, applicationRoles);
    if (!authorization) return;

    const storagePath = req.body?.storagePath;
    const parsed = parseAttachmentPath(storagePath);
    if (!parsed) return res.status(400).json({ error: "Invalid attachment path" });

    const context = await authorizeAttachmentResource(
        authorization.userProfile,
        parsed.patientId,
        parsed.resourceType,
        parsed.resourceId,
        true
    );
    if (!context) return res.status(403).json({ error: "Attachment access denied" });

    try {
        await db.runTransaction(async transaction => {
            const { resourceData: data, branchId } = await refreshAttachmentWriteContext(transaction, authorization, parsed.patientId, parsed.resourceType, parsed.resourceId);
            const attachments = Array.isArray(data.attachments) ? data.attachments : [];
            if (!attachments.some((attachment: any) => attachment?.storagePath === storagePath)) {
                throw new Error('Attachment is not registered on this record');
            }
            transaction.update(context.resourceRef, {
                attachments: attachments.filter((attachment: any) => attachment?.storagePath !== storagePath)
            });
            stageAuditLog(transaction, {
                authorization,
                action: 'UPDATE',
                resource: parsed.resourceType === 'patient' ? 'Patient' : parsed.resourceType === 'appointment' ? 'Appointment' : 'Visit',
                resourceId: parsed.resourceId,
                resourceName: typeof context.patientData.patientID === 'string' ? context.patientData.patientID.slice(0, 80) : '',
                branchId,
                eventType: 'attachment_deleted'
            });
        });
        await storageBucket.file(storagePath).delete({ ignoreNotFound: true });
        res.status(204).send();
    } catch (error) {
        console.error("Attachment deletion failed", error);
        res.status((error as any)?.status || 500).json({ error: (error as any)?.status ? (error as Error).message : 'Attachment deletion failed' });
    }
});

app.post("/api/records/patients", async (req, res) => {
    const authorization = await authorizeRequest(req, res, applicationRoles);
    if (!authorization) return;

    try {
        requireRole(authorization.userProfile, auditActionRoles.Patient.CREATE);
        const payload = requestPayload(req);
        assertPatientHistoryMetadata(payload);
        const patient = parsePatientPayload(payload, !hasCapability(authorization.userProfile, 'clinical.view'));
        const branchSnapshot = await db.collection('branches').doc(patient.homeBranchId).get();
        const branchData = branchSnapshot.data() || {};
        if (!branchSnapshot.exists || branchData.status !== 'Active') throw new RequestError(400, 'Branch is not active');
        if (!canAccessBranch(authorization.userProfile, patient.homeBranchId)) throw new RequestError(403, 'Branch access denied');

        const duplicateSnapshot = await db.collection('patients').where('email', '==', patient.email).limit(20).get();
        const duplicate = duplicateSnapshot.docs.some(document => {
            const data = document.data();
            return String(data.name || '').trim().toLowerCase() === patient.name.toLowerCase()
                && String(data.contactNumber || '').trim() === patient.contactNumber
                && patientIdentityKey(data) === patientIdentityKey(patient);
        });
        if (duplicate) throw new RequestError(409, 'A patient with these details already exists');

        const currentYear = new Date().getFullYear() % 100;
        const patientPrefix = `ID-${String(currentYear).padStart(2, '0')}-`;
        const counterRef = db.collection('counters').doc(`patient-${String(currentYear).padStart(2, '0')}`);
        const counterExists = (await counterRef.get()).exists;
        let existingMax = 0;
        if (!counterExists) {
            const existingPatients = await db.collection('patients').get();
            existingMax = existingPatients.docs.reduce((maximum, document) => {
                const patientId = document.data().patientID;
                if (typeof patientId !== 'string' || !patientId.startsWith(patientPrefix)) return maximum;
                return Math.max(maximum, Number.parseInt(patientId.slice(patientPrefix.length), 10) || 0);
            }, 0);
        }
        const patientRef = db.collection('patients').doc();
        const identityRef = db.collection('patient_identity_keys').doc(patientIdentityKey(patient));
        const now = new Date().toISOString();
        const actorName = trustedUserName(authorization);
        let patientID = '';

        await db.runTransaction(async transaction => {
            await refreshSupportAuthorization(transaction, authorization);
            if (!canAccessBranch(authorization.userProfile, patient.homeBranchId)) throw new RequestError(403, 'Branch access denied');
            Object.assign(patient, patientHistoryInput(payload, undefined, authorization.userProfile));
            protectClinicalWrite(authorization.userProfile, patient, {}, false);
            const historyAttribution = patientHistoryAttribution(payload, patient, undefined,
                { uid: authorization.decodedToken.uid, name: trustedUserName(authorization) }, now);
            const [counterSnapshot, latestBranchSnapshot, identitySnapshot] = await Promise.all([
                transaction.get(counterRef),
                transaction.get(db.collection('branches').doc(patient.homeBranchId)),
                transaction.get(identityRef)
            ]);
            const latestBranch = latestBranchSnapshot.data() || {};
            if (!latestBranchSnapshot.exists || latestBranch.status !== 'Active') throw new RequestError(400, 'Branch is not active');
            if (identitySnapshot.exists) throw new RequestError(409, 'A patient with these details already exists');
            const lastNumber = Math.max(Number(counterSnapshot.data()?.lastNumber) || 0, existingMax);
            const nextNumber = lastNumber + 1;
            patientID = `${patientPrefix}${String(nextNumber).padStart(4, '0')}`;
            transaction.set(counterRef, { lastNumber: nextNumber, updatedAt: FieldValue.serverTimestamp() });
            transaction.create(identityRef, {
                patientId: patientRef.id,
                createdAt: FieldValue.serverTimestamp()
            });
            transaction.create(patientRef, {
                ...patient,
                ...historyAttribution,
                patientID,
                homeBranchName: typeof latestBranch.branchName === 'string' ? latestBranch.branchName : '',
                dateRegistered: now,
                attachments: [],
                createdBranchId: patient.homeBranchId,
                createdBranchName: typeof latestBranch.branchName === 'string' ? latestBranch.branchName : '',
                createdByUid: authorization.decodedToken.uid,
                createdByName: actorName,
                createdAt: now,
                createdByUserDefaultBranchId: authorization.userProfile.defaultBranchId || null,
                createdByUserDefaultBranchName: authorization.userProfile.defaultBranchName || null,
                lastUpdatedBranchId: patient.homeBranchId,
                lastUpdatedBranchName: typeof latestBranch.branchName === 'string' ? latestBranch.branchName : '',
                lastUpdatedByUid: authorization.decodedToken.uid,
                lastUpdatedByName: actorName,
                lastUpdatedAt: now
            });
            stageAuditLog(transaction, {
                authorization,
                action: 'CREATE',
                resource: 'Patient',
                resourceId: patientRef.id,
                resourceName: patientID,
                branchId: patient.homeBranchId
            });
        });
        res.status(201).json({ id: patientRef.id, patientID });
    } catch (error) {
        return sendRecordError(res, error, 'Patient creation');
    }
});

app.patch("/api/records/patients/:patientId", async (req, res) => {
    const authorization = await authorizeRequest(req, res, applicationRoles);
    if (!authorization) return;

    try {
        requireRole(authorization.userProfile, auditActionRoles.Patient.UPDATE);
        if (!isValidDocumentId(req.params.patientId)) throw new RequestError(400, 'Invalid patient ID');
        const payload = requestPayload(req);
        assertPatientHistoryMetadata(payload);
        const expectedLastUpdatedAt = typeof payload.expectedLastUpdatedAt === 'string'
            ? payload.expectedLastUpdatedAt
            : null;

        const patientRef = db.collection('patients').doc(req.params.patientId);
        const now = new Date().toISOString();
        const actorName = trustedUserName(authorization);

        await db.runTransaction(async transaction => {
            await refreshSupportAuthorization(transaction, authorization);
            const role = authorization.userProfile.role as string;
            const fullUpdates = role === 'staff' || role === 'manager' ? null : parsePatientPayload(payload, !hasCapability(authorization.userProfile, 'clinical.view') || !hasCapability(authorization.userProfile, 'clinical.edit_draft'));
            const patientSnapshot = await transaction.get(patientRef);
            if (!patientSnapshot.exists) throw new RequestError(404, 'Patient not found');
            const patientData = patientSnapshot.data() || {};
            if (patientData.isArchived === true) throw new RequestError(409, 'Archived patients must be restored before editing');
            const updates = fullUpdates ? { ...fullUpdates } : parseLimitedPatientPayload(
                payload,
                patientData,
                role as 'staff' | 'manager'
            );
            // Earlier clients do not send structured emergency contacts. Omission
            // preserves the current values; explicit empty values still clear them.
            if (fullUpdates) {
                Object.assign(updates, patientHistoryInput(payload, patientData, authorization.userProfile));
                for (const field of ['emergencyContactName', 'emergencyContactRelationship', 'emergencyContactNumber']) {
                    if (!Object.prototype.hasOwnProperty.call(payload, field)) {
                        delete updates[field];
                    }
                }
            }
            protectClinicalWrite(authorization.userProfile, updates, patientData);
            const historyAttribution = patientHistoryAttribution(payload, updates, patientData,
                { uid: authorization.decodedToken.uid, name: trustedUserName(authorization) }, now);
            const targetPatientData = { ...patientData, ...updates };
            const branchRef = db.collection('branches').doc(targetPatientData.homeBranchId);
            const branchSnapshot = await transaction.get(branchRef);
            if (!branchSnapshot.exists) throw new RequestError(400, 'Branch not found');
            const branchData = branchSnapshot.data() || {};
            if (expectedLastUpdatedAt && patientData.lastUpdatedAt !== expectedLastUpdatedAt) {
                throw new RequestError(409, 'This patient was updated by another user. Close the form and try again with the latest record.');
            }
            if (targetPatientData.homeBranchId !== patientData.homeBranchId) {
                if (!canAccessBranch(authorization.userProfile, targetPatientData.homeBranchId)) {
                    throw new RequestError(403, 'Branch access denied');
                }
                if (branchData.status !== 'Active') throw new RequestError(400, 'Branch is not active');
            }
            const oldIdentityRef = db.collection('patient_identity_keys').doc(patientIdentityKey(patientData));
            const newIdentityRef = db.collection('patient_identity_keys').doc(patientIdentityKey(targetPatientData));
            const duplicateQuery = db.collection('patients').where('email', '==', targetPatientData.email).limit(20);
            const newIdentitySnapshot = await transaction.get(newIdentityRef);
            const oldIdentitySnapshot = oldIdentityRef.id === newIdentityRef.id
                ? newIdentitySnapshot
                : await transaction.get(oldIdentityRef);
            const duplicateSnapshot = await transaction.get(duplicateQuery);
            const duplicate = duplicateSnapshot.docs.some(document => {
                if (document.id === patientRef.id) return false;
                const data = document.data();
                return patientIdentityKey(data) === patientIdentityKey(targetPatientData);
            });
            if (duplicate || (newIdentitySnapshot.exists && newIdentitySnapshot.data()?.patientId !== patientRef.id)) {
                throw new RequestError(409, 'A patient with these details already exists');
            }
            const trustedUpdates = {
                ...updates,
                ...historyAttribution,
                homeBranchName: typeof branchData.branchName === 'string' ? branchData.branchName : '',
                lastUpdatedBranchId: targetPatientData.homeBranchId,
                lastUpdatedBranchName: typeof branchData.branchName === 'string' ? branchData.branchName : '',
                lastUpdatedByUid: authorization.decodedToken.uid,
                lastUpdatedByName: actorName,
                lastUpdatedAt: now
            };
            const changedFields = getChangedFieldNames(patientData, updates);
            if (oldIdentityRef.id !== newIdentityRef.id
                && oldIdentitySnapshot.exists
                && oldIdentitySnapshot.data()?.patientId === patientRef.id) {
                transaction.delete(oldIdentityRef);
            }
            transaction.set(newIdentityRef, {
                patientId: patientRef.id,
                updatedAt: FieldValue.serverTimestamp()
            }, { merge: true });
            transaction.update(patientRef, trustedUpdates);
            stageAuditLog(transaction, {
                authorization,
                action: 'UPDATE',
                resource: 'Patient',
                resourceId: patientRef.id,
                resourceName: typeof patientData.patientID === 'string' ? patientData.patientID : '',
                branchId: targetPatientData.homeBranchId,
                changeFields: changedFields
            });
        });
        res.status(200).json({ id: patientRef.id, updatedAt: now });
    } catch (error) {
        return sendRecordError(res, error, 'Patient update');
    }
});

app.post("/api/records/appointments", async (req, res) => {
    const authorization = await authorizeRequest(req, res, applicationRoles);
    if (!authorization) return;

    try {
        requireRole(authorization.userProfile, auditActionRoles.Appointment.CREATE);
        const payload = requestPayload(req);
        const appointment = parseAppointmentPayload(payload);
        const selection = parseAppointmentServiceSelection(payload);
        const specialPrice = parseSpecialPriceCommand(payload);
        parseExpectedPricingRevision(payload);
        assertBookingQuoteServerOwned(payload);
        const appointmentRef = db.collection('appointments').doc();
        const now = new Date().toISOString();
        const actorName = trustedUserName(authorization);

        await db.runTransaction(async transaction => {
            await refreshAppointmentAuthorization(transaction, authorization, 'CREATE');
            protectClinicalWrite(authorization.userProfile, appointment, {}, false);
            if (selection) assertCapability(authorization.userProfile, 'services.view');
            const context = await transactionRecordContext(
                transaction,
                authorization,
                appointment.patientId,
                appointment.branchId,
                appointment.doctorId
            );
            if (context.branchData.status !== 'Active') throw new RequestError(400, 'Branch is not active');
            await assertDoctorAvailability(transaction, appointment.doctorId, appointment.appointmentDate);
            const serviceSnapshot = await appointmentServiceSnapshot(transaction, selection, appointment.branchId);
            const specialPriceUpdates = appointmentSpecialPriceUpdates(specialPrice, { ...appointment, ...serviceSnapshot }, {
                uid: authorization.decodedToken.uid, name: actorName, now
            });
            const bookingQuoteUpdates = await appointmentBookingQuoteUpdates(transaction, selection, specialPrice,
                { ...appointment, ...serviceSnapshot, ...specialPriceUpdates }, {
                    uid: authorization.decodedToken.uid, name: actorName, now
                });
            transaction.create(appointmentRef, {
                ...appointment,
                ...serviceSnapshot,
                ...specialPriceUpdates,
                ...bookingQuoteUpdates,
                patientName: typeof context.patientData.name === 'string' ? context.patientData.name : '',
                attachments: [],
                createdAt: now,
                createdByUid: authorization.decodedToken.uid,
                createdByName: actorName
            });
            stageAuditLog(transaction, {
                authorization,
                action: 'CREATE',
                resource: 'Appointment',
                resourceId: appointmentRef.id,
                resourceName: typeof context.patientData.patientID === 'string' ? context.patientData.patientID : '',
                branchId: appointment.branchId,
                changeFields: [...Object.keys(specialPriceUpdates), ...Object.keys(bookingQuoteUpdates)]
            });
        });
        res.status(201).json({ id: appointmentRef.id });
    } catch (error) {
        return sendRecordError(res, error, 'Appointment creation');
    }
});

app.patch("/api/records/appointments/:appointmentId", async (req, res) => {
    const authorization = await authorizeRequest(req, res, applicationRoles);
    if (!authorization) return;

    try {
        requireRole(authorization.userProfile, auditActionRoles.Appointment.UPDATE);
        if (!isValidDocumentId(req.params.appointmentId)) throw new RequestError(400, 'Invalid appointment ID');
        const payload = requestPayload(req);

        const selection = parseAppointmentServiceSelection(payload);
        const specialPrice = parseSpecialPriceCommand(payload);
        const expectedPricingRevision = parseExpectedPricingRevision(payload);
        assertBookingQuoteServerOwned(payload);
        const appointmentRef = db.collection('appointments').doc(req.params.appointmentId);
        const now = new Date().toISOString();
        const actorName = trustedUserName(authorization);

        await db.runTransaction(async transaction => {
            await refreshAppointmentAuthorization(transaction, authorization, 'UPDATE');
            const appointmentSnapshot = await transaction.get(appointmentRef);
            if (!appointmentSnapshot.exists) throw new RequestError(404, 'Appointment not found');
            const appointmentData = appointmentSnapshot.data() || {};
            const permittedPayload = { ...payload };
            protectClinicalWrite(authorization.userProfile, permittedPayload, appointmentData, false);
            const retainedClinical = hasCapability(authorization.userProfile, 'clinical.view') ? {} : Object.fromEntries([...clinicalWriteFields].filter(field => Object.hasOwn(appointmentData, field)).map(field => [field, appointmentData[field]]));
            const updates = parseAppointmentPayload({ ...retainedClinical, ...permittedPayload }, appointmentData);
            if (appointmentData.isArchived === true) throw new RequestError(409, 'Archived appointments must be restored before editing');
            if (!canAccessBranch(authorization.userProfile, appointmentData.branchId)) {
                throw new RequestError(403, 'Branch access denied');
            }
            if (appointmentData.visitHistoryCreated === true) throw new RequestError(409, 'Appointment is sealed by a visit record');
            protectClinicalWrite(authorization.userProfile, updates, appointmentData, false);
            if (!hasCapability(authorization.userProfile, 'clinical.view')) {
                updates.mainConcern = appointmentData.mainConcern || ''; updates.notes = appointmentData.notes || '';
            }
            if (selection) assertCapability(authorization.userProfile, 'services.view');
            if (authorization.userProfile.role === 'staff') {
                if (updates.status === 'Completed') {
                    throw new RequestError(403, 'Only clinical or administrative roles can complete appointments');
                }
                if (updates.mainConcern !== String(appointmentData.mainConcern || '')
                    || updates.notes !== String(appointmentData.notes || '')) {
                    throw new RequestError(403, 'Staff cannot change clinical appointment notes');
                }
            }
            const context = await transactionRecordContext(
                transaction,
                authorization,
                updates.patientId,
                updates.branchId,
                updates.doctorId
            );
            if (updates.branchId !== appointmentData.branchId && context.branchData.status !== 'Active') {
                throw new RequestError(400, 'Branch is not active');
            }
            await assertDoctorAvailability(transaction, updates.doctorId, updates.appointmentDate, {
                appointmentId: appointmentRef.id
            });
            assertSpecialPriceRevision(specialPrice, expectedPricingRevision, appointmentData);
            const serviceSnapshot = await appointmentServiceSnapshot(transaction, selection, updates.branchId, appointmentData);
            const specialPriceUpdates = appointmentSpecialPriceUpdates(specialPrice, { ...appointmentData, ...updates, ...serviceSnapshot }, {
                uid: authorization.decodedToken.uid, name: actorName, now
            }, appointmentData);
            const bookingQuoteUpdates = await appointmentBookingQuoteUpdates(transaction, selection, specialPrice,
                { ...appointmentData, ...updates, ...serviceSnapshot, ...specialPriceUpdates }, {
                    uid: authorization.decodedToken.uid, name: actorName, now
                }, appointmentData);
            const trustedUpdates: Record<string, unknown> = {
                ...updates,
                ...serviceSnapshot,
                ...specialPriceUpdates,
                ...bookingQuoteUpdates,
                patientName: typeof context.patientData.name === 'string' ? context.patientData.name : '',
                updatedAt: now,
                updatedByUid: authorization.decodedToken.uid,
                updatedByName: actorName
            };
            if (updates.status !== appointmentData.status) {
                trustedUpdates.lastStatusChangedAt = now;
                trustedUpdates.lastStatusChangedByUid = authorization.decodedToken.uid;
                trustedUpdates.lastStatusChangedByName = actorName;
            }
            const changedFields = getChangedFieldNames(appointmentData, { ...updates, ...serviceSnapshot, ...specialPriceUpdates, ...bookingQuoteUpdates });
            transaction.update(appointmentRef, trustedUpdates);
            stageAuditLog(transaction, {
                authorization,
                action: 'UPDATE',
                resource: 'Appointment',
                resourceId: appointmentRef.id,
                resourceName: typeof context.patientData.patientID === 'string' ? context.patientData.patientID : '',
                branchId: updates.branchId,
                changeFields: changedFields
            });
        });
        res.status(200).json({ id: appointmentRef.id });
    } catch (error) {
        return sendRecordError(res, error, 'Appointment update');
    }
});

app.post("/api/records/visits", async (req, res) => {
    const authorization = await authorizeRequest(req, res, applicationRoles);
    if (!authorization) return;

    try {
        requireRole(authorization.userProfile, auditActionRoles.Visit.CREATE);
        const payload = requestPayload(req);
        const visit = parseVisitPayload(payload);
        const selection = parseAppointmentServiceSelection(payload);
        const specialPriceCommand = parseVisitSpecialPriceCommand(payload);
        const hasSessionUsage = Object.hasOwn(payload, 'sessionUsage');
        const clientVisitId = payload.clientVisitId;
        if ((hasSessionUsage || clientVisitId !== undefined) && (typeof clientVisitId !== 'string'
            || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientVisitId))) {
            throw new RequestError(400, 'A valid clientVisitId is required for retry-safe session usage');
        }
        const creationIntent = clientVisitId ? visitCreationIntent(payload) : undefined;
        const visitRef = db.collection('visits').doc(clientVisitId ? String(clientVisitId).toLowerCase() : undefined);
        let alreadyCreated = false;
        let savedVersion = 1;
        const now = new Date().toISOString();
        const actorName = trustedUserName(authorization);

        await db.runTransaction(async transaction => {
            await refreshVisitAuthorization(transaction, authorization, 'CREATE');
            if (!canAccessBranch(authorization.userProfile, visit.branchId)) throw new RequestError(403, 'Branch access denied');
            if (clientVisitId) {
                const existing = (await transaction.get(visitRef)).data();
                if (existing) {
                    if (existing.createdByUid !== authorization.decodedToken.uid
                        || existing.creationIntentHash !== creationIntent || existing.isArchived === true) {
                        throw new RequestError(409, 'This Visit retry identity belongs to another or changed record. Reload the saved Visit.');
                    }
                    if (!canAccessBranch(authorization.userProfile, existing.branchId)) throw new RequestError(403, 'Branch access denied');
                    assertVisitDoctorOwnership(authorization, optionalDoctorId(existing.doctorId));
                    if (hasSessionUsage) {
                        for (const permission of ['treatment_ledger.view', 'patients.view', 'visits.view'] as const) {
                            assertCapability(authorization.userProfile, permission);
                        }
                    }
                    const currentPatient = (await transaction.get(db.collection('patients').doc(existing.patientId))).data();
                    if (!currentPatient) throw new RequestError(404, 'Patient not found');
                    if (currentPatient.isArchived === true) throw new RequestError(409, 'Patient is archived');
                    if (existing.creationRecordHash !== visitCreatedRecordIntent(existing) || isVisitClinicallySealed(existing)) {
                        throw new TreatmentLedgerError(409, 'CREATE_RETRY_CHANGED', 'This Visit was already saved and has since changed. Reload Visit history to review the saved record.');
                    }
                    savedVersion = visitVersion(existing) ?? nextVisitVersion(existing);
                    alreadyCreated = true;
                    return;
                }
            }
            if (selection) assertCapability(authorization.userProfile, 'services.view');
            await applyVisitPerformer(transaction, payload, visit);
            assertVisitDoctorOwnership(authorization, visit.doctorId);
            const context = await transactionRecordContext(
                transaction,
                authorization,
                visit.patientId,
                visit.branchId,
                visit.doctorId
            );
            if (context.branchData.status !== 'Active') throw new RequestError(400, 'Branch is not active');

            let linkedAppointmentRef: DocumentReference | null = null;
            let linkedAppointmentData: Record<string, any> | undefined;
            if (visit.appointmentId) {
                linkedAppointmentRef = db.collection('appointments').doc(visit.appointmentId);
                const appointmentSnapshot = await transaction.get(linkedAppointmentRef);
                if (!appointmentSnapshot.exists) throw new RequestError(404, 'Linked appointment not found');
                const appointmentData = appointmentSnapshot.data() || {};
                if (appointmentData.isArchived === true) throw new RequestError(409, 'Linked appointment is archived');
                if (!canAccessBranch(authorization.userProfile, appointmentData.branchId)) {
                    throw new RequestError(403, 'Appointment access denied');
                }
                assertExpectedBookingContext(payload, appointmentData);
                linkedAppointmentData = appointmentData;
                if (appointmentData.visitHistoryCreated === true) throw new RequestError(409, 'A visit already exists for this appointment');
                if (appointmentData.patientId !== visit.patientId
                    || appointmentData.branchId !== visit.branchId
                    || !matchesLinkedAppointmentDoctor(appointmentData, visit)
                    || normalizeLocalDateTime(String(appointmentData.appointmentDate || '')) !== visit.visitDate) {
                    throw new RequestError(409, 'Visit details do not match the linked appointment');
                }
            }

            await assertVisitDoctorAvailability(transaction, visit, {
                appointmentId: visit.appointmentId
            });
            await applyVisitServiceSelection(transaction, selection, payload, visit);
            Object.assign(visit, await visitPriceQuoteUpdates(transaction, selection, specialPriceCommand, visit,
                { uid: authorization.decodedToken.uid, name: actorName, now }, undefined, linkedAppointmentData));
            await applyVisitSessionUsage(transaction, { identity: authorization.decodedToken, profile: authorization.userProfile },
                visitRef.id, visit, payload.sessionUsage);
            const visitSource = linkedAppointmentRef ? 'Appointment' : 'Walk-In';
            transaction.create(visitRef, {
                ...visit,
                visitVersion: savedVersion,
                ...(creationIntent ? { creationIntentHash: creationIntent, creationRecordHash: visitCreatedRecordIntent({ ...visit, visitSource }) } : {}),
                visitSource,
                patientName: typeof context.patientData.name === 'string' ? context.patientData.name : '',
                attachments: [],
                createdAt: now,
                createdBy: actorName,
                createdByUid: authorization.decodedToken.uid,
                updatedAt: now,
                updatedBy: actorName,
                updatedByUid: authorization.decodedToken.uid
            });
            if (linkedAppointmentRef) {
                transaction.update(linkedAppointmentRef, {
                    visitHistoryId: visitRef.id,
                    visitHistoryCreated: true,
                    status: 'Completed',
                    updatedAt: now,
                    updatedByUid: authorization.decodedToken.uid,
                    updatedByName: actorName,
                    lastStatusChangedAt: now,
                    lastStatusChangedByUid: authorization.decodedToken.uid,
                    lastStatusChangedByName: actorName
                });
            }
            const totalVisits = Number(context.patientData.totalVisits) || 0;
            const totalCompletedVisits = Number(context.patientData.totalCompletedVisits) || 0;
            transaction.update(context.patientRef, {
                lastVisitDate: visit.visitDate,
                lastVisitBranch: typeof context.branchData.branchName === 'string' ? context.branchData.branchName : '',
                totalVisits: totalVisits + 1,
                totalCompletedVisits: totalCompletedVisits + 1,
                currentPatientStatus: 'Completed',
                ...(totalVisits === 0 ? { firstVisitDate: visit.visitDate } : {})
            });
            stageAuditLog(transaction, {
                authorization,
                action: 'CREATE',
                resource: 'Visit',
                resourceId: visitRef.id,
                resourceName: typeof context.patientData.patientID === 'string' ? context.patientData.patientID : '',
                branchId: visit.branchId,
                changeFields: ['performedByUserId', ...visitPerformerSnapshotFields, 'assistingStaffText', 'visitQuote']
            });
            if (linkedAppointmentRef) {
                stageAuditLog(transaction, {
                    authorization,
                    action: 'UPDATE',
                    resource: 'Appointment',
                    resourceId: linkedAppointmentRef.id,
                    resourceName: typeof context.patientData.patientID === 'string' ? context.patientData.patientID : '',
                    branchId: visit.branchId,
                    changeFields: ['visitHistoryId', 'visitHistoryCreated', 'status'],
                    eventType: 'appointment_completed_from_visit'
                });
            }
        });
        res.status(alreadyCreated ? 200 : 201).json({ id: visitRef.id, visitVersion: savedVersion });
    } catch (error) {
        return sendRecordError(res, error, 'Visit creation');
    }
});

app.patch("/api/records/visits/:visitId", async (req, res) => {
    const authorization = await authorizeRequest(req, res, applicationRoles);
    if (!authorization) return;

    try {
        requireRole(authorization.userProfile, auditActionRoles.Visit.UPDATE);
        if (!isValidDocumentId(req.params.visitId)) throw new RequestError(400, 'Invalid visit ID');
        const payload = requestPayload(req);
        const selection = parseAppointmentServiceSelection(payload);
        const specialPriceCommand = parseVisitSpecialPriceCommand(payload);
        if (Object.hasOwn(payload, 'clientVisitId')) throw new RequestError(400, 'clientVisitId is only valid when creating a Visit');
        const visitRef = db.collection('visits').doc(req.params.visitId);
        const now = new Date().toISOString();
        const actorName = trustedUserName(authorization);
        let savedVersion = 0;

        await db.runTransaction(async transaction => {
            await refreshVisitAuthorization(transaction, authorization, 'UPDATE');
            if (selection) assertCapability(authorization.userProfile, 'services.view');
            const visitSnapshot = await transaction.get(visitRef);
            if (!visitSnapshot.exists) throw new RequestError(404, 'Visit not found');
            const visitData = visitSnapshot.data() || {};
            if (visitData.isArchived === true) throw new RequestError(409, 'Archived visits must be restored before editing');
            if (isVisitClinicallySealed(visitData)) throw new RequestError(409, 'Signed or finalized visits are read-only; no amendment workflow is configured.');
            const updates = parseVisitPayload(payload, visitData);
            if (authorization.userProfile.role === 'doctor'
                && visitData.doctorId !== authorization.decodedToken.uid) {
                throw new RequestError(403, 'Doctors can only update their own visit records');
            }
            if (!canAccessBranch(authorization.userProfile, visitData.branchId)) {
                throw new RequestError(403, 'Branch access denied');
            }
            if (!canAccessBranch(authorization.userProfile, updates.branchId)) throw new RequestError(403, 'Branch access denied');
            if (updates.patientId !== visitData.patientId) throw new RequestError(409, 'A visit cannot be moved to another patient');
            if (updates.appointmentId !== (visitData.appointmentId || null)) {
                throw new RequestError(409, 'The linked appointment cannot be changed');
            }
            savedVersion = assertVisitSaveVersion(payload, visitData);
            await applyVisitPerformer(transaction, payload, updates, visitData);
            assertVisitDoctorOwnership(authorization, updates.doctorId);
            const prospectiveVisit = { ...visitData, ...updates };
            const context = await transactionRecordContext(
                transaction,
                authorization,
                updates.patientId,
                updates.branchId,
                updates.doctorId,
                updates.doctorId === optionalDoctorId(visitData.doctorId)
                    && updates.branchId === visitData.branchId && updates.visitDate === visitData.visitDate
            );
            if (updates.branchId !== visitData.branchId && context.branchData.status !== 'Active') {
                throw new RequestError(400, 'Branch is not active');
            }
            if (updates.appointmentId) {
                const appointmentSnapshot = await transaction.get(
                    db.collection('appointments').doc(updates.appointmentId)
                );
                const appointmentData = appointmentSnapshot.data() || {};
                if (!appointmentSnapshot.exists
                    || appointmentData.patientId !== updates.patientId
                    || appointmentData.branchId !== updates.branchId
                    || !matchesLinkedAppointmentDoctor(appointmentData, prospectiveVisit)
                    || normalizeLocalDateTime(String(appointmentData.appointmentDate || '')) !== updates.visitDate
                    || appointmentData.visitHistoryId !== visitRef.id) {
                    throw new RequestError(409, 'Visit details must remain consistent with the linked appointment');
                }
            }
            await assertVisitDoctorAvailability(transaction, prospectiveVisit, {
                appointmentId: updates.appointmentId,
                visitId: visitRef.id
            });

            await applyVisitServiceSelection(transaction, selection, payload, updates, visitData);
            Object.assign(updates, await visitPriceQuoteUpdates(transaction, selection, specialPriceCommand,
                { ...visitData, ...updates }, { uid: authorization.decodedToken.uid, name: actorName, now }, visitData));
            await applyVisitSessionUsage(transaction, { identity: authorization.decodedToken, profile: authorization.userProfile },
                visitRef.id, { ...visitData, ...updates }, payload.sessionUsage, visitData);
            const visitsSnapshot = await transaction.get(
                db.collection('visits').where('patientId', '==', updates.patientId)
            );
            const prospectiveVisits = visitsSnapshot.docs.map(document =>
                document.id === visitRef.id ? { ...visitData, ...updates } : document.data()
            ).filter(item => item.isArchived !== true);
            const chronologicalVisits = prospectiveVisits
                .filter(item => isValidLocalDateTime(item.visitDate))
                .sort((left, right) => left.visitDate.localeCompare(right.visitDate));
            const firstVisit = chronologicalVisits[0];
            const lastVisit = chronologicalVisits[chronologicalVisits.length - 1];
            let lastVisitBranchName = '';
            if (lastVisit?.branchId === updates.branchId) {
                lastVisitBranchName = typeof context.branchData.branchName === 'string' ? context.branchData.branchName : '';
            } else if (isValidDocumentId(lastVisit?.branchId)) {
                const lastBranchSnapshot = await transaction.get(db.collection('branches').doc(lastVisit.branchId));
                lastVisitBranchName = typeof lastBranchSnapshot.data()?.branchName === 'string'
                    ? lastBranchSnapshot.data()!.branchName
                    : '';
            }
            const trustedUpdates = {
                ...updates,
                visitVersion: savedVersion,
                visitSource: updates.appointmentId ? 'Appointment' : 'Walk-In',
                patientName: typeof context.patientData.name === 'string' ? context.patientData.name : '',
                updatedAt: now,
                updatedBy: actorName,
                updatedByUid: authorization.decodedToken.uid
            };
            const changedFields = getChangedFieldNames(visitData, updates);
            transaction.update(visitRef, trustedUpdates);
            transaction.update(context.patientRef, {
                totalVisits: prospectiveVisits.length,
                totalCompletedVisits: prospectiveVisits.filter(item => item.status === 'Completed').length,
                totalNoShowVisits: prospectiveVisits.filter(item => item.status === 'No Show').length,
                firstVisitDate: firstVisit?.visitDate || null,
                lastVisitDate: lastVisit?.visitDate || null,
                lastVisitBranch: lastVisitBranchName,
                currentPatientStatus: lastVisit?.status || null
            });
            stageAuditLog(transaction, {
                authorization,
                action: 'UPDATE',
                resource: 'Visit',
                resourceId: visitRef.id,
                resourceName: typeof context.patientData.patientID === 'string' ? context.patientData.patientID : '',
                branchId: updates.branchId,
                changeFields: changedFields
            });
        });
        res.status(200).json({ id: visitRef.id, visitVersion: savedVersion });
    } catch (error) {
        return sendRecordError(res, error, 'Visit update');
    }
});

app.delete("/api/records/:kind/:recordId", async (req, res) => {
    const authorization = await authorizeRequest(req, res, applicationRoles);
    if (!authorization) return;

    try {
        if (!isRecordKind(req.params.kind)) throw new RequestError(404, 'Unknown record type');
        if (!isValidDocumentId(req.params.recordId)) throw new RequestError(400, 'Invalid record ID');
        const config = archiveRecordConfig[req.params.kind];
        requireRole(authorization.userProfile, auditActionRoles[config.resource].DELETE);
        const reason = parseArchiveReason(requestPayload(req));
        const recordRef = db.collection(req.params.kind).doc(req.params.recordId);
        const now = new Date().toISOString();
        const actorName = trustedUserName(authorization);

        await db.runTransaction(async transaction => {
            await refreshSupportAuthorization(transaction, authorization);
            const recordSnapshot = await transaction.get(recordRef);
            if (!recordSnapshot.exists) throw new RequestError(404, `${config.resource} not found`);
            const recordData = recordSnapshot.data() || {};
            if (!canAccessBranch(authorization.userProfile, recordData[config.branchField])) throw new RequestError(403, 'Branch access denied');
            if (recordData.isArchived === true) throw new RequestError(409, `${config.resource} is already archived`);

            if (req.params.kind === 'patients') {
                const [appointments, visits] = await Promise.all([
                    transaction.get(db.collection('appointments').where('patientId', '==', recordRef.id)),
                    transaction.get(db.collection('visits').where('patientId', '==', recordRef.id))
                ]);
                const hasActiveHistory = [...appointments.docs, ...visits.docs]
                    .some(document => document.data().isArchived !== true);
                if (hasActiveHistory) {
                    throw new RequestError(409, 'Archive this patient’s appointments and visits before archiving the patient');
                }
            }

            let visitSummary: Record<string, unknown> | null = null;
            if (req.params.kind === 'visits' && isValidDocumentId(recordData.patientId)) {
                visitSummary = await patientVisitSummary(transaction, recordData.patientId, {
                    visitId: recordRef.id,
                    isArchived: true
                });
            }

            let resourceName = typeof recordData.patientID === 'string' ? recordData.patientID : '';
            if (!resourceName && isValidDocumentId(recordData.patientId)) {
                const patientSnapshot = await transaction.get(db.collection('patients').doc(recordData.patientId));
                resourceName = typeof patientSnapshot.data()?.patientID === 'string'
                    ? patientSnapshot.data()!.patientID
                    : '';
            }

            transaction.update(recordRef, {
                isArchived: true,
                ...(req.params.kind === 'visits' ? { visitVersion: nextVisitVersion(recordData) } : {}),
                archivedAt: now,
                archivedByUid: authorization.decodedToken.uid,
                archivedByName: actorName,
                archiveReason: reason,
                updatedAt: now
            });
            if (visitSummary && isValidDocumentId(recordData.patientId)) {
                transaction.update(db.collection('patients').doc(recordData.patientId), visitSummary);
            }
            stageAuditLog(transaction, {
                authorization,
                action: 'DELETE',
                resource: config.resource,
                resourceId: recordRef.id,
                resourceName,
                branchId: typeof recordData[config.branchField] === 'string' ? recordData[config.branchField] : null,
                changeFields: ['isArchived', 'archivedAt', 'archiveReason'],
                eventType: 'record_archived',
                reason
            });
        });
        res.status(200).json({ id: recordRef.id, archivedAt: now });
    } catch (error) {
        return sendRecordError(res, error, 'Record archive');
    }
});

app.post("/api/records/:kind/:recordId/restore", async (req, res) => {
    const authorization = await authorizeRequest(req, res, applicationRoles);
    if (!authorization) return;

    try {
        if (!isRecordKind(req.params.kind)) throw new RequestError(404, 'Unknown record type');
        if (!isValidDocumentId(req.params.recordId)) throw new RequestError(400, 'Invalid record ID');
        const config = archiveRecordConfig[req.params.kind];
        requireRole(authorization.userProfile, auditActionRoles[config.resource].DELETE);
        const recordRef = db.collection(req.params.kind).doc(req.params.recordId);
        const now = new Date().toISOString();
        const actorName = trustedUserName(authorization);

        await db.runTransaction(async transaction => {
            await refreshSupportAuthorization(transaction, authorization);
            const recordSnapshot = await transaction.get(recordRef);
            if (!recordSnapshot.exists) throw new RequestError(404, `${config.resource} not found`);
            const recordData = recordSnapshot.data() || {};
            if (!canAccessBranch(authorization.userProfile, recordData[config.branchField])) throw new RequestError(403, 'Branch access denied');
            if (recordData.isArchived !== true) throw new RequestError(409, `${config.resource} is not archived`);

            if (req.params.kind === 'appointments') {
                await assertDoctorAvailability(transaction, recordData.doctorId, recordData.appointmentDate, {
                    appointmentId: recordRef.id
                });
            }
            if (req.params.kind === 'visits') {
                await assertVisitDoctorAvailability(transaction, recordData, {
                    appointmentId: recordData.appointmentId || null,
                    visitId: recordRef.id
                });
            }

            let visitSummary: Record<string, unknown> | null = null;
            if (req.params.kind === 'visits' && isValidDocumentId(recordData.patientId)) {
                visitSummary = await patientVisitSummary(transaction, recordData.patientId, {
                    visitId: recordRef.id,
                    isArchived: false
                });
            }

            let resourceName = typeof recordData.patientID === 'string' ? recordData.patientID : '';
            if (!resourceName && isValidDocumentId(recordData.patientId)) {
                const patientSnapshot = await transaction.get(db.collection('patients').doc(recordData.patientId));
                resourceName = typeof patientSnapshot.data()?.patientID === 'string'
                    ? patientSnapshot.data()!.patientID
                    : '';
            }

            transaction.update(recordRef, {
                isArchived: false,
                ...(req.params.kind === 'visits' ? { visitVersion: nextVisitVersion(recordData) } : {}),
                archivedAt: FieldValue.delete(),
                archivedByUid: FieldValue.delete(),
                archivedByName: FieldValue.delete(),
                archiveReason: FieldValue.delete(),
                restoredAt: now,
                restoredByUid: authorization.decodedToken.uid,
                restoredByName: actorName,
                updatedAt: now
            });
            if (visitSummary && isValidDocumentId(recordData.patientId)) {
                transaction.update(db.collection('patients').doc(recordData.patientId), visitSummary);
            }
            stageAuditLog(transaction, {
                authorization,
                action: 'UPDATE',
                resource: config.resource,
                resourceId: recordRef.id,
                resourceName,
                branchId: typeof recordData[config.branchField] === 'string' ? recordData[config.branchField] : null,
                changeFields: ['isArchived', 'restoredAt'],
                eventType: 'record_restored'
            });
        });
        res.status(200).json({ id: recordRef.id, restoredAt: now });
    } catch (error) {
        return sendRecordError(res, error, 'Record restore');
    }
});

app.get("/api/patients", async (req, res) => {
    console.log("Request to /api/patients");
    const authorization = await authorizeRequest(req, res, applicationRoles);
    if (!authorization) return;

    try {
        console.log("Fetching patients");
        const snapshot = await db.runTransaction(async transaction => {
            await refreshSupportAuthorization(transaction, authorization);
            return transaction.get(db.collection('patients'));
        });
        const patients = snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }) as Record<string, any> & { id: string })
            .filter(patient => patient.isArchived !== true);

        res.setHeader('Cache-Control', 'no-store');
        res.json(patients.map(patient => redactClinicalData('patients', patient, authorization.userProfile)));
    } catch (error) {
        return sendRecordError(res, error, 'Patient directory');
    }
});

app.use('/api', (_req, res) => { res.status(404).json({ error: 'API endpoint not found' }); });
app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = error?.type === 'entity.too.large' ? 413 : error?.type === 'entity.parse.failed' ? 400 : 500;
  res.status(status).json({ error: status === 413 ? 'Request is too large' : status === 400 ? 'Invalid JSON request' : 'Request failed' });
});

// Vite middleware development/production
async function startServer() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (process.env.NODE_ENV === 'production' && (!process.env.APP_URL?.startsWith('https://') || !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)) throw new Error('Production HTTPS APP_URL and Google OAuth credentials are required');
  await pool.query('SELECT 1 FROM app_records LIMIT 1');
  console.log("Starting PostgreSQL-backed server...");
  if (process.env.NODE_ENV !== "production") {
    console.log("Running in development mode...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Running in production mode...");
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath, { index: false }));
    app.get('*', async (req, res) => {
      try {
        const [indexTemplate, brandingSnapshot] = await Promise.all([
          readFile(path.join(distPath, 'index.html'), 'utf8'),
          db.collection('settings').doc('branding').get(),
        ]);
        const branding = brandingSnapshot.data() || {};
        const escapeHtml = (value: unknown) => String(value || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
        const rawAppName = branding.appName || 'Patient Management App';
        const appName = escapeHtml(rawAppName);
        const browserTitle = escapeHtml(branding.browserTitle || rawAppName);
        const metaTags = [
          `<meta name="application-name" content="${appName}">`,
          `<meta name="apple-mobile-web-app-title" content="${escapeHtml(branding.appShortName || branding.appName || 'Patient App')}">`,
          `<meta name="theme-color" content="${escapeHtml(branding.primaryColor || '#0d9488')}">`,
          branding.faviconUrl ? `<link rel="icon" href="${escapeHtml(branding.faviconUrl)}">` : '',
        ].filter(Boolean).join('\n    ');
        const brandedIndex = indexTemplate
          .replace(/<title>.*?<\/title>/i, `<title>${browserTitle}</title>`)
          .replace('</head>', `    ${metaTags}\n  </head>`);
        res.type('html').send(brandedIndex);
      } catch (error) {
        console.error('Failed to render branded app shell:', error);
        res.sendFile(path.join(distPath, 'index.html'));
      }
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
  server.requestTimeout = 60_000;
  server.headersTimeout = 65_000;
  let stopping = false;
  const stop = () => {
    if (stopping) return; stopping = true;
    const deadline = setTimeout(() => process.exit(1), 30_000); deadline.unref();
    server.close(() => { void pool.end().then(() => process.exit(0)); });
  };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
}

if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.cjs')) {
  startServer().catch(error => { console.error('Server startup failed:', error.message); process.exit(1); });
}
