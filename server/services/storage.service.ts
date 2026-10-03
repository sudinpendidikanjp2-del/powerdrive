import fs from "fs";
import path from "path";
import crypto from "crypto";
import { db } from "../db/index.ts";
import { ActivityAction, FileRecord, FolderRecord, SyncStatus, UserRecord } from "../types/index.ts";
import { AuditService } from "./audit.service.ts";
import { PreviewService } from "./preview.service.ts";

export function getMimeType(fileName: string, dbMimeType?: string): string {
  if (dbMimeType && dbMimeType !== "application/octet-stream" && dbMimeType !== "binary/octet-stream" && dbMimeType.trim().length > 0) {
    return dbMimeType;
  }
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const mimeMap: Record<string, string> = {
    // Video
    mp4: "video/mp4",
    webm: "video/webm",
    ogg: "video/ogg",
    ogv: "video/ogg",
    mov: "video/quicktime",
    m4v: "video/mp4",
    mkv: "video/x-matroska",
    avi: "video/x-msvideo",
    wmv: "video/x-ms-wmv",
    flv: "video/x-flv",
    "3gp": "video/3gpp",
    // Image
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    bmp: "image/bmp",
    ico: "image/x-icon",
    tif: "image/tiff",
    tiff: "image/tiff",
    avif: "image/avif",
    // Audio
    mp3: "audio/mpeg",
    wav: "audio/wav",
    oga: "audio/ogg",
    m4a: "audio/mp4",
    aac: "audio/aac",
    flac: "audio/flac",
    wma: "audio/x-ms-wma",
    // Documents
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    txt: "text/plain; charset=utf-8",
    csv: "text/csv; charset=utf-8",
    json: "application/json; charset=utf-8",
    xml: "application/xml; charset=utf-8",
    html: "text/html; charset=utf-8",
    htm: "text/html; charset=utf-8",
    css: "text/css; charset=utf-8",
    js: "application/javascript; charset=utf-8",
    ts: "text/plain; charset=utf-8",
    zip: "application/zip",
    rar: "application/x-rar-compressed",
    "7z": "application/x-7z-compressed",
    tar: "application/x-tar",
    gz: "application/gzip",
  };
  return mimeMap[ext] || dbMimeType || "application/octet-stream";
}

export interface StorageStats {
  totalFiles: number;
  totalSizeBytes: number;
  totalSizeFormatted: string;
  storageBasePath: string;
  pendingSyncCount: number;
  syncedCount: number;
  failedSyncCount: number;
}

export interface ChunkUploadSession {
  uploadId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  folderId: string;
  chunkSize: number;
  totalChunks: number;
  uploadedChunks: Set<number>;
  conflictMode?: "create_version" | "overwrite" | "rename" | "skip";
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
  updatedAt: Date;
}

export class StorageService {
  private static basePath = path.join(process.cwd(), "storage", "uploads");
  private static tempChunksPath = path.join(process.cwd(), "storage", "temp_chunks");
  private static chunkSessions: Map<string, ChunkUploadSession> = new Map();

  /**
   * Resolve physical path on disk robustly
   */
  public static resolveStoragePath(storagePath: string): string | null {
    if (!storagePath) return null;
    if (path.isAbsolute(storagePath) && fs.existsSync(storagePath)) {
      return storagePath;
    }
    const cwdPath = path.join(process.cwd(), storagePath);
    if (fs.existsSync(cwdPath)) {
      return cwdPath;
    }
    const cleanPath = storagePath.replace(/^\/+/, "");
    const cleanCwdPath = path.join(process.cwd(), cleanPath);
    if (fs.existsSync(cleanCwdPath)) {
      return cleanCwdPath;
    }
    return null;
  }

  /**
   * Ensure date-partitioned storage directory exists: /storage/uploads/YYYY/MM/DD/
   */
  public static getPartitionedPath(date: Date = new Date()): { absoluteDir: string; relativeDir: string } {
    const year = String(date.getFullYear());
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    const relativeDir = path.join("storage", "uploads", year, month, day);
    const absoluteDir = path.join(process.cwd(), relativeDir);

    if (!fs.existsSync(absoluteDir)) {
      fs.mkdirSync(absoluteDir, { recursive: true });
    }

    return { absoluteDir, relativeDir };
  }

