import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import multer from "multer";
import { randomUUID } from "crypto";

import firebaseConfig from "./firebase-applet-config.json";

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
const applicationRoles = ['admin', 'manager', 'staff', 'doctor', 'support_developer'] as const;
const globalBranchRoles = new Set(['admin', 'support_developer']);
const firestoreInLimit = 30;

function getAssignedBranchIds(userProfile: Record<string, unknown>) {
    if (!Array.isArray(userProfile.assignedBranches)) return [];
    return [...new Set(userProfile.assignedBranches.filter(
        (branchId): branchId is string => typeof branchId === 'string' && branchId.length > 0
    ))];
}

function chunk<T>(values: T[], size: number) {
    const chunks: T[][] = [];
    for (let index = 0; index < values.length; index += size) {
        chunks.push(values.slice(index, index + size));
    }
    return chunks;
}

type ResourceType = 'patient' | 'appointment' | 'visit';

const resourceCollections: Record<ResourceType, string> = {
    patient: 'patients',
    appointment: 'appointments',
    visit: 'visits'
};

const attachmentWriteRoles: Record<ResourceType, readonly string[]> = {
    patient: ['admin', 'manager', 'doctor', 'support_developer'],
    appointment: applicationRoles,
    visit: ['admin', 'manager', 'doctor', 'support_developer']
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
    if (resourceType === 'patient' && resourceId !== patientId) return null;
    if (resourceType !== 'patient' && resourceData.patientId !== patientId) return null;

    const patientBranchId = patientData.homeBranchId;
    const resourceBranchId = resourceType === 'patient' ? patientBranchId : resourceData.branchId;
    if (!canAccessBranch(userProfile, patientBranchId) || !canAccessBranch(userProfile, resourceBranchId)) return null;

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
    const data = snapshot.data() || {};
    const configuredExtensions = Array.isArray(data.allowedExtensions)
        ? data.allowedExtensions.filter((value: unknown): value is string => typeof value === 'string').map(value => value.toLowerCase())
        : ['.png', '.jpg', '.pdf'];
    const maxFileSizeMB = Math.min(Math.max(Number(data.maxFileSizeMB) || 1, 0.1), 10);
    const maxFiles = Math.min(Math.max(Number(data.maxFilesPerAppointment) || 5, 1), 20);
    return { configuredExtensions, maxBytes: Math.floor(maxFileSizeMB * 1024 * 1024), maxFiles };
}

function publicStorageUrl(storagePath: string) {
    return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(firebaseConfig.storageBucket)}/o/${encodeURIComponent(storagePath)}?alt=media`;
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
                || !canAccessBranch(authorization.userProfile, branchId)) {
                throw new Error('Attachment access changed');
            }
            const attachments = Array.isArray(data.attachments) ? data.attachments : [];
            if (attachments.length >= settings.maxFiles) throw new Error('Maximum attachment count reached');
            transaction.update(context.resourceRef, { attachments: [...attachments, attachment] });
        });

        res.status(201).json({ attachment });
    } catch (error: any) {
        if (storedFile) await storedFile.delete({ ignoreNotFound: true }).catch(() => undefined);
        console.error("Attachment upload failed", error);
        res.status(500).json({ error: error?.message === 'Maximum attachment count reached' ? error.message : "Attachment upload failed" });
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
                || !canAccessBranch(authorization.userProfile, branchId)) {
                throw new Error('Attachment access changed');
            }
            const attachments = Array.isArray(data.attachments) ? data.attachments : [];
            if (!attachments.some((attachment: any) => attachment?.storagePath === storagePath)) {
                throw new Error('Attachment is not registered on this record');
            }
            transaction.update(context.resourceRef, {
                attachments: attachments.filter((attachment: any) => attachment?.storagePath !== storagePath)
            });
        });
        await admin.storage().bucket(firebaseConfig.storageBucket).file(storagePath).delete({ ignoreNotFound: true });
        res.status(204).send();
    } catch (error) {
        console.error("Attachment deletion failed", error);
        res.status(500).json({ error: "Attachment deletion failed" });
    }
});

app.get("/api/patients", async (req, res) => {
    console.log("Request to /api/patients");
    const authorization = await authorizeRequest(req, res, applicationRoles);
    if (!authorization) return;

    try {
        console.log("Fetching patients");
        const role = authorization.userProfile.role as string;
        let patients: Array<{ id: string } & Record<string, unknown>>;

        if (globalBranchRoles.has(role)) {
            const snapshot = await db.collection("patients").get();
            patients = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } else {
            const assignedBranchIds = getAssignedBranchIds(authorization.userProfile);
            if (assignedBranchIds.length === 0) {
                return res.json([]);
            }

            const snapshots = await Promise.all(
                chunk(assignedBranchIds, firestoreInLimit).map(branchIds =>
                    db.collection("patients").where("homeBranchId", "in", branchIds).get()
                )
            );
            const patientsById = new Map<string, { id: string } & Record<string, unknown>>();
            snapshots.forEach(snapshot => snapshot.docs.forEach(doc => {
                patientsById.set(doc.id, { id: doc.id, ...doc.data() });
            }));
            patients = [...patientsById.values()];
        }

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
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
