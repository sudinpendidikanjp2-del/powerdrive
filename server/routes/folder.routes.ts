import { Router } from "express";
import { FolderController } from "../controllers/folder.controller.ts";
import { authenticate, requireAdmin, requireAuth } from "../middleware/auth.ts";
import { requireAuthWhenUnscoped, requireFolderRead } from "../middleware/access.ts";

export const folderRouter = Router();

// Middleware to parse auth token (cookies, headers, or query)
folderRouter.use(authenticate);

// Read endpoints: owners, admins, or visitors holding a share session for the folder.
// Legacy signed links (?folderId=&perm=&sig=) are exchanged for a share session here.
folderRouter.post("/verify-share-token", FolderController.verifyShareToken);
folderRouter.get("/:id/breadcrumbs", requireFolderRead((req) => req.params.id), FolderController.getBreadcrumbs);
folderRouter.get("/:id", requireFolderRead((req) => req.params.id), FolderController.getFolder);
folderRouter.get("/", requireAuthWhenUnscoped((req) => req.query.parentId), FolderController.listFolders);

// Routes requiring active user authentication
folderRouter.use(requireAuth);

folderRouter.get("/tree/google", FolderController.getGoogleFolderTree);
// The activity log includes user emails and IP addresses, so it is not public.
folderRouter.get("/:id/activities", FolderController.getFolderActivities);

// Folder routes (ownership & permission validated in service)
folderRouter.post("/", FolderController.createFolder);
folderRouter.post("/bulk-delete", FolderController.bulkDeleteFolders);
folderRouter.post("/bulk-restore", FolderController.bulkRestoreFolders);
folderRouter.post("/:id/restore", FolderController.restoreFolder);
folderRouter.delete("/:id/permanent", FolderController.permanentlyDeleteFolder);
folderRouter.put("/:id", FolderController.updateFolder);
folderRouter.post("/:id/sync", FolderController.syncFolder);
folderRouter.delete("/:id", FolderController.deleteFolder);
folderRouter.post("/google/create", requireAdmin, FolderController.createGoogleDriveFolder);
folderRouter.post("/google/resolve-path", requireAdmin, FolderController.resolvePath);
