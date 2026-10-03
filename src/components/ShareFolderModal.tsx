import React, { useCallback, useEffect, useState } from "react";
import { Check, Copy, Eye, KeyRound, Link2, Loader2, Mail, Share2, Upload } from "lucide-react";
import { FileItem, Folder, ShareLink } from "../types/frontend.ts";
import { api } from "../services/api.ts";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "../ui/Dialog.tsx";
import { Button } from "../ui/Button.tsx";
import { Badge } from "../ui/Badge.tsx";
import { Field, TextInput } from "../ui/Field.tsx";
import { formatDate } from "../lib/format.ts";
import { cn } from "../lib/cn.ts";

interface ShareFolderModalProps {
  folder?: Folder | null;
  file?: FileItem | null;
  onClose: () => void;
  /** Kept for callers; managed links do not change the folder record. */
  onPermissionUpdated?: (updatedFolder: Folder) => void;
}

const EXPIRY_OPTIONS = [
  { days: 0, label: "Tidak berakhir" },
  { days: 1, label: "1 hari" },
  { days: 7, label: "7 hari" },
  { days: 30, label: "30 hari" },
];

export const shareUrl = (id: string) => `${window.location.origin}${window.location.pathname}?s=${encodeURIComponent(id)}`;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="primary"
      icon={copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard blocked (insecure context): the field next to it is selectable.
        }
      }}
    >
      {copied ? "Tersalin" : "Salin"}
    </Button>
  );
}

function LinkRow({ link, onRevoke, revoking }: { link: ShareLink; onRevoke: () => void; revoking: boolean }) {
  const url = shareUrl(link.id);
  return (
    <li className="rounded-xl border border-ink-200 p-3.5 animate-fade-in">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-semibold text-ink-900 mr-1">
          {link.permission === "EDIT" ? "Bisa mengunggah" : "Bisa melihat"}
        </span>
        {link.hasPassword && (
          <Badge icon={<KeyRound className="w-3 h-3" />}>Kata sandi</Badge>
        )}
        {link.allowedEmails.length > 0 && (
          <Badge icon={<Mail className="w-3 h-3" />} title={link.allowedEmails.join(", ")}>
            {link.allowedEmails.length} email
          </Badge>
        )}
        {link.expiresAt && <Badge tone="warn">Berakhir {formatDate(link.expiresAt)}</Badge>}
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <input
          readOnly
          aria-label="Alamat tautan"
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 min-w-0 h-9 px-2.5 rounded-lg bg-ink-50 border border-ink-200 text-xs font-mono text-ink-700 truncate focus:outline-none focus:border-accent-600"
        />
        <CopyButton text={url} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-ink-500">
        <span className="tabular">
          Dibuat {formatDate(link.createdAt)}
          {link.lastOpenedAt ? ` · terakhir dibuka ${formatDate(link.lastOpenedAt)}` : " · belum pernah dibuka"}
        </span>
        <button
          type="button"
          onClick={onRevoke}
          disabled={revoking}
          className="font-semibold text-danger-600 hover:underline underline-offset-2 disabled:opacity-50"
        >
          {revoking ? "Mencabut…" : "Cabut"}
        </button>
      </div>
    </li>
  );
}

