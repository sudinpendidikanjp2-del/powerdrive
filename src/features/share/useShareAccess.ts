import { useCallback, useEffect, useState } from "react";
import { api } from "../../services/api.ts";
import { FileItem, Folder, FolderPermission } from "../../types/frontend.ts";
import { setShareSession } from "../../lib/credentials.ts";

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function readLegacyGateParams() {
  try {
    const p = new URLSearchParams(window.location.search);
    return { pwdHash: p.get("pwdHash"), emails: p.get("emails") };
  } catch {
    return { pwdHash: null, emails: null };
  }
}

export type ShareState =
  | { kind: "loading" }
  | { kind: "gate"; needsPassword: boolean; needsEmail: boolean; error?: string }
  | { kind: "error"; message: string }
  | { kind: "folder"; folder: Folder; permission: FolderPermission }
  | { kind: "file"; file: FileItem };

/**
 * Opens a share link and keeps the resulting share session for this tab.
 *
 * - Current links (?s=<id>): the server reports which credentials it needs,
 *   then checks the password or email itself before issuing a session.
 * - Legacy signed links (?folderId=&perm=&sig=) are still accepted so links
 *   that were sent before the upgrade keep working.
 */
export function useShareAccess({
  shareId,
  folderId,
  fileId,
  permParam,
  signature,
}: {
  shareId?: string;
  folderId?: string;
  fileId?: string;
  permParam?: string | null;
  signature?: string | null;
}) {
  const [legacyGate] = useState(readLegacyGateParams);
  const legacyNeedsGate = !shareId && !!(legacyGate.pwdHash || legacyGate.emails);
  const [state, setState] = useState<ShareState>(
    legacyNeedsGate ? { kind: "gate", needsPassword: !!legacyGate.pwdHash, needsEmail: !!legacyGate.emails } : { kind: "loading" }
  );

  const grant = useCallback((res: { session?: string; folder?: Folder; file?: FileItem; permission?: string }) => {
    if (res.session) setShareSession(res.session);
    if (res.file && !res.folder) return setState({ kind: "file", file: res.file });
    if (res.folder) {
      return setState({
        kind: "folder",
        folder: res.folder,
        permission: res.permission === "EDIT" ? FolderPermission.EDIT : FolderPermission.VIEW,
      });
    }
    throw new Error("Isi tautan tidak ditemukan.");
  }, []);

  const openManaged = useCallback(
    async (password?: string, email?: string) => {
      if (!shareId) return;
      try {
        if (password === undefined && email === undefined) {
          const gate = await api.getShareGate(shareId);
          if (gate.requiresPassword || gate.requiresEmail) {
            return setState({ kind: "gate", needsPassword: gate.requiresPassword, needsEmail: gate.requiresEmail });
          }
        }
        const res = await api.openShareLink(shareId, { password, email });
        grant(res);
      } catch (err: any) {
        const message = err?.message || "Tautan tidak dapat dibuka.";
        setState((prev) => (prev.kind === "gate" ? { ...prev, error: message } : { kind: "error", message }));
      }
    },
    [shareId, grant]
  );

  const openLegacy = useCallback(
    async (password?: string, email?: string) => {
      try {
        if (!signature) {
          throw new Error("Tautan ini tidak lagi berlaku. Minta pemilik membagikan tautan baru.");
        }
        const pwdHash = password ? await sha256(password) : legacyGate.pwdHash || undefined;
        const res = await api.verifyShareToken({
          folderId,
          fileId,
          permission: permParam === "EDIT" ? "EDIT" : "VIEW",
          signature,
          pwdHash,
          emails: legacyGate.emails || undefined,
          emailInput: email,
        });
        if (!res.isValid) throw new Error("Tautan ini tidak valid atau sudah diubah.");
        grant({ session: res.session, folder: fileId ? undefined : res.folder, file: res.file, permission: res.grantedPermission });
      } catch (err: any) {
        const message = err?.message || "Tautan tidak dapat dibuka.";
        if (legacyNeedsGate) setState({ kind: "gate", needsPassword: !!legacyGate.pwdHash, needsEmail: !!legacyGate.emails, error: message });
        else setState({ kind: "error", message });
      }
    },
    [folderId, fileId, permParam, signature, legacyGate, legacyNeedsGate, grant]
  );

  useEffect(() => {
    if (shareId) openManaged();
    else if (!legacyNeedsGate) openLegacy();
  }, [shareId, legacyNeedsGate, openManaged, openLegacy]);

  return {
    state,
    retry: () => {
      setState({ kind: "loading" });
      if (shareId) openManaged();
      else openLegacy();
    },
    submitGate: (password: string, email: string) =>
      shareId ? openManaged(password || "", email || "") : openLegacy(password || undefined, email || undefined),
  };
}
