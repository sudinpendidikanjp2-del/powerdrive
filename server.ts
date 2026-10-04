import { database, describeDatabaseUrl } from "./server/config/env.ts";
import express from "express";
import path from "path";
import cookieParser from "cookie-parser";
import { createServer as createViteServer } from "vite";
import { apiRouter } from "./server/routes/index.ts";
import { db, prisma } from "./server/db/index.ts";
import { SyncEngineService } from "./server/services/sync-engine.service.ts";
import { PreviewService } from "./server/services/preview.service.ts";

const PORT = 3000;

async function connectDatabase() {
  const target = describeDatabaseUrl(database.url);
  if (database.isFallback) console.log(`[Database] DATABASE_URL is not set; using local database ${target}`);
  try {
    await prisma.$connect();
  } catch (err: any) {
    console.error(`\n[Database] Cannot connect to ${target}`);
    console.error(`  ${String(err?.message || err).trim().split("\n").pop()}`);
    console.error("\n  To start a local PostgreSQL with Docker:  npm run db:local");
    console.error("  Then create the tables and admin account: npm run db:init");
    console.error("  Or point DATABASE_URL (in .env) at an existing PostgreSQL server.\n");
    process.exit(1);
  }
}

async function startServer() {
  await connectDatabase();

  // Ensure database baseline is initialized
  await db.initializeDefaultData();

  // Start background Google Drive sync queue worker
  SyncEngineService.startWorker(5000);

  // Start background file preview rendering worker
  PreviewService.startWorker(3000);

  const app = express();


  // Basic security & parsing middlewares
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));
  app.use(cookieParser());

  // Mount API Router FIRST
  app.use("/api", apiRouter);

  // Google OAuth Popup Callback Handler
  app.get(["/auth/callback", "/auth/callback/"], (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Google Auth Callback</title>
        </head>
        <body style="font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: #f8fafc;">
          <div style="text-align: center; padding: 24px; background: #1e293b; border-radius: 16px; border: 1px solid #334155;">
            <h3 style="margin-top: 0; font-size: 18px;">Autentikasi Google Terhubung</h3>
            <p style="color: #94a3b8; font-size: 14px;">Jendela ini akan tertutup otomatis...</p>
          </div>
          <script>
            try {
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', url: window.location.href }, window.location.origin);
                setTimeout(() => window.close(), 500);
              } else {
                window.location.href = '/';
              }
            } catch (e) {
              window.location.href = '/';
            }
          </script>
        </body>
      </html>
    `);
  });

  // Development vs Production Frontend handling
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("[Server] Fatal bootstrap error:", err);
  process.exit(1);
});
