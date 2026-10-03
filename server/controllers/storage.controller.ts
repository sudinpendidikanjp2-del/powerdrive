import fs from "fs";
import path from "path";
import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.ts";
import { StorageService, getMimeType } from "../services/storage.service.ts";
import { GoogleDriveService } from "../services/google-drive.service.ts";
import { db } from "../db/index.ts";
import { ActivityAction, SyncStatus } from "../types/index.ts";
import { AuditService } from "../services/audit.service.ts";
import { AccessService } from "../services/access.service.ts";

export function generateVideoThumbnailSvg(fileName: string, mimeType: string = "", sizeBytes: number = 0): string {
  const ext = fileName.split(".").pop()?.toUpperCase() || "MP4";
  const sizeFormatted =
    sizeBytes > 1024 * 1024
      ? `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
      : sizeBytes > 1024
      ? `${(sizeBytes / 1024).toFixed(0)} KB`
      : `${sizeBytes} B`;

  const safeFileName = fileName
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const displayName = safeFileName.length > 22 ? safeFileName.substring(0, 19) + "..." : safeFileName;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" width="320" height="200">
  <defs>
    <linearGradient id="videoDarkGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#090D16" />
      <stop offset="50%" stop-color="#18132F" />
      <stop offset="100%" stop-color="#2D0F3F" />
    </linearGradient>
    <linearGradient id="playBtnGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#A855F7" />
      <stop offset="100%" stop-color="#7C3AED" />
    </linearGradient>
    <filter id="videoGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="4" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
  </defs>
  <rect width="100%" height="100%" fill="url(#videoDarkGrad)" />

  <!-- Subtle Filmstrip Decorative Bars -->
  <g fill="#334155" opacity="0.35">
    <rect x="12" y="10" width="16" height="10" rx="2" />
    <rect x="36" y="10" width="16" height="10" rx="2" />
    <rect x="60" y="10" width="16" height="10" rx="2" />
    <rect x="244" y="10" width="16" height="10" rx="2" />
    <rect x="268" y="10" width="16" height="10" rx="2" />
    <rect x="292" y="10" width="16" height="10" rx="2" />
  </g>

  <!-- Centered Play Badge -->
  <circle cx="160" cy="80" r="28" fill="url(#playBtnGrad)" filter="url(#videoGlow)" />
  <polygon points="153,67 173,80 153,93" fill="#FFFFFF" />

  <!-- Video Extension Badge -->
  <rect x="242" y="30" width="66" height="22" rx="6" fill="#000000" opacity="0.65" />
  <rect x="242" y="30" width="66" height="22" rx="6" fill="none" stroke="#A855F7" stroke-width="1" />
  <text x="275" y="45" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="bold" fill="#F3E8FF" text-anchor="middle" dominant-baseline="middle">${ext}</text>

  <!-- Bottom Metadata Deck -->
  <rect x="0" y="142" width="320" height="58" fill="#020617" opacity="0.85" />
  <text x="18" y="166" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="600" fill="#F8FAFC">${displayName}</text>
  <text x="18" y="186" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11" fill="#94A3B8">${sizeFormatted} • Berkas Video</text>
</svg>`;
}

export function generateFileThumbnailSvg(fileName: string, mimeType: string = "", sizeBytes: number = 0): string {
  const ext = fileName.split(".").pop()?.toUpperCase() || "FILE";
  const sizeFormatted =
    sizeBytes > 1024 * 1024
      ? `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
      : sizeBytes > 1024
      ? `${(sizeBytes / 1024).toFixed(0)} KB`
      : `${sizeBytes} B`;

  let primaryColor = "#3B82F6"; // default blue
  let secondaryColor = "#1D4ED8";
  let iconSymbol = "📄";

  if (mimeType.includes("pdf") || ext === "PDF") {
    primaryColor = "#EF4444";
    secondaryColor = "#B91C1C";
    iconSymbol = "📕";
  } else if (mimeType.includes("sheet") || mimeType.includes("excel") || ext === "XLS" || ext === "XLSX" || ext === "CSV") {
    primaryColor = "#10B981";
    secondaryColor = "#047857";
    iconSymbol = "📊";
  } else if (mimeType.includes("word") || mimeType.includes("document") || ext === "DOC" || ext === "DOCX") {
    primaryColor = "#2563EB";
    secondaryColor = "#1E40AF";
    iconSymbol = "📝";
  } else if (mimeType.includes("presentation") || mimeType.includes("powerpoint") || ext === "PPT" || ext === "PPTX") {
    primaryColor = "#F59E0B";
    secondaryColor = "#D97706";
    iconSymbol = "📑";
  } else if (mimeType.startsWith("image/") || ["PNG", "JPG", "JPEG", "WEBP", "GIF", "SVG"].includes(ext)) {
    primaryColor = "#8B5CF6";
    secondaryColor = "#6D28D9";
    iconSymbol = "🖼️";
  } else if (mimeType.startsWith("video/") || ["MP4", "MKV", "AVI", "MOV", "WEBM"].includes(ext)) {
    primaryColor = "#EC4899";
    secondaryColor = "#BE185D";
    iconSymbol = "🎬";
  } else if (mimeType.startsWith("audio/") || ["MP3", "WAV", "OGG", "M4A"].includes(ext)) {
    primaryColor = "#14B8A6";
    secondaryColor = "#0F766E";
    iconSymbol = "🎵";
  } else if (mimeType.includes("zip") || mimeType.includes("tar") || ["ZIP", "RAR", "7Z", "GZ", "TAR"].includes(ext)) {
    primaryColor = "#F97316";
    secondaryColor = "#C2410C";
    iconSymbol = "📦";
  } else if (mimeType.includes("json") || mimeType.includes("javascript") || mimeType.includes("typescript") || ["JS", "TS", "JSON", "PY", "HTML", "CSS", "SQL"].includes(ext)) {
    primaryColor = "#6366F1";
    secondaryColor = "#4338CA";
    iconSymbol = "💻";
  }

  const safeFileName = fileName
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const displayName = safeFileName.length > 22 ? safeFileName.substring(0, 19) + "..." : safeFileName;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" width="320" height="200">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#F8FAFC" />
      <stop offset="100%" stop-color="#EEF2F6" />
    </linearGradient>
    <linearGradient id="badgeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${primaryColor}" />
      <stop offset="100%" stop-color="${secondaryColor}" />
    </linearGradient>
    <filter id="cardShadow" x="-5%" y="-5%" width="110%" height="115%">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-opacity="0.08" />
    </filter>
  </defs>
  <rect width="100%" height="100%" fill="url(#bgGrad)" />
  <rect x="24" y="20" width="272" height="160" rx="10" fill="#FFFFFF" stroke="#E2E8F0" stroke-width="1.5" filter="url(#cardShadow)" />
  <rect x="36" y="32" width="56" height="56" rx="8" fill="url(#badgeGrad)" />
  <text x="64" y="66" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="20" text-anchor="middle" dominant-baseline="middle">${iconSymbol}</text>
  <rect x="104" y="34" width="60" height="20" rx="4" fill="${primaryColor}15" />
  <text x="134" y="47" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="bold" fill="${secondaryColor}" text-anchor="middle" dominant-baseline="middle">${ext}</text>
  <text x="104" y="74" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="600" fill="#1E293B">${displayName}</text>
  <line x1="36" y1="104" x2="284" y2="104" stroke="#F1F5F9" stroke-width="1" />
  <text x="36" y="132" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11" fill="#64748B">Ukuran Berkas</text>
  <text x="36" y="152" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="600" fill="#334155">${sizeFormatted}</text>
  <circle cx="260" cy="142" r="14" fill="${primaryColor}15" />
  <path d="M256 142 L260 146 L264 142 M260 138 L260 146" stroke="${primaryColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" />
</svg>`;
}

