import React, { Suspense, useMemo, useRef, useState } from "react";
import { Download, Eye, FolderOpen, Home, Loader2, SearchX, UploadCloud } from "lucide-react";
import { FileItem, Folder, FolderPermission } from "../../types/frontend.ts";
import { api } from "../../services/api.ts";
import { useDialog } from "../../context/DialogContext.tsx";
import { useTransfer } from "../../context/TransferContext.tsx";
import { formatBytes, formatDate, formatShortDate } from "../../lib/format.ts";
import { usePersistentState } from "../../lib/usePersistentState.ts";
import { Button } from "../../ui/Button.tsx";
import { Badge, PermissionBadge } from "../../ui/Badge.tsx";
import { ContextMenu, MenuItem } from "../../ui/Menu.tsx";
import { useExplorer } from "../explorer/useExplorer.ts";
import { useFileDropZone } from "../explorer/useFileDropZone.ts";
import { MarqueeBox } from "../explorer/useMarquee.ts";
import { ExplorerEntry } from "../explorer/types.ts";
import { ItemsView, toEntries } from "../explorer/ItemsView.tsx";
import { Breadcrumbs } from "../explorer/Breadcrumbs.tsx";
import {
  DockAction,
  DropOverlay,
  EmptyState,
  ErrorState,
  ItemsSkeleton,
  LoadMore,
  SearchField,
  SelectionDock,
  TopProgress,
  ViewToggle,
} from "../explorer/ExplorerParts.tsx";
import { useDriveListing } from "../drive/useDriveListing.ts";
import { useShareAccess } from "./useShareAccess.ts";
import { ShareError, ShareGate, ShareHeader, SharedFileCard } from "./ShareScreens.tsx";
import { LazyThumbnail } from "../../components/LazyThumbnail.tsx";
import { FilePreviewModal } from "../explorer/lazyDialogs.ts";

interface PublicSharedFolderViewProps {
  shareId?: string;
  initialFolderId?: string;
  fileId?: string;
  permParam?: string | null;
  signatureParam?: string | null;
  onGoToLogin: () => void;
}

export const PublicSharedFolderView: React.FC<PublicSharedFolderViewProps> = ({
  shareId,
  initialFolderId,
  fileId,
  permParam,
  signatureParam,
  onGoToLogin,
}) => {
  const access = useShareAccess({ shareId, folderId: initialFolderId, fileId, permParam, signature: signatureParam });
  const { startFileDownload } = useTransfer();
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const { state } = access;

  if (state.kind === "folder") {
    return <SharedFolderBrowser root={state.folder} permission={state.permission} onGoToLogin={onGoToLogin} />;
  }

  return (
    <div className="min-h-dvh flex flex-col bg-canvas text-ink-900">
      <ShareHeader onGoToLogin={onGoToLogin} context={state.kind === "file" ? "Berkas dibagikan dengan Anda" : undefined} />
      {state.kind === "loading" && (
        <div className="flex-1 flex items-center justify-center gap-2 text-sm text-ink-500" role="status">
          <Loader2 className="w-5 h-5 animate-spin" /> Memeriksa tautan
        </div>
      )}
      {state.kind === "gate" && (
        <ShareGate needsPassword={state.needsPassword} needsEmail={state.needsEmail} error={state.error} onSubmit={access.submitGate} />
      )}
      {state.kind === "error" && <ShareError message={state.message} onRetry={access.retry} onGoToLogin={onGoToLogin} />}
      {state.kind === "file" && (
        <>
          <SharedFileCard
            file={state.file}
            onPreview={() => setPreviewFile(state.file)}
            onDownload={() => startFileDownload(state.file.id, state.file.originalName, state.file.size)}
          />
          <Suspense fallback={null}>{previewFile && <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />}</Suspense>
        </>
      )}
    </div>
  );
};

