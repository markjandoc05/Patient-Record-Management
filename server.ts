import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import multer from "multer";
import { createHash, randomUUID } from "crypto";
import { readFile } from "fs/promises";

import firebaseConfig from "./firebase-applet-config.json";
import { canEditPatient, hasPermission, RBAC, Role } from "./src/rbac";
import { IMAGE_OPTIMIZATION, normalizeMediaSettings } from "./src/mediaSettings";
import { AuditAction, AuditResource, shouldRecordAuditEvent } from "./src/auditPolicy";
import { getDeveloperActivityDefinition } from "./src/developerToolsPolicy";
import { describeLoginUserAgent, shouldRecordLoginActivity } from "./src/loginActivityPolicy";

// Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp({
         credential: admin.credential.applicationDefault(),
         projectId: firebaseConfig.projectId,
         storageBucket: firebaseConfig.storageBucket
    });
}

const app = express();
app.use(express.json());
app.use((_req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex');
    next();
});
const PORT = Number(process.env.PORT) || 3000;
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024, files: 1 }
});
const uploadSingleFile: express.RequestHandler = (req, res, next) => {
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
const db = getFirestore(admin.app(), firebaseConfig.firestoreDatabaseId);
const applicationRoles = Object.keys(RBAC) as Role[];
const globalBranchRoles = new Set(['admin', 'support_developer']);
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
    const forwarded = req.headers['x-forwarded-for'];
    const candidate = typeof forwarded === 'string'
        ? forwarded.split(',')[0]?.trim()
        : Array.isArray(forwarded) ? forwarded[0]?.split(',')[0]?.trim() : '';
    const rawIp = candidate || req.socket.remoteAddress || '';
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
    patient: ['admin', 'doctor', 'support_developer'],
    appointment: applicationRoles,
    visit: ['admin', 'doctor', 'support_developer']
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
    return typeof userProfile.role === 'string'
        && attachmentWriteRoles[resourceType].includes(userProfile.role);
}

