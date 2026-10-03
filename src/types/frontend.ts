export enum UserRole {
  ADMIN = "ADMIN",
  USER = "USER",
}

export enum FolderPermission {
  VIEW = "VIEW",
  EDIT = "EDIT",
}

export enum DriveType {
  MY_DRIVE = "MY_DRIVE",
  SHARED_DRIVE = "SHARED_DRIVE",
}

export enum SyncStatus {
  PENDING = "PENDING",
  PROCESSING = "PROCESSING",
  SYNCED = "SYNCED",
  FAILED = "FAILED",
  RETRYING = "RETRYING",
  LOCAL_ONLY = "LOCAL_ONLY",
}

export enum PreviewStatus {
  PENDING = "PENDING",
  PROCESSING = "PROCESSING",
  READY = "READY",
  FAILED = "FAILED",
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromEmail: string;
  fromName: string;
  isConfigured: boolean;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  avatarUrl?: string | null;
  authProvider?: "LOCAL" | "GOOGLE";
  googleSub?: string | null;
  isGoogleConnected?: boolean;
  googleAccountEmail?: string | null;
  googleAccountName?: string | null;
  createdAt: string;
}

export interface Folder {
  id: string;
  name: string;
  targetFolderPath: string;
  googleDriveFolderId?: string | null;
  targetDriveType: DriveType;
  targetDriveId?: string | null;
  syncToGoogleDrive?: boolean;
  description?: string | null;
  parentId?: string | null;
  ownerId?: string | null;
  ownerName?: string | null;
  permission?: FolderPermission;
  isImported?: boolean;
  source?: "LOCAL" | "GOOGLE_DRIVE";
  isTrashed?: boolean;
  trashedAt?: string | null;
  trashedBy?: string | null;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt?: string | null;
  filesCount?: number;
  subfoldersCount?: number;
  totalSizeBytes?: number;
  storageId?: string | null;
}

export interface FileVersion {
  version: number;
  storedName: string;
  storagePath: string;
  size: number;
  checksumSha256: string;
  mimeType: string;
  createdAt: string;
  uploadedBy?: string;
}

export interface FileItem {
  id: string;
  folderId: string;
  userId: string;
  originalName: string;
  storagePath: string;
  size: number;
  mimeType: string;
  checksumSha256: string;
  version?: number;
  versionHistory?: FileVersion[];
  isTrashed?: boolean;
  trashedAt?: string | null;
  trashedBy?: string | null;
  syncStatus: SyncStatus;
  previewStatus?: PreviewStatus;
  thumbnailPath?: string | null;
  syncAttempts: number;
  lastError?: string | null;
  googleDriveFileId?: string | null;
  googleDriveFolderId?: string | null;
  googleDriveWebViewLink?: string | null;
  storageId?: string | null;
  createdAt: string;
  updatedAt: string;
  syncedAt?: string | null;
  user?: {
    id: string;
    name: string;
    email: string;
  };
  folder?: {
    id: string;
    name: string;
    targetFolderPath: string;
    syncToGoogleDrive?: boolean;
    googleDriveFolderId?: string | null;
  };
  syncJobs?: SyncJob[];
  /** Present when the file lives on a mounted server drive instead of managed storage. */
  mountSource?: {
    mountId: string;
    relativePath: string;
    viewUrl: string;
    downloadUrl: string;
  };
}

export interface SyncJob {
  id: string;
  fileId: string;
  status: SyncStatus;
  attempts: number;
  maxAttempts: number;
  lastError?: string | null;
  scheduledAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  userId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  details?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  result: "SUCCESS" | "FAILURE";
  createdAt: string;
  user?: {
    id: string;
    email: string;
    name: string;
  };
}

export interface GoogleDriveStatus {
  connected: boolean;
  isConnected?: boolean;
  userEmail: string | null;
  driveType: DriveType;
  sharedDriveId: string | null;
  hasRefreshToken: boolean;
  scopes: string[];
  systemAccountEmail: string;
  tokenExpiresAt: string | null;
}

export interface GoogleDriveNode {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  hasChildren?: boolean;
}

export interface StorageStats {
  totalFiles: number;
  totalSizeBytes: number;
  totalSizeFormatted: string;
  syncStatusBreakdown?: {
    pending: number;
    processing: number;
    synced: number;
    retrying: number;
    failed: number;
  };
  storageDirectory?: string;
  storageBasePath?: string;
  pendingSyncCount?: number;
  syncedCount?: number;
  failedSyncCount?: number;
}

