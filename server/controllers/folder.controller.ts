import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.ts";
import { FolderService } from "../services/folder.service.ts";
import { GoogleDriveService } from "../services/google-drive.service.ts";
import { ShareTokenService } from "../services/share-token.service.ts";
import { ShareLinkService } from "../services/share-link.service.ts";
import { AccessService } from "../services/access.service.ts";
import { DriveType } from "../types/index.ts";
import { db } from "../db/index.ts";

export class FolderController {
  public static async listFolders(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { parentId, page, limit, q, search, storageId } = req.query;
      // Signed-out visitors (share links) may only list inside a specific folder,
      // never the whole tree or the root of every account.
      if (!req.user && (parentId === undefined || ["", "root", "null"].includes(String(parentId)))) {
        res.status(401).json({ success: false, error: "Authentication required. Please log in." });
        return;
      }
      const pageNum = Math.max(1, parseInt(String(page || "1"), 10) || 1);
      const limitNum = Math.max(1, Math.min(100, parseInt(String(limit || "20"), 10) || 20));
      const searchQuery = q || search ? String(q || search).trim() : undefined;
      const storageIdVal = storageId !== undefined ? (storageId === "ALL" ? "ALL" : String(storageId)) : undefined;

      const result = await FolderService.listFoldersPaginated({
        parentId: parentId !== undefined ? String(parentId) : undefined,
        user: req.user,
        page: pageNum,
        limit: limitNum,
        search: searchQuery,
        storageId: storageIdVal === "ALL" ? undefined : storageIdVal,
      });

      res.status(200).json({
        success: true,
        data: {
          folders: result.folders,
          total: result.total,
          totalData: result.total,
          page: result.page,
          currentPage: result.page,
          limit: result.limit,
          pageSize: result.limit,
          totalPages: result.totalPages,
          hasMore: result.hasMore,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to list folders",
      });
    }
  }

