import {
  ArchivePartManifest,
  ArchiveSession,
  AuditLog,
  DriveType,
  FileItem,
  Folder,
  GoogleDriveNode,
  GoogleDriveStatus,
  IndexerStatus,
  IndexingState,
  MountBrowseResult,
  MountDrive,
  MountFileItem,
  PaginatedFilesResponse,
  PaginatedFoldersResponse,
  ShareItemType,
  ShareLink,
  SelfTestResult,
  StorageStats,
  SyncJob,
  SyncStats,
  SyncStatus,
  TransferProgress,
  User,
} from "../types/frontend.ts";

import { applyXhrCredentials, authHeaders, getAuthToken, withCredentialsQuery } from "../lib/credentials.ts";

const BASE_URL = "/api";

function getHeaders(extraHeaders: Record<string, string> = {}) {
  return authHeaders(extraHeaders);
}

async function handleResponse<T>(res: Response): Promise<T> {
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const rawText = await res.text().catch(() => "");
    if (res.status === 401) {
      throw new Error("Sesi login telah berakhir atau belum terautentikasi. Silakan masuk kembali.");
    }
    if (res.status === 403) {
      throw new Error("Anda tidak memiliki hak akses untuk tindakan ini.");
    }
    if (res.status === 404) {
      throw new Error("Endpoint API tidak ditemukan (404). Silakan muat ulang halaman.");
    }
    if (res.status >= 500) {
      throw new Error(`Server mengalami kendala (${res.status}). Silakan coba beberapa saat lagi.`);
    }
    throw new Error(`Respons server bukan JSON valid (${res.status}): ${rawText.slice(0, 120)}`);
  }

  let data: any;
  try {
    data = await res.json();
  } catch (err: any) {
    throw new Error(`Gagal membaca respons server: ${err.message}`);
  }

  if (!res.ok || data.success === false) {
    throw new Error(data.error || "Terjadi kesalahan saat memproses permintaan.");
  }
  return data.data !== undefined ? data.data : data;
}