export const ShareFolderModal: React.FC<ShareFolderModalProps> = ({ folder, file, onClose }) => {
  const isFile = !!file;
  const itemId = file?.id || folder?.id || "";
  const itemType = isFile ? "FILE" : "FOLDER";
  const itemName = file ? file.originalName : folder?.name || "";

  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const [permission, setPermission] = useState<"VIEW" | "EDIT">("VIEW");
  const [password, setPassword] = useState("");
  const [emails, setEmails] = useState("");
  const [expiresInDays, setExpiresInDays] = useState(0);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await api.listShareLinks(itemType, itemId);
      setLinks(res.links);
    } catch (err: any) {
      setLoadError(err?.message || "Daftar tautan tidak dapat dimuat.");
    }
  }, [itemType, itemId]);

  useEffect(() => {
    if (itemId) load();
  }, [itemId, load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const { link } = await api.createShareLink({
        itemType,
        itemId,
        permission: isFile ? "VIEW" : permission,
        password: password.trim() || undefined,
        allowedEmails: emails
          .split(/[,;\s]+/)
          .map((x) => x.trim())
          .filter(Boolean),
        expiresInDays: expiresInDays || undefined,
      });
      setLinks((prev) => [link, ...(prev || [])]);
      setPassword("");
      setEmails("");
      try {
        await navigator.clipboard.writeText(shareUrl(link.id));
      } catch {
        // Not copied automatically; the row has its own copy button.
      }
    } catch (err: any) {
      setCreateError(err?.message || "Tautan gagal dibuat.");
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    setRevokingId(id);
    try {
      await api.revokeShareLink(id);
      setLinks((prev) => (prev || []).filter((l) => l.id !== id));
    } catch (err: any) {
      setLoadError(err?.message || "Tautan gagal dicabut.");
    } finally {
      setRevokingId(null);
    }
  };

  if (!itemId) return null;

  return (
    <Dialog open onClose={onClose} size="md">
      <DialogHeader
        icon={<Share2 className="w-4 h-4" />}
        title={isFile ? "Bagikan berkas" : "Bagikan folder"}
        description={<span className="break-all">{itemName}</span>}
        onClose={onClose}
      />
      <DialogBody className="space-y-5 pb-2">
        <form onSubmit={create} className="rounded-xl bg-ink-50 border border-ink-200 p-3.5 space-y-3">
          <div className="text-sm font-semibold text-ink-900">Buat tautan baru</div>
          {!isFile && (
            <div role="radiogroup" aria-label="Izin tautan" className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-ink-100">
              {[
                { value: "VIEW" as const, label: "Bisa melihat", icon: <Eye className="w-4 h-4" /> },
                { value: "EDIT" as const, label: "Bisa mengunggah", icon: <Upload className="w-4 h-4" /> },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={permission === opt.value}
                  onClick={() => setPermission(opt.value)}
                  className={cn(
                    "h-9 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors",
                    permission === opt.value ? "bg-surface text-ink-900 shadow-card" : "text-ink-500 hover:text-ink-900"
                  )}
                >
                  {opt.icon}
                  {opt.label}
                </button>
              ))}
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Kata sandi" hint="Opsional">
              <TextInput type="text" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Field label="Berlaku">
              <select
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(Number(e.target.value))}
                className="w-full h-10 px-2.5 rounded-lg bg-surface border border-ink-200 text-base sm:text-sm text-ink-900 focus:border-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-600/20"
              >
                {EXPIRY_OPTIONS.map((o) => (
                  <option key={o.days} value={o.days}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Hanya untuk email" hint="Opsional, pisahkan dengan koma">
            <TextInput value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="nama@contoh.id" />
          </Field>
          <p className="text-xs text-ink-500 leading-relaxed">
            Kata sandi diperiksa di server. Batasan email hanya meminta penerima mengetik alamat yang diizinkan; alamat itu tidak
            diverifikasi lewat kotak masuk.
          </p>
          {createError && (
            <p role="alert" className="text-sm text-danger-700 bg-danger-50 rounded-lg px-3 py-2">
              {createError}
            </p>
          )}
          <Button type="submit" variant="primary" size="md" loading={creating} icon={<Link2 className="w-4 h-4" />}>
            Buat dan salin tautan
          </Button>
        </form>

        <section aria-label="Tautan aktif">
          <div className="text-sm font-semibold text-ink-900 mb-2">
            Tautan aktif {links && <span className="text-ink-500 tabular">{links.length}</span>}
          </div>
          {loadError ? (
            <p role="alert" className="text-sm text-danger-700 bg-danger-50 rounded-lg px-3 py-2">
              {loadError}
            </p>
          ) : links === null ? (
            <div className="flex items-center gap-2 text-sm text-ink-500 py-3">
              <Loader2 className="w-4 h-4 animate-spin" /> Memuat tautan
            </div>
          ) : links.length === 0 ? (
            <p className="text-sm text-ink-500 py-1">
              Belum ada tautan. Tanpa tautan, {isFile ? "berkas" : "folder"} ini hanya bisa dibuka oleh Anda dan administrator.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {links.map((l) => (
                <LinkRow key={l.id} link={l} onRevoke={() => revoke(l.id)} revoking={revokingId === l.id} />
              ))}
            </ul>
          )}
        </section>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" size="md" onClick={onClose}>
          Selesai
        </Button>
      </DialogFooter>
    </Dialog>
  );
};