async function authorizeAttachmentResource(
    userProfile: Record<string, any>,
    patientId: string,
    resourceType: ResourceType,
    resourceId: string,
    requireWrite: boolean
) {
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
    // Patient identity and longitudinal history are shared across clinics.
    // Writes to an appointment or visit remain scoped to its operating branch.
    if (requireWrite && resourceType !== 'patient' && !canAccessBranch(userProfile, resourceBranchId)) return null;

    return { patientRef, resourceRef, patientData, resourceData, branchId: resourceBranchId };
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
    return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(firebaseConfig.storageBucket)}/o/${encodeURIComponent(storagePath)}?alt=media`;
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
    'expectedLastUpdatedAt'
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
    const birthday = String(patient.birthday || '');
    return createHash('sha256')
        .update([normalizedName, normalizedContact, normalizedEmail, birthday].join('\u001f'))
        .digest('hex');
}

function getChangedFieldNames(before: Record<string, any>, updates: Record<string, any>) {
    return Object.keys(updates).filter(field => JSON.stringify(before[field]) !== JSON.stringify(updates[field]));
}

function trustedUserName(authorization: { decodedToken: admin.auth.DecodedIdToken, userProfile: Record<string, any> }) {
    return typeof authorization.userProfile.fullName === 'string'
        ? authorization.userProfile.fullName.slice(0, 120)
        : authorization.decodedToken.email || 'Unknown User';
}

function requireRole(userProfile: Record<string, any>, allowedRoles: readonly string[]) {
    if (typeof userProfile.role !== 'string' || !allowedRoles.includes(userProfile.role)) {
        throw new RequestError(403, 'Insufficient permissions');
    }
}

async function assertDoctorAvailability(
    transaction: admin.firestore.Transaction,
    doctorId: string,
    dateTime: string,
    exclusions: { appointmentId?: string | null, visitId?: string | null } = {}
) {
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
        && document.data().doctorId === doctorId
        && document.data().isArchived !== true
        && document.data().status !== 'Cancelled'
        && document.data().appointmentId !== exclusions.appointmentId
        && typeof document.data().visitDate === 'string'
        && normalizeLocalDateTime(document.data().visitDate) === normalizeLocalDateTime(dateTime)
    );
    if (appointmentConflict || visitConflict) throw new RequestError(409, 'Doctor already has a booking at this time');
}

function sendRecordError(res: express.Response, error: unknown, operation: string) {
    if (error instanceof RequestError) return res.status(error.status).json({ error: error.message });
    console.error(`${operation} failed`, error);
    return res.status(500).json({ error: `${operation} failed` });
}

function requestPayload(req: express.Request) {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        throw new RequestError(400, 'Invalid request body');
    }
    return req.body as Record<string, unknown>;
}

function parsePatientPayload(payload: Record<string, unknown>): Record<string, any> {
    const data = cleanRecordText(payload, patientTextLimits);
    requireRecordFields(data, ['name', 'contactNumber', 'email', 'gender', 'address', 'mainConcern']);
    if (!isValidDocumentId(payload.homeBranchId)) throw new RequestError(400, 'homeBranchId is required');
    if (!isValidDate(payload.birthday)) throw new RequestError(400, 'Invalid birthday');
    if (data.name.length < 2) throw new RequestError(400, 'Patient name is too short');
    const contactDigits = data.contactNumber.replace(/\D/g, '');
    if (contactDigits.length < 7 || contactDigits.length > 15) throw new RequestError(400, 'Invalid contact number');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) throw new RequestError(400, 'Invalid email address');
    if (!['Male', 'Female', 'Other'].includes(data.gender)) throw new RequestError(400, 'Invalid gender');
    if (!patientStatuses.has(data.status || 'Active')) throw new RequestError(400, 'Invalid patient status');
    return {
        ...data,
        email: data.email.toLowerCase(),
        birthday: payload.birthday,
        age: calculateAge(payload.birthday),
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
    const parsed = parsePatientPayload(mergedPayload);
    const result: Record<string, any> = {
        name: parsed.name,
        contactNumber: parsed.contactNumber,
        email: parsed.email,
        birthday: parsed.birthday,
        age: parsed.age,
        gender: parsed.gender,
        address: parsed.address,
        emergencyContact: parsed.emergencyContact
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
    transaction: admin.firestore.Transaction,
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

function parseAppointmentPayload(payload: Record<string, unknown>): Record<string, any> {
    const data = cleanRecordText(payload, appointmentTextLimits);
    if (!isValidDocumentId(payload.patientId)) throw new RequestError(400, 'patientId is required');
    if (!isValidDocumentId(payload.branchId)) throw new RequestError(400, 'branchId is required');
    if (!isValidDocumentId(payload.doctorId)) throw new RequestError(400, 'doctorId is required');
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
        doctorId: payload.doctorId,
        appointmentDate: normalizeLocalDateTime(payload.appointmentDate)
    };
}

function parseVisitPayload(payload: Record<string, unknown>): Record<string, any> {
    const data = cleanRecordText(payload, visitTextLimits);
    if (!isValidDocumentId(payload.patientId)) throw new RequestError(400, 'patientId is required');
    if (!isValidDocumentId(payload.branchId)) throw new RequestError(400, 'branchId is required');
    if (!isValidDocumentId(payload.doctorId)) throw new RequestError(400, 'doctorId is required');
    if (!isValidLocalDateTime(payload.visitDate)) throw new RequestError(400, 'Invalid visit date');
    requireRecordFields(data, ['visitType']);
    if (!visitTypes.has(data.visitType)) throw new RequestError(400, 'Invalid visit type');
    if (payload.appointmentId !== null && payload.appointmentId !== undefined
        && !isValidDocumentId(payload.appointmentId)) {
        throw new RequestError(400, 'Invalid appointmentId');
    }
    if (data.nextVisitDate && !isValidDate(data.nextVisitDate)) throw new RequestError(400, 'Invalid follow-up date');
    return {
        ...data,
        patientId: payload.patientId,
        branchId: payload.branchId,
        doctorId: payload.doctorId,
        visitDate: normalizeLocalDateTime(payload.visitDate),
        appointmentId: (payload.appointmentId || null) as string | null,
        followUpRequired: payload.followUpRequired === true,
        status: 'Completed'
    };
}

async function transactionRecordContext(
    transaction: admin.firestore.Transaction,
    authorization: { decodedToken: admin.auth.DecodedIdToken, userProfile: Record<string, any> },
    patientId: string,
    branchId: string,
    doctorId: string
) {
    const patientRef = db.collection('patients').doc(patientId);
    const branchRef = db.collection('branches').doc(branchId);
    const doctorRef = db.collection('users').doc(doctorId);
    const [patientSnapshot, branchSnapshot, doctorSnapshot] = await Promise.all([
        transaction.get(patientRef),
        transaction.get(branchRef),
        transaction.get(doctorRef)
    ]);
    if (!patientSnapshot.exists) throw new RequestError(404, 'Patient not found');
    if (!branchSnapshot.exists) throw new RequestError(400, 'Branch not found');
    const patientData = patientSnapshot.data() || {};
    const branchData = branchSnapshot.data() || {};
    const doctorData = doctorSnapshot.data() || {};
    if (!canAccessBranch(authorization.userProfile, branchId)) {
        throw new RequestError(403, 'Branch access denied');
    }
    if (patientData.isArchived === true) throw new RequestError(409, 'Patient is archived');
    if (!doctorSnapshot.exists || doctorData.active !== true || doctorData.role !== 'doctor'
        || !Array.isArray(doctorData.assignedBranches) || !doctorData.assignedBranches.includes(branchId)) {
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
    authorization: { decodedToken: admin.auth.DecodedIdToken, userProfile: Record<string, any> };
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
        recordedAt: admin.firestore.FieldValue.serverTimestamp(),
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
    transaction: admin.firestore.Transaction,
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
    authorization: { decodedToken: admin.auth.DecodedIdToken, userProfile: Record<string, any> },
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
        || !auditActionRoles[resource][action as Exclude<AuditAction, 'AUTH'>].includes(role)) {
        return null;
    }

    const collectionName = resource === 'Patient' ? 'patients' : resource === 'Appointment' ? 'appointments' : 'visits';
    const snapshot = await db.collection(collectionName).doc(resourceId).get();
    if (!snapshot.exists) {
        return action === 'DELETE' && hasGlobalAccess ? { branchId: null, resourceName: '' } : null;
    }
    const data = snapshot.data() || {};
    const branchId = resource === 'Patient' ? data.homeBranchId : data.branchId;
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
        const decodedToken = await admin.auth().verifyIdToken(match[1]);
        if ((decodedToken as any).firebase?.sign_in_provider !== 'google.com') {
            res.status(403).json({ error: 'Google sign-in is required' });
            return null;
        }
        const userSnapshot = await db.collection("users").doc(decodedToken.uid).get();
        const userProfile = userSnapshot.data();

        if (!userSnapshot.exists || userProfile?.active !== true) {
            res.status(403).json({ error: "Account is not approved or active" });
            return null;
        }

        if (typeof userProfile.role !== 'string' || !allowedRoles.includes(userProfile.role)) {
            res.status(403).json({ error: "Insufficient permissions" });
            return null;
        }

        return { decodedToken, userProfile };
    } catch (error) {
        console.error("Request authentication failed", error);
        res.status(401).json({ error: "Unauthorized" });
        return null;
    }
}

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
    authorization: { decodedToken: admin.auth.DecodedIdToken, userProfile: Record<string, any> },
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
            recordedAt: admin.firestore.FieldValue.serverTimestamp(),
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
    const authorization = await authorizeRequest(req, res, ['admin', 'support_developer']);
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
    authorization: { decodedToken: admin.auth.DecodedIdToken, userProfile: Record<string, any> },
    userId: string,
    targetProfile: Record<string, any>
) {
    if (authorization.decodedToken.uid === userId) {
        throw new RequestError(403, 'You cannot manage your own account with this action');
    }
    if (authorization.userProfile.role === 'admin' && targetProfile.role === 'support_developer') {
        throw new RequestError(403, 'Administrators cannot manage Support / Developer accounts');
    }
}

async function getManagedUser(
    authorization: { decodedToken: admin.auth.DecodedIdToken, userProfile: Record<string, any> },
    userId: string
) {
    if (!isValidDocumentId(userId)) throw new RequestError(400, 'Invalid user ID');
    const userRef = db.collection('users').doc(userId);
    const snapshot = await userRef.get();
    if (!snapshot.exists) throw new RequestError(404, 'User account not found');
    const targetProfile = snapshot.data() || {};
    canManageUserTarget(authorization, userId, targetProfile);
    return { userRef, targetProfile };
}

// User archive/delete operations intentionally never touch clinical records or
// prior audit events. Archive retains the profile for later restoration; delete
// removes only the authentication identity and current user profile.
app.post('/api/users/:userId/archive', async (req, res) => {
    const authorization = await authorizeRequest(req, res, ['admin', 'support_developer']);
    if (!authorization) return;

    try {
        const { userRef, targetProfile } = await getManagedUser(authorization, req.params.userId);
        if (targetProfile.isArchived === true) throw new RequestError(409, 'User account is already archived');
        const now = new Date().toISOString();
        await db.runTransaction(async transaction => {
            transaction.update(userRef, {
                active: false,
                isArchived: true,
                accountStatus: 'archived',
                archivedAt: now,
                archivedByUid: authorization.decodedToken.uid,
                archivedByName: trustedUserName(authorization)
            });
            transaction.set(db.collection('audit_logs').doc(), buildAuditLogData({
                authorization,
                action: 'UPDATE',
                resource: 'User',
                resourceId: userRef.id,
                eventType: 'user_archived',
                changeFields: ['active', 'isArchived', 'accountStatus']
            }));
        });
        await admin.auth().revokeRefreshTokens(userRef.id).catch(error => {
            if (error?.code !== 'auth/user-not-found') throw error;
        });
        res.status(200).json({ id: userRef.id, archivedAt: now });
    } catch (error) {
        return sendRecordError(res, error, 'User archive');
    }
});

app.post('/api/users/:userId/restore', async (req, res) => {
    const authorization = await authorizeRequest(req, res, ['admin', 'support_developer']);
    if (!authorization) return;

    try {
        const { userRef, targetProfile } = await getManagedUser(authorization, req.params.userId);
        if (targetProfile.isArchived !== true) throw new RequestError(409, 'Only archived user accounts can be restored');
        const now = new Date().toISOString();
        await db.runTransaction(async transaction => {
            transaction.update(userRef, {
                active: true,
                isArchived: false,
                accountStatus: 'active',
                archivedAt: admin.firestore.FieldValue.delete(),
                archivedByUid: admin.firestore.FieldValue.delete(),
                archivedByName: admin.firestore.FieldValue.delete(),
                restoredAt: now,
                restoredByUid: authorization.decodedToken.uid,
                restoredByName: trustedUserName(authorization)
            });
            transaction.set(db.collection('audit_logs').doc(), buildAuditLogData({
                authorization,
                action: 'UPDATE',
                resource: 'User',
                resourceId: userRef.id,
                eventType: 'user_restored',
                changeFields: ['active', 'isArchived', 'accountStatus']
            }));
        });
        res.status(200).json({ id: userRef.id, restoredAt: now });
    } catch (error) {
        return sendRecordError(res, error, 'User restore');
    }
});

app.post('/api/users/:userId/activate', async (req, res) => {
    const authorization = await authorizeRequest(req, res, ['admin', 'support_developer']);
    if (!authorization) return;

    try {
        const { userRef, targetProfile } = await getManagedUser(authorization, req.params.userId);
        if (targetProfile.isArchived === true) throw new RequestError(409, 'Archived users must be restored before activation');
        if (targetProfile.active === true) throw new RequestError(409, 'User account is already active');
        const now = new Date().toISOString();
        await db.runTransaction(async transaction => {
            transaction.update(userRef, {
                active: true,
                accountStatus: 'active',
                activatedAt: now,
                activatedByUid: authorization.decodedToken.uid,
                activatedByName: trustedUserName(authorization)
            });
            transaction.set(db.collection('audit_logs').doc(), buildAuditLogData({
                authorization,
                action: 'UPDATE',
                resource: 'User',
                resourceId: userRef.id,
                eventType: 'user_activated',
                changeFields: ['active', 'accountStatus']
            }));
        });
        res.status(200).json({ id: userRef.id, activatedAt: now });
    } catch (error) {
        return sendRecordError(res, error, 'User activation');
    }
});

app.post('/api/users/:userId/deactivate', async (req, res) => {
    const authorization = await authorizeRequest(req, res, ['admin', 'support_developer']);
    if (!authorization) return;

    try {
        const { userRef, targetProfile } = await getManagedUser(authorization, req.params.userId);
        if (targetProfile.isArchived === true) throw new RequestError(409, 'Archived user accounts are already inactive');
        if (targetProfile.active !== true) throw new RequestError(409, 'User account is already inactive');
        const now = new Date().toISOString();
        await db.runTransaction(async transaction => {
            transaction.update(userRef, {
                active: false,
                accountStatus: 'inactive',
                deactivatedAt: now,
                deactivatedByUid: authorization.decodedToken.uid,
                deactivatedByName: trustedUserName(authorization)
            });
            transaction.set(db.collection('audit_logs').doc(), buildAuditLogData({
                authorization,
                action: 'UPDATE',
                resource: 'User',
                resourceId: userRef.id,
                eventType: 'user_deactivated',
                changeFields: ['active', 'accountStatus']
            }));
        });
        await admin.auth().revokeRefreshTokens(userRef.id).catch(error => {
            if (error?.code !== 'auth/user-not-found') throw error;
        });
        res.status(200).json({ id: userRef.id, deactivatedAt: now });
    } catch (error) {
        return sendRecordError(res, error, 'User deactivation');
    }
});

app.delete('/api/users/:userId', async (req, res) => {
    const authorization = await authorizeRequest(req, res, ['admin', 'support_developer']);
    if (!authorization) return;

    try {
        const { userRef } = await getManagedUser(authorization, req.params.userId);
        await db.runTransaction(async transaction => {
            transaction.delete(userRef);
            // This audit entry is intentionally written in the same transaction
            // as the profile deletion and is retained after the account is gone.
            transaction.set(db.collection('audit_logs').doc(), buildAuditLogData({
                authorization,
                action: 'DELETE',
                resource: 'User',
                resourceId: userRef.id,
                eventType: 'user_deleted'
            }));
        });
        await admin.auth().deleteUser(userRef.id).catch(error => {
            if (error?.code !== 'auth/user-not-found') throw error;
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
    const authorization = await authorizeRequest(req, res, ['support_developer']);
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
    const authorization = await authorizeRequest(req, res, ['support_developer']);
    if (!authorization) return;
    if (!authorizeDeveloperRequest(authorization, res)) return;

    try {
        const startedAt = Date.now();
        await db.collection('settings').doc('branding').get();
        const firestoreLatencyMs = Date.now() - startedAt;
        await db.collection('audit_logs').add(buildAuditLogData({
            authorization,
            action: 'VIEW',
            resource: 'Settings',
            resourceId: 'developer_diagnostics',
            eventType: 'developer_diagnostics_run'
        }));
        res.json({ firestoreLatencyMs, serverTime: new Date().toISOString() });
    } catch (error) {
        console.error('Developer diagnostics failed', error);
        res.status(500).json({ error: 'Developer diagnostics failed' });
    }
});

app.post('/api/developer/maintenance', async (req, res) => {
    const authorization = await authorizeRequest(req, res, ['support_developer']);
    if (!authorization) return;
    if (!authorizeDeveloperRequest(authorization, res)) return;

    try {
        const payload = requestPayload(req);
        if (typeof payload.maintenanceMode !== 'boolean') {
            throw new RequestError(400, 'maintenanceMode must be true or false');
        }
        const brandingRef = db.collection('settings').doc('branding');
        await db.runTransaction(async transaction => {
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
    const authorization = await authorizeRequest(req, res, ['support_developer']);
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
    const authorization = await authorizeRequest(req, res, ['admin', 'support_developer']);
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
        const bucket = admin.storage().bucket(firebaseConfig.storageBucket);
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

        const safeName = sanitizeFileName(req.file.originalname);
        const fileId = `${Date.now()}_${randomUUID()}${extension}`;
        const folder = typedResource === 'patient' ? 'general' : `${typedResource}s`;
        const storagePath = `uploads/${patientId}/${folder}/${resourceId}/${fileId}`;
        const note = typeof req.body.note === 'string' ? req.body.note.replace(/[\r\n]/g, ' ').trim().slice(0, 500) : '';
        const attachment = {
            id: fileId,
            name: safeName,
            storagePath,
            note,
            contentType: detectedType,
            size: req.file.size,
            uploadedAt: new Date().toISOString(),
            uploadedByUid: authorization.decodedToken.uid
        };

        const bucket = admin.storage().bucket(firebaseConfig.storageBucket);
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
            const snapshot = await transaction.get(context.resourceRef);
            if (!snapshot.exists) throw new Error('Attachment resource no longer exists');
            const data = snapshot.data() || {};
            const branchId = typedResource === 'patient' ? data.homeBranchId : data.branchId;
            if ((typedResource !== 'patient' && data.patientId !== patientId)
                || (typedResource !== 'patient' && !canAccessBranch(authorization.userProfile, branchId))) {
                throw new Error('Attachment access changed');
            }
            const attachments = Array.isArray(data.attachments) ? data.attachments : [];
            if (attachments.length >= settings.maxFiles) throw new RequestError(409, 'Maximum attachment count reached');
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
        res.status(error instanceof RequestError ? error.status : 500).json({
            error: error instanceof RequestError ? error.message : "Attachment upload failed"
        });
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

    const file = admin.storage().bucket(firebaseConfig.storageBucket).file(storagePath as string);
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
            const snapshot = await transaction.get(context.resourceRef);
            if (!snapshot.exists) throw new Error('Attachment resource no longer exists');
            const data = snapshot.data() || {};
            const branchId = parsed.resourceType === 'patient' ? data.homeBranchId : data.branchId;
            if ((parsed.resourceType !== 'patient' && data.patientId !== parsed.patientId)
                || (parsed.resourceType !== 'patient' && !canAccessBranch(authorization.userProfile, branchId))) {
                throw new Error('Attachment access changed');
            }
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
        await admin.storage().bucket(firebaseConfig.storageBucket).file(storagePath).delete({ ignoreNotFound: true });
        res.status(204).send();
    } catch (error) {
        console.error("Attachment deletion failed", error);
        res.status(500).json({ error: "Attachment deletion failed" });
    }
});

app.post("/api/records/patients", async (req, res) => {
    const authorization = await authorizeRequest(req, res, applicationRoles);
    if (!authorization) return;

    try {
        requireRole(authorization.userProfile, auditActionRoles.Patient.CREATE);
        const patient = parsePatientPayload(requestPayload(req));
        const branchSnapshot = await db.collection('branches').doc(patient.homeBranchId).get();
        const branchData = branchSnapshot.data() || {};
        if (!branchSnapshot.exists || branchData.status !== 'Active') throw new RequestError(400, 'Branch is not active');
        if (!canAccessBranch(authorization.userProfile, patient.homeBranchId)) throw new RequestError(403, 'Branch access denied');

        const duplicateSnapshot = await db.collection('patients').where('email', '==', patient.email).limit(20).get();
        const duplicate = duplicateSnapshot.docs.some(document => {
            const data = document.data();
            return String(data.name || '').trim().toLowerCase() === patient.name.toLowerCase()
                && String(data.contactNumber || '').trim() === patient.contactNumber
                && data.birthday === patient.birthday;
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
            transaction.set(counterRef, { lastNumber: nextNumber, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
            transaction.create(identityRef, {
                patientId: patientRef.id,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
            transaction.create(patientRef, {
                ...patient,
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
        const expectedLastUpdatedAt = typeof payload.expectedLastUpdatedAt === 'string'
            ? payload.expectedLastUpdatedAt
            : null;
        const role = authorization.userProfile.role as string;
        const fullUpdates = role === 'staff' || role === 'manager' ? null : parsePatientPayload(payload);
        const patientRef = db.collection('patients').doc(req.params.patientId);
        const now = new Date().toISOString();
        const actorName = trustedUserName(authorization);

        await db.runTransaction(async transaction => {
            const patientSnapshot = await transaction.get(patientRef);
            if (!patientSnapshot.exists) throw new RequestError(404, 'Patient not found');
            const patientData = patientSnapshot.data() || {};
            if (patientData.isArchived === true) throw new RequestError(409, 'Archived patients must be restored before editing');
            const updates = fullUpdates || parseLimitedPatientPayload(
                payload,
                patientData,
                role as 'staff' | 'manager'
            );
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
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
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
        const appointment = parseAppointmentPayload(requestPayload(req));
        const appointmentRef = db.collection('appointments').doc();
        const now = new Date().toISOString();
        const actorName = trustedUserName(authorization);

        await db.runTransaction(async transaction => {
            const context = await transactionRecordContext(
                transaction,
                authorization,
                appointment.patientId,
                appointment.branchId,
                appointment.doctorId
            );
            if (context.branchData.status !== 'Active') throw new RequestError(400, 'Branch is not active');
            await assertDoctorAvailability(transaction, appointment.doctorId, appointment.appointmentDate);
            transaction.create(appointmentRef, {
                ...appointment,
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
                branchId: appointment.branchId
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
        const updates = parseAppointmentPayload(requestPayload(req));
        const appointmentRef = db.collection('appointments').doc(req.params.appointmentId);
        const now = new Date().toISOString();
        const actorName = trustedUserName(authorization);

        await db.runTransaction(async transaction => {
            const appointmentSnapshot = await transaction.get(appointmentRef);
            if (!appointmentSnapshot.exists) throw new RequestError(404, 'Appointment not found');
            const appointmentData = appointmentSnapshot.data() || {};
            if (appointmentData.isArchived === true) throw new RequestError(409, 'Archived appointments must be restored before editing');
            if (!canAccessBranch(authorization.userProfile, appointmentData.branchId)) {
                throw new RequestError(403, 'Branch access denied');
            }
            if (appointmentData.visitHistoryCreated === true) throw new RequestError(409, 'Appointment is sealed by a visit record');
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
            const trustedUpdates: Record<string, unknown> = {
                ...updates,
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
            const changedFields = getChangedFieldNames(appointmentData, updates);
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
        const visit = parseVisitPayload(requestPayload(req));
        if (authorization.userProfile.role === 'doctor'
            && visit.doctorId !== authorization.decodedToken.uid) {
            throw new RequestError(403, 'Doctors can only create their own visit records');
        }
        const visitRef = db.collection('visits').doc();
        const now = new Date().toISOString();
        const actorName = trustedUserName(authorization);

        await db.runTransaction(async transaction => {
            const context = await transactionRecordContext(
                transaction,
                authorization,
                visit.patientId,
                visit.branchId,
                visit.doctorId
            );
            if (context.branchData.status !== 'Active') throw new RequestError(400, 'Branch is not active');

            let linkedAppointmentRef: admin.firestore.DocumentReference | null = null;
            if (visit.appointmentId) {
                linkedAppointmentRef = db.collection('appointments').doc(visit.appointmentId);
                const appointmentSnapshot = await transaction.get(linkedAppointmentRef);
                if (!appointmentSnapshot.exists) throw new RequestError(404, 'Linked appointment not found');
                const appointmentData = appointmentSnapshot.data() || {};
                if (appointmentData.isArchived === true) throw new RequestError(409, 'Linked appointment is archived');
                if (!canAccessBranch(authorization.userProfile, appointmentData.branchId)) {
                    throw new RequestError(403, 'Appointment access denied');
                }
                if (appointmentData.visitHistoryCreated === true) throw new RequestError(409, 'A visit already exists for this appointment');
                if (appointmentData.patientId !== visit.patientId
                    || appointmentData.branchId !== visit.branchId
                    || appointmentData.doctorId !== visit.doctorId
                    || normalizeLocalDateTime(String(appointmentData.appointmentDate || '')) !== visit.visitDate) {
                    throw new RequestError(409, 'Visit details do not match the linked appointment');
                }
            }

            await assertDoctorAvailability(transaction, visit.doctorId, visit.visitDate, {
                appointmentId: visit.appointmentId
            });
            const visitSource = linkedAppointmentRef ? 'Appointment' : 'Walk-In';
            transaction.create(visitRef, {
                ...visit,
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
                branchId: visit.branchId
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
        res.status(201).json({ id: visitRef.id });
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
        const updates = parseVisitPayload(requestPayload(req));
        if (authorization.userProfile.role === 'doctor'
            && updates.doctorId !== authorization.decodedToken.uid) {
            throw new RequestError(403, 'Doctors can only update their own visit records');
        }
        const visitRef = db.collection('visits').doc(req.params.visitId);
        const now = new Date().toISOString();
        const actorName = trustedUserName(authorization);

        await db.runTransaction(async transaction => {
            const visitSnapshot = await transaction.get(visitRef);
            if (!visitSnapshot.exists) throw new RequestError(404, 'Visit not found');
            const visitData = visitSnapshot.data() || {};
            if (visitData.isArchived === true) throw new RequestError(409, 'Archived visits must be restored before editing');
            if (authorization.userProfile.role === 'doctor'
                && visitData.doctorId !== authorization.decodedToken.uid) {
                throw new RequestError(403, 'Doctors can only update their own visit records');
            }
            if (!canAccessBranch(authorization.userProfile, visitData.branchId)) {
                throw new RequestError(403, 'Branch access denied');
            }
            if (updates.patientId !== visitData.patientId) throw new RequestError(409, 'A visit cannot be moved to another patient');
            if (updates.appointmentId !== (visitData.appointmentId || null)) {
                throw new RequestError(409, 'The linked appointment cannot be changed');
            }
            const context = await transactionRecordContext(
                transaction,
                authorization,
                updates.patientId,
                updates.branchId,
                updates.doctorId
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
                    || appointmentData.doctorId !== updates.doctorId
                    || normalizeLocalDateTime(String(appointmentData.appointmentDate || '')) !== updates.visitDate
                    || appointmentData.visitHistoryId !== visitRef.id) {
                    throw new RequestError(409, 'Visit details must remain consistent with the linked appointment');
                }
            }
            await assertDoctorAvailability(transaction, updates.doctorId, updates.visitDate, {
                appointmentId: updates.appointmentId,
                visitId: visitRef.id
            });

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
        res.status(200).json({ id: visitRef.id });
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
            const recordSnapshot = await transaction.get(recordRef);
            if (!recordSnapshot.exists) throw new RequestError(404, `${config.resource} not found`);
            const recordData = recordSnapshot.data() || {};
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
            const recordSnapshot = await transaction.get(recordRef);
            if (!recordSnapshot.exists) throw new RequestError(404, `${config.resource} not found`);
            const recordData = recordSnapshot.data() || {};
            if (recordData.isArchived !== true) throw new RequestError(409, `${config.resource} is not archived`);

            if (req.params.kind === 'appointments') {
                await assertDoctorAvailability(transaction, recordData.doctorId, recordData.appointmentDate, {
                    appointmentId: recordRef.id
                });
            }
            if (req.params.kind === 'visits') {
                await assertDoctorAvailability(transaction, recordData.doctorId, recordData.visitDate, {
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
                archivedAt: admin.firestore.FieldValue.delete(),
                archivedByUid: admin.firestore.FieldValue.delete(),
                archivedByName: admin.firestore.FieldValue.delete(),
                archiveReason: admin.firestore.FieldValue.delete(),
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
        const snapshot = await db.collection("patients").get();
        const patients = snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }) as Record<string, any> & { id: string })
            .filter(patient => patient.isArchived !== true);

        res.json(patients);
    } catch (error) {
        console.error("Error in /api/patients", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// Vite middleware development/production
async function startServer() {
  console.log("Starting server...");
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