export class StorageController {
  /**
   * Upload single or multiple files into a target application folder
   */
  public static async uploadFiles(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { folderId, conflictMode } = req.body;
      if (!folderId) {
        res.status(400).json({
          success: false,
          error: "Target folderId is required",
        });
        return;
      }

      // Write access (owner, admin or an EDIT share link) is enforced by the route guard.

      // Handle both single file (req.file) and multiple files (req.files)
      const rawFiles: Express.Multer.File[] = [];
      if (req.file) {
        rawFiles.push(req.file);
      } else if (req.files) {
        if (Array.isArray(req.files)) {
          rawFiles.push(...req.files);
        } else {
          for (const key of Object.keys(req.files)) {
            rawFiles.push(...req.files[key]);
          }
        }
      }

      if (rawFiles.length === 0) {
        res.status(400).json({
          success: false,
          error: "No files uploaded",
        });
        return;
      }

      const ipAddress = req.ip || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = req.headers["user-agent"] || "unknown";

      const uploader = await AccessService.uploaderFor(req, folderId);
      const uploadedResults = [];
      for (const file of rawFiles) {
        const saved = await StorageService.saveFile({
          originalName: file.originalname,
          mimeType: file.mimetype,
          buffer: file.buffer,
          size: file.size,
          folderId,
          conflictMode: conflictMode || "create_version",
          user: uploader,
          ipAddress,
          userAgent,
        });
        uploadedResults.push(saved);
      }

      res.status(201).json({
        success: true,
        message: `Successfully uploaded and buffered ${uploadedResults.length} file(s)`,
        data: {
          files: uploadedResults,
          count: uploadedResults.length,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to upload file(s)",
      });
    }
  }

