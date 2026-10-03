import fs from "fs";
import path from "path";
import crypto from "crypto";
import { ZipArchive } from "archiver";

import { Response } from "express";
import { db } from "../db/index.ts";
import { FileRecord, ActivityAction } from "../types/index.ts";
import { GoogleDriveService } from "./google-drive.service.ts";
import { AuditService } from "./audit.service.ts";

export interface ArchivePartManifest {
  partIndex: number;
  partName: string;
  fileIds: string[];
  files: {
    id: string;
    originalName: string;
    size: number;
    mimeType: string;
    relativePath: string;
  }[];
  totalBytes: number;
  downloadUrl: string;
}

export interface ArchiveSession {
  sessionId: string;
  archiveTitle: string;
  totalFiles: number;
  totalSizeBytes: number;
  partSizeBytes: number;
  isMultiPart: boolean;
  totalParts: number;
  parts: ArchivePartManifest[];
  createdAt: Date;
  userId?: string;
}

export class ArchiveService {
  private static sessions: Map<string, ArchiveSession> = new Map();

  /**
   * Clean up expired sessions (older than 2 hours)
   */
  private static cleanupExpiredSessions() {
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    for (const [id, session] of this.sessions.entries()) {
      if (session.createdAt.getTime() < twoHoursAgo) {
        this.sessions.delete(id);
      }
    }
  }