export const api = {
  // --- AUTH ---
  async getAuthConfig(): Promise<{
    allowRegistration: boolean;
    adminEmail: string;
    maxFileSizeMb: number;
    appName: string;
  }> {
    const res = await fetch(`${BASE_URL}/auth/config`);
    return handleResponse(res);
  },

  async login(email: string, password?: string): Promise<{ user: User; token: string }> {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    return handleResponse(res);
  },

  async register(payload: { name: string; email: string; password: string; role?: string }): Promise<{ user: User; token: string }> {
    const res = await fetch(`${BASE_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return handleResponse(res);
  },

  async googleAuth(payload: {
    email: string;
    name?: string;
    avatarUrl?: string;
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: number;
  }): Promise<{ user: User; token: string }> {
    const res = await fetch(`${BASE_URL}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return handleResponse(res);
  },

  async forgotPassword(email: string): Promise<{ message: string }> {
    const res = await fetch(`${BASE_URL}/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    return handleResponse(res);
  },

  async resetPassword(payload: { token: string; password: string }): Promise<{ message: string }> {
    const res = await fetch(`${BASE_URL}/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return handleResponse(res);
  },

  async getMe(): Promise<{ user: User; token: string }> {
    const res = await fetch(`${BASE_URL}/auth/me`, {
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async logout(): Promise<void> {
    try {
      await fetch(`${BASE_URL}/auth/logout`, {
        method: "POST",
        headers: getHeaders(),
      });
    } finally {
      localStorage.removeItem("auth_token");
      localStorage.removeItem("auth_user");
    }
  },

  async listUsers(): Promise<{ users: User[] }> {
    const res = await fetch(`${BASE_URL}/auth/users`, {
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async listAuditLogs(): Promise<{ logs: AuditLog[] }> {
    const res = await fetch(`${BASE_URL}/auth/audit-logs`, {
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  // --- SYSTEM SETTINGS & ADMIN ---
  async getSystemSettings(): Promise<{ settings: Array<{ key: string; value: string; description?: string; updatedAt: string }> }> {
    const res = await fetch(`${BASE_URL}/admin/settings`, {
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async updateSystemSetting(key: string, value: string, description?: string): Promise<{ setting: any; message: string }> {
    const res = await fetch(`${BASE_URL}/admin/settings`, {
      method: "POST",
      headers: getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ key, value, description }),
    });
    return handleResponse(res);
  },

  async getSmtpConfig(): Promise<{ config: any }> {
    const res = await fetch(`${BASE_URL}/admin/smtp`, {
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async saveSmtpConfig(payload: any): Promise<{ config: any; message: string }> {
    const res = await fetch(`${BASE_URL}/admin/smtp`, {
      method: "POST",
      headers: getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    return handleResponse(res);
  },

  async testSmtpConfig(targetEmail?: string): Promise<{ message: string }> {
    const res = await fetch(`${BASE_URL}/admin/smtp/test`, {
      method: "POST",
      headers: getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ targetEmail }),
    });
    return handleResponse(res);
  },

  // --- GOOGLE DRIVE ---
  async getGoogleConfig(): Promise<{ clientId: string; hasClientSecret: boolean; redirectUri: string; appUrl: string }> {
    const res = await fetch(`${BASE_URL}/google/config`);
    return handleResponse(res);
  },

  async getGoogleStatus(): Promise<GoogleDriveStatus> {
    const res = await fetch(`${BASE_URL}/google/status`, {
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async connectGoogle(payload: { email?: string; accessToken?: string; refreshToken?: string }): Promise<GoogleDriveStatus> {
    const res = await fetch(`${BASE_URL}/google/connect`, {
      method: "POST",
      headers: getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    return handleResponse(res);
  },

  async disconnectGoogle(): Promise<{ message: string }> {
    const res = await fetch(`${BASE_URL}/google/disconnect`, {
      method: "POST",
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async updateDriveType(driveType: DriveType, sharedDriveId?: string): Promise<GoogleDriveStatus> {
    const res = await fetch(`${BASE_URL}/google/drive-type`, {
      method: "POST",
      headers: getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ driveType, sharedDriveId }),
    });
    return handleResponse(res);
  },

  async getGoogleTree(folderId?: string, driveType?: DriveType): Promise<{ items: GoogleDriveNode[] }> {
    const params = new URLSearchParams();
    if (folderId) params.set("folderId", folderId);
    if (driveType) params.set("driveType", driveType);
    const res = await fetch(`${BASE_URL}/google/tree?${params.toString()}`, {
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async listGoogleFolders(parentId: string = "root", searchQuery?: string, accessToken?: string): Promise<{ folders: GoogleDriveNode[] }> {
    const params = new URLSearchParams();
    if (parentId) params.set("parentId", parentId);
    if (searchQuery) params.set("q", searchQuery);
    const extraHeaders: Record<string, string> = {};
    if (accessToken) extraHeaders["X-Google-Access-Token"] = accessToken;

    const res = await fetch(`${BASE_URL}/google/folders?${params.toString()}`, {
      headers: getHeaders(extraHeaders),
    });
    return handleResponse(res);
  },

  async getGoogleFolderContents(folderId: string, accessToken?: string): Promise<{
    id: string;
    name: string;
    description?: string;
    webViewLink?: string;
    subfolders: Array<{ id: string; name: string }>;
    files: Array<{ id: string; name: string; mimeType: string; size?: number; webViewLink?: string }>;
  }> {
    const extraHeaders: Record<string, string> = {};
    if (accessToken) extraHeaders["X-Google-Access-Token"] = accessToken;

    const res = await fetch(`${BASE_URL}/google/folders/${encodeURIComponent(folderId)}/contents`, {
      headers: getHeaders(extraHeaders),
    });
    return handleResponse(res);
  },

  async importGoogleFolder(payload: {
    googleFolderId: string;
    parentAppFolderId?: string | null;
    permission?: string;
    customName?: string;
    accessToken?: string;
  }): Promise<{
    folder: Folder;
    totalFoldersImported: number;
    totalFilesImported: number;
  }> {
    const extraHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (payload.accessToken) extraHeaders["X-Google-Access-Token"] = payload.accessToken;

    const res = await fetch(`${BASE_URL}/google/import-folder`, {
      method: "POST",
      headers: getHeaders(extraHeaders),
      body: JSON.stringify(payload),
    });
    return handleResponse(res);
  },

  // --- FOLDERS ---
  async getFolder(id: string): Promise<{ folder: Folder; breadcrumbs?: Array<{ id: string; name: string; parentId: string | null }> }> {
    const res = await fetch(`${BASE_URL}/folders/${encodeURIComponent(id)}`, {
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async getFolderBreadcrumbs(id: string): Promise<{ breadcrumbs: Array<{ id: string; name: string; parentId: string | null }> }> {
    const res = await fetch(`${BASE_URL}/folders/${encodeURIComponent(id)}/breadcrumbs`, {
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async getFolderActivities(folderId: string, limit: number = 50): Promise<{ activities: AuditLog[] }> {
    const res = await fetch(`${BASE_URL}/folders/${encodeURIComponent(folderId)}/activities?limit=${limit}`, {
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async listFolders(
    params?:
      | {
          parentId?: string | null;
          page?: number;
          limit?: number;
          search?: string;
        }
      | string
      | null
  ): Promise<PaginatedFoldersResponse> {
    const query = new URLSearchParams();
    if (typeof params === "string") {
      if (params) query.set("parentId", params);
    } else if (params && typeof params === "object") {
      if (params.parentId !== undefined) {
        query.set("parentId", params.parentId === null ? "root" : params.parentId);
      }
      if (params.page !== undefined) query.set("page", String(params.page));
      if (params.limit !== undefined) query.set("limit", String(params.limit));
      if (params.search) query.set("search", params.search);
    }

    const url = query.toString() ? `${BASE_URL}/folders?${query.toString()}` : `${BASE_URL}/folders`;
    const res = await fetch(url, {
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async createFolder(payload: {
    name: string;
    targetFolderPath?: string;
    parentId?: string | null;
    permission?: string;
    targetDriveType?: DriveType;
    targetDriveId?: string;
    description?: string;
  }): Promise<{ folder: Folder }> {
    const res = await fetch(`${BASE_URL}/folders`, {
      method: "POST",
      headers: getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    return handleResponse(res);
  },

  async updateFolder(
    id: string,
    payload: {
      name?: string;
      description?: string;
      permission?: string;
      targetFolderPath?: string;
      syncToGoogleDrive?: boolean;
      parentId?: string | null;
    }
  ): Promise<{ folder: Folder }> {
    const res = await fetch(`${BASE_URL}/folders/${id}`, {
      method: "PUT",
      headers: getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    return handleResponse(res);
  },

  async syncFolder(id: string): Promise<{ folder: Folder }> {
    const res = await fetch(`${BASE_URL}/folders/${id}/sync`, {
      method: "POST",
      headers: getHeaders({ "Content-Type": "application/json" }),
    });
    return handleResponse(res);
  },

  async getFolderStats(id: string): Promise<{ folder: Folder; filesCount: number; totalSizeBytes: number }> {
    const res = await fetch(`${BASE_URL}/folders/${id}/stats`, {
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  // --- SHARE LINKS ---
  async listShareLinks(itemType: ShareItemType, itemId: string): Promise<{ links: ShareLink[] }> {
    const q = new URLSearchParams({ itemType, itemId });
    const res = await fetch(`${BASE_URL}/shares?${q.toString()}`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async createShareLink(payload: {
    itemType: ShareItemType;
    itemId: string;
    permission: "VIEW" | "EDIT";
    password?: string;
    allowedEmails?: string[];
    expiresInDays?: number;
  }): Promise<{ link: ShareLink }> {
    const res = await fetch(`${BASE_URL}/shares`, {
      method: "POST",
      headers: getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    return handleResponse(res);
  },

  async revokeShareLink(id: string): Promise<{ revoked: string }> {
    const res = await fetch(`${BASE_URL}/shares/${encodeURIComponent(id)}`, { method: "DELETE", headers: getHeaders() });
    return handleResponse(res);
  },

  async getShareGate(id: string): Promise<{ requiresPassword: boolean; requiresEmail: boolean; itemType: ShareItemType }> {
    const res = await fetch(`${BASE_URL}/shares/${encodeURIComponent(id)}/gate`);
    return handleResponse(res);
  },

  async openShareLink(
    id: string,
    payload: { password?: string; email?: string }
  ): Promise<{ session: string; permission: "VIEW" | "EDIT"; itemType: ShareItemType; folder?: Folder; file?: FileItem }> {
    const res = await fetch(`${BASE_URL}/shares/${encodeURIComponent(id)}/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return handleResponse(res);
  },

  async verifyShareToken(payload: {
    folderId?: string;
    fileId?: string;
    permission: string;
    signature: string;
    pwdHash?: string;
    emails?: string;
    emailInput?: string;
  }): Promise<{ isValid: boolean; folder?: Folder; file?: FileItem; grantedPermission?: string; session?: string; error?: string }> {
    const res = await fetch(`${BASE_URL}/folders/verify-share-token`, {
      method: "POST",
      headers: getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    return handleResponse(res);
  },

  async deleteFolder(id: string, permanent: boolean = false): Promise<{ message: string }> {
    const url = permanent ? `${BASE_URL}/folders/${id}/permanent` : `${BASE_URL}/folders/${id}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async restoreFolder(id: string): Promise<{ folder: Folder; message: string }> {
    const res = await fetch(`${BASE_URL}/folders/${id}/restore`, {
      method: "POST",
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async bulkDeleteFolders(folderIds: string[], permanent: boolean = false): Promise<{ message: string; data: { count: number; processedIds: string[]; failedIds: string[] } }> {
    const res = await fetch(`${BASE_URL}/folders/bulk-delete`, {
      method: "POST",
      headers: getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ folderIds, permanent }),
    });
    return handleResponse(res);
  },

  async bulkRestoreFolders(folderIds: string[]): Promise<{ message: string; data: { count: number; restoredIds: string[]; failedIds: string[] } }> {
    const res = await fetch(`${BASE_URL}/folders/bulk-restore`, {
      method: "POST",
      headers: getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ folderIds }),
    });
    return handleResponse(res);
  },

  // --- STORAGE & FILES ---
  async checkConflicts(
    folderId: string,
    fileNames: string[],
    timeoutMs: number = 3000
  ): Promise<{ conflicts: Array<{ fileName: string; existingFile: FileItem }> }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${BASE_URL}/storage/conflicts/check`, {
        method: "POST",
        headers: getHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ folderId, fileNames }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      return await handleResponse(res);
    } catch (err) {
      clearTimeout(timer);
      console.warn("[checkConflicts] Timeout or request aborted, skipping pre-check:", err);
      return { conflicts: [] };
    }
  },

  async uploadFiles(
    folderId: string,
    files: File[],
    conflictMode: "create_version" | "overwrite" | "rename" | "skip" = "create_version"
  ): Promise<{ files: FileItem[] }> {
    const formData = new FormData();
    formData.append("folderId", folderId);
    formData.append("conflictMode", conflictMode);
    for (const file of files) {
      formData.append("files", file);
    }

    const headers = authHeaders();

    const res = await fetch(`${BASE_URL}/storage/upload`, {
      method: "POST",
      headers,
      body: formData,
    });
    return handleResponse(res);
  },

  // --- RESUMABLE CHUNKED UPLOAD ---
  async initChunkUpload(payload: {
    fileName: string;
    fileSize: number;
    mimeType: string;
    folderId: string;
    chunkSize: number;
    totalChunks: number;
    conflictMode?: "create_version" | "overwrite" | "rename" | "skip";
  }): Promise<{ uploadId: string; chunkSize: number; totalChunks: number; uploadedChunks: number[] }> {
    const res = await fetch(`${BASE_URL}/storage/upload/chunk/init`, {
      method: "POST",
      headers: getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    return handleResponse(res);
  },

  async uploadSingleChunk(
    uploadId: string,
    chunkIndex: number,
    chunkBlob: Blob,
    onProgress?: (loaded: number, total: number) => void
  ): Promise<{ success: boolean; chunkIndex: number; uploadedCount: number; totalChunks: number }> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${BASE_URL}/storage/upload/chunk`);

      applyXhrCredentials(xhr);

      if (xhr.upload && onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            onProgress(e.loaded, e.total);
          }
        };
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const resp = JSON.parse(xhr.responseText);
            resolve(resp.data !== undefined ? resp.data : resp);
          } catch {
            resolve({ success: true, chunkIndex, uploadedCount: chunkIndex + 1, totalChunks: 0 });
          }
        } else {
          try {
            const err = JSON.parse(xhr.responseText);
            reject(new Error(err.error || `HTTP error ${xhr.status}`));
          } catch {
            reject(new Error(`HTTP error ${xhr.status}`));
          }
        }
      };

      xhr.onerror = () => {
        reject(new Error("Koneksi jaringan terputus saat mengunggah chunk."));
      };

      xhr.ontimeout = () => {
        reject(new Error("Waktu unggah chunk habis (Timeout)."));
      };

      const formData = new FormData();
      formData.append("uploadId", uploadId);
      formData.append("chunkIndex", String(chunkIndex));
      formData.append("chunk", chunkBlob, `chunk_${chunkIndex}`);

      xhr.send(formData);
    });
  },

  async getChunkUploadStatus(uploadId: string): Promise<{
    uploadId: string;
    fileName: string;
    fileSize: number;
    totalChunks: number;
    uploadedChunks: number[];
    isComplete: boolean;
  }> {
    const res = await fetch(`${BASE_URL}/storage/upload/chunk/status/${uploadId}`, {
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async completeChunkUpload(uploadId: string): Promise<{ file: FileItem }> {
    const res = await fetch(`${BASE_URL}/storage/upload/chunk/complete`, {
      method: "POST",
      headers: getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ uploadId }),
    });
    return handleResponse(res);
  },

  async cancelChunkUpload(uploadId: string): Promise<void> {
    await fetch(`${BASE_URL}/storage/upload/chunk/cancel`, {
      method: "POST",
      headers: getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ uploadId }),
    });
  },

  // --- BULK FILE OPERATIONS ---
  async bulkDeleteFiles(fileIds: string[], permanent: boolean = false): Promise<{ message: string; data: { count: number; processedIds: string[]; failedIds: string[] } }> {
    const res = await fetch(`${BASE_URL}/storage/files/bulk-delete`, {
      method: "POST",
      headers: getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ fileIds, permanent }),
    });
    return handleResponse(res);
  },

  async bulkRestoreFiles(fileIds: string[]): Promise<{ message: string; data: { count: number; restoredIds: string[]; failedIds: string[] } }> {
    const res = await fetch(`${BASE_URL}/storage/files/bulk-restore`, {
      method: "POST",
      headers: getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ fileIds }),
    });
    return handleResponse(res);
  },

  async bulkSyncFiles(fileIds: string[]): Promise<{ message: string; data: { triggeredCount: number; triggeredIds: string[] } }> {
    const res = await fetch(`${BASE_URL}/storage/files/bulk-sync`, {
      method: "POST",
      headers: getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ fileIds }),
    });
    return handleResponse(res);
  },

  async bulkMoveFiles(fileIds: string[], targetFolderId: string): Promise<{ success: boolean; message: string; movedCount: number; failedCount: number; failed: string[] }> {
    const res = await fetch(`${BASE_URL}/storage/files/bulk-move`, {
      method: "POST",
      headers: getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ fileIds, targetFolderId }),
    });
    return handleResponse(res);
  },

  async bulkCopyFiles(fileIds: string[], targetFolderId: string): Promise<{ success: boolean; message: string; copiedCount: number }> {
    const res = await fetch(`${BASE_URL}/storage/files/bulk-copy`, {
      method: "POST",
      headers: getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ fileIds, targetFolderId }),
    });
    return handleResponse(res);
  },

  async listFiles(params?: {
    folderId?: string | null;
    syncStatus?: SyncStatus | string;
    myOnly?: boolean;
    page?: number;
    limit?: number;
    search?: string;
  }): Promise<PaginatedFilesResponse> {
    const query = new URLSearchParams();
    if (params?.folderId !== undefined && params?.folderId !== null) {
      query.set("folderId", params.folderId);
    } else if (params?.folderId === null) {
      query.set("folderId", "root");
    }
    if (params?.syncStatus && params.syncStatus !== "ALL") query.set("syncStatus", params.syncStatus as string);
    if (params?.myOnly) query.set("myOnly", "true");
    if (params?.page !== undefined) query.set("page", String(params.page));
    if (params?.limit !== undefined) query.set("limit", String(params.limit));
    if (params?.search) query.set("search", params.search);

    const res = await fetch(`${BASE_URL}/storage/files?${query.toString()}`, {
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async getFile(id: string): Promise<{ file: FileItem }> {
    const res = await fetch(`${BASE_URL}/storage/files/${id}`, {
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async renameFile(id: string, name: string): Promise<{ file: FileItem; message: string }> {
    const res = await fetch(`${BASE_URL}/storage/files/${id}/rename`, {
      method: "PUT",
      headers: getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name }),
    });
    return handleResponse(res);
  },

  async verifyFile(id: string): Promise<{
    fileId: string;
    originalName: string;
    storedChecksumSha256: string;
    calculatedChecksumSha256: string;
    match: boolean;
    fileSizeBytes: number;
    verifiedAt: string;
  }> {
    const res = await fetch(`${BASE_URL}/storage/files/${id}/verify`, {
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async deleteFile(id: string, permanent: boolean = false): Promise<{ message: string }> {
    const url = permanent ? `${BASE_URL}/storage/files/${id}/permanent` : `${BASE_URL}/storage/files/${id}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async restoreFile(id: string): Promise<{ file: FileItem; message: string }> {
    const res = await fetch(`${BASE_URL}/storage/files/${id}/restore`, {
      method: "POST",
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  // --- TRASH & RECOVERY ---
  async getTrash(): Promise<{ files: FileItem[]; folders: Folder[]; total: number }> {
    const res = await fetch(`${BASE_URL}/trash`, {
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async restoreTrashItems(fileIds: string[] = [], folderIds: string[] = []): Promise<{ message: string; data: { restoredFiles: number; restoredFolders: number } }> {
    const res = await fetch(`${BASE_URL}/trash/restore`, {
      method: "POST",
      headers: getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ fileIds, folderIds }),
    });
    return handleResponse(res);
  },

  async permanentDeleteTrashItems(fileIds: string[] = [], folderIds: string[] = []): Promise<{ message: string; data: { deletedFiles: number; deletedFolders: number } }> {
    const res = await fetch(`${BASE_URL}/trash/permanent-delete`, {
      method: "POST",
      headers: getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ fileIds, folderIds }),
    });
    return handleResponse(res);
  },

  async emptyTrash(): Promise<{ message: string; data: { deletedFiles: number; deletedFolders: number } }> {
    const res = await fetch(`${BASE_URL}/trash/empty`, {
      method: "DELETE",
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async getStorageStats(): Promise<StorageStats> {
    const res = await fetch(`${BASE_URL}/storage/stats`, {
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  getDownloadUrl(id: string): string {
    return withCredentialsQuery(`${BASE_URL}/storage/files/${id}/download`);
  },

  getViewUrl(id: string): string {
    return withCredentialsQuery(`${BASE_URL}/storage/files/${id}/view`);
  },

  getThumbnailUrl(id: string): string {
    return withCredentialsQuery(`${BASE_URL}/storage/files/${id}/thumbnail`);
  },

  async getFileTextContent(id: string): Promise<{
    fileId: string;
    originalName: string;
    mimeType: string;
    size: number;
    content: string;
  }> {
    const res = await fetch(`${BASE_URL}/storage/files/${id}/content`, {
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  // --- SYNC ENGINE ---
  async listSyncJobs(params?: { status?: SyncStatus; fileId?: string }): Promise<{ jobs: SyncJob[]; total: number }> {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    if (params?.fileId) query.set("fileId", params.fileId);

    const res = await fetch(`${BASE_URL}/sync/jobs?${query.toString()}`, {
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async getSyncStats(): Promise<SyncStats> {
    const res = await fetch(`${BASE_URL}/sync/stats`, {
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async triggerSyncQueue(): Promise<{ message: string; data: { processedCount: number } }> {
    const res = await fetch(`${BASE_URL}/sync/trigger`, {
      method: "POST",
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async retryFailedSyncJobs(): Promise<{ message: string; data: { retriedCount: number } }> {
    const res = await fetch(`${BASE_URL}/sync/retry-failed`, {
      method: "POST",
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async retrySyncJob(jobId: string): Promise<{ job: SyncJob }> {
    const res = await fetch(`${BASE_URL}/sync/jobs/${jobId}/retry`, {
      method: "POST",
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async syncSingleFile(fileId: string): Promise<{ job: SyncJob }> {
    const res = await fetch(`${BASE_URL}/sync/files/${fileId}/sync`, {
      method: "POST",
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  // --- SYSTEM DIAGNOSTICS & SELF TEST ---
  async runSelfTest(): Promise<SelfTestResult> {
    const res = await fetch(`${BASE_URL}/test/self-test`, {
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  // --- MOUNTED LOCAL DRIVES (/mnt) ---
  async listMounts(): Promise<{ mounts: MountDrive[]; total: number }> {
    const res = await fetch(`${BASE_URL}/mounts`, {
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async createMountPoint(folderName: string): Promise<{ mount: MountDrive; message: string }> {
    const res = await fetch(`${BASE_URL}/mounts/create`, {
      method: "POST",
      headers: getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ folderName }),
    });
    return handleResponse(res);
  },

  async updateMountPermissions(
    mountId: string,
    allowedEmails: string[]
  ): Promise<{ allowedEmails: string[]; message: string }> {
    const res = await fetch(`${BASE_URL}/mounts/${mountId}/permissions`, {
      method: "POST",
      headers: getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ allowedEmails }),
    });
    return handleResponse(res);
  },

  async getMount(mountId: string): Promise<{ mount: MountDrive }> {
    const res = await fetch(`${BASE_URL}/mounts/${mountId}`, {
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async browseMountDirectory(
    mountId: string,
    subPath: string = "",
    options?: { page?: number; limit?: number; search?: string }
  ): Promise<MountBrowseResult> {
    const params = new URLSearchParams();
    if (subPath) params.set("subPath", subPath);
    if (options?.page) params.set("page", String(options.page));
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.search) params.set("search", options.search);
    const res = await fetch(`${BASE_URL}/mounts/${mountId}/browse?${params.toString()}`, {
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async syncMount(mountId: string): Promise<{ message: string }> {
    const res = await fetch(`${BASE_URL}/mounts/${mountId}/sync`, {
      method: "POST",
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async getMountSyncStatus(mountId: string): Promise<IndexerStatus> {
    const res = await fetch(`${BASE_URL}/mounts/${mountId}/sync-status`, {
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async createMountFolder(
    mountId: string,
    subPath: string,
    folderName: string
  ): Promise<{ createdPath: string; message: string }> {
    const res = await fetch(`${BASE_URL}/mounts/${mountId}/mkdir`, {
      method: "POST",
      headers: getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ subPath, folderName }),
    });
    return handleResponse(res);
  },

  async renameMountItem(
    mountId: string,
    itemRelativePath: string,
    newName: string
  ): Promise<{ oldPath: string; newPath: string; message: string }> {
    const res = await fetch(`${BASE_URL}/mounts/${mountId}/rename`, {
      method: "POST",
      headers: getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ itemRelativePath, newName }),
    });
    return handleResponse(res);
  },

  async deleteMountItem(
    mountId: string,
    itemRelativePath: string
  ): Promise<{ message: string }> {
    const res = await fetch(`${BASE_URL}/mounts/${mountId}/delete`, {
      method: "POST",
      headers: getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ itemRelativePath }),
    });
    return handleResponse(res);
  },

  async bulkMoveMountItems(
    mountId: string,
    sourceRelativePaths: string[],
    targetFolderRelativePath: string
  ): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${BASE_URL}/mounts/${mountId}/bulk-move`, {
      method: "POST",
      headers: getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ sourceRelativePaths, targetFolderRelativePath }),
    });
    return handleResponse(res);
  },

  async bulkCopyMountItems(
    mountId: string,
    sourceRelativePaths: string[],
    targetFolderRelativePath: string
  ): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${BASE_URL}/mounts/${mountId}/bulk-copy`, {
      method: "POST",
      headers: getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ sourceRelativePaths, targetFolderRelativePath }),
    });
    return handleResponse(res);
  },

  async uploadToMount(
    mountId: string,
    subPath: string,
    files: File[]
  ): Promise<{ savedFiles: string[]; count: number; message: string }> {
    const formData = new FormData();
    formData.append("subPath", subPath);
    for (const file of files) {
      formData.append("files", file);
    }

    const headers = authHeaders();

    const res = await fetch(`${BASE_URL}/mounts/${mountId}/upload`, {
      method: "POST",
      headers,
      body: formData,
    });
    return handleResponse(res);
  },

  async uploadToMountWithProgress(params: {
    mountId: string;
    subPath: string;
    files: File[];
    onProgress?: (progress: TransferProgress) => void;
    signal?: AbortSignal;
  }): Promise<{ savedFiles: string[]; count: number; message: string }> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${BASE_URL}/mounts/${params.mountId}/upload`);

      applyXhrCredentials(xhr);

      const startTime = Date.now();
      const totalSize = params.files.reduce((acc, f) => acc + f.size, 0);

      if (xhr.upload && params.onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const elapsedSec = Math.max(0.1, (Date.now() - startTime) / 1000);
            const speedBytesPerSec = e.loaded / elapsedSec;
            const remainingBytes = Math.max(0, e.total - e.loaded);
            const etaSeconds = speedBytesPerSec > 0 ? Math.round(remainingBytes / speedBytesPerSec) : 0;
            const percentage = Math.min(100, Math.round((e.loaded / e.total) * 100));

            params.onProgress!({
              loadedBytes: e.loaded,
              totalBytes: e.total,
              percentage,
              speedBytesPerSec,
              etaSeconds,
            });
          }
        };
      }

      if (params.signal) {
        params.signal.addEventListener("abort", () => {
          xhr.abort();
          reject(new Error("Unggahan dibatalkan oleh pengguna"));
        });
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const resp = JSON.parse(xhr.responseText);
            resolve(resp.data !== undefined ? resp.data : resp);
          } catch {
            resolve({ savedFiles: [], count: 0, message: "Unggahan berhasil" });
          }
        } else {
          try {
            const err = JSON.parse(xhr.responseText);
            reject(new Error(err.error || `HTTP error ${xhr.status}`));
          } catch {
            reject(new Error(`HTTP error ${xhr.status}`));
          }
        }
      };

      xhr.onerror = () => {
        reject(new Error("Koneksi jaringan terputus saat mengunggah ke storage terpasang."));
      };

      xhr.ontimeout = () => {
        reject(new Error("Waktu unggah habis (Timeout)."));
      };

      const formData = new FormData();
      formData.append("subPath", params.subPath);
      for (const file of params.files) {
        formData.append("files", file);
      }

      xhr.send(formData);
    });
  },

  async importMountFileToDrive(
    mountId: string,
    relativePath: string,
    targetFolderId: string
  ): Promise<{ file: FileItem; message: string }> {
    const res = await fetch(`${BASE_URL}/mounts/${mountId}/import-to-drive`, {
      method: "POST",
      headers: getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ relativePath, targetFolderId }),
    });
    return handleResponse(res);
  },

  getMountFileViewUrl(mountId: string, subPath: string): string {
    const token = getAuthToken();
    const query = new URLSearchParams();
    query.set("subPath", subPath);
    if (token) query.set("token", token);
    return `${BASE_URL}/mounts/${mountId}/file/view?${query.toString()}`;
  },

  getMountFileDownloadUrl(mountId: string, subPath: string): string {
    const token = getAuthToken();
    const query = new URLSearchParams();
    query.set("subPath", subPath);
    if (token) query.set("token", token);
    return `${BASE_URL}/mounts/${mountId}/file/download?${query.toString()}`;
  },

  async getMountFileContent(
    mountId: string,
    subPath: string
  ): Promise<{ name: string; content: string; mimeType: string; size: number }> {
    const params = new URLSearchParams();
    params.set("subPath", subPath);
    const res = await fetch(`${BASE_URL}/mounts/${mountId}/file/content?${params.toString()}`, {
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  // ==========================================
  // MULTI-PART ZIP & REAL-TIME STREAMING METHODS
  // ==========================================

  /**
   * Download multiple files as a single streamed ZIP archive
   */
  async downloadDirectZip(fileIds: string[], archiveName?: string): Promise<void> {
    const res = await fetch(`${BASE_URL}/storage/bulk-download/direct-zip`, {
      method: "POST",
      headers: getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ fileIds, archiveName }),
    });

    if (!res.ok) {
      let errMsg = "Gagal mengunduh arsip ZIP";
      try {
        const data = await res.json();
        errMsg = data.error || errMsg;
      } catch {
        // ignore
      }
      throw new Error(errMsg);
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = archiveName || `PowerDrive-Archive-${Date.now()}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  },

  /**
   * Prepare a multi-part ZIP bulk download session
   */
  async prepareBulkArchive(payload: {
    fileIds?: string[];
    folderId?: string;
    partSizeBytes?: number;
    archiveName?: string;
  }): Promise<{ session: ArchiveSession }> {
    const res = await fetch(`${BASE_URL}/storage/bulk-download/prepare`, {
      method: "POST",
      headers: getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    return handleResponse(res);
  },

  /**
   * Get archive session info
   */
  async getArchiveSession(sessionId: string): Promise<{ session: ArchiveSession }> {
    const res = await fetch(`${BASE_URL}/storage/bulk-download/session/${sessionId}`, {
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  /**
   * Stream download a file with real-time percentage and byte tracking
   */
  async downloadFileWithProgress(params: {
    fileId: string;
    fileName: string;
    expectedSize?: number;
    onProgress?: (progress: TransferProgress) => void;
    signal?: AbortSignal;
  }): Promise<Blob> {
    const url = this.getDownloadUrl(params.fileId);
    const startTime = Date.now();
    let loadedBytes = 0;

    const response = await fetch(url, {
      headers: getHeaders(),
      signal: params.signal,
    });

    if (!response.ok) {
      throw new Error(`Gagal mengunduh berkas (HTTP ${response.status})`);
    }

    const contentLength = response.headers.get("content-length");
    const totalBytes = contentLength ? parseInt(contentLength, 10) : params.expectedSize || 0;

    const reader = response.body?.getReader();
    if (!reader) {
      const blob = await response.blob();
      if (params.onProgress && totalBytes > 0) {
        params.onProgress({
          loadedBytes: totalBytes,
          totalBytes,
          percentage: 100,
          speedBytesPerSec: 0,
          etaSeconds: 0,
        });
      }
      return blob;
    }

    const chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (value) {
        chunks.push(value);
        loadedBytes += value.length;

        if (params.onProgress) {
          const elapsedSec = Math.max(0.1, (Date.now() - startTime) / 1000);
          const speedBytesPerSec = loadedBytes / elapsedSec;
          const effectiveTotal = Math.max(loadedBytes, totalBytes);
          const remainingBytes = Math.max(0, effectiveTotal - loadedBytes);
          const etaSeconds = speedBytesPerSec > 0 ? Math.round(remainingBytes / speedBytesPerSec) : 0;
          const percentage = effectiveTotal > 0 ? Math.min(100, Math.round((loadedBytes / effectiveTotal) * 100)) : 0;

          params.onProgress({
            loadedBytes,
            totalBytes: effectiveTotal,
            percentage,
            speedBytesPerSec,
            etaSeconds,
          });
        }
      }
    }

    const blob = new Blob(chunks, {
      type: response.headers.get("content-type") || "application/octet-stream",
    });

    return blob;
  },

  /**
   * Stream download a specific part of a multi-part ZIP with real-time progress
   */
  async downloadArchivePartWithProgress(params: {
    sessionId: string;
    partIndex: number;
    partName: string;
    expectedSize?: number;
    onProgress?: (progress: TransferProgress) => void;
    signal?: AbortSignal;
  }): Promise<Blob> {
    const url = `${BASE_URL}/storage/bulk-download/part/${params.sessionId}/${params.partIndex}`;
    const startTime = Date.now();
    let loadedBytes = 0;

    const response = await fetch(url, {
      headers: getHeaders(),
      signal: params.signal,
    });

    if (!response.ok) {
      throw new Error(`Gagal mengunduh part arsip ZIP (HTTP ${response.status})`);
    }

    const contentLength = response.headers.get("x-archive-part-bytes") || response.headers.get("content-length");
    const totalBytes = contentLength ? parseInt(contentLength, 10) : params.expectedSize || 0;

    const reader = response.body?.getReader();
    if (!reader) {
      const blob = await response.blob();
      if (params.onProgress && totalBytes > 0) {
        params.onProgress({
          loadedBytes: totalBytes,
          totalBytes,
          percentage: 100,
          speedBytesPerSec: 0,
          etaSeconds: 0,
        });
      }
      return blob;
    }

    const chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (value) {
        chunks.push(value);
        loadedBytes += value.length;

        if (params.onProgress) {
          const elapsedSec = Math.max(0.1, (Date.now() - startTime) / 1000);
          const speedBytesPerSec = loadedBytes / elapsedSec;
          const effectiveTotal = Math.max(loadedBytes, totalBytes);
          const remainingBytes = Math.max(0, effectiveTotal - loadedBytes);
          const etaSeconds = speedBytesPerSec > 0 ? Math.round(remainingBytes / speedBytesPerSec) : 0;
          const percentage = effectiveTotal > 0 ? Math.min(100, Math.round((loadedBytes / effectiveTotal) * 100)) : 0;

          params.onProgress({
            loadedBytes,
            totalBytes: effectiveTotal,
            percentage,
            speedBytesPerSec,
            etaSeconds,
          });
        }
      }
    }

    return new Blob(chunks, { type: "application/zip" });
  },

  /**
   * Upload multiple files with real-time XMLHttpRequest tracking
   */
  async uploadFilesWithProgress(params: {
    folderId: string;
    files: File[];
    onProgress?: (progress: TransferProgress) => void;
    signal?: AbortSignal;
  }): Promise<{ files: FileItem[] }> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${BASE_URL}/storage/upload`);

      applyXhrCredentials(xhr);

      const startTime = Date.now();
      const totalSize = params.files.reduce((acc, f) => acc + f.size, 0);

      if (xhr.upload && params.onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const elapsedSec = Math.max(0.1, (Date.now() - startTime) / 1000);
            const speedBytesPerSec = e.loaded / elapsedSec;
            const remainingBytes = Math.max(0, e.total - e.loaded);
            const etaSeconds = speedBytesPerSec > 0 ? Math.round(remainingBytes / speedBytesPerSec) : 0;
            const percentage = Math.min(100, Math.round((e.loaded / e.total) * 100));

            params.onProgress!({
              loadedBytes: e.loaded,
              totalBytes: e.total,
              percentage,
              speedBytesPerSec,
              etaSeconds,
            });
          }
        };
      }

      if (params.signal) {
        params.signal.addEventListener("abort", () => {
          xhr.abort();
          reject(new Error("Unggahan dibatalkan oleh pengguna"));
        });
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const resp = JSON.parse(xhr.responseText);
            resolve(resp.data !== undefined ? resp.data : resp);
          } catch {
            resolve({ files: [] });
          }
        } else {
          try {
            const err = JSON.parse(xhr.responseText);
            reject(new Error(err.error || `HTTP error ${xhr.status}`));
          } catch {
            reject(new Error(`HTTP error ${xhr.status}`));
          }
        }
      };

      xhr.onerror = () => {
        reject(new Error("Koneksi jaringan terputus saat mengunggah berkas."));
      };

      xhr.ontimeout = () => {
        reject(new Error("Waktu unggah berkas habis (Timeout)."));
      };

      const formData = new FormData();
      formData.append("folderId", params.folderId);
      for (const file of params.files) {
        formData.append("files", file);
      }

      xhr.send(formData);
    });
  },
};
