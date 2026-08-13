import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import multer from "multer";

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
const PORT = 3000;
const upload = multer({ storage: multer.memoryStorage() });
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

// API routes - Proxy for Firebase
app.post("/api/upload-image", upload.single('file'), async (req, res) => {
    console.log("Entering /api/upload-image API route");
    const authorization = await authorizeRequest(req, res, applicationRoles);
    if (!authorization) return;

    try {
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });

        const { path: storagePath } = req.body;
        if (!storagePath) return res.status(400).json({ error: "No path specified" });

        console.log("Firebase config for storageBucket:", firebaseConfig.storageBucket);
        const bucket = admin.storage().bucket(firebaseConfig.storageBucket);
        console.log("Bucket object:", bucket);
        console.log("Bucket name:", bucket.name);
        const file = bucket.file(storagePath);

        console.log("File path for upload:", storagePath);
        
        try {
            console.log("Saving file...");
            await file.save(req.file.buffer, {
                contentType: req.file.mimetype,
                metadata: {
                    uploadedByUid: authorization.decodedToken.uid
                }
            });
            console.log("File saved successfully");
        } catch (storageError: any) {
            console.error("Firebase Storage write error message:", storageError.message);
            console.error("Firebase Storage write error code:", storageError.code);
            throw storageError; // Re-throw to be caught by the outer catch
        }
        console.log("File saved successfully");


        const [url] = await file.getSignedUrl({
            action: 'read',
            expires: '03-01-2500' // Far future
        });

        res.json({ downloadUrl: url, storagePath });
    } catch (error: any) {
        console.error("Final Error in /api/upload-image:", error);
        res.status(500).json({ error: "Internal Server Error", details: String(error.message || "Unknown error") });
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
