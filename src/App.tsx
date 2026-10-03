import React, { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { AuthProvider, useAuth } from "./context/AuthContext.tsx";
import { DialogProvider } from "./context/DialogContext.tsx";
import { TransferProvider } from "./context/TransferContext.tsx";
import { ThemeProvider } from "./context/ThemeContext.tsx";
import { TransferHUD } from "./components/TransferHUD.tsx";
import { ChunkUploadModal } from "./components/ChunkUploadModal.tsx";
import { GoogleDriveLayout } from "./components/GoogleDriveLayout.tsx";
import { Folder, GoogleDriveStatus, StorageStats, SyncStats } from "./types/frontend.ts";
import { api } from "./services/api.ts";

// Signed-out screens are separate chunks: a signed-in user never downloads them.
const AuthView = lazy(() => import("./components/AuthView.tsx").then((m) => ({ default: m.AuthView })));
const PublicSharedFolderView = lazy(() =>
  import("./features/share/PublicSharedFolderView.tsx").then((m) => ({ default: m.PublicSharedFolderView }))
);

function FullScreenLoader({ label }: { label: string }) {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-canvas" role="status">
      <div className="flex items-center gap-3 text-sm text-ink-500">
        <Loader2 className="w-5 h-5 animate-spin" />
        {label}
      </div>
    </div>
  );
}

function readShareParams() {
  try {
    const params = new URLSearchParams(window.location.search);
    return {
      shareId: params.get("s"),
      folderId: params.get("folderId") || params.get("folder"),
      fileId: params.get("fileId") || params.get("file"),
      perm: params.get("perm") || params.get("permission"),
      sig: params.get("sig") || params.get("signature") || params.get("token"),
    };
  } catch {
    return { shareId: null, folderId: null, fileId: null, perm: null, sig: null };
  }
}

function MainApp() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const [shareParams] = useState(readShareParams);
  const [forceShowLogin, setForceShowLogin] = useState(false);

  const [folders, setFolders] = useState<Folder[]>([]);
  const [googleStatus, setGoogleStatus] = useState<GoogleDriveStatus | null>(null);
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);
  const [syncStats, setSyncStats] = useState<SyncStats | null>(null);

  // Account-wide data for the shell and settings. Folder listings are paged by
  // the explorer itself, so no file list is loaded here.
  const fetchGlobalData = useCallback(async () => {
    const [foldersRes, googleRes, storageRes, syncRes] = await Promise.allSettled([
      api.listFolders({ limit: 100 }),
      api.getGoogleStatus(),
      api.getStorageStats(),
      api.getSyncStats(),
    ]);
    if (foldersRes.status === "fulfilled") setFolders(foldersRes.value.folders);
    if (googleRes.status === "fulfilled") setGoogleStatus(googleRes.value);
    if (storageRes.status === "fulfilled") setStorageStats(storageRes.value);
    if (syncRes.status === "fulfilled") setSyncStats(syncRes.value);
  }, []);

  useEffect(() => {
    if (user) fetchGlobalData();
  }, [user, fetchGlobalData]);

  useEffect(() => {
    if (!user) return;
    const onRefresh = () => fetchGlobalData();
    window.addEventListener("powerdrive:refresh-data", onRefresh);
    return () => window.removeEventListener("powerdrive:refresh-data", onRefresh);
  }, [user, fetchGlobalData]);

  if (isAuthLoading) return <FullScreenLoader label="Memuat Power Drive" />;

  const isShareLink = !!(shareParams.shareId || shareParams.folderId || shareParams.fileId);

  if (isShareLink && !forceShowLogin) {
    return (
      <Suspense fallback={<FullScreenLoader label="Membuka tautan" />}>
        <PublicSharedFolderView
          shareId={shareParams.shareId || undefined}
          initialFolderId={shareParams.folderId || undefined}
          fileId={shareParams.fileId || undefined}
          permParam={shareParams.perm}
          signatureParam={shareParams.sig}
          onGoToLogin={() => setForceShowLogin(true)}
        />
        <TransferHUD />
        <ChunkUploadModal />
      </Suspense>
    );
  }

  if (!user) {
    return (
      <Suspense fallback={<FullScreenLoader label="Memuat" />}>
        <AuthView
          onSuccess={fetchGlobalData}
          onBackToSharedFolder={isShareLink ? () => setForceShowLogin(false) : undefined}
        />
      </Suspense>
    );
  }

  return (
    <>
      <GoogleDriveLayout
        folders={folders}
        googleStatus={googleStatus}
        storageStats={storageStats}
        syncStats={syncStats}
        onRefreshAll={fetchGlobalData}
      />
      <TransferHUD />
      <ChunkUploadModal />
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <DialogProvider>
          <TransferProvider>
            <MainApp />
          </TransferProvider>
        </DialogProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