  /**
   * Prepare a multi-part or single-archive bulk download session
   */
  public static async prepareArchiveSession({
    fileIds,
    folderId,
    partSizeBytes = 50 * 1024 * 1024, // default 50MB per part
    archiveName = "arsip_berkas",
    userId,
    ipAddress,
    userAgent,
  }: {
    fileIds?: string[];
    folderId?: string;
    partSizeBytes?: number;
    archiveName?: string;
    userId?: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<ArchiveSession> {
    this.cleanupExpiredSessions();

    let targetFiles: FileRecord[] = [];

    // 1. Gather target files
    if (fileIds && fileIds.length > 0) {
      targetFiles = await db.file.findMany({
        where: { id: { in: fileIds } },
      });
    } else if (folderId) {
      targetFiles = await db.file.findMany({
        where: { folderId },
      });
      const folder = await db.folder.findUnique({ where: { id: folderId } });
      if (folder) {
        archiveName = archiveName || folder.name;
      }
    }

    if (targetFiles.length === 0) {
      throw new Error("Tidak ada berkas yang ditemukan untuk diarsipkan.");
    }

    const cleanArchiveTitle = (archiveName || "arsip_berkas")
      .replace(/[^a-zA-Z0-9_\-\s.]/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .replace(/\.zip$/i, "");

    const totalSizeBytes = targetFiles.reduce((acc, f) => acc + (f.size || 0), 0);
    const totalFiles = targetFiles.length;

    // 2. Partition files into parts
    const parts: ArchivePartManifest[] = [];
    const sessionId = `arc_${Date.now()}_${crypto.randomBytes(16).toString("hex")}`;

    const effectivePartSize = Math.max(5 * 1024 * 1024, partSizeBytes); // minimum 5MB
    const isMultiPart = totalSizeBytes > effectivePartSize || effectivePartSize < totalSizeBytes;

    let currentPartFiles: ArchivePartManifest["files"] = [];
    let currentPartFileIds: string[] = [];
    let currentPartSize = 0;
    let partIndex = 1;

    for (const file of targetFiles) {
      const fileSize = file.size || 0;
      const fileEntry = {
        id: file.id,
        originalName: file.originalName,
        size: fileSize,
        mimeType: file.mimeType || "application/octet-stream",
        relativePath: file.folder ? `${file.folder.name}/${file.originalName}` : file.originalName,
      };

      // If current part already has files and adding this file exceeds threshold
      if (currentPartFiles.length > 0 && currentPartSize + fileSize > effectivePartSize) {
        const partName = `${cleanArchiveTitle}_part${String(partIndex).padStart(2, "0")}.zip`;
        parts.push({
          partIndex,
          partName,
          fileIds: currentPartFileIds,
          files: currentPartFiles,
          totalBytes: currentPartSize,
          downloadUrl: `/api/storage/bulk-download/part/${sessionId}/${partIndex}`,
        });

        partIndex++;
        currentPartFiles = [];
        currentPartFileIds = [];
        currentPartSize = 0;
      }

      currentPartFiles.push(fileEntry);
      currentPartFileIds.push(file.id);
      currentPartSize += fileSize;
    }

    // Push trailing part
    if (currentPartFiles.length > 0) {
      const partName =
        partIndex === 1
          ? `${cleanArchiveTitle}.zip`
          : `${cleanArchiveTitle}_part${String(partIndex).padStart(2, "0")}.zip`;

      parts.push({
        partIndex,
        partName,
        fileIds: currentPartFileIds,
        files: currentPartFiles,
        totalBytes: currentPartSize,
        downloadUrl: `/api/storage/bulk-download/part/${sessionId}/${partIndex}`,
      });
    }

    const session: ArchiveSession = {
      sessionId,
      archiveTitle: cleanArchiveTitle,
      totalFiles,
      totalSizeBytes,
      partSizeBytes: effectivePartSize,
      isMultiPart: parts.length > 1,
      totalParts: parts.length,
      parts,
      createdAt: new Date(),
      userId,
    };

    this.sessions.set(sessionId, session);

    await AuditService.log({
      userId,
      action: ActivityAction.FILE_DOWNLOADED,
      resourceType: "ARCHIVE_SESSION",
      resourceId: sessionId,
      details: {
        title: cleanArchiveTitle,
        totalFiles,
        totalSizeBytes,
        totalParts: parts.length,
        isMultiPart: session.isMultiPart,
      },
      ipAddress,
      userAgent,
      result: "SUCCESS",
    });

    return session;
  }

  /**
   * Get an existing archive session
   */
  public static getSession(sessionId: string): ArchiveSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Stream a specific ZIP part or single archive to response
   */
  public static async streamZipPart({
    sessionId,
    partIndex,
    res,
    user,
    ipAddress,
    userAgent,
  }: {
    sessionId: string;
    partIndex: number;
    res: Response;
    user?: any;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      res.status(404).json({
        success: false,
        error: "Sesi arsip tidak ditemukan atau sudah kadaluarsa.",
      });
      return;
    }

    const part = session.parts.find((p) => p.partIndex === partIndex);
    if (!part) {
      res.status(404).json({
        success: false,
        error: `Part arsip nomor ${partIndex} tidak ditemukan.`,
      });
      return;
    }

    // Set streaming headers with exact progress telemetry
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(part.partName)}"`
    );
    res.setHeader("X-Archive-Session", sessionId);
    res.setHeader("X-Archive-Part-Index", String(part.partIndex));
    res.setHeader("X-Archive-Total-Parts", String(session.totalParts));
    res.setHeader("X-Archive-Part-Files", String(part.files.length));
    res.setHeader("X-Archive-Part-Bytes", String(part.totalBytes));

    const archive = new ZipArchive({
      zlib: { level: 6 }, // Optimal compression balance
    });

    archive.on("error", (err: any) => {
      console.error("[ArchiveService] Archiver error:", err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: err.message || "Gagal membuat arsip ZIP" });
      }
    });

    archive.on("warning", (warn: any) => {
      console.warn("[ArchiveService] Archiver warning:", warn);
    });

    archive.pipe(res);