  /**
   * Initialize a resumable chunk upload session
   */
  /** Session metadata for authorization checks, recovering it from disk after a restart. */
  public static peekChunkSession(uploadId: string): { folderId: string; userId?: string } | null {
    if (!/^upl_[\w]+$/.test(uploadId)) return null;
    const live = this.chunkSessions.get(uploadId);
    if (live) return { folderId: live.folderId, userId: live.userId };
    const metaFile = path.join(this.tempChunksPath, uploadId, "meta.json");
    if (!fs.existsSync(metaFile)) return null;
    try {
      const meta = JSON.parse(fs.readFileSync(metaFile, "utf-8"));
      return { folderId: meta.folderId, userId: meta.userId };
    } catch {
      return null;
    }
  }

  public static async initChunkUpload({
    fileName,
    fileSize,
    mimeType,
    folderId,
    chunkSize,
    totalChunks,
    conflictMode,
    user,
    ipAddress,
    userAgent,
  }: {
    fileName: string;
    fileSize: number;
    mimeType: string;
    folderId: string;
    chunkSize: number;
    totalChunks: number;
    conflictMode?: "create_version" | "overwrite" | "rename" | "skip";
    user?: UserRecord;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{ uploadId: string; chunkSize: number; totalChunks: number; uploadedChunks: number[] }> {
    // 1. Verify folder exists if target is a subfolder
    const targetFolderId = !folderId || folderId === "root" || folderId === "null" ? null : folderId;
    if (targetFolderId) {
      const folder = await db.folder.findUnique({ where: { id: targetFolderId } });
      if (!folder) {
        throw new Error(`Target folder with id ${folderId} does not exist`);
      }
    }

    // 2. Generate unique uploadId
    const uploadId = `upl_${Date.now()}_${crypto.randomBytes(16).toString("hex")}`;
    const chunkDir = path.join(this.tempChunksPath, uploadId);
    if (!fs.existsSync(chunkDir)) {
      fs.mkdirSync(chunkDir, { recursive: true });
    }

    const session: ChunkUploadSession = {
      uploadId,
      fileName,
      fileSize,
      mimeType: mimeType || "application/octet-stream",
      folderId: targetFolderId || "root",
      chunkSize,
      totalChunks,
      uploadedChunks: new Set<number>(),
      conflictMode: conflictMode || "create_version",
      userId: user?.id,
      ipAddress,
      userAgent,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Save session in memory and write session meta to disk for recovery
    this.chunkSessions.set(uploadId, session);
    fs.writeFileSync(
      path.join(chunkDir, "meta.json"),
      JSON.stringify({
        uploadId,
        fileName,
        fileSize,
        mimeType,
        folderId,
        chunkSize,
        totalChunks,
        conflictMode: session.conflictMode,
        userId: user?.id,
        createdAt: session.createdAt.toISOString(),
      })
    );

    return {
      uploadId,
      chunkSize,
      totalChunks,
      uploadedChunks: [],
    };
  }

  /**
   * Save a single chunk to the staging directory
   */
  public static async saveChunk({
    uploadId,
    chunkIndex,
    buffer,
  }: {
    uploadId: string;
    chunkIndex: number;
    buffer: Buffer;
  }): Promise<{ success: boolean; chunkIndex: number; uploadedCount: number; totalChunks: number }> {
    let session = this.chunkSessions.get(uploadId);
    const chunkDir = path.join(this.tempChunksPath, uploadId);

    // If memory was cleared, restore session from disk metadata
    if (!session) {
      const metaFile = path.join(chunkDir, "meta.json");
      if (fs.existsSync(metaFile)) {
        const meta = JSON.parse(fs.readFileSync(metaFile, "utf-8"));
        session = {
          ...meta,
          createdAt: new Date(meta.createdAt),
          updatedAt: new Date(),
          uploadedChunks: new Set<number>(),
        };
        // Scan existing chunk files
        const existingFiles = fs.readdirSync(chunkDir);
        for (const file of existingFiles) {
          if (file.startsWith("chunk_")) {
            const idx = parseInt(file.replace("chunk_", ""), 10);
            if (!isNaN(idx)) session.uploadedChunks.add(idx);
          }
        }
        this.chunkSessions.set(uploadId, session);
      } else {
        throw new Error(`Upload session ${uploadId} not found or expired`);
      }
    }

    if (chunkIndex < 0 || chunkIndex >= session.totalChunks) {
      throw new Error(`Invalid chunk index ${chunkIndex} (Total: ${session.totalChunks})`);
    }

    // Write chunk buffer to disk
    const chunkPath = path.join(chunkDir, `chunk_${chunkIndex}`);
    fs.writeFileSync(chunkPath, buffer);
    session.uploadedChunks.add(chunkIndex);
    session.updatedAt = new Date();

    return {
      success: true,
      chunkIndex,
      uploadedCount: session.uploadedChunks.size,
      totalChunks: session.totalChunks,
    };
  }

  /**
   * Check status of an upload session (for resuming after internet disconnection)
   */
  public static async getChunkStatus(uploadId: string): Promise<{
    uploadId: string;
    fileName: string;
    fileSize: number;
    totalChunks: number;
    uploadedChunks: number[];
    isComplete: boolean;
  }> {
    let session = this.chunkSessions.get(uploadId);
    const chunkDir = path.join(this.tempChunksPath, uploadId);

    if (!session) {
      const metaFile = path.join(chunkDir, "meta.json");
      if (fs.existsSync(metaFile)) {
        const meta = JSON.parse(fs.readFileSync(metaFile, "utf-8"));
        session = {
          ...meta,
          createdAt: new Date(meta.createdAt),
          updatedAt: new Date(),
          uploadedChunks: new Set<number>(),
        };
        const existingFiles = fs.readdirSync(chunkDir);
        for (const file of existingFiles) {
          if (file.startsWith("chunk_")) {
            const idx = parseInt(file.replace("chunk_", ""), 10);
            if (!isNaN(idx)) session.uploadedChunks.add(idx);
          }
        }
        this.chunkSessions.set(uploadId, session);
      } else {
        throw new Error(`Upload session ${uploadId} not found`);
      }
    }

    return {
      uploadId,
      fileName: session.fileName,
      fileSize: session.fileSize,
      totalChunks: session.totalChunks,
      uploadedChunks: Array.from(session.uploadedChunks).sort((a, b) => a - b),
      isComplete: session.uploadedChunks.size === session.totalChunks,
    };
  }

  /**
   * Complete chunked upload: Concatenate all chunks in order, verify integrity, create/update File record with versioning & SyncJob
   */
  public static async completeChunkUpload(uploadId: string): Promise<FileRecord> {
    let session = this.chunkSessions.get(uploadId);
    const chunkDir = path.join(this.tempChunksPath, uploadId);

    if (!session) {
      const metaFile = path.join(chunkDir, "meta.json");
      if (fs.existsSync(metaFile)) {
        const meta = JSON.parse(fs.readFileSync(metaFile, "utf-8"));
        session = {
          ...meta,
          createdAt: new Date(meta.createdAt),
          updatedAt: new Date(),
          uploadedChunks: new Set<number>(),
        };
        const existingFiles = fs.readdirSync(chunkDir);
        for (const file of existingFiles) {
          if (file.startsWith("chunk_")) {
            const idx = parseInt(file.replace("chunk_", ""), 10);
            if (!isNaN(idx)) session.uploadedChunks.add(idx);
          }
        }
        this.chunkSessions.set(uploadId, session);
      } else {
        throw new Error(`Upload session ${uploadId} not found`);
      }
    }

    // Verify all chunks are present
    const missingChunks: number[] = [];
    for (let i = 0; i < session.totalChunks; i++) {
      const chunkFile = path.join(chunkDir, `chunk_${i}`);
      if (!fs.existsSync(chunkFile)) {
        missingChunks.push(i);
      }
    }

    if (missingChunks.length > 0) {
      throw new Error(`Cannot assemble file: ${missingChunks.length} chunk(s) missing [${missingChunks.slice(0, 5).join(", ")}...]`);
    }

    // Prepare final destination
    const targetFolderId = !session.folderId || session.folderId === "root" || session.folderId === "null" ? null : session.folderId;
    let folder: FolderRecord | null = null;
    if (targetFolderId) {
      folder = await db.folder.findUnique({ where: { id: targetFolderId } });
    }

    const { absoluteDir, relativeDir } = this.getPartitionedPath();
    if (!fs.existsSync(absoluteDir)) {
      fs.mkdirSync(absoluteDir, { recursive: true });
    }

    const sanitizedName = session.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storedName = `${Date.now()}_${crypto.randomBytes(4).toString("hex")}_${sanitizedName}`;
    const absoluteFilePath = path.join(absoluteDir, storedName);
    const relativeFilePath = path.join(relativeDir, storedName);

    // Concatenate chunks sequentially into final destination and wait for file flush
    const hash = crypto.createHash("sha256");
    await new Promise<void>((resolve, reject) => {
      const writeStream = fs.createWriteStream(absoluteFilePath, { flags: "w" });
      writeStream.on("error", (err) => {
        reject(err);
      });
      writeStream.on("finish", () => {
        resolve();
      });

      try {
        for (let i = 0; i < session.totalChunks; i++) {
          const chunkPath = path.join(chunkDir, `chunk_${i}`);
          const chunkData = fs.readFileSync(chunkPath);
          writeStream.write(chunkData);
          hash.update(chunkData);
        }
        writeStream.end();
      } catch (err) {
        writeStream.destroy();
        reject(err);
      }
    });

    const checksumSha256 = hash.digest("hex");
    const finalStats = fs.statSync(absoluteFilePath);
    const resolvedMimeType = getMimeType(session.fileName, session.mimeType);

    // Clean up temporary chunk directory
    try {
      fs.rmSync(chunkDir, { recursive: true, force: true });
    } catch (e) {
      console.warn(`[StorageService] Warning cleaning temp chunk dir ${chunkDir}:`, e);
    }
    this.chunkSessions.delete(uploadId);

    // Check if an existing file with the same originalName in this folder exists
    const existingFile = await db.file.findFirst({
      where: { folderId: targetFolderId, originalName: session.fileName, isTrashed: false },
    });

    const isSyncEnabled = folder ? folder.syncToGoogleDrive !== false : true;
    const initialSyncStatus = isSyncEnabled ? SyncStatus.PENDING : SyncStatus.LOCAL_ONLY;

    let fileRecord: FileRecord;

    if (existingFile && session.conflictMode !== "rename") {
      // Create new version and preserve old version in versionHistory
      const currentVer = existingFile.version || 1;
      const nextVer = currentVer + 1;
      const history = Array.isArray(existingFile.versionHistory) ? [...existingFile.versionHistory] : [];
      
      history.push({
        version: currentVer,
        storedName: existingFile.storedName,
        storagePath: existingFile.storagePath,
        size: existingFile.size,
        checksumSha256: existingFile.checksumSha256,
        mimeType: existingFile.mimeType,
        createdAt: existingFile.updatedAt || existingFile.createdAt,
        uploadedBy: session.userId || "Pengguna",
      });

      fileRecord = (await db.file.update({
        where: { id: existingFile.id },
        data: {
          storedName,
          storagePath: relativeFilePath,
          size: finalStats.size,
          checksumSha256,
          mimeType: resolvedMimeType || existingFile.mimeType,
          version: nextVer,
          versionHistory: history,
          syncStatus: initialSyncStatus,
          syncAttempts: 0,
          lastError: null,
          updatedAt: new Date(),
        },
      })) as FileRecord;

      // Update or create Sync Job only if sync is enabled for this folder
      if (isSyncEnabled) {
        const existingJob = await db.syncJob.findFirst({ where: { fileId: existingFile.id } });
        if (existingJob) {
          await db.syncJob.update({
            where: { id: existingJob.id },
            data: {
              status: SyncStatus.PENDING,
              scheduledAt: new Date(),
              attempts: 0,
              lastError: null,
            },
          });
        } else {
          await db.syncJob.create({
            data: {
              fileId: existingFile.id,
              status: SyncStatus.PENDING,
              attempts: 0,
              maxAttempts: 5,
              scheduledAt: new Date(),
              startedAt: null,
              completedAt: null,
              lastError: null,
            },
          });
        }
      }
    } else {
      let finalName = session.fileName;
      if (existingFile && session.conflictMode === "rename") {
        finalName = await this.getAvailableFileName(targetFolderId, session.fileName);
      }

      const resolvedMimeType = getMimeType(session.fileName, session.mimeType);

      fileRecord = await db.file.create({
        data: {
          userId: session.userId || "usr_anonymous",
          folderId: targetFolderId,
          originalName: finalName,
          storedName,
          storagePath: relativeFilePath,
          mimeType: resolvedMimeType,
          size: finalStats.size,
          checksumSha256,
          version: 1,
          versionHistory: [],
          syncStatus: initialSyncStatus,
          googleDriveFileId: null,
          googleDriveFolderId: folder ? folder.googleDriveFolderId || null : null,
          googleDriveWebViewLink: null,
          syncAttempts: 0,
          lastError: null,
          syncedAt: null,
        },
      });

      // Create Sync Job for background worker only if sync is enabled
      if (isSyncEnabled) {
        await db.syncJob.create({
          data: {
            fileId: fileRecord.id,
            status: SyncStatus.PENDING,
            attempts: 0,
            maxAttempts: 5,
            scheduledAt: new Date(),
            startedAt: null,
            completedAt: null,
            lastError: null,
          },
        });
      }
    }

    // Audit log
    await AuditService.log({
      userId: session.userId,
      action: ActivityAction.FILE_UPLOAD_COMPLETED,
      resourceType: "FILE",
      resourceId: fileRecord.id,
      details: {
        originalName: session.fileName,
        version: fileRecord.version || 1,
        size: finalStats.size,
        mimeType: session.mimeType,
        checksumSha256,
        folderName: folder ? folder.name : "Drive Saya",
        uploadMethod: "RESUMABLE_CHUNKED",
        totalChunks: session.totalChunks,
      },
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      result: "SUCCESS",
    });

    // Trigger Preview Worker immediately for the uploaded file
    PreviewService.triggerImmediateProcess();

    return fileRecord;
  }

  /**
   * Cancel and cleanup an unfinished chunk upload session
   */
  public static async cancelChunkUpload(uploadId: string): Promise<void> {
    const chunkDir = path.join(this.tempChunksPath, uploadId);
    if (fs.existsSync(chunkDir)) {
      try {
        fs.rmSync(chunkDir, { recursive: true, force: true });
      } catch (e) {
        console.warn(`[StorageService] Error cleaning cancelled upload ${uploadId}:`, e);
      }
    }
    this.chunkSessions.delete(uploadId);
  }

  /**
   * Get next available non-conflicting filename (e.g. Doc (1).pdf)
   */
  public static async getAvailableFileName(folderId: string | null, fileName: string): Promise<string> {
    const targetFolderId = !folderId || folderId === "root" || folderId === "null" ? null : folderId;
    const extIndex = fileName.lastIndexOf(".");
    const namePart = extIndex !== -1 ? fileName.substring(0, extIndex) : fileName;
    const extPart = extIndex !== -1 ? fileName.substring(extIndex) : "";

    let candidate = fileName;
    let counter = 1;

    while (true) {
      const existing = await db.file.findFirst({
        where: { folderId: targetFolderId, originalName: candidate, isTrashed: false },
      });
      if (!existing) return candidate;
      candidate = `${namePart} (${counter})${extPart}`;
      counter++;
    }
  }

  /**
   * Check for duplicate files in a folder before upload
   */
  public static async checkConflicts(
    folderId: string | null,
    fileNames: string[]
  ): Promise<Array<{ fileName: string; existingFile: FileRecord }>> {
    const targetFolderId = !folderId || folderId === "root" || folderId === "null" ? null : folderId;
    const conflicts: Array<{ fileName: string; existingFile: FileRecord }> = [];
    for (const fileName of fileNames) {
      const existing = await db.file.findFirst({
        where: { folderId: targetFolderId, originalName: fileName, isTrashed: false },
      });
      if (existing) {
        conflicts.push({ fileName, existingFile: existing });
      }
    }
    return conflicts;
  }

  /**
   * Compute SHA-256 checksum from file buffer or path
   */
  public static calculateSha256(filePathOrBuffer: string | Buffer): string {
    const hash = crypto.createHash("sha256");
    if (typeof filePathOrBuffer === "string") {
      const fileBuffer = fs.readFileSync(filePathOrBuffer);
      hash.update(fileBuffer);
    } else {
      hash.update(filePathOrBuffer);
    }
    return hash.digest("hex");
  }

  /**
   * Save uploaded file into local storage buffer and register File & SyncJob records
   */
  public static async saveFile({
    originalName,
    mimeType,
    buffer,
    size,
    folderId,
    conflictMode = "create_version",
    user,
    ipAddress,
    userAgent,
  }: {
    originalName: string;
    mimeType: string;
    buffer: Buffer;
    size: number;
    folderId: string | null;
    conflictMode?: "create_version" | "overwrite" | "rename" | "skip";
    user?: UserRecord;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<FileRecord> {
    // 1. Verify folder exists if target is a subfolder
    const targetFolderId = !folderId || folderId === "root" || folderId === "null" ? null : folderId;
    let folder: FolderRecord | null = null;
    if (targetFolderId) {
      folder = await db.folder.findUnique({ where: { id: targetFolderId } });
      if (!folder) {
        throw new Error(`Target folder with id ${folderId} does not exist`);
      }
    }

    // 2. Format safe storage filename
    const { absoluteDir, relativeDir } = this.getPartitionedPath();
    const sanitizedName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storedName = `${Date.now()}_${crypto.randomBytes(4).toString("hex")}_${sanitizedName}`;
    const absoluteFilePath = path.join(absoluteDir, storedName);
    const relativeFilePath = path.join(relativeDir, storedName);

    // 3. Write file to disk
    fs.writeFileSync(absoluteFilePath, buffer);

    // 4. Calculate SHA-256 Checksum
    const checksumSha256 = this.calculateSha256(buffer);

    // 5. Check duplicate/versioning
    const existingFile = await db.file.findFirst({
      where: { folderId: targetFolderId, originalName, isTrashed: false },
    });

    const isSyncEnabled = folder ? folder.syncToGoogleDrive !== false : true;
    const initialSyncStatus = isSyncEnabled ? SyncStatus.PENDING : SyncStatus.LOCAL_ONLY;

    let fileRecord: FileRecord;

    const resolvedMimeType = getMimeType(originalName, mimeType);

    if (existingFile && conflictMode !== "rename") {
      const currentVer = existingFile.version || 1;
      const nextVer = currentVer + 1;
      const history = Array.isArray(existingFile.versionHistory) ? [...existingFile.versionHistory] : [];
      
      history.push({
        version: currentVer,
        storedName: existingFile.storedName,
        storagePath: existingFile.storagePath,
        size: existingFile.size,
        checksumSha256: existingFile.checksumSha256,
        mimeType: existingFile.mimeType,
        createdAt: existingFile.updatedAt || existingFile.createdAt,
        uploadedBy: user?.name || "Pengguna",
      });

      fileRecord = (await db.file.update({
        where: { id: existingFile.id },
        data: {
          storedName,
          storagePath: relativeFilePath,
          size,
          checksumSha256,
          mimeType: resolvedMimeType || existingFile.mimeType,
          version: nextVer,
          versionHistory: history,
          syncStatus: initialSyncStatus,
          syncAttempts: 0,
          lastError: null,
          updatedAt: new Date(),
        },
      })) as FileRecord;

      // Update sync job only if sync is enabled
      if (isSyncEnabled) {
        const existingJob = await db.syncJob.findFirst({ where: { fileId: existingFile.id } });
        if (existingJob) {
          await db.syncJob.update({
            where: { id: existingJob.id },
            data: {
              status: SyncStatus.PENDING,
              scheduledAt: new Date(),
              attempts: 0,
              lastError: null,
            },
          });
        } else {
          await db.syncJob.create({
            data: {
              fileId: existingFile.id,
              status: SyncStatus.PENDING,
              attempts: 0,
              maxAttempts: 5,
              scheduledAt: new Date(),
              startedAt: null,
              completedAt: null,
              lastError: null,
            },
          });
        }
      }
    } else {
      let finalName = originalName;
      if (existingFile && conflictMode === "rename") {
        finalName = await this.getAvailableFileName(targetFolderId, originalName);
      }

      fileRecord = await db.file.create({
        data: {
          userId: user?.id || "usr_anonymous",
          folderId: targetFolderId,
          originalName: finalName,
          storedName,
          storagePath: relativeFilePath,
          mimeType: resolvedMimeType,
          size,
          checksumSha256,
          version: 1,
          versionHistory: [],
          syncStatus: initialSyncStatus,
          googleDriveFileId: null,
          googleDriveFolderId: folder ? folder.googleDriveFolderId || null : null,
          googleDriveWebViewLink: null,
          syncAttempts: 0,
          lastError: null,
          syncedAt: null,
        },
      });

      // 6. Create Initial Sync Job for the Background Sync Worker only if sync is enabled
      if (isSyncEnabled) {
        await db.syncJob.create({
          data: {
            fileId: fileRecord.id,
            status: SyncStatus.PENDING,
            attempts: 0,
            maxAttempts: 5,
            scheduledAt: new Date(),
            startedAt: null,
            completedAt: null,
            lastError: null,
          },
        });
      }
    }

    // 7. Audit log
    await AuditService.log({
      userId: user?.id,
      action: ActivityAction.FILE_UPLOAD_COMPLETED,
      resourceType: "FILE",
      resourceId: fileRecord.id,
      details: {
        originalName: fileRecord.originalName,
        version: fileRecord.version || 1,
        size,
        mimeType,
        checksumSha256,
        folderName: folder.name,
        syncStatus: initialSyncStatus,
      },
      ipAddress,
      userAgent,
      result: "SUCCESS",
    });

    // Trigger Preview Worker immediately for the uploaded file
    PreviewService.triggerImmediateProcess();

    return fileRecord;
  }

  /**
   * Verify file checksum matches database record
   */
  public static verifyFileIntegrity(filePath: string, expectedSha256: string): boolean {
    const fullPath = this.resolveStoragePath(filePath) || (path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath));
    if (!fs.existsSync(fullPath)) {
      return false;
    }
    const actualChecksum = this.calculateSha256(fullPath);
    return actualChecksum.toLowerCase() === expectedSha256.toLowerCase();
  }

  /**
   * Read file buffer or stream
   */
  public static getFileStream(storagePath: string): fs.ReadStream {
    const fullPath = this.resolveStoragePath(storagePath);
    if (!fullPath || !fs.existsSync(fullPath)) {
      throw new Error(`File not found at storage path: ${storagePath}`);
    }
    return fs.createReadStream(fullPath);
  }

  /**
   * Delete file from local disk buffer
   */
  public static deleteLocalFile(storagePath: string): boolean {
    try {
      const fullPath = this.resolveStoragePath(storagePath);
      if (fullPath && fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        return true;
      }
      return false;
    } catch (err) {
      console.error(`[StorageService] Failed to delete file at ${storagePath}:`, err);
      return false;
    }
  }

  /**
   * Calculate storage disk metrics and sync queue statistics
   */
  public static async getStorageStats(): Promise<any> {
    const files = await db.file.findMany();
    let totalSizeBytes = 0;
    const breakdown = {
      pending: 0,
      processing: 0,
      synced: 0,
      retrying: 0,
      failed: 0,
      localOnly: 0,
    };

    for (const f of files) {
      totalSizeBytes += f.size || 0;
      if (f.syncStatus === SyncStatus.PENDING) {
        breakdown.pending++;
      } else if (f.syncStatus === SyncStatus.PROCESSING) {
        breakdown.processing++;
      } else if (f.syncStatus === SyncStatus.SYNCED) {
        breakdown.synced++;
      } else if (f.syncStatus === SyncStatus.RETRYING) {
        breakdown.retrying++;
      } else if (f.syncStatus === SyncStatus.FAILED) {
        breakdown.failed++;
      } else if (f.syncStatus === SyncStatus.LOCAL_ONLY) {
        breakdown.localOnly++;
      }
    }

    const totalSizeFormatted = this.formatBytes(totalSizeBytes);

    return {
      totalFiles: files.length,
      totalSizeBytes,
      totalSizeFormatted,
      storageBasePath: this.basePath,
      storageDirectory: this.basePath,
      pendingSyncCount: breakdown.pending + breakdown.processing + breakdown.retrying,
      syncedCount: breakdown.synced,
      failedSyncCount: breakdown.failed,
      localOnlyCount: breakdown.localOnly,
      syncStatusBreakdown: breakdown,
    };
  }


  public static async bulkMoveFiles({
    fileIds,
    targetFolderId,
    user,
    ipAddress,
    userAgent,
  }: {
    fileIds: string[];
    targetFolderId: string;
    user?: UserRecord;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<FileRecord[]> {
    const targetFolder = await db.folder.findUnique({ where: { id: targetFolderId } });
    if (!targetFolder) {
      throw new Error(`Target folder with id ${targetFolderId} does not exist`);
    }

    const movedFiles: FileRecord[] = [];
    const isSyncEnabled = targetFolder.syncToGoogleDrive !== false || !!targetFolder.googleDriveFolderId;
    const initialSyncStatus = isSyncEnabled ? SyncStatus.PENDING : SyncStatus.LOCAL_ONLY;

    for (const fileId of fileIds) {
      const file = await db.file.findUnique({ where: { id: fileId } });
      if (!file) continue;

      if (file.folderId === targetFolderId) {
        movedFiles.push(file);
        continue;
      }

      let finalName = file.originalName;
      const existingFile = await db.file.findFirst({
        where: { folderId: targetFolderId, originalName: file.originalName, isTrashed: false },
      });
      if (existingFile) {
        finalName = await this.getAvailableFileName(targetFolderId, file.originalName);
      }

      const updatedFile = await db.file.update({
        where: { id: fileId },
        data: {
          folderId: targetFolderId,
          originalName: finalName,
          syncStatus: initialSyncStatus,
          googleDriveFileId: isSyncEnabled ? null : file.googleDriveFileId,
          googleDriveFolderId: targetFolder.googleDriveFolderId || null,
          googleDriveWebViewLink: isSyncEnabled ? null : file.googleDriveWebViewLink,
          lastError: null,
          syncedAt: null,
        },
      });

      if (isSyncEnabled) {
        const existingJob = await db.syncJob.findFirst({ where: { fileId } });
        if (existingJob) {
          await db.syncJob.update({
            where: { id: existingJob.id },
            data: {
              status: SyncStatus.PENDING,
              attempts: 0,
              scheduledAt: new Date(),
              startedAt: null,
              completedAt: null,
              lastError: null,
            },
          });
        } else {
          await db.syncJob.create({
            data: {
              fileId,
              status: SyncStatus.PENDING,
              attempts: 0,
              maxAttempts: 5,
              scheduledAt: new Date(),
            },
          });
        }
      } else {
        const existingJob = await db.syncJob.findFirst({ where: { fileId } });
        if (existingJob) {
          await db.syncJob.delete({ where: { id: existingJob.id } });
        }
      }

      await AuditService.log({
        userId: user?.id,
        action: ActivityAction.FILE_MOVED,
        resourceType: "FILE",
        resourceId: file.id,
        details: {
          fileName: file.originalName,
          newFileName: finalName === file.originalName ? undefined : finalName,
          targetFolderId,
          targetFolderName: targetFolder.name,
        },
        ipAddress,
        userAgent,
        result: "SUCCESS",
      });

      movedFiles.push(updatedFile);
    }

    return movedFiles;
  }

  public static async bulkCopyFiles({
    fileIds,
    targetFolderId,
    user,
    ipAddress,
    userAgent,
  }: {
    fileIds: string[];
    targetFolderId: string;
    user?: UserRecord;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<FileRecord[]> {
    const targetFolder = await db.folder.findUnique({ where: { id: targetFolderId } });
    if (!targetFolder) {
      throw new Error(`Target folder with id ${targetFolderId} does not exist`);
    }

    const copiedFiles: FileRecord[] = [];
    const isSyncEnabled = targetFolder.syncToGoogleDrive !== false || !!targetFolder.googleDriveFolderId;
    const initialSyncStatus = isSyncEnabled ? SyncStatus.PENDING : SyncStatus.LOCAL_ONLY;

    for (const fileId of fileIds) {
      const file = await db.file.findUnique({ where: { id: fileId } });
      if (!file) continue;

      const srcPath = this.resolveStoragePath(file.storagePath);
      if (!srcPath || !fs.existsSync(srcPath)) {
        console.warn(`[StorageService] Source file missing for copy: ${file.storagePath}`);
        continue;
      }

      const { absoluteDir, relativeDir } = this.getPartitionedPath();
      const sanitizedName = file.originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storedName = `${Date.now()}_${crypto.randomBytes(4).toString("hex")}_${sanitizedName}`;
      const absoluteFilePath = path.join(absoluteDir, storedName);
      const relativeFilePath = path.join(relativeDir, storedName);

      fs.copyFileSync(srcPath, absoluteFilePath);

      let finalName = file.originalName;
      const existingFile = await db.file.findFirst({
        where: { folderId: targetFolderId, originalName: file.originalName, isTrashed: false },
      });
      if (existingFile) {
        finalName = await this.getAvailableFileName(targetFolderId, file.originalName);
      }

      const newFile = await db.file.create({
        data: {
          userId: user?.id || "usr_anonymous",
          folderId: targetFolderId,
          originalName: finalName,
          storedName,
          storagePath: relativeFilePath,
          mimeType: file.mimeType,
          size: file.size,
          checksumSha256: file.checksumSha256,
          version: 1,
          versionHistory: [],
          syncStatus: initialSyncStatus,
          googleDriveFileId: null,
          googleDriveFolderId: targetFolder.googleDriveFolderId || null,
          googleDriveWebViewLink: null,
          syncAttempts: 0,
          lastError: null,
          syncedAt: null,
        },
      });

      if (isSyncEnabled) {
        await db.syncJob.create({
          data: {
            fileId: newFile.id,
            status: SyncStatus.PENDING,
            attempts: 0,
            maxAttempts: 5,
            scheduledAt: new Date(),
          },
        });
      }

      await AuditService.log({
        userId: user?.id,
        action: ActivityAction.FILE_COPIED,
        resourceType: "FILE",
        resourceId: newFile.id,
        details: {
          fileName: file.originalName,
          copiedFileName: finalName,
          targetFolderId,
          targetFolderName: targetFolder.name,
        },
        ipAddress,
        userAgent,
        result: "SUCCESS",
      });

      copiedFiles.push(newFile);
    }

    return copiedFiles;
  }

  public static formatBytes(bytes: number, decimals: number = 2): string {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  }
}