  /**
   * Get buffer storage metrics
   */
  public static async getStorageStats(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const stats = await StorageService.getStorageStats();
      res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to retrieve storage statistics",
      });
    }
  }

  /**
   * List files with pagination (default limit 20) and filtering by folderId, syncStatus, user, or search query
   */
  public static async listFiles(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { folderId, syncStatus, myOnly, page, limit, q, search, storageId } = req.query;

      const pageNum = Math.max(1, parseInt(String(page || "1"), 10) || 1);
      const limitNum = Math.max(1, Math.min(100, parseInt(String(limit || "20"), 10) || 20));
      const searchQuery = q || search ? String(q || search).trim() : undefined;

      const hasFolder = folderId !== undefined && folderId !== "" && folderId !== "root" && folderId !== "null";
      // Signed-out visitors (share links) must name a folder; without one this
      // would list every file of every account.
      if (!req.user && !hasFolder) {
        res.status(401).json({ success: false, error: "Authentication required. Please log in." });
        return;
      }

      const where: any = {};
      if (folderId !== undefined && folderId !== "") {
        where.folderId = (folderId === "root" || folderId === "null") ? null : String(folderId);
      }
      // Across folders, regular users only see their own uploads.
      if (!hasFolder && req.user && req.user.role !== "ADMIN") {
        where.userId = req.user.id;
      }
      if (syncStatus && syncStatus !== "ALL") {
        where.syncStatus = syncStatus as SyncStatus;
      }
      if (myOnly === "true" && req.user) {
        where.userId = req.user.id;
      }
      if (searchQuery) {
        where.search = searchQuery;
      }
      if (storageId !== undefined && storageId !== "") {
        if (storageId !== "ALL") {
          where.storageId = String(storageId);
        }
      } else {
        where.storageId = null;
      }

      const total = await db.file.count({ where });
      const totalPages = Math.max(1, Math.ceil(total / limitNum));
      const skip = (pageNum - 1) * limitNum;

      const files = await db.file.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { createdAt: "desc" },
      });

      const hasMore = pageNum < totalPages;

      res.status(200).json({
        success: true,
        data: {
          files,
          total,
          totalData: total,
          page: pageNum,
          currentPage: pageNum,
          limit: limitNum,
          pageSize: limitNum,
          totalPages,
          hasMore,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to list files",
      });
    }
  }

  /**
   * Get single file record
   */
  public static async getFile(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const file = await db.file.findUnique({ where: { id } });
      if (!file) {
        res.status(404).json({
          success: false,
          error: "File not found",
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: { file },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to retrieve file",
      });
    }
  }

  /**
   * Rename a file record
   */
  public static async renameFile(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { name } = req.body;
      if (!name || !name.trim()) {
        res.status(400).json({
          success: false,
          error: "Nama berkas baru wajib diisi",
        });
        return;
      }

      const file = await db.file.findUnique({ where: { id } });
      if (!file) {
        res.status(404).json({
          success: false,
          error: "Berkas tidak ditemukan",
        });
        return;
      }

      // Check permissions
      if (req.user?.role !== "ADMIN" && file.userId !== req.user?.id) {
        res.status(403).json({
          success: false,
          error: "Anda tidak memiliki hak akses untuk mengubah nama berkas ini.",
        });
        return;
      }

      const updated = await db.file.update({
        where: { id },
        data: { originalName: name.trim() },
      });

      const ipAddress = req.ip || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = req.headers["user-agent"] || "unknown";

      await AuditService.log({
        userId: req.user?.id,
        action: ActivityAction.FILE_UPLOAD_COMPLETED,
        resourceType: "FILE",
        resourceId: id,
        details: { oldName: file.originalName, newName: updated.originalName },
        ipAddress,
        userAgent,
        result: "SUCCESS",
      });

      res.status(200).json({
        success: true,
        message: "Nama berkas berhasil diperbarui",
        data: { file: updated },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Gagal mengubah nama berkas",
      });
    }
  }

  /**
   * Stream download a local buffer file or Google Drive remote file
   */
  public static async downloadFile(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const file = await db.file.findUnique({ where: { id } });
      if (!file) {
        res.status(404).json({
          success: false,
          error: "File not found",
        });
        return;
      }

      const explicitToken = req.query.token as string | undefined;
      const fullPath = StorageService.resolveStoragePath(file.storagePath);

      // 1. Try local physical file first
      if (fullPath && fs.existsSync(fullPath)) {
        const stat = fs.statSync(fullPath);
        res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(file.originalName)}"`);
        res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
        res.setHeader("Content-Length", stat.size);

        const stream = fs.createReadStream(fullPath);
        stream.pipe(res);

        await AuditService.log({
          userId: req.user?.id,
          action: ActivityAction.FILE_DOWNLOADED,
          resourceType: "FILE",
          resourceId: file.id,
          details: { originalName: file.originalName, size: stat.size, source: "LOCAL_BUFFER" },
          ipAddress: req.ip || req.socket.remoteAddress || "127.0.0.1",
          userAgent: req.headers["user-agent"] || "unknown",
          result: "SUCCESS",
        });
        return;
      }

      // 2. If remote Google Drive file, stream from Google Drive API
      if (file.googleDriveFileId) {
        try {
          const gStream = await GoogleDriveService.downloadFileStream(file.googleDriveFileId, explicitToken);
          res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(file.originalName)}"`);
          res.setHeader("Content-Type", gStream.mimeType || file.mimeType || "application/octet-stream");
          if (gStream.size) {
            res.setHeader("Content-Length", gStream.size);
          }

          gStream.stream.pipe(res);

          await AuditService.log({
            userId: req.user?.id,
            action: ActivityAction.FILE_DOWNLOADED,
            resourceType: "FILE",
            resourceId: file.id,
            details: { originalName: file.originalName, source: "GOOGLE_DRIVE_STREAM" },
            ipAddress: req.ip || req.socket.remoteAddress || "127.0.0.1",
            userAgent: req.headers["user-agent"] || "unknown",
            result: "SUCCESS",
          });
          return;
        } catch (gErr) {
          console.warn("[StorageController] Google Drive API stream failed, redirecting to direct download link:", gErr);
          // Fallback direct Google Drive download export link
          res.redirect(`https://drive.google.com/uc?export=download&id=${file.googleDriveFileId}`);
          return;
        }
      }

      // 3. Fallback: if webViewLink exists
      if (file.googleDriveWebViewLink) {
        res.redirect(file.googleDriveWebViewLink);
        return;
      }

      // 4. In-memory / simulated file download fallback
      const fallbackContent = `File: ${file.originalName}\nMIME: ${file.mimeType}\nSize: ${file.size} bytes\nChecksum: ${file.checksumSha256 || "N/A"}\nSync Status: ${file.syncStatus}\nSynced At: ${file.syncedAt || "N/A"}`;
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(file.originalName)}"`);
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Content-Length", Buffer.byteLength(fallbackContent));
      res.send(fallbackContent);
    } catch (error: any) {
      console.error("[StorageController] downloadFile error:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to download file",
      });
    }
  }

  /**
   * Stream file for inline preview (image, video, audio, pdf, text, etc.)
   */
  public static async viewFile(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const file = await db.file.findUnique({ where: { id } });
      if (!file) {
        res.status(404).json({
          success: false,
          error: "File not found",
        });
        return;
      }

      const explicitToken = req.query.token as string | undefined;
      const requestedQuality = req.query.quality as string | undefined; // 'low' | 'medium' | 'original'
      const fullPath = StorageService.resolveStoragePath(file.storagePath);
      const determinedMimeType = getMimeType(file.originalName, file.mimeType);

      // 1. If physical local file exists
      if (fullPath && fs.existsSync(fullPath)) {
        let activePath = fullPath;
        let stat = fs.statSync(activePath);
        let fileSize = stat.size;

        const isImage = determinedMimeType.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|avif)$/i.test(file.originalName);
        if (isImage) {
          const ext = file.originalName.split(".").pop()?.toLowerCase() || "jpg";
          const lowPath = path.join(process.cwd(), "storage", "thumbnails", `${file.id}.${ext}`);
          const medPath = path.join(process.cwd(), "storage", "previews", `${file.id}.${ext}`);

          if (requestedQuality === "low" && fs.existsSync(lowPath)) {
            activePath = lowPath;
            stat = fs.statSync(activePath);
            fileSize = stat.size;
          } else if (requestedQuality === "original") {
            activePath = fullPath;
            stat = fs.statSync(activePath);
            fileSize = stat.size;
          } else if (fs.existsSync(medPath)) {
            // Default to medium quality for previews
            activePath = medPath;
            stat = fs.statSync(activePath);
            fileSize = stat.size;
          }
        }

        const range = req.headers.range;

        res.setHeader("Cache-Control", "public, max-age=3600");
        res.setHeader("Accept-Ranges", "bytes");

        // Support HTTP Range requests (crucial for video / audio seeking)
        if (range) {
          const parts = range.replace(/bytes=/, "").split("-");
          const start = parts[0] ? parseInt(parts[0], 10) : 0;
          const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

          if (isNaN(start) || isNaN(end) || start < 0 || end >= fileSize || start > end) {
            res.status(416).setHeader("Content-Range", `bytes */${fileSize}`).end();
            return;
          }

          const chunkSize = end - start + 1;
          const fileStream = fs.createReadStream(activePath, { start, end });

          res.writeHead(206, {
            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
            "Accept-Ranges": "bytes",
            "Content-Length": chunkSize,
            "Content-Type": determinedMimeType,
            "Content-Disposition": `inline; filename="${encodeURIComponent(file.originalName)}"`,
          });
          fileStream.pipe(res);
        } else {
          res.writeHead(200, {
            "Content-Length": fileSize,
            "Content-Type": determinedMimeType,
            "Accept-Ranges": "bytes",
            "Content-Disposition": `inline; filename="${encodeURIComponent(file.originalName)}"`,
          });
          fs.createReadStream(activePath).pipe(res);
        }
        return;
      }

      // 2. If Google Drive remote file
      if (file.googleDriveFileId && !file.googleDriveFileId.startsWith("gdrive_") && !file.googleDriveFileId.startsWith("virtual_")) {
        const isImage = determinedMimeType.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|avif)$/i.test(file.originalName);
        if (isImage && requestedQuality !== "original") {
          // Redirect directly to Google Drive resized smart thumbnail endpoint for incredible performance
          const sz = requestedQuality === "low" ? "w220" : "w1200";
          res.redirect(`https://drive.google.com/thumbnail?id=${file.googleDriveFileId}&sz=${sz}`);
          return;
        }

        try {
          const gStream = await GoogleDriveService.downloadFileStream(file.googleDriveFileId, explicitToken);
          res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(file.originalName)}"`);
          res.setHeader("Content-Type", determinedMimeType || gStream.mimeType || "application/octet-stream");
          res.setHeader("Cache-Control", "public, max-age=3600");
          res.setHeader("Accept-Ranges", "bytes");
          if (gStream.size) {
            res.setHeader("Content-Length", gStream.size);
          }

          gStream.stream.pipe(res);
          return;
        } catch (gErr: any) {
          // For images, redirect to Google Drive direct thumbnail / preview
          if (isImage) {
            const sz = requestedQuality === "low" ? "w220" : "w1200";
            res.redirect(`https://drive.google.com/thumbnail?id=${file.googleDriveFileId}&sz=${sz}`);
            return;
          }

          if (file.googleDriveWebViewLink) {
            res.redirect(file.googleDriveWebViewLink);
            return;
          }
        }
      }

      // 3. If image, serve dynamic SVG thumbnail
      const isImage = determinedMimeType.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|avif)$/i.test(file.originalName);
      if (isImage) {
        const svg = generateFileThumbnailSvg(file.originalName, determinedMimeType, file.size);
        res.setHeader("Content-Type", "image/svg+xml");
        res.setHeader("Cache-Control", "public, max-age=3600");
        res.send(svg);
        return;
      }

      // 4. Fallback redirect or informative preview
      if (file.googleDriveWebViewLink) {
        res.redirect(file.googleDriveWebViewLink);
        return;
      }

      const svg = generateFileThumbnailSvg(file.originalName, determinedMimeType, file.size);
      res.setHeader("Content-Type", "image/svg+xml");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.send(svg);
    } catch (error: any) {
      console.error("[StorageController] viewFile error:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to preview file",
      });
    }
  }

  /**
   * Get thumbnail representation for file card / grid view
   */
  public static async getThumbnail(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const file = await db.file.findUnique({ where: { id } });
      if (!file) {
        res.status(404).json({
          success: false,
          error: "File not found",
        });
        return;
      }

      const explicitToken = req.query.token as string | undefined;
      const resolvedMime = getMimeType(file.originalName, file.mimeType);
      const isImage = resolvedMime.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|avif)$/i.test(file.originalName);
      const isVideo = resolvedMime.startsWith("video/") || /\.(mp4|webm|ogg|ogv|mov|m4v|mkv|avi|wmv|flv|3gp)$/i.test(file.originalName);

      // A. If the local/remote file preview is PENDING or PROCESSING, serve a beautiful animated loading SVG
      if (file.previewStatus === "PENDING" || file.previewStatus === "PROCESSING") {
        const safeName = file.originalName.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const displayName = safeName.length > 22 ? safeName.substring(0, 19) + "..." : safeName;
        const processingSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" width="320" height="200">
  <defs>
    <linearGradient id="procGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0F172A" />
      <stop offset="100%" stop-color="#1E293B" />
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#procGrad)" />
  <circle cx="160" cy="80" r="20" fill="none" stroke="#6366F1" stroke-width="3" stroke-dasharray="80" stroke-dashoffset="0">
    <animateTransform attributeName="transform" type="rotate" from="0 160 80" to="360 160 80" dur="1.5s" repeatCount="indefinite" />
  </circle>
  <text x="160" y="130" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="12" fill="#94A3B8" font-weight="500" text-anchor="middle">Memproses Pratinjau...</text>
  <text x="160" y="150" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11" fill="#64748B" text-anchor="middle">${displayName}</text>
</svg>`;
        res.setHeader("Content-Type", "image/svg+xml");
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate"); // Do not cache while processing!
        res.send(processingSvg);
        return;
      }

      // B. If a physically pre-rendered thumbnail exists on the disk, serve it immediately with heavy caching
      if (file.previewStatus === "READY" && file.thumbnailPath && file.thumbnailPath !== "gdrive") {
        const fullThumbPath = StorageService.resolveStoragePath(file.thumbnailPath);
        if (fullThumbPath && fs.existsSync(fullThumbPath)) {
          const ext = file.thumbnailPath.split(".").pop()?.toLowerCase();
          const contentType = ext === "svg" ? "image/svg+xml" : (ext === "png" ? "image/png" : "image/jpeg");
          const stat = fs.statSync(fullThumbPath);
          res.setHeader("Content-Type", contentType);
          res.setHeader("Content-Length", stat.size);
          res.setHeader("Cache-Control", "public, max-age=86400"); // Cache for 1 day
          fs.createReadStream(fullThumbPath).pipe(res);
          return;
        }
      }

      // 1. If Google Drive remote file exists, Google Drive provides high-res thumbnails for both images & videos!
      if (file.googleDriveFileId && !file.googleDriveFileId.startsWith("gdrive_") && !file.googleDriveFileId.startsWith("virtual_")) {
        if (isImage || isVideo) {
          try {
            const drive = await GoogleDriveService.getClient(
              explicitToken,
              undefined,
              false,
              req.user?.id || req.user?.email || file.userId
            );

            const fileMeta = await drive.files.get({
              fileId: file.googleDriveFileId,
              fields: "thumbnailLink",
              supportsAllDrives: true,
            });

            const thumbnailLink = fileMeta.data.thumbnailLink;
            if (thumbnailLink) {
              const lowResLink = thumbnailLink.replace(/=s\d+$/, "=s220");
              const thumbRes = await fetch(lowResLink);
              if (thumbRes.ok) {
                const buffer = await thumbRes.arrayBuffer();
                res.setHeader("Content-Type", thumbRes.headers.get("Content-Type") || "image/jpeg");
                res.setHeader("Cache-Control", "public, max-age=86400");
                res.send(Buffer.from(buffer));
                return;
              }
            }
          } catch (gdriveErr: any) {
            console.warn("[StorageController] Failed to fetch Google Drive thumbnail on server, falling back to redirect:", gdriveErr.message || gdriveErr);
          }

          res.redirect(`https://drive.google.com/thumbnail?id=${file.googleDriveFileId}&sz=w220`);
          return;
        }
      }

      // 2. If local physical image file exists
      if (isImage) {
        const fullPath = StorageService.resolveStoragePath(file.storagePath);

        if (fullPath && fs.existsSync(fullPath)) {
          const stat = fs.statSync(fullPath);
          res.setHeader("Content-Type", resolvedMime || "image/jpeg");
          res.setHeader("Content-Length", stat.size);
          res.setHeader("Cache-Control", "public, max-age=86400");
          fs.createReadStream(fullPath).pipe(res);
          return;
        }
      }

      // 3. For video files (if local or unsupported direct Google Drive thumbnail redirect)
      if (isVideo) {
        const svg = generateVideoThumbnailSvg(file.originalName, resolvedMime, file.size);
        res.setHeader("Content-Type", "image/svg+xml");
        res.setHeader("Cache-Control", "public, max-age=86400");
        res.send(svg);
        return;
      }

      // 4. For non-images/non-videos or missing files: return high-res SVG thumbnail badge
      const svg = generateFileThumbnailSvg(file.originalName, resolvedMime || "application/octet-stream", file.size);
      res.setHeader("Content-Type", "image/svg+xml");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(svg);
    } catch (error: any) {
      console.error("[StorageController] getThumbnail error:", error);
      const fallbackSvg = generateFileThumbnailSvg("File", "application/octet-stream", 0);
      res.setHeader("Content-Type", "image/svg+xml");
      res.send(fallbackSvg);
    }
  }

  /**
   * Get raw text content for code, txt, markdown, json, csv files
   */
  public static async getFileContent(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const file = await db.file.findUnique({ where: { id } });
      if (!file) {
        res.status(404).json({
          success: false,
          error: "File not found",
        });
        return;
      }

      const explicitToken = req.query.token as string | undefined;
      const fullPath = StorageService.resolveStoragePath(file.storagePath);

      // 1. Read local physical file if exists
      if (fullPath && fs.existsSync(fullPath)) {
        const stat = fs.statSync(fullPath);
        if (stat.size > 5 * 1024 * 1024) {
          res.status(400).json({
            success: false,
            error: "Ukuran berkas teks terlalu besar (> 5MB) untuk dimuat langsung di browser.",
          });
          return;
        }

        const content = fs.readFileSync(fullPath, "utf-8");
        res.status(200).json({
          success: true,
          data: {
            fileId: file.id,
            originalName: file.originalName,
            mimeType: file.mimeType,
            size: file.size,
            content,
          },
        });
        return;
      }

      // 2. If Google Drive file, stream content into string
      if (file.googleDriveFileId) {
        try {
          const gStream = await GoogleDriveService.downloadFileStream(file.googleDriveFileId, explicitToken);
          const chunks: Buffer[] = [];
          
          for await (const chunk of gStream.stream as any) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          
          const content = Buffer.concat(chunks).toString("utf-8");
          res.status(200).json({
            success: true,
            data: {
              fileId: file.id,
              originalName: file.originalName,
              mimeType: file.mimeType,
              size: file.size,
              content,
            },
          });
          return;
        } catch (err: any) {
          console.warn("[StorageController] Failed to read Google Drive text stream:", err);
        }
      }

      // 3. Fallback info
      res.status(200).json({
        success: true,
        data: {
          fileId: file.id,
          originalName: file.originalName,
          mimeType: file.mimeType,
          size: file.size,
          content: `Berkas: ${file.originalName}\nTipe MIME: ${file.mimeType}\nUkuran: ${file.size} bytes\nStatus Sinkronisasi: ${file.syncStatus}\n\n[Berkas tersimpan di Google Drive / Cloud Storage. Silakan unduh atau buka tautan untuk melihat konten lengkap.]`,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Gagal membaca konten teks berkas",
      });
    }
  }

  /**
   * Delete a file record (moves to Trash)
   */
  public static async deleteFile(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const file = await db.file.findUnique({ where: { id } });
      if (!file) {
        res.status(404).json({
          success: false,
          error: "Berkas tidak ditemukan",
        });
        return;
      }

      // Check if user is owner or admin
      if (req.user?.role !== "ADMIN" && file.userId !== req.user?.id) {
        res.status(403).json({
          success: false,
          error: "Anda tidak memiliki hak akses untuk menghapus berkas ini",
        });
        return;
      }

      // Move to Trash (soft delete)
      const trashed = await db.file.trash({ where: { id }, userId: req.user?.id });

      await AuditService.log({
        userId: req.user?.id,
        action: ActivityAction.FILE_TRASHED,
        resourceType: "FILE",
        resourceId: id,
        details: { originalName: file.originalName, storagePath: file.storagePath, softDelete: true },
        ipAddress: req.ip || req.socket.remoteAddress || "127.0.0.1",
        userAgent: req.headers["user-agent"] || "unknown",
        result: "SUCCESS",
      });

      res.status(200).json({
        success: true,
        message: "Berkas berhasil dipindahkan ke sampah",
        data: { file: trashed },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Gagal memindahkan berkas ke sampah",
      });
    }
  }

  /**
   * Restore a file record from Trash
   */
  public static async restoreFile(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const file = await db.file.findUnique({ where: { id } });
      if (!file) {
        res.status(404).json({
          success: false,
          error: "Berkas tidak ditemukan",
        });
        return;
      }

      if (req.user?.role !== "ADMIN" && file.userId !== req.user?.id) {
        res.status(403).json({
          success: false,
          error: "Anda tidak memiliki hak akses untuk memulihkan berkas ini",
        });
        return;
      }

      const restored = await db.file.restore({ where: { id } });

      await AuditService.log({
        userId: req.user?.id,
        action: ActivityAction.FILE_RESTORED,
        resourceType: "FILE",
        resourceId: id,
        details: { originalName: file.originalName },
        ipAddress: req.ip || req.socket.remoteAddress || "127.0.0.1",
        userAgent: req.headers["user-agent"] || "unknown",
        result: "SUCCESS",
      });

      res.status(200).json({
        success: true,
        message: "Berkas berhasil dipulihkan dari sampah",
        data: { file: restored },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Gagal memulihkan berkas",
      });
    }
  }

  /**
   * Permanently delete a file record and its local disk buffer
   */
  public static async permanentlyDeleteFile(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const file = await db.file.findUnique({ where: { id } });
      if (!file) {
        res.status(404).json({
          success: false,
          error: "Berkas tidak ditemukan",
        });
        return;
      }

      if (req.user?.role !== "ADMIN" && file.userId !== req.user?.id) {
        res.status(403).json({
          success: false,
          error: "Anda tidak memiliki hak akses untuk menghapus permanen berkas ini",
        });
        return;
      }

      // Delete local disk file
      StorageService.deleteLocalFile(file.storagePath);

      // Permanently remove from database
      await db.file.delete({ where: { id } });

      await AuditService.log({
        userId: req.user?.id,
        action: ActivityAction.FILE_DELETED,
        resourceType: "FILE",
        resourceId: id,
        details: { originalName: file.originalName, storagePath: file.storagePath, permanent: true },
        ipAddress: req.ip || req.socket.remoteAddress || "127.0.0.1",
        userAgent: req.headers["user-agent"] || "unknown",
        result: "SUCCESS",
      });

      res.status(200).json({
        success: true,
        message: "Berkas berhasil dihapus permanen",
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Gagal menghapus berkas permanen",
      });
    }
  }

  /**
   * Verify integrity of a stored file
   */
  public static async verifyIntegrity(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const file = await db.file.findUnique({ where: { id } });
      if (!file) {
        res.status(404).json({
          success: false,
          error: "File not found",
        });
        return;
      }

      const isValid = StorageService.verifyFileIntegrity(file.storagePath, file.checksumSha256);

      res.status(200).json({
        success: true,
        data: {
          fileId: file.id,
          originalName: file.originalName,
          expectedSha256: file.checksumSha256,
          isIntegrityValid: isValid,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to verify file integrity",
      });
    }
  }

  /**
   * Check for filename conflicts in a folder before upload
   */
  public static async checkConflicts(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { folderId, fileNames } = req.body;
      if (folderId === undefined || folderId === null || !Array.isArray(fileNames)) {
        res.status(400).json({
          success: false,
          error: "folderId and fileNames array are required",
        });
        return;
      }

      const conflicts = await StorageService.checkConflicts(folderId, fileNames);
      res.status(200).json({
        success: true,
        data: { conflicts },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to check conflicts",
      });
    }
  }

  // ==========================================
  // RESUMABLE CHUNKED UPLOAD HANDLERS
  // ==========================================

  /**
   * 1. Initialize a resumable chunk upload session
   */
  public static async initChunkUpload(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { fileName, fileSize, mimeType, folderId, chunkSize, totalChunks, conflictMode } = req.body;

      if (!fileName || !fileSize || folderId === undefined || folderId === null || !totalChunks) {
        res.status(400).json({
          success: false,
          error: "fileName, fileSize, folderId, and totalChunks are required",
        });
        return;
      }

      // Write access (owner, admin or an EDIT share link) is enforced by the route guard.

      const ipAddress = req.ip || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = req.headers["user-agent"] || "unknown";

      const session = await StorageService.initChunkUpload({
        fileName,
        fileSize: Number(fileSize),
        mimeType: mimeType || "application/octet-stream",
        folderId,
        chunkSize: Number(chunkSize) || 1024 * 1024,
        totalChunks: Number(totalChunks),
        conflictMode: conflictMode || "create_version",
        user: await AccessService.uploaderFor(req, folderId),
        ipAddress,
        userAgent,
      });

      res.status(200).json({
        success: true,
        data: session,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to initialize chunk upload",
      });
    }
  }

  /**
   * 2. Upload a single chunk
   */
  public static async uploadChunk(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { uploadId, chunkIndex } = req.body;
      const file = req.file;

      if (!uploadId || chunkIndex === undefined || !file) {
        res.status(400).json({
          success: false,
          error: "uploadId, chunkIndex, and chunk file are required",
        });
        return;
      }

      const result = await StorageService.saveChunk({
        uploadId,
        chunkIndex: Number(chunkIndex),
        buffer: file.buffer,
      });

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to save chunk",
      });
    }
  }

  /**
   * 3. Get chunk upload status (for pause/resume sync check)
   */
  public static async getChunkStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { uploadId } = req.params;
      const status = await StorageService.getChunkStatus(uploadId);

      res.status(200).json({
        success: true,
        data: status,
      });
    } catch (error: any) {
      res.status(404).json({
        success: false,
        error: error.message || "Upload session not found",
      });
    }
  }

  /**
   * 4. Complete chunk upload: assemble chunks into final file
   */
  public static async completeChunkUpload(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { uploadId } = req.body;
      if (!uploadId) {
        res.status(400).json({
          success: false,
          error: "uploadId is required",
        });
        return;
      }

      const fileRecord = await StorageService.completeChunkUpload(uploadId);

      res.status(201).json({
        success: true,
        message: "File assembled and verified successfully",
        data: { file: fileRecord },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to complete chunk upload",
      });
    }
  }

  /**
   * 5. Cancel chunk upload session and delete temporary files
   */
  public static async cancelChunkUpload(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { uploadId } = req.body;
      if (uploadId) {
        await StorageService.cancelChunkUpload(uploadId);
      }
      res.status(200).json({
        success: true,
        message: "Upload cancelled and temporary files cleaned",
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to cancel upload session",
      });
    }
  }

  // ==========================================
  // BULK OPERATIONS (MULTI-SELECTION)
  // ==========================================

  /**
   * Bulk delete multiple files (soft-delete to Trash by default, or permanent if permanent=true)
   */
  public static async bulkDeleteFiles(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { fileIds, permanent } = req.body;
      if (!Array.isArray(fileIds) || fileIds.length === 0) {
        res.status(400).json({
          success: false,
          error: "fileIds array is required",
        });
        return;
      }

      const processed: string[] = [];
      const failed: string[] = [];

      for (const id of fileIds) {
        try {
          const file = await db.file.findUnique({ where: { id } });
          if (!file) continue;

          // Check permissions
          if (req.user?.role !== "ADMIN" && file.userId !== req.user?.id) {
            failed.push(id);
            continue;
          }

          if (permanent) {
            StorageService.deleteLocalFile(file.storagePath);
            await db.file.delete({ where: { id } });

            await AuditService.log({
              userId: req.user?.id,
              action: ActivityAction.FILE_DELETED,
              resourceType: "FILE",
              resourceId: id,
              details: { originalName: file.originalName, storagePath: file.storagePath, bulk: true, permanent: true },
              ipAddress: req.ip || req.socket.remoteAddress || "127.0.0.1",
              userAgent: req.headers["user-agent"] || "unknown",
              result: "SUCCESS",
            });
          } else {
            await db.file.trash({ where: { id }, userId: req.user?.id });

            await AuditService.log({
              userId: req.user?.id,
              action: ActivityAction.FILE_TRASHED,
              resourceType: "FILE",
              resourceId: id,
              details: { originalName: file.originalName, storagePath: file.storagePath, bulk: true, softDelete: true },
              ipAddress: req.ip || req.socket.remoteAddress || "127.0.0.1",
              userAgent: req.headers["user-agent"] || "unknown",
              result: "SUCCESS",
            });
          }

          processed.push(id);
        } catch {
          failed.push(id);
        }
      }

      res.status(200).json({
        success: true,
        message: permanent ? `Berhasil menghapus permanen ${processed.length} berkas` : `Berhasil memindahkan ${processed.length} berkas ke sampah`,
        data: { count: processed.length, processedIds: processed, failedIds: failed },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to perform bulk delete",
      });
    }
  }

  /**
   * Bulk restore multiple files from Trash
   */
  public static async bulkRestoreFiles(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { fileIds } = req.body;
      if (!Array.isArray(fileIds) || fileIds.length === 0) {
        res.status(400).json({
          success: false,
          error: "fileIds array is required",
        });
        return;
      }

      const restored: string[] = [];
      const failed: string[] = [];

      for (const id of fileIds) {
        try {
          const file = await db.file.findUnique({ where: { id } });
          if (!file) continue;

          if (req.user?.role !== "ADMIN" && file.userId !== req.user?.id) {
            failed.push(id);
            continue;
          }

          await db.file.restore({ where: { id } });

          await AuditService.log({
            userId: req.user?.id,
            action: ActivityAction.FILE_RESTORED,
            resourceType: "FILE",
            resourceId: id,
            details: { originalName: file.originalName, bulk: true },
            ipAddress: req.ip || req.socket.remoteAddress || "127.0.0.1",
            userAgent: req.headers["user-agent"] || "unknown",
            result: "SUCCESS",
          });

          restored.push(id);
        } catch {
          failed.push(id);
        }
      }

      res.status(200).json({
        success: true,
        message: `Berhasil memulihkan ${restored.length} berkas dari sampah`,
        data: { count: restored.length, restoredIds: restored, failedIds: failed },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to perform bulk restore",
      });
    }
  }

  /**
   * Bulk re-sync multiple files to Google Drive
   */
  public static async bulkSyncFiles(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { fileIds } = req.body;
      if (!Array.isArray(fileIds) || fileIds.length === 0) {
        res.status(400).json({
          success: false,
          error: "fileIds array is required",
        });
        return;
      }

      const { SyncEngineService } = await import("../services/sync-engine.service.ts");
      const triggered: string[] = [];

      for (const id of fileIds) {
        try {
          await SyncEngineService.syncSingleFile(id);
          triggered.push(id);
        } catch (e) {
          console.warn(`[StorageController] Bulk sync failed for file ${id}:`, e);
        }
      }

      res.status(200).json({
        success: true,
        message: `${triggered.length} berkas dipicu untuk sinkronisasi Google Drive`,
        data: { triggeredCount: triggered.length, triggeredIds: triggered },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to perform bulk sync",
      });
    }
  }

  // ==========================================
  // MULTI-PART & BULK ZIP ARCHIVE CONTROLLERS
  // ==========================================

  /**
   * Prepare a multi-part ZIP or single archive session
   */
  public static async prepareBulkArchive(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { ArchiveService } = await import("../services/archive.service.ts");
      const { fileIds, folderId, partSizeBytes, archiveName } = req.body;

      const ipAddress = req.ip || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = req.headers["user-agent"] || "unknown";

      const session = await ArchiveService.prepareArchiveSession({
        fileIds,
        folderId,
        partSizeBytes: partSizeBytes ? Number(partSizeBytes) : undefined,
        archiveName,
        userId: req.user?.id,
        ipAddress,
        userAgent,
      });

      res.status(200).json({
        success: true,
        message: `Sesi arsip berhasil disiapkan (${session.totalParts} part, ${session.totalFiles} berkas)`,
        data: { session },
      });
    } catch (error: any) {
      console.error("[StorageController] prepareBulkArchive error:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Gagal menyiapkan arsip unduhan",
      });
    }
  }

  /**
   * Stream download a specific part of a multi-part ZIP archive
   */
  public static async downloadArchivePart(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { ArchiveService } = await import("../services/archive.service.ts");
      const { sessionId, partIndex } = req.params;

      const ipAddress = req.ip || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = req.headers["user-agent"] || "unknown";

      await ArchiveService.streamZipPart({
        sessionId,
        partIndex: parseInt(partIndex, 10),
        res,
        user: req.user,
        ipAddress,
        userAgent,
      });
    } catch (error: any) {
      console.error("[StorageController] downloadArchivePart error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: error.message || "Gagal mengunduh part arsip ZIP",
        });
      }
    }
  }

  /**
   * Get metadata info for an existing archive session
   */
  public static async getArchiveSession(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { ArchiveService } = await import("../services/archive.service.ts");
      const { sessionId } = req.params;
      const session = ArchiveService.getSession(sessionId);

      if (!session) {
        res.status(404).json({
          success: false,
          error: "Sesi arsip tidak ditemukan atau telah kadaluarsa",
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: { session },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Gagal mengambil detail sesi arsip",
      });
    }
  }

  /**
   * Direct unified ZIP stream
   */
  public static async downloadDirectZip(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { ArchiveService } = await import("../services/archive.service.ts");
      const { fileIds, archiveName } = req.body;

      if (!Array.isArray(fileIds) || fileIds.length === 0) {
        res.status(400).json({
          success: false,
          error: "fileIds array is required",
        });
        return;
      }

      const ipAddress = req.ip || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = req.headers["user-agent"] || "unknown";

      await ArchiveService.streamDirectZip({
        fileIds,
        archiveName,
        res,
        user: req.user,
        ipAddress,
        userAgent,
      });
    } catch (error: any) {
      console.error("[StorageController] downloadDirectZip error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: error.message || "Gagal membuat arsip ZIP langsung",
        });
      }
    }
  }

  public static async bulkMoveFiles(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { fileIds, targetFolderId } = req.body;
      if (!Array.isArray(fileIds) || fileIds.length === 0) {
        res.status(400).json({
          success: false,
          error: "fileIds array is required",
        });
        return;
      }
      if (!targetFolderId) {
        res.status(400).json({
          success: false,
          error: "targetFolderId is required",
        });
        return;
      }

      const allowedFileIds: string[] = [];
      const failedFileIds: string[] = [];

      for (const id of fileIds) {
        const file = await db.file.findUnique({ where: { id } });
        if (!file) continue;

        if (req.user?.role !== "ADMIN" && file.userId !== req.user?.id) {
          failedFileIds.push(id);
          continue;
        }
        allowedFileIds.push(id);
      }

      if (allowedFileIds.length === 0) {
        res.status(403).json({
          success: false,
          error: "Anda tidak memiliki izin untuk memindahkan berkas-berkas ini.",
          failed: failedFileIds,
        });
        return;
      }

      const moved = await StorageService.bulkMoveFiles({
        fileIds: allowedFileIds,
        targetFolderId,
        user: req.user,
        ipAddress: req.ip || req.socket.remoteAddress || "127.0.0.1",
        userAgent: req.headers["user-agent"] || "unknown",
      });

      res.json({
        success: true,
        message: `${moved.length} berkas berhasil dipindahkan.`,
        movedCount: moved.length,
        failedCount: failedFileIds.length,
        failed: failedFileIds,
      });
    } catch (err: any) {
      console.error("[StorageController] bulkMoveFiles error:", err);
      res.status(500).json({
        success: false,
        error: err.message || "Gagal memindahkan berkas.",
      });
    }
  }

  public static async bulkCopyFiles(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { fileIds, targetFolderId } = req.body;
      if (!Array.isArray(fileIds) || fileIds.length === 0) {
        res.status(400).json({
          success: false,
          error: "fileIds array is required",
        });
        return;
      }
      if (!targetFolderId) {
        res.status(400).json({
          success: false,
          error: "targetFolderId is required",
        });
        return;
      }

      const allowedFileIds: string[] = [];
      for (const id of fileIds) {
        const file = await db.file.findUnique({ where: { id } });
        if (!file) continue;
        allowedFileIds.push(id);
      }

      if (allowedFileIds.length === 0) {
        res.status(404).json({
          success: false,
          error: "Tidak ada berkas valid yang ditemukan untuk disalin.",
        });
        return;
      }

      const copied = await StorageService.bulkCopyFiles({
        fileIds: allowedFileIds,
        targetFolderId,
        user: req.user,
        ipAddress: req.ip || req.socket.remoteAddress || "127.0.0.1",
        userAgent: req.headers["user-agent"] || "unknown",
      });

      res.json({
        success: true,
        message: `${copied.length} berkas berhasil disalin.`,
        copiedCount: copied.length,
      });
    } catch (err: any) {
      console.error("[StorageController] bulkCopyFiles error:", err);
      res.status(500).json({
        success: false,
        error: err.message || "Gagal menyalin berkas.",
      });
    }
  }
}