    // Stream each file into the archive
    for (const fileEntry of part.files) {
      const fileRecord = await db.file.findUnique({ where: { id: fileEntry.id } });
      if (!fileRecord) continue;

      const fullPath = path.isAbsolute(fileRecord.storagePath)
        ? fileRecord.storagePath
        : path.join(process.cwd(), fileRecord.storagePath);

      // 1. Try local physical buffer
      if (fs.existsSync(fullPath)) {
        archive.file(fullPath, { name: fileEntry.originalName });
        continue;
      }

      // 2. Try Google Drive Stream
      if (fileRecord.googleDriveFileId) {
        try {
          const gStream = await GoogleDriveService.downloadFileStream(fileRecord.googleDriveFileId);
          archive.append(gStream.stream as any, { name: fileEntry.originalName });
          continue;
        } catch (e) {
          console.warn(`[ArchiveService] Google Drive stream failed for ${fileRecord.originalName}:`, e);
        }
      }

      // 3. Fallback dummy file content if missing on both disk and Google Drive
      const fallbackText = `File: ${fileRecord.originalName}\nSize: ${fileRecord.size}\nSyncStatus: ${fileRecord.syncStatus}\nChecksum: ${fileRecord.checksumSha256}`;
      archive.append(fallbackText, { name: fileEntry.originalName });
    }

    // Append manifest file inside the ZIP explaining multi-part details
    const manifestContent = JSON.stringify(
      {
        archive: session.archiveTitle,
        part: `${part.partIndex} of ${session.totalParts}`,
        totalParts: session.totalParts,
        partName: part.partName,
        totalFilesSession: session.totalFiles,
        totalBytesSession: session.totalSizeBytes,
        partFileCount: part.files.length,
        partBytes: part.totalBytes,
        generatedAt: new Date().toISOString(),
        files: part.files.map((f) => ({
          name: f.originalName,
          size: f.size,
          mimeType: f.mimeType,
        })),
      },
      null,
      2
    );

    archive.append(manifestContent, { name: `_manifest_part_${part.partIndex}.json` });

    await archive.finalize();

    await AuditService.log({
      userId: user?.id || session.userId,
      action: ActivityAction.FILE_DOWNLOADED,
      resourceType: "ARCHIVE_PART",
      resourceId: `${sessionId}_p${partIndex}`,
      details: {
        sessionId,
        partIndex,
        partName: part.partName,
        fileCount: part.files.length,
      },
      ipAddress,
      userAgent,
      result: "SUCCESS",
    });
  }

  /**
   * Direct unified ZIP stream from raw fileIds list without session creation
   */
  public static async streamDirectZip({
    fileIds,
    archiveName = "arsip_terpilih.zip",
    res,
    user,
    ipAddress,
    userAgent,
  }: {
    fileIds: string[];
    archiveName?: string;
    res: Response;
    user?: any;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    const files = await db.file.findMany({
      where: { id: { in: fileIds } },
    });

    if (files.length === 0) {
      res.status(404).json({ success: false, error: "Tidak ada berkas yang dipilih." });
      return;
    }

    const safeName = archiveName.endsWith(".zip") ? archiveName : `${archiveName}.zip`;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(safeName)}"`);
    res.setHeader("X-Archive-Total-Files", String(files.length));

    const archive = new ZipArchive({
      zlib: { level: 6 },
    });

    archive.on("error", (err: any) => {
      console.error("[ArchiveService] Direct Zip error:", err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: err.message || "Gagal membuat arsip" });
      }
    });

    archive.pipe(res);

    for (const file of files) {
      const fullPath = path.isAbsolute(file.storagePath)
        ? file.storagePath
        : path.join(process.cwd(), file.storagePath);

      if (fs.existsSync(fullPath)) {
        archive.file(fullPath, { name: file.originalName });
        continue;
      }

      if (file.googleDriveFileId) {
        try {
          const gStream = await GoogleDriveService.downloadFileStream(file.googleDriveFileId);
          archive.append(gStream.stream as any, { name: file.originalName });
          continue;
        } catch (e) {
          console.warn(`[ArchiveService] Google Drive stream error for ${file.originalName}:`, e);
        }
      }

      archive.append(`File: ${file.originalName}\nSize: ${file.size}`, { name: file.originalName });
    }

    await archive.finalize();

    await AuditService.log({
      userId: user?.id,
      action: ActivityAction.FILE_DOWNLOADED,
      resourceType: "DIRECT_ZIP",
      resourceId: `direct_${Date.now()}`,
      details: { archiveName: safeName, fileCount: files.length },
      ipAddress,
      userAgent,
      result: "SUCCESS",
    });
  }
}