/** Read-only (or upload-enabled with an EDIT link) browser for a shared folder subtree. */
function SharedFolderBrowser({ root, permission, onGoToLogin }: { root: Folder; permission: FolderPermission; onGoToLogin: () => void }) {
  const { showAlert, showToast } = useDialog();
  const { startFileDownload, startUploadWithProgress } = useTransfer();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [path, setPath] = useState<Folder[]>([root]);
  const current = path[path.length - 1];
  const [search, setSearch] = useState("");
  const [view, setView] = usePersistentState<"grid" | "list">("powerdrive:view", "grid");
  const listing = useDriveListing(current.id, search, { scopedSearch: true });
  const canUpload = permission === FolderPermission.EDIT;

  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: ExplorerEntry } | null>(null);
  const [zipping, setZipping] = useState(false);

  const folderById = useMemo(() => new Map(listing.folders.map((f) => [f.id, f])), [listing.folders]);
  const fileById = useMemo(() => new Map(listing.files.map((f) => [f.id, f])), [listing.files]);
  const entries = useMemo(() => toEntries(listing.folders, listing.files), [listing.folders, listing.files]);

  const enter = (folder: Folder) => {
    setSearch("");
    setPath((p) => [...p, folder]);
  };

  const openEntry = (entry: ExplorerEntry) => {
    if (entry.kind === "folder") {
      const f = folderById.get(entry.id);
      if (f) enter(f);
    } else {
      const f = fileById.get(entry.id);
      if (f) setPreviewFile(f);
    }
  };

  const explorer = useExplorer({
    entries,
    resetKey: `${current.id}|${listing.isSearching}`,
    open: openEntry,
    onContextMenu: (entry, x, y) => setContextMenu({ x, y, entry }),
  });
  const { selection } = explorer;

  const selectedFiles = Array.from(selection.keys)
    .filter((k) => k.startsWith("file_"))
    .map((k) => fileById.get(k.slice(5)))
    .filter(Boolean) as FileItem[];
  const selectedFolders = Array.from(selection.keys)
    .filter((k) => k.startsWith("folder_"))
    .map((k) => folderById.get(k.slice(7)))
    .filter(Boolean) as Folder[];

  const downloadZip = async (files: FileItem[]) => {
    if (files.length === 0) return;
    setZipping(true);
    try {
      const name = `${current.name}-${new Date().toISOString().slice(0, 10)}.zip`;
      await api.downloadDirectZip(files.map((f) => f.id), name);
    } catch (err: any) {
      showAlert({ title: "ZIP gagal dibuat", message: err?.message || "Coba unduh berkas satu per satu.", type: "error" });
    } finally {
      setZipping(false);
    }
  };

  const upload = async (files: File[]) => {
    if (!canUpload || files.length === 0) return;
    try {
      await startUploadWithProgress(current.id, files);
      listing.refresh();
    } catch (err: any) {
      showAlert({ title: "Unggahan gagal", message: err?.message || "Berkas tidak dapat diunggah.", type: "error" });
    }
  };
  const drop = useFileDropZone(upload, canUpload);

  const menuFor = (entry: ExplorerEntry): MenuItem[] => {
    if (entry.kind === "folder") {
      return [{ label: "Buka", icon: <FolderOpen className="w-4 h-4" />, onSelect: () => openEntry(entry) }];
    }
    const file = fileById.get(entry.id);
    if (!file) return [];
    return [
      { label: "Pratinjau", icon: <Eye className="w-4 h-4" />, onSelect: () => setPreviewFile(file) },
      { label: "Unduh", icon: <Download className="w-4 h-4" />, onSelect: () => startFileDownload(file.id, file.originalName, file.size) },
    ];
  };

  const isEmpty = listing.status === "ready" && listing.folders.length === 0 && listing.files.length === 0;

  return (
    <div className="h-dvh flex flex-col bg-canvas text-ink-900">
      <ShareHeader
        onGoToLogin={onGoToLogin}
        context={
          <span className="flex items-center gap-2">
            Folder dibagikan dengan Anda <PermissionBadge permission={permission} />
          </span>
        }
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          upload(Array.from(e.target.files || []));
          e.target.value = "";
        }}
      />

      <main className="flex-1 min-h-0 flex flex-col relative" {...drop.bind}>
        {drop.isOver && <DropOverlay label={`Lepas untuk mengunggah ke "${current.name}"`} />}

        <div className="sticky top-0 z-20 bg-canvas border-b border-ink-200">
          <div className="px-3 sm:px-6 pt-2.5 pb-1 flex items-center gap-3">
            <Breadcrumbs
              items={path.map((f, i) => ({ targetId: f.id, label: f.name, icon: i === 0 ? <Home className="w-4 h-4" /> : undefined }))}
              onNavigate={(i) => {
                setSearch("");
                setPath((p) => p.slice(0, i + 1));
              }}
              dnd={explorer.dnd}
            />
          </div>
          <div className="px-3 sm:px-6 pb-2.5 pt-1 flex items-center gap-2">
            <SearchField value={search} onChange={setSearch} placeholder={`Cari di ${current.name}`} />
            <div className="flex items-center gap-2 ml-auto">
              <ViewToggle value={view} onChange={setView} />
              {listing.files.length > 0 && (
                <Button icon={<Download className="w-4 h-4" />} loading={zipping} onClick={() => downloadZip(listing.files)} title="Unduh semua berkas di folder ini sebagai ZIP">
                  <span className="hidden sm:inline">Unduh semua</span>
                </Button>
              )}
              {canUpload && (
                <Button variant="primary" icon={<UploadCloud className="w-4 h-4" />} onClick={() => fileInputRef.current?.click()}>
                  <span className="hidden sm:inline">Unggah</span>
                </Button>
              )}
            </div>
          </div>
        </div>

        <div
          ref={explorer.contentRef}
          onMouseDown={explorer.marquee.onMouseDown}
          onClick={explorer.marquee.onBackgroundClick}
          className="relative flex-1 overflow-y-auto px-3 sm:px-6 pt-5 pb-28"
        >
          <TopProgress active={listing.isRefreshing || listing.isSearchPending} />
          <MarqueeBox box={explorer.marquee.box} />
          {listing.status === "loading" ? (
            <ItemsSkeleton />
          ) : listing.status === "error" ? (
            <ErrorState message={listing.error || "Isi folder tidak dapat dimuat."} onRetry={listing.retry} />
          ) : isEmpty ? (
            listing.isSearching ? (
              <EmptyState icon={<SearchX className="w-6 h-6" />} title={`Tidak ada hasil untuk "${search.trim()}"`}>
                <Button size="md" onClick={() => setSearch("")}>
                  Hapus pencarian
                </Button>
              </EmptyState>
            ) : (
              <EmptyState
                dashed
                icon={<FolderOpen className="w-6 h-6" />}
                title="Folder ini kosong"
                description={canUpload ? "Anda bisa mengunggah berkas ke folder ini." : undefined}
              >
                {canUpload && (
                  <Button variant="primary" size="md" icon={<UploadCloud className="w-4 h-4" />} onClick={() => fileInputRef.current?.click()}>
                    Pilih berkas
                  </Button>
                )}
              </EmptyState>
            )
          ) : (
            <>
              <ItemsView
                view={view}
                folders={listing.folders}
                files={listing.files}
                showFiles={listing.files.length > 0}
                explorer={explorer}
                folderTitle="Folder"
                folderMeta={(f) => `${f.filesCount || 0} berkas`}
                folderColumns={[
                  { label: "Isi", render: (f) => `${f.filesCount || 0} berkas` },
                  { label: "Dibuat", render: (f) => formatDate(f.createdAt) },
                ]}
                fileMeta={(f) => `${formatBytes(f.size)} · ${formatShortDate(f.createdAt)}`}
                fileCorner={(f) => (f.version && f.version > 1 ? <Badge tone="solid">v{f.version}</Badge> : null)}
                fileColumns={[
                  { label: "Ukuran", render: (f) => formatBytes(f.size) },
                  { label: "Diunggah", render: (f) => formatDate(f.createdAt) },
                ]}
                thumbnail={(f) => <LazyThumbnail file={f} />}
              />
              <LoadMore
                hasMore={listing.hasMore}
                loading={listing.isLoadingMore}
                onLoadMore={listing.loadMore}
                shown={listing.folders.length + listing.files.length}
                total={listing.total}
              />
            </>
          )}
        </div>
      </main>

      <SelectionDock count={selection.count} onClear={selection.clear} onSelectAll={selection.selectAll}>
        {selectedFolders.length === 1 && selectedFiles.length === 0 && (
          <DockAction icon={<FolderOpen className="w-4 h-4" />} label="Buka" onClick={() => enter(selectedFolders[0])} />
        )}
        {selectedFiles.length === 1 && (
          <DockAction icon={<Eye className="w-4 h-4" />} label="Pratinjau" onClick={() => setPreviewFile(selectedFiles[0])} />
        )}
        {selectedFiles.length > 0 && (
          <DockAction
            icon={<Download className="w-4 h-4" />}
            label={selectedFiles.length > 1 ? "Unduh ZIP" : "Unduh"}
            onClick={() =>
              selectedFiles.length > 1
                ? downloadZip(selectedFiles)
                : startFileDownload(selectedFiles[0].id, selectedFiles[0].originalName, selectedFiles[0].size)
            }
          />
        )}
      </SelectionDock>

      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} title={contextMenu.entry.name} items={menuFor(contextMenu.entry)} onClose={() => setContextMenu(null)} />
      )}
      <Suspense fallback={null}>
        {previewFile && <FilePreviewModal file={previewFile} filesList={listing.files} onClose={() => setPreviewFile(null)} onNavigateFile={setPreviewFile} />}
      </Suspense>
    </div>
  );
}