export interface SyncStats {
  workerActive: boolean;
  lastTickAt: string | null;
  totalJobs: number;
  pendingJobs: number;
  processingJobs: number;
  syncedJobs: number;
  failedJobs: number;
  retryingJobs: number;
}

export interface SelfTestResult {
  success: boolean;
  database: { success: boolean; details: Record<string, unknown> };
  auth: { success: boolean; details: Record<string, unknown> };
  googleDrive: { success: boolean; details: Record<string, unknown> };
  folder: { success: boolean; details: Record<string, unknown> };
  storage: { success: boolean; details: Record<string, unknown> };
  sync: { success: boolean; details: Record<string, unknown> };
}

export type IndexingState = "pending" | "indexing" | "ready" | "error";

export interface IndexerStatus {
  state: IndexingState;
  isIndexing: boolean;
  lastIndexedAt: string | null;
  totalIndexedFiles: number;
  totalIndexedFolders: number;
  currentlyIndexingFolder: string | null;
  queueLength: number;
  lastError: string | null;
  reconciliationCount: number;
}

export interface MountDrive {
  id: string;
  name: string;
  mountPoint: string;
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  isMounted: boolean;
  itemCount: number;
  filesCount: number;
  dirsCount: number;
  createdAt: string;
  updatedAt: string;
  isWritable: boolean;
  /** Emails allowed to open this mount; empty means every signed-in user. */
  allowedEmails?: string[];
  isIndexing?: boolean;
  indexingState?: IndexingState;
}

export interface MountFileItem {
  id: string;
  name: string;
  relativePath: string;
  fullPath: string;
  mountId: string;
  isDirectory: boolean;
  size: number;
  mimeType: string;
  modifiedAt: string;
  extension: string;
  isImage: boolean;
  isVideo: boolean;
  isAudio: boolean;
  isPdf: boolean;
  isText: boolean;
  isOfficeDoc: boolean;
  isArchive: boolean;
}

export interface MountBrowseResult {
  mount: MountDrive;
  currentPath: string;
  subPath: string;
  items: MountFileItem[];
  totalItems: number;
  page?: number;
  limit?: number;
  totalPages?: number;
  breadcrumbs: { name: string; subPath: string }[];
  isIndexing?: boolean;
  indexingStatus?: IndexerStatus;
}

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
  createdAt: string;
}

export interface TransferProgress {
  loadedBytes: number;
  totalBytes: number;
  percentage: number;
  speedBytesPerSec: number;
  etaSeconds: number;
}

export type TransferType = "UPLOAD" | "DOWNLOAD" | "MULTIPART_ZIP";
export type TransferStatus = "PENDING" | "ACTIVE" | "PAUSED" | "COMPLETED" | "ERROR" | "CANCELLED";

export interface ActiveTransfer {
  id: string;
  type: TransferType;
  title: string;
  subtitle?: string;
  status: TransferStatus;
  loadedBytes: number;
  totalBytes: number;
  percentage: number;
  speedBytesPerSec: number;
  etaSeconds: number;
  errorMessage?: string | null;
  fileId?: string;
  archiveSessionId?: string;
  currentPart?: number;
  totalParts?: number;
  startedAt: number;
  completedAt?: number;
  abortController?: AbortController;
  blobUrl?: string;
}

export interface PaginationMeta {
  page: number;
  currentPage: number;
  limit: number;
  pageSize: number;
  total: number;
  totalData: number;
  totalPages: number;
  hasMore: boolean;
}

export interface PaginatedFoldersResponse extends PaginationMeta {
  folders: Folder[];
}

export interface PaginatedFilesResponse extends PaginationMeta {
  files: FileItem[];
}



export type ShareItemType = "FOLDER" | "FILE";

/** A managed share link as its owner sees it. The id is the secret in the URL (?s=<id>). */
export interface ShareLink {
  id: string;
  itemType: ShareItemType;
  itemId: string;
  permission: "VIEW" | "EDIT";
  hasPassword: boolean;
  allowedEmails: string[];
  createdAt: string;
  expiresAt: string | null;
  lastOpenedAt: string | null;
}
