import { Router } from "express";
import { authRouter } from "./auth.routes.ts";
import { adminRouter } from "./admin.routes.ts";
import { googleRouter } from "./google.routes.ts";
import { folderRouter } from "./folder.routes.ts";
import { storageRouter } from "./storage.routes.ts";
import { syncRouter } from "./sync.routes.ts";
import { mountRouter } from "./mount.routes.ts";
import { trashRouter } from "./trash.routes.ts";
import { shareRouter } from "./share.routes.ts";
import { runAuthSelfTest } from "../tests/auth.test.ts";
import { runDatabaseSelfTest } from "../db/test-db.ts";
import { runGoogleDriveSelfTest } from "../tests/google.test.ts";
import { runFolderSelfTest } from "../tests/folder.test.ts";
import { runStorageSelfTest } from "../tests/storage.test.ts";
import { runSyncSelfTest } from "../tests/sync.test.ts";

export const apiRouter = Router();

apiRouter.use("/auth", authRouter);
apiRouter.use("/admin", adminRouter);
apiRouter.use("/google", googleRouter);
apiRouter.use("/folders", folderRouter);
apiRouter.use("/storage", storageRouter);
apiRouter.use("/sync", syncRouter);
apiRouter.use("/mounts", mountRouter);
apiRouter.use("/trash", trashRouter);
apiRouter.use("/shares", shareRouter);

// Health check endpoint
apiRouter.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    app: "Centralized File Upload & Google Drive Sync",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
});

// Self-Test Endpoint for automated verification
apiRouter.get("/test/self-test", async (req, res) => {
  const dbTest = await runDatabaseSelfTest();
  const authTest = await runAuthSelfTest();
  const googleTest = await runGoogleDriveSelfTest();
  const folderTest = await runFolderSelfTest();
  const storageTest = await runStorageSelfTest();
  const syncTest = await runSyncSelfTest();

  res.status(200).json({
    success:
      dbTest.success &&
      authTest.success &&
      googleTest.success &&
      folderTest.success &&
      storageTest.success &&
      syncTest.success,
    database: dbTest,
    auth: authTest,
    googleDrive: googleTest,
    folder: folderTest,
    storage: storageTest,
    sync: syncTest,
  });
});

// Fallback 404 handler for any unmapped /api routes
apiRouter.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    error: `Endpoint API tidak ditemukan: ${req.method} ${req.originalUrl}`,
  });
});

// Global API error handler
apiRouter.use((err: any, req: any, res: any, next: any) => {
  console.error("[API Error Handler]", err);
  if (res.headersSent) {
    return next(err);
  }
  const statusCode = err.status || err.statusCode || (err.name === "MulterError" ? 400 : 500);
  let errorMessage = err.message || "Terjadi kesalahan internal pada server.";

  if (err.code === "LIMIT_FILE_SIZE") {
    errorMessage = "Ukuran berkas melebihi batas maksimal yang diizinkan (500MB).";
  } else if (err.code === "LIMIT_FILE_COUNT") {
    errorMessage = "Jumlah berkas melebihi batas maksimal per unggahan (50 berkas).";
  } else if (err.code === "LIMIT_UNEXPECTED_FILE") {
    errorMessage = `Field berkas tidak valid: ${err.field || "berkas"}`;
  }

  res.status(statusCode).json({
    success: false,
    error: errorMessage,
    code: err.code || "API_ERROR",
  });
});