  public static async getFolder(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const folder = await FolderService.getFolderById(id);
      if (!folder) {
        res.status(404).json({
          success: false,
          error: "Folder not found",
        });
        return;
      }

      const breadcrumbs = AccessService.trimToShareRoot(req, await FolderService.getFolderBreadcrumbs(id, req.user));

      res.status(200).json({
        success: true,
        data: { folder, breadcrumbs },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to retrieve folder",
      });
    }
  }

  public static async getBreadcrumbs(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const breadcrumbs = AccessService.trimToShareRoot(req, await FolderService.getFolderBreadcrumbs(id, req.user));
      res.status(200).json({
        success: true,
        data: { breadcrumbs },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to retrieve folder breadcrumbs",
      });
    }
  }

  public static async createFolder(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { name, description, parentId, permission, targetFolderPath, targetPath, targetDriveType, targetDriveId, targetDriveName, googleDriveFolderId, syncToGoogleDrive } = req.body;
      const ipAddress = req.ip || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = req.headers["user-agent"] || "unknown";

      const folder = await FolderService.createFolder({
        name,
        description,
        parentId: parentId || null,
        permission,
        targetFolderPath: targetFolderPath || targetPath || name,
        targetDriveType: (targetDriveType as DriveType) || DriveType.MY_DRIVE,
        targetDriveId,
        targetDriveName,
        googleDriveFolderId,
        syncToGoogleDrive: syncToGoogleDrive !== undefined ? syncToGoogleDrive === true || syncToGoogleDrive === "true" : false,
        creator: req.user,
        ipAddress,
        userAgent,
      });

      res.status(201).json({
        success: true,
        message: "Application folder created successfully",
        data: { folder },
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || "Failed to create folder",
      });
    }
  }

  public static async syncFolder(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const ipAddress = req.ip || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = req.headers["user-agent"] || "unknown";

      const folder = await FolderService.syncFolder(id, req.user, ipAddress, userAgent);

      res.status(200).json({
        success: true,
        message: "Folder berhasil disinkronkan ke Google Drive",
        data: { folder },
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || "Gagal menyinkronkan folder ke Google Drive",
      });
    }
  }

  public static async updateFolder(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { name, description, permission, targetFolderPath, targetPath, targetDriveType, targetDriveId, targetDriveName, googleDriveFolderId, syncToGoogleDrive, parentId } = req.body;
      const ipAddress = req.ip || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = req.headers["user-agent"] || "unknown";

      const folder = await FolderService.updateFolder({
        id,
        name,
        description,
        permission,
        targetFolderPath: targetFolderPath || targetPath,
        targetDriveType: targetDriveType as DriveType,
        targetDriveId,
        targetDriveName,
        googleDriveFolderId,
        syncToGoogleDrive: syncToGoogleDrive !== undefined ? syncToGoogleDrive === true || syncToGoogleDrive === "true" : undefined,
        parentId,
        user: req.user,
        ipAddress,
        userAgent,
      });


      res.status(200).json({
        success: true,
        message: "Folder updated successfully",
        data: { folder },
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || "Failed to update folder",
      });
    }
  }

  public static async deleteFolder(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const ipAddress = req.ip || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = req.headers["user-agent"] || "unknown";

      await FolderService.deleteFolder(id, req.user, ipAddress, userAgent);

      res.status(200).json({
        success: true,
        message: "Folder berhasil dipindahkan ke sampah",
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || "Failed to delete folder",
      });
    }
  }

  public static async restoreFolder(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const ipAddress = req.ip || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = req.headers["user-agent"] || "unknown";

      const restored = await FolderService.restoreFolder(id, req.user, ipAddress, userAgent);

      res.status(200).json({
        success: true,
        message: "Folder berhasil dipulihkan",
        data: restored,
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || "Failed to restore folder",
      });
    }
  }

  public static async permanentlyDeleteFolder(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const ipAddress = req.ip || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = req.headers["user-agent"] || "unknown";

      await FolderService.permanentlyDeleteFolder(id, req.user, ipAddress, userAgent);

      res.status(200).json({
        success: true,
        message: "Folder berhasil dihapus permanen",
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || "Failed to permanently delete folder",
      });
    }
  }

  public static async bulkDeleteFolders(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { folderIds, permanent } = req.body;
      if (!Array.isArray(folderIds) || folderIds.length === 0) {
        res.status(400).json({
          success: false,
          error: "folderIds array is required",
        });
        return;
      }

      const ipAddress = req.ip || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = req.headers["user-agent"] || "unknown";

      const processed: string[] = [];
      const failed: string[] = [];

      for (const id of folderIds) {
        try {
          if (permanent) {
            await FolderService.permanentlyDeleteFolder(id, req.user!, ipAddress, userAgent);
          } else {
            await FolderService.deleteFolder(id, req.user!, ipAddress, userAgent);
          }
          processed.push(id);
        } catch {
          failed.push(id);
        }
      }

      res.status(200).json({
        success: true,
        message: permanent ? `Berhasil menghapus permanen ${processed.length} folder` : `Berhasil memindahkan ${processed.length} folder ke sampah`,
        data: { count: processed.length, processedIds: processed, failedIds: failed },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to perform bulk folder operation",
      });
    }
  }

  public static async bulkRestoreFolders(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { folderIds } = req.body;
      if (!Array.isArray(folderIds) || folderIds.length === 0) {
        res.status(400).json({
          success: false,
          error: "folderIds array is required",
        });
        return;
      }

      const ipAddress = req.ip || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = req.headers["user-agent"] || "unknown";

      const restored: string[] = [];
      const failed: string[] = [];

      for (const id of folderIds) {
        try {
          await FolderService.restoreFolder(id, req.user!, ipAddress, userAgent);
          restored.push(id);
        } catch {
          failed.push(id);
        }
      }

      res.status(200).json({
        success: true,
        message: `Berhasil memulihkan ${restored.length} folder`,
        data: { count: restored.length, restoredIds: restored, failedIds: failed },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to bulk restore folders",
      });
    }
  }

  public static async getGoogleFolderTree(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const rootId = (req.query.rootId as string) || "root";
      const driveType = (req.query.driveType as DriveType) || DriveType.MY_DRIVE;

      const tree = await GoogleDriveService.getFolderTree(rootId, driveType);

      res.status(200).json({
        success: true,
        data: { tree },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to fetch Google Drive folder tree",
      });
    }
  }

  public static async createGoogleDriveFolder(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { name, parentId, driveType } = req.body;
      const ipAddress = req.ip || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = req.headers["user-agent"] || "unknown";

      const created = await GoogleDriveService.createGoogleFolder({
        name,
        parentId: parentId || "root",
        driveType: (driveType as DriveType) || DriveType.MY_DRIVE,
        userId: req.user?.id,
        ipAddress,
        userAgent,
      });

      res.status(201).json({
        success: true,
        message: "Folder created in Google Drive",
        data: { folder: created },
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || "Failed to create folder in Google Drive",
      });
    }
  }

  public static async resolvePath(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { pathString, rootParentId, driveType } = req.body;
      const ipAddress = req.ip || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = req.headers["user-agent"] || "unknown";

      const resolved = await GoogleDriveService.resolveOrCreatePath({
        pathString,
        rootParentId: rootParentId || "root",
        driveType: (driveType as DriveType) || DriveType.MY_DRIVE,
        userId: req.user?.id,
        ipAddress,
        userAgent,
      });

      res.status(200).json({
        success: true,
        data: resolved,
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || "Failed to resolve folder path",
      });
    }
  }

  public static async verifyShareToken(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { folderId, fileId, permission, signature, sig, token, pwdHash, emails } = req.body;
      const itemId = folderId || fileId;
      const effectiveSig = (signature || sig || token || "").trim();

      if (!itemId || !permission || !effectiveSig) {
        res.status(400).json({
          success: false,
          error: "Item ID, permission, and cryptographic signature are required",
        });
        return;
      }

      const isValid = ShareTokenService.verifySignature(itemId, permission, effectiveSig, pwdHash, emails);
      // Legacy links put the allowed emails in the URL; at least require the visitor to name one.
      const emailList = typeof emails === "string" ? emails.toLowerCase().split(/[,;\s]+/).filter(Boolean) : [];
      const emailInput = String(req.body.emailInput || "").trim().toLowerCase();
      if (isValid && emailList.length > 0 && !emailList.includes(emailInput)) {
        res.status(403).json({ success: false, error: "Email ini tidak diizinkan membuka tautan.", data: { isValid: false } });
        return;
      }
      if (!isValid) {
        res.status(403).json({
          success: false,
          error: "Tanda tangan kriptografi tidak cocok. Parameter izin kemungkinan telah diubah secara ilegal.",
          data: { isValid: false },
        });
        return;
      }

      if (folderId) {
        const folder = await FolderService.getFolderById(folderId);
        if (!folder) {
          res.status(404).json({
            success: false,
            error: "Folder tidak ditemukan.",
            data: { isValid: false },
          });
          return;
        }

        res.status(200).json({
          success: true,
          data: {
            isValid: true,
            folder,
            grantedPermission: permission,
            session: ShareLinkService.issueSession({
              linkId: "legacy",
              itemType: "FOLDER",
              itemId: folder.id,
              permission: permission === "EDIT" ? "EDIT" : "VIEW",
            }),
          },
        });
      } else {
        const file = await db.file.findUnique({ where: { id: fileId } });
        if (!file) {
          res.status(404).json({
            success: false,
            error: "Berkas tidak ditemukan.",
            data: { isValid: false },
          });
          return;
        }

        res.status(200).json({
          success: true,
          data: {
            isValid: true,
            file,
            grantedPermission: "VIEW",
            session: ShareLinkService.issueSession({ linkId: "legacy", itemType: "FILE", itemId: file.id, permission: "VIEW" }),
          },
        });
      }
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to verify share token",
      });
    }
  }

  public static async getFolderActivities(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const limit = parseInt(req.query.limit as string, 10) || 50;

      const activities = await FolderService.getFolderActivities(id, limit);

      res.status(200).json({
        success: true,
        data: {
          activities,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Gagal mengambil riwayat aktivitas folder",
      });
    }
  }
}

