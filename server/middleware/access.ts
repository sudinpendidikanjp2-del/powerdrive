import { NextFunction, Response } from "express";
import { AuthenticatedRequest } from "./auth.ts";
import { AccessService } from "../services/access.service.ts";
import { db } from "../db/index.ts";

type Source = (req: AuthenticatedRequest) => unknown;

const isRoot = (id: unknown) => id === undefined || id === null || id === "" || id === "root" || id === "null";

function deny(req: AuthenticatedRequest, res: Response) {
  // Signed-out visitors get 401 (they may need to open the link first); signed-in users get 403.
  res.status(req.user ? 403 : 401).json({
    success: false,
    error: req.user ? "Anda tidak memiliki akses ke item ini." : "Buka tautan bagikan atau masuk untuk mengakses item ini.",
  });
}

/**
 * Requires read access to the folder named by `source`. The root of "My Drive"
 * is only for signed-in users; their own root listing is filtered by the service.
 */
export function requireFolderRead(source: Source) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const id = source(req);
      if (isRoot(id)) return req.user ? next() : deny(req, res);
      if (await AccessService.canReadFolder(req, String(id))) return next();
      return deny(req, res);
    } catch (err) {
      next(err);
    }
  };
}

/** Requires upload/write access to the folder named by `source` (root: signed-in users only). */
export function requireFolderWrite(source: Source) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const id = source(req);
      if (isRoot(id)) return req.user ? next() : deny(req, res);
      const folder = await db.folder.findUnique({ where: { id: String(id) } });
      if (!folder) {
        res.status(404).json({ success: false, error: "Folder tujuan tidak ditemukan." });
        return;
      }
      if (await AccessService.canWriteFolder(req, folder.id)) return next();
      return deny(req, res);
    } catch (err) {
      next(err);
    }
  };
}

/** Requires read access to the file in `req.params.id`. */
export async function requireFileRead(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const file = await db.file.findUnique({ where: { id: req.params.id } });
    if (!file) {
      res.status(404).json({ success: false, error: "Berkas tidak ditemukan." });
      return;
    }
    if (await AccessService.canReadFile(req, file)) return next();
    return deny(req, res);
  } catch (err) {
    next(err);
  }
}

/** Every file in `req.body.fileIds` must be readable (ZIP downloads). */
export async function requireFilesRead(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const ids: unknown = req.body?.fileIds;
    if (Array.isArray(ids)) {
      for (const id of ids) {
        const file = await db.file.findUnique({ where: { id: String(id) } });
        if (!file || !(await AccessService.canReadFile(req, file))) return deny(req, res);
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}

/** Chunk upload calls after init must target a folder the caller may still write to. */
export function requireChunkSessionWrite(source: Source) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { StorageService } = await import("../services/storage.service.ts");
      const session = StorageService.peekChunkSession(String(source(req) || ""));
      if (!session) {
        res.status(404).json({ success: false, error: "Sesi unggahan tidak ditemukan." });
        return;
      }
      return requireFolderWrite(() => session.folderId)(req, res, next);
    } catch (err) {
      next(err);
    }
  };
}

/** Listing without a folder (all files / all root folders) is for signed-in users only. */
export function requireAuthWhenUnscoped(source: Source) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!isRoot(source(req))) return requireFolderRead(source)(req, res, next);
    if (req.user) return next();
    return deny(req, res);
  };
}
