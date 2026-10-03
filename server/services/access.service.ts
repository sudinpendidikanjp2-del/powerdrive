import { db } from "../db/index.ts";
import { FileRecord, FolderRecord, UserRecord } from "../types/index.ts";

/** What an unauthenticated (or additionally authenticated) visitor proved with a share link. */
export interface ShareGrant {
  linkId: string;
  itemType: "FOLDER" | "FILE";
  itemId: string;
  permission: "VIEW" | "EDIT";
}

export interface Principal {
  user?: UserRecord;
  share?: ShareGrant;
}

const MAX_DEPTH = 64;

/**
 * Every access decision for folders and files goes through here.
 *
 * - Admins can read and write everything.
 * - A signed-in user can read and write folders they own, including everything
 *   nested inside them, and files they uploaded.
 * - A share session grants VIEW (read) or EDIT (read + upload) on the shared
 *   folder and its whole subtree, or read on a single shared file.
 */
export class AccessService {
  /** Folder ids from `folderId` up to the root (inclusive), nearest first. */
  static async ancestry(folderId: string): Promise<FolderRecord[]> {
    const chain: FolderRecord[] = [];
    const seen = new Set<string>();
    let current: string | null = folderId;
    while (current && !seen.has(current) && chain.length < MAX_DEPTH) {
      seen.add(current);
      const folder: FolderRecord | null = await db.folder.findUnique({ where: { id: current } });
      if (!folder) break;
      chain.push(folder);
      current = folder.parentId;
    }
    return chain;
  }

  static isAdmin(p: Principal) {
    return p.user?.role === "ADMIN";
  }

  private static async folderAccess(p: Principal, folderId: string): Promise<"none" | "read" | "write"> {
    if (this.isAdmin(p)) return "write";
    const chain = await this.ancestry(folderId);
    if (chain.length === 0) return "none";
    if (p.user && chain.some((f) => f.ownerId === p.user!.id)) return "write";
    if (p.share?.itemType === "FOLDER" && chain.some((f) => f.id === p.share!.itemId)) {
      return p.share.permission === "EDIT" ? "write" : "read";
    }
    return "none";
  }

  static async canReadFolder(p: Principal, folderId: string) {
    return (await this.folderAccess(p, folderId)) !== "none";
  }

  static async canWriteFolder(p: Principal, folderId: string) {
    return (await this.folderAccess(p, folderId)) === "write";
  }

  static async canReadFile(p: Principal, file: FileRecord) {
    if (this.isAdmin(p)) return true;
    if (p.user && file.userId === p.user.id) return true;
    if (p.share?.itemType === "FILE" && p.share.itemId === file.id) return true;
    return file.folderId ? this.canReadFolder(p, file.folderId) : false;
  }

  /** Owners and admins may create or revoke share links for an item. */
  static async canShare(user: UserRecord | undefined, itemType: "FOLDER" | "FILE", itemId: string) {
    if (!user) return false;
    if (user.role === "ADMIN") return true;
    if (itemType === "FOLDER") {
      const chain = await this.ancestry(itemId);
      return chain.some((f) => f.ownerId === user.id);
    }
    const file = await db.file.findUnique({ where: { id: itemId } });
    if (!file) return false;
    if (file.userId === user.id) return true;
    return file.folderId ? (await this.ancestry(file.folderId)).some((f) => f.ownerId === user.id) : false;
  }

  /**
   * Who an upload is recorded under. Share-link visitors have no account, so
   * their uploads belong to the owner of the folder they upload into (the
   * person who shared it); the link id goes into the audit log.
   */
  static async uploaderFor(p: Principal, folderId: string | null | undefined): Promise<UserRecord | undefined> {
    if (p.user) return p.user;
    if (!p.share || !folderId) return undefined;
    const chain = await this.ancestry(folderId);
    const ownerId = chain.find((f) => f.ownerId)?.ownerId;
    if (!ownerId) return undefined;
    return (await db.user.findUnique({ where: { id: ownerId } })) || undefined;
  }

  /**
   * Breadcrumbs as the principal may see them: share visitors only see the
   * path from the shared folder down, never the owner's folders above it.
   */
  static trimToShareRoot<T extends { id: string }>(p: Principal, trail: T[]): T[] {
    if (p.user || p.share?.itemType !== "FOLDER") return trail;
    const idx = trail.findIndex((c) => c.id === p.share!.itemId);
    return idx === -1 ? [] : trail.slice(idx);
  }
}
