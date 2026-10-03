import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { ActiveTransfer, TransferProgress, TransferType, ArchiveSession, FileItem } from "../types/frontend.ts";
import { api } from "../services/api.ts";
import { withCredentialsQuery } from "../lib/credentials.ts";
import { useDialog } from "./DialogContext.tsx";

export interface UploadTask {
  id: string;
  file: globalThis.File;
  uploadId: string | null;
  status: "pending" | "uploading" | "paused" | "error" | "assembling" | "completed" | "cancelled";
  bytesSent: number;
  totalBytes: number;
  currentChunkIndex: number;
  totalChunks: number;
  speedBytesPerSec: number;
  etaSeconds: number;
  errorMessage: string | null;
  completedRecord?: FileItem;
}

export interface ChunkUploadSession {
  isOpen: boolean;
  viewMode: "compact" | "full";
  targetFolderId: string;
  targetFolderName: string;
  files: globalThis.File[];
  fileConflictModes?: Map<string, "create_version" | "overwrite" | "rename" | "skip">;
  tasks: UploadTask[];
  isAllPaused: boolean;
  onUploadCompleteCallback?: (completedFiles: FileItem[]) => void;
}

interface TransferContextValue {
  transfers: ActiveTransfer[];
  isHubOpen: boolean;
  setIsHubOpen: (open: boolean) => void;
  activeCount: number;
  startFileDownload: (fileId: string, fileName: string, expectedSize?: number) => Promise<boolean>;
  startArchivePartDownload: (params: {
    sessionId: string;
    partIndex: number;
    partName: string;
    expectedSize?: number;
  }) => Promise<boolean>;
  startBulkArchiveAllParts: (session: ArchiveSession) => Promise<void>;
  startUploadWithProgress: (folderId: string, files: File[]) => Promise<void>;
  startMountUploadWithProgress: (params: {
    mountId: string;
    mountName: string;
    subPath: string;
    files: File[];
    onComplete?: () => void;
  }) => Promise<boolean>;
  startChunkUpload: (params: {
    targetFolderId: string;
    targetFolderName: string;
    files: File[];
    fileConflictModes?: Map<string, "create_version" | "overwrite" | "rename" | "skip">;
    onUploadComplete?: (completedFiles: FileItem[]) => void;
  }) => void;
  chunkSession: ChunkUploadSession | null;
  setChunkSessionViewMode: (viewMode: "compact" | "full") => void;
  closeChunkSession: () => void;
  pauseChunkTask: (taskId: string) => void;
  resumeChunkTask: (taskId: string) => void;
  retryChunkTask: (taskId: string) => void;
  cancelChunkTask: (taskId: string) => void;
  pauseAllChunkTasks: () => void;
  resumeAllChunkTasks: () => void;
  retryAllFailedChunkTasks: () => void;
  cancelTransfer: (id: string) => void;
  clearCompleted: () => void;
  removeTransfer: (id: string) => void;
}

const CHUNK_SIZE = 1024 * 1024 * 2; // 2MB chunk for optimal throughput
const MAX_CONCURRENT_CHUNK_UPLOADS = 10; // Up to 10 concurrent parallel chunk streams

const TransferContext = createContext<TransferContextValue | null>(null);

