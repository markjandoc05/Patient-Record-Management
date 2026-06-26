import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import admin from "firebase-admin";
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

// API routes - Proxy for Firebase
app.post("/api/upload-image", upload.single('file'), async (req, res) => {
    console.log("Entering /api/upload-image API route");
    const authorization = req.headers.authorization;
    if (!authorization) return res.status(401).json({ error: "Unauthorized" });
    const idToken = authorization.split("Bearer ")[1];
    if (!idToken) return res.status(401).json({ error: "Unauthorized" });

    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
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
                    uploadedByUid: decodedToken.uid
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
    // Authenticate user
    const authorization = req.headers.authorization;
    if (!authorization) {
        console.log("No authorization header");
        return res.status(401).json({ error: "Unauthorized" });
    }
    const idToken = authorization.split("Bearer ")[1];
    if (!idToken) {
        console.log("No idToken");
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        console.log("Verifying token");
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        console.log("Token verified", decodedToken.uid);
        const user = await admin.firestore().collection("users").doc(decodedToken.uid).get();
        const userData = user.data();
        
        // Example check: Manager or Admin can view all
        // For now, let's just return all patients - refinement needed for role-based
        console.log("Fetching patients");
        const snapshot = await admin.firestore().collection("patients").get();
        const patients = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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