export const TransferProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [transfers, setTransfers] = useState<ActiveTransfer[]>([]);
  const [isHubOpen, setIsHubOpen] = useState<boolean>(false);
  const [chunkSession, setChunkSession] = useState<ChunkUploadSession | null>(null);
  const { showToast, showAlert } = useDialog();

  const activeTransfersRef = useRef<Map<string, AbortController>>(new Map());
  
  // References for persistent chunk uploads
  const chunkAbortFlagsRef = useRef<Map<string, boolean>>(new Map());
  const chunkStartedTasksRef = useRef<Set<string>>(new Set());
  const chunkCompletedRecordsRef = useRef<FileItem[]>([]);

  const activeTransfersCount = transfers.filter((t) => t.status === "ACTIVE" || t.status === "PENDING").length;
  const activeChunkTasksCount = chunkSession
    ? chunkSession.tasks.filter((t) => t.status === "uploading" || t.status === "assembling" || t.status === "pending").length
    : 0;

  const totalActiveTransfers = activeTransfersCount + activeChunkTasksCount;

  // Protect against accidental browser tab closing / refresh during active uploads
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (totalActiveTransfers > 0) {
        e.preventDefault();
        e.returnValue = "Pengunggahan/pengunduhan berkas sedang berlangsung. Meninggalkan halaman akan menghentikan transfer.";
        return e.returnValue;
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [totalActiveTransfers]);

  const updateTransfer = useCallback((id: string, updates: Partial<ActiveTransfer>) => {
    setTransfers((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
    );
  }, []);

  const triggerBrowserDownload = (blob: Blob, fileName: string) => {
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
  };

  const triggerDirectDownload = (url: string, fileName: string) => {
    try {
      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.src = url;
      document.body.appendChild(iframe);
      setTimeout(() => {
        try {
          document.body.removeChild(iframe);
        } catch (e) {}
      }, 30000);
    } catch (err) {
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  /**
   * Start a single file download with real-time progress bar
   */
  const startFileDownload = useCallback(
    async (fileId: string, fileName: string, expectedSize?: number): Promise<boolean> => {
      const transferId = `dl_${fileId}_${Date.now()}`;
      const abortController = new AbortController();
      activeTransfersRef.current.set(transferId, abortController);

      const newTransfer: ActiveTransfer = {
        id: transferId,
        type: "DOWNLOAD",
        title: fileName,
        subtitle: "Menghubungkan ke server...",
        status: "ACTIVE",
        loadedBytes: 0,
        totalBytes: expectedSize || 0,
        percentage: 0,
        speedBytesPerSec: 0,
        etaSeconds: 0,
        fileId,
        startedAt: Date.now(),
        abortController,
      };

      setTransfers((prev) => [newTransfer, ...prev]);
      setIsHubOpen(true);
      showToast(`Mulai mengunduh "${fileName}"`, "info");

      try {
        const url = withCredentialsQuery(`/api/storage/files/${fileId}/download`);

        const response = await fetch(url, { signal: abortController.signal });
        if (!response.ok) {
          throw new Error(`Server returned status ${response.status}`);
        }

        const reader = response.body?.getReader();
        const contentLength = parseInt(response.headers.get("content-length") || "0", 10) || expectedSize || 0;

        if (!reader) {
          triggerDirectDownload(url, fileName);
          return true;
        }

        const chunks: Uint8Array[] = [];
        let receivedLength = 0;
        const startedTime = Date.now();

        updateTransfer(transferId, { subtitle: "Mengunduh aliran data..." });

        while (true) {
          if (abortController.signal.aborted) {
            throw new DOMException("Aborted", "AbortError");
          }

          const { done, value } = await reader.read();
          if (done) break;

          chunks.push(value);
          receivedLength += value.length;

          const percentage = contentLength ? Math.min(Math.round((receivedLength / contentLength) * 100), 99) : 0;
          const elapsedSecs = (Date.now() - startedTime) / 1000;
          const speedBytesPerSec = elapsedSecs > 0 ? Math.round(receivedLength / elapsedSecs) : 0;
          const remainingBytes = contentLength - receivedLength;
          const etaSeconds = speedBytesPerSec > 0 ? Math.ceil(remainingBytes / speedBytesPerSec) : 0;

          updateTransfer(transferId, {
            loadedBytes: receivedLength,
            totalBytes: contentLength || receivedLength,
            percentage,
            speedBytesPerSec,
            etaSeconds,
          });
        }

        const blob = new Blob(chunks);
        triggerBrowserDownload(blob, fileName);

        updateTransfer(transferId, {
          status: "COMPLETED",
          percentage: 100,
          loadedBytes: receivedLength,
          totalBytes: receivedLength,
          completedAt: Date.now(),
          subtitle: "Unduhan selesai",
        });
        showToast(`Unduhan "${fileName}" selesai!`, "success");
        return true;
      } catch (err: any) {
        if (err.name === "AbortError" || abortController.signal.aborted) {
          updateTransfer(transferId, {
            status: "CANCELLED",
            subtitle: "Unduhan dibatalkan oleh pengguna",
          });
          return false;
        }

        console.error("[TransferContext] Download error:", err);
        updateTransfer(transferId, {
          status: "ERROR",
          errorMessage: err.message || "Gagal mengunduh berkas",
          subtitle: "Gagal mengunduh",
        });
        showAlert({
          title: "Gagal Mengunduh",
          message: err.message || "Terjadi kesalahan saat mengunduh berkas.",
          type: "error",
        });
        return false;
      } finally {
        activeTransfersRef.current.delete(transferId);
      }
    },
    [showToast, showAlert, updateTransfer]
  );

  /**
   * Start downloading a single part of a multi-part ZIP
   */
  const startArchivePartDownload = useCallback(
    async (params: {
      sessionId: string;
      partIndex: number;
      partName: string;
      expectedSize?: number;
    }): Promise<boolean> => {
      const transferId = `arc_${params.sessionId}_p${params.partIndex}_${Date.now()}`;
      const abortController = new AbortController();
      activeTransfersRef.current.set(transferId, abortController);

      const newTransfer: ActiveTransfer = {
        id: transferId,
        type: "MULTIPART_ZIP",
        title: params.partName,
        subtitle: `Menghubungkan Part ${params.partIndex}...`,
        status: "ACTIVE",
        loadedBytes: 0,
        totalBytes: params.expectedSize || 0,
        percentage: 0,
        speedBytesPerSec: 0,
        etaSeconds: 0,
        archiveSessionId: params.sessionId,
        currentPart: params.partIndex,
        startedAt: Date.now(),
        abortController,
      };

      setTransfers((prev) => [newTransfer, ...prev]);
      setIsHubOpen(true);
      showToast(`Mengunduh part arsip "${params.partName}"`, "info");

      try {
        const url = withCredentialsQuery(`/api/storage/bulk-download/part/${params.sessionId}/${params.partIndex}`);

        const response = await fetch(url, { signal: abortController.signal });
        if (!response.ok) {
          throw new Error(`Server returned status ${response.status}`);
        }

        const reader = response.body?.getReader();
        const contentLength = parseInt(response.headers.get("content-length") || "0", 10) || params.expectedSize || 0;

        if (!reader) {
          triggerDirectDownload(url, params.partName);
          return true;
        }

        const chunks: Uint8Array[] = [];
        let receivedLength = 0;
        const startedTime = Date.now();

        updateTransfer(transferId, { subtitle: `Mengunduh data part ${params.partIndex}...` });

        while (true) {
          if (abortController.signal.aborted) {
            throw new DOMException("Aborted", "AbortError");
          }

          const { done, value } = await reader.read();
          if (done) break;

          chunks.push(value);
          receivedLength += value.length;

          const percentage = contentLength ? Math.min(Math.round((receivedLength / contentLength) * 100), 99) : 0;
          const elapsedSecs = (Date.now() - startedTime) / 1000;
          const speedBytesPerSec = elapsedSecs > 0 ? Math.round(receivedLength / elapsedSecs) : 0;
          const remainingBytes = contentLength - receivedLength;
          const etaSeconds = speedBytesPerSec > 0 ? Math.ceil(remainingBytes / speedBytesPerSec) : 0;

          updateTransfer(transferId, {
            loadedBytes: receivedLength,
            totalBytes: contentLength || receivedLength,
            percentage,
            speedBytesPerSec,
            etaSeconds,
          });
        }

        const blob = new Blob(chunks, { type: "application/zip" });
        triggerBrowserDownload(blob, params.partName);

        updateTransfer(transferId, {
          status: "COMPLETED",
          percentage: 100,
          loadedBytes: receivedLength,
          totalBytes: receivedLength,
          completedAt: Date.now(),
          subtitle: "Part ZIP berhasil diunduh",
        });
        showToast(`Part "${params.partName}" berhasil diunduh!`, "success");
        return true;
      } catch (err: any) {
        if (err.name === "AbortError" || abortController.signal.aborted) {
          updateTransfer(transferId, {
            status: "CANCELLED",
            subtitle: "Part ZIP dibatalkan oleh pengguna",
          });
          return false;
        }

        console.error("[TransferContext] Archive part download error:", err);
        updateTransfer(transferId, {
          status: "ERROR",
          errorMessage: err.message || "Gagal mengunduh part arsip ZIP",
          subtitle: "Gagal mengunduh part",
        });
        showAlert({
          title: "Gagal Mengunduh Part ZIP",
          message: err.message || "Terjadi kesalahan saat mengunduh part arsip ZIP.",
          type: "error",
        });
        return false;
      } finally {
        activeTransfersRef.current.delete(transferId);
      }
    },
    [showToast, showAlert, updateTransfer]
  );

  /**
   * Sequentially download all parts of a multi-part ZIP session
   */
  const startBulkArchiveAllParts = useCallback(
    async (session: ArchiveSession) => {
      setIsHubOpen(true);
      showToast(`Mempersiapkan pengunduhan ${session.totalParts} part arsip...`, "info");

      for (let i = 0; i < session.parts.length; i++) {
        const part = session.parts[i];
        const success = await startArchivePartDownload({
          sessionId: session.sessionId,
          partIndex: part.partIndex,
          partName: part.partName,
          expectedSize: part.totalBytes,
        });
        if (!success) {
          console.log("[TransferContext] Bulk download aborted sequentially.");
          break;
        }
      }
    },
    [startArchivePartDownload, showToast]
  );

  /**
   * Standard Upload (e.g. for Public Shared Folder)
   */
  const startUploadWithProgress = useCallback(
    async (folderId: string, files: File[]) => {
      const transferId = `upl_${Date.now()}`;
      const abortController = new AbortController();
      activeTransfersRef.current.set(transferId, abortController);

      const totalSize = files.reduce((acc, f) => acc + f.size, 0);
      const title =
        files.length === 1 ? files[0].name : `${files.length} Berkas (${files[0].name}...)`;

      const newTransfer: ActiveTransfer = {
        id: transferId,
        type: "UPLOAD",
        title,
        subtitle: "Mengunggah ke buffer lokal...",
        status: "ACTIVE",
        loadedBytes: 0,
        totalBytes: totalSize,
        percentage: 0,
        speedBytesPerSec: 0,
        etaSeconds: 0,
        startedAt: Date.now(),
        abortController,
      };

      setTransfers((prev) => [newTransfer, ...prev]);
      setIsHubOpen(true);
      showToast(`Mengunggah ${files.length} berkas...`, "info");

      try {
        const res = await api.uploadFilesWithProgress({
          folderId,
          files,
          signal: abortController.signal,
          onProgress: (progress: TransferProgress) => {
            updateTransfer(transferId, {
              loadedBytes: progress.loadedBytes,
              totalBytes: progress.totalBytes,
              percentage: progress.percentage,
              speedBytesPerSec: progress.speedBytesPerSec,
              etaSeconds: progress.etaSeconds,
            });
          },
        });

        updateTransfer(transferId, {
          status: "COMPLETED",
          percentage: 100,
          loadedBytes: totalSize,
          totalBytes: totalSize,
          completedAt: Date.now(),
          subtitle: "Unggahan selesai & siap disinkronkan",
        });

        showToast(`Berhasil mengunggah ${res.files?.length || files.length} berkas!`, "success");
        try {
          window.dispatchEvent(new CustomEvent("powerdrive:refresh-data", { detail: { folderId } }));
        } catch {}
      } catch (err: any) {
        if (err.name === "AbortError" || abortController.signal.aborted) {
          updateTransfer(transferId, {
            status: "CANCELLED",
            subtitle: "Unggahan dibatalkan",
          });
        } else {
          console.error("[TransferContext] Upload error:", err);
          updateTransfer(transferId, {
            status: "ERROR",
            errorMessage: err.message || "Gagal mengunggah berkas",
            subtitle: "Gagal mengunggah",
          });
          showAlert({
            title: "Gagal Mengunggah Berkas",
            message: err.message || "Terjadi kesalahan saat mengunggah berkas.",
            type: "error",
          });
        }
      } finally {
        activeTransfersRef.current.delete(transferId);
      }
    },
    [showToast, showAlert, updateTransfer]
  );

  /**
   * Upload to Mounted Storage with persistent background progress
   */
  const startMountUploadWithProgress = useCallback(
    async (params: {
      mountId: string;
      mountName: string;
      subPath: string;
      files: File[];
      onComplete?: () => void;
    }): Promise<boolean> => {
      const transferId = `mnt_upl_${params.mountId}_${Date.now()}`;
      const abortController = new AbortController();
      activeTransfersRef.current.set(transferId, abortController);

      const totalSize = params.files.reduce((acc, f) => acc + f.size, 0);
      const title =
        params.files.length === 1
          ? params.files[0].name
          : `${params.files.length} Berkas (${params.files[0].name}...)`;

      const newTransfer: ActiveTransfer = {
        id: transferId,
        type: "UPLOAD",
        title: `${title} [${params.mountName}]`,
        subtitle: `Mengunggah ke storage terpasang ${params.subPath || "/"}...`,
        status: "ACTIVE",
        loadedBytes: 0,
        totalBytes: totalSize,
        percentage: 0,
        speedBytesPerSec: 0,
        etaSeconds: 0,
        startedAt: Date.now(),
        abortController,
      };

      setTransfers((prev) => [newTransfer, ...prev]);
      setIsHubOpen(true);
      showToast(`Mengunggah ${params.files.length} berkas ke "${params.mountName}"...`, "info");

      try {
        const res = await api.uploadToMountWithProgress({
          mountId: params.mountId,
          subPath: params.subPath,
          files: params.files,
          signal: abortController.signal,
          onProgress: (progress: TransferProgress) => {
            updateTransfer(transferId, {
              loadedBytes: progress.loadedBytes,
              totalBytes: progress.totalBytes,
              percentage: progress.percentage,
              speedBytesPerSec: progress.speedBytesPerSec,
              etaSeconds: progress.etaSeconds,
            });
          },
        });

        updateTransfer(transferId, {
          status: "COMPLETED",
          percentage: 100,
          loadedBytes: totalSize,
          totalBytes: totalSize,
          completedAt: Date.now(),
          subtitle: "Unggahan ke storage terpasang selesai",
        });

        showToast(res.message || `Berhasil mengunggah ${params.files.length} berkas ke ${params.mountName}!`, "success");
        if (params.onComplete) params.onComplete();
        try {
          window.dispatchEvent(new CustomEvent("powerdrive:refresh-mounts"));
        } catch {}
        return true;
      } catch (err: any) {
        if (err.name === "AbortError" || abortController.signal.aborted) {
          updateTransfer(transferId, {
            status: "CANCELLED",
            subtitle: "Unggahan storage dibatalkan",
          });
        } else {
          console.error("[TransferContext] Mount upload error:", err);
          updateTransfer(transferId, {
            status: "ERROR",
            errorMessage: err.message || "Gagal mengunggah berkas ke storage terpasang",
            subtitle: "Gagal mengunggah",
          });
          showAlert({
            title: "Gagal Mengunggah Berkas ke Storage",
            message: err.message || "Terjadi kesalahan saat mengunggah berkas ke storage terpasang.",
            type: "error",
          });
        }
        return false;
      } finally {
        activeTransfersRef.current.delete(transferId);
      }
    },
    [showToast, showAlert, updateTransfer]
  );

  // =========================================================================
  // PERSISTENT RESUMABLE CHUNK UPLOAD ENGINE (UNINTERRUPTED ACROSS PAGE CHANGES)
  // =========================================================================

  const updateChunkTask = useCallback((taskId: string, patch: Partial<UploadTask>) => {
    setChunkSession((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        tasks: prev.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
      };
    });
  }, []);

  const processChunkUploadTask = useCallback(
    async (task: UploadTask, sessionFolderId: string, conflictModes?: Map<string, string>) => {
      const taskId = task.id;
      const file = task.file;
      const conflictMode = ((conflictModes?.get(file.name) as any) || "create_version") as
        | "create_version"
        | "overwrite"
        | "rename"
        | "skip";

      if (conflictMode === "skip") {
        updateChunkTask(taskId, { status: "completed", bytesSent: file.size });
        return;
      }

      const totalChunks = Math.ceil(file.size / CHUNK_SIZE) || 1;
      let uploadId = task.uploadId;
      let uploadedChunks = new Set<number>();

      // 1. Inisialisasi sesi upload jika belum ada
      if (!uploadId) {
        updateChunkTask(taskId, { status: "uploading", errorMessage: null });
        try {
          const initRes = await api.initChunkUpload({
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type || "application/octet-stream",
            folderId: sessionFolderId,
            chunkSize: CHUNK_SIZE,
            totalChunks,
            conflictMode,
          });
          uploadId = initRes.uploadId;
          uploadedChunks = new Set(initRes.uploadedChunks || []);
          updateChunkTask(taskId, { uploadId });
        } catch (err: any) {
          updateChunkTask(taskId, {
            status: "error",
            errorMessage: err.message || "Gagal menginisialisasi sesi chunk upload",
          });
          return;
        }
      } else {
        try {
          const statusRes = await api.getChunkUploadStatus(uploadId);
          uploadedChunks = new Set(statusRes.uploadedChunks || []);
        } catch {
          try {
            const initRes = await api.initChunkUpload({
              fileName: file.name,
              fileSize: file.size,
              mimeType: file.type || "application/octet-stream",
              folderId: sessionFolderId,
              chunkSize: CHUNK_SIZE,
              totalChunks,
              conflictMode,
            });
            uploadId = initRes.uploadId;
            uploadedChunks = new Set(initRes.uploadedChunks || []);
            updateChunkTask(taskId, { uploadId });
          } catch (err: any) {
            updateChunkTask(taskId, {
              status: "error",
              errorMessage: err.message || "Gagal memperbarui status chunk upload",
            });
            return;
          }
        }
      }

      updateChunkTask(taskId, { status: "uploading", errorMessage: null });

      let lastTime = Date.now();
      let lastBytesSent = Array.from(uploadedChunks).reduce((acc, idx) => {
        const start = idx * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        return acc + (end - start);
      }, 0);

      // 2. Upload chunks secara berurutan
      for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
        if (chunkAbortFlagsRef.current.get(taskId)) {
          updateChunkTask(taskId, { status: "paused", speedBytesPerSec: 0, etaSeconds: 0 });
          return;
        }

        if (uploadedChunks.has(chunkIdx)) {
          continue;
        }

        const start = chunkIdx * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunkBlob = file.slice(start, end);

        try {
          let chunkLoadedBytes = 0;
          await api.uploadSingleChunk(
            uploadId,
            chunkIdx,
            chunkBlob,
            (loaded) => {
              if (chunkAbortFlagsRef.current.get(taskId)) return;
              chunkLoadedBytes = loaded;
              const currentTotalSent = lastBytesSent + chunkLoadedBytes;
              const now = Date.now();
              const timeDiff = (now - lastTime) / 1000;
              let speed = 0;
              let eta = 0;
              if (timeDiff > 0.3) {
                speed = chunkLoadedBytes / timeDiff;
                const remainingBytes = file.size - currentTotalSent;
                eta = speed > 0 ? Math.ceil(remainingBytes / speed) : 0;
              }

              updateChunkTask(taskId, {
                bytesSent: Math.min(currentTotalSent, file.size),
                currentChunkIndex: chunkIdx + 1,
                speedBytesPerSec: speed,
                etaSeconds: eta,
              });
            }
          );

          uploadedChunks.add(chunkIdx);
          lastBytesSent += (end - start);
          lastTime = Date.now();

          updateChunkTask(taskId, {
            bytesSent: lastBytesSent,
            currentChunkIndex: chunkIdx + 1,
          });
        } catch (err: any) {
          if (chunkAbortFlagsRef.current.get(taskId)) {
            updateChunkTask(taskId, { status: "paused" });
            return;
          }
          updateChunkTask(taskId, {
            status: "error",
            errorMessage:
              err.message ||
              `Gagal mengirim bagian ${chunkIdx + 1}/${totalChunks}. Tekan Coba Lagi untuk melanjutkan.`,
            speedBytesPerSec: 0,
            etaSeconds: 0,
          });
          return;
        }
      }

      // 3. Assemble and complete file
      if (chunkAbortFlagsRef.current.get(taskId)) {
        updateChunkTask(taskId, { status: "paused" });
        return;
      }

      updateChunkTask(taskId, {
        status: "assembling",
        bytesSent: file.size,
        speedBytesPerSec: 0,
        etaSeconds: 0,
      });

      try {
        const completeRes = await api.completeChunkUpload(uploadId);
        chunkCompletedRecordsRef.current.push(completeRes.file);
        updateChunkTask(taskId, {
          status: "completed",
          completedRecord: completeRes.file,
          bytesSent: file.size,
        });

        // Trigger auto refresh across all listeners
        try {
          window.dispatchEvent(
            new CustomEvent("powerdrive:refresh-data", {
              detail: { folderId: sessionFolderId, file: completeRes.file },
            })
          );
        } catch {}
      } catch (err: any) {
        updateChunkTask(taskId, {
          status: "error",
          errorMessage: err.message || "Gagal menggabungkan berkas",
        });
      }
    },
    [updateChunkTask]
  );

  // Background queue runner for chunk session
  useEffect(() => {
    if (!chunkSession || !chunkSession.isOpen || chunkSession.tasks.length === 0) return;

    const activeCount = chunkSession.tasks.filter(
      (t) => t.status === "uploading" || t.status === "assembling"
    ).length;

    if (activeCount >= MAX_CONCURRENT_CHUNK_UPLOADS) return;

    const pendingTasks = chunkSession.tasks.filter(
      (t) =>
        t.status === "pending" &&
        !chunkAbortFlagsRef.current.get(t.id) &&
        !chunkStartedTasksRef.current.has(t.id)
    );

    if (pendingTasks.length === 0) return;

    const availableSlots = MAX_CONCURRENT_CHUNK_UPLOADS - activeCount;
    const tasksToStart = pendingTasks.slice(0, availableSlots);

    tasksToStart.forEach((task) => {
      chunkStartedTasksRef.current.add(task.id);
      processChunkUploadTask(
        task,
        chunkSession.targetFolderId,
        chunkSession.fileConflictModes as any
      );
    });
  }, [chunkSession, processChunkUploadTask]);

  /**
   * Start a new resumable chunk upload session (completely persistent)
   */
  const startChunkUpload = useCallback(
    (params: {
      targetFolderId: string;
      targetFolderName: string;
      files: File[];
      fileConflictModes?: Map<string, "create_version" | "overwrite" | "rename" | "skip">;
      onUploadComplete?: (completedFiles: FileItem[]) => void;
    }) => {
      if (params.files.length === 0) return;

      const initialTasks: UploadTask[] = params.files.map((file, index) => {
        const mode = params.fileConflictModes?.get(file.name);
        return {
          id: `task_${Date.now()}_${index}_${file.name}`,
          file,
          uploadId: null,
          status: mode === "skip" ? "completed" : "pending",
          bytesSent: mode === "skip" ? file.size : 0,
          totalBytes: file.size,
          currentChunkIndex: 0,
          totalChunks: Math.ceil(file.size / CHUNK_SIZE) || 1,
          speedBytesPerSec: 0,
          etaSeconds: 0,
          errorMessage: null,
        };
      });

      chunkCompletedRecordsRef.current = [];
      chunkAbortFlagsRef.current.clear();
      chunkStartedTasksRef.current.clear();

      setChunkSession({
        isOpen: true,
        viewMode: "compact", // Default to non-blocking compact floating dock (user can expand anytime)
        targetFolderId: params.targetFolderId,
        targetFolderName: params.targetFolderName,
        files: params.files,
        fileConflictModes: params.fileConflictModes,
        tasks: initialTasks,
        isAllPaused: false,
        onUploadCompleteCallback: params.onUploadComplete,
      });

      showToast(`Mengunggah ${params.files.length} berkas`, "info");
    },
    [showToast]
  );

  const setChunkSessionViewMode = useCallback((viewMode: "compact" | "full") => {
    setChunkSession((prev) => (prev ? { ...prev, viewMode } : null));
  }, []);

  const closeChunkSession = useCallback(() => {
    if (chunkSession?.onUploadCompleteCallback && chunkCompletedRecordsRef.current.length > 0) {
      chunkSession.onUploadCompleteCallback(chunkCompletedRecordsRef.current);
    }
    setChunkSession(null);
    chunkAbortFlagsRef.current.clear();
    chunkStartedTasksRef.current.clear();
    chunkCompletedRecordsRef.current = [];
  }, [chunkSession]);

  const pauseChunkTask = useCallback((taskId: string) => {
    chunkAbortFlagsRef.current.set(taskId, true);
    updateChunkTask(taskId, { status: "paused", speedBytesPerSec: 0, etaSeconds: 0 });
  }, [updateChunkTask]);

  const resumeChunkTask = useCallback((taskId: string) => {
    chunkAbortFlagsRef.current.set(taskId, false);
    chunkStartedTasksRef.current.delete(taskId);
    updateChunkTask(taskId, { status: "pending", errorMessage: null });
  }, [updateChunkTask]);

  const retryChunkTask = useCallback((taskId: string) => {
    chunkAbortFlagsRef.current.set(taskId, false);
    chunkStartedTasksRef.current.delete(taskId);
    updateChunkTask(taskId, { status: "pending", errorMessage: null });
  }, [updateChunkTask]);

  const cancelChunkTask = useCallback(
    async (taskId: string) => {
      chunkAbortFlagsRef.current.set(taskId, true);
      let uploadId: string | null = null;
      setChunkSession((prev) => {
        if (!prev) return null;
        const target = prev.tasks.find((t) => t.id === taskId);
        uploadId = target?.uploadId || null;
        return {
          ...prev,
          tasks: prev.tasks.filter((t) => t.id !== taskId),
        };
      });

      if (uploadId) {
        try {
          await api.cancelChunkUpload(uploadId);
        } catch (e) {
          console.warn("Could not cancel server chunk upload:", e);
        }
      }
    },
    []
  );

  const pauseAllChunkTasks = useCallback(() => {
    setChunkSession((prev) => {
      if (!prev) return null;
      prev.tasks.forEach((t) => {
        if (t.status === "uploading" || t.status === "pending") {
          chunkAbortFlagsRef.current.set(t.id, true);
        }
      });
      return {
        ...prev,
        isAllPaused: true,
        tasks: prev.tasks.map((t) =>
          t.status === "uploading" || t.status === "pending"
            ? { ...t, status: "paused", speedBytesPerSec: 0, etaSeconds: 0 }
            : t
        ),
      };
    });
  }, []);

  const resumeAllChunkTasks = useCallback(() => {
    setChunkSession((prev) => {
      if (!prev) return null;
      prev.tasks.forEach((t) => {
        if (t.status === "paused" || t.status === "error") {
          chunkAbortFlagsRef.current.set(t.id, false);
          chunkStartedTasksRef.current.delete(t.id);
        }
      });
      return {
        ...prev,
        isAllPaused: false,
        tasks: prev.tasks.map((t) =>
          t.status === "paused" || t.status === "error"
            ? { ...t, status: "pending", errorMessage: null }
            : t
        ),
      };
    });
  }, []);

  const retryAllFailedChunkTasks = useCallback(() => {
    setChunkSession((prev) => {
      if (!prev) return null;
      prev.tasks.forEach((t) => {
        if (t.status === "error" || t.status === "cancelled") {
          chunkAbortFlagsRef.current.set(t.id, false);
          chunkStartedTasksRef.current.delete(t.id);
        }
      });
      return {
        ...prev,
        tasks: prev.tasks.map((t) =>
          t.status === "error" || t.status === "cancelled"
            ? { ...t, status: "pending", errorMessage: null }
            : t
        ),
      };
    });
  }, []);

  const cancelTransfer = useCallback((id: string) => {
    const controller = activeTransfersRef.current.get(id);
    if (controller) {
      controller.abort();
    }
    updateTransfer(id, {
      status: "CANCELLED",
      subtitle: "Dibatalkan oleh pengguna",
    });
  }, [updateTransfer]);

  const clearCompleted = useCallback(() => {
    setTransfers((prev) =>
      prev.filter((t) => t.status === "ACTIVE" || t.status === "PENDING")
    );
  }, []);

  const removeTransfer = useCallback((id: string) => {
    setTransfers((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <TransferContext.Provider
      value={{
        transfers,
        isHubOpen,
        setIsHubOpen,
        activeCount: totalActiveTransfers,
        startFileDownload,
        startArchivePartDownload,
        startBulkArchiveAllParts,
        startUploadWithProgress,
        startMountUploadWithProgress,
        startChunkUpload,
        chunkSession,
        setChunkSessionViewMode,
        closeChunkSession,
        pauseChunkTask,
        resumeChunkTask,
        retryChunkTask,
        cancelChunkTask,
        pauseAllChunkTasks,
        resumeAllChunkTasks,
        retryAllFailedChunkTasks,
        cancelTransfer,
        clearCompleted,
        removeTransfer,
      }}
    >
      {children}
    </TransferContext.Provider>
  );
};

export const useTransfer = (): TransferContextValue => {
  const context = useContext(TransferContext);
  if (!context) {
    throw new Error("useTransfer must be used within a TransferProvider");
  }
  return context;
};
