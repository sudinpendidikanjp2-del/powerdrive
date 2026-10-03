import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma, db } from "../db/index.ts";
import { ShareGrant } from "./access.service.ts";

const SESSION_SECRET = `${process.env.SESSION_SECRET || "default-insecure-dev-session-secret-change-in-production"}:share-session`;
const SESSION_TTL_SECONDS = 12 * 60 * 60;

// Wrong password/email attempts allowed per link and client address per window.
const ATTEMPT_LIMIT = 10;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map<string, { count: number; resetAt: number }>();

export type ShareItemType = "FOLDER" | "FILE";
export type SharePermission = "VIEW" | "EDIT";

export class ShareLinkError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: "NOT_FOUND" | "GATE_REQUIRED" | "GATE_FAILED" | "RATE_LIMITED" | "INVALID"
  ) {
    super(message);
  }
}

interface ShareLinkRow {
  id: string;
  itemType: string;
  itemId: string;
  permission: string;
  passwordHash: string | null;
  allowedEmails: string[];
  createdById: string;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastOpenedAt: Date | null;
}

/** Public shape of a link for its owner (never includes the password hash). */
export function presentLink(link: ShareLinkRow) {
  return {
    id: link.id,
    itemType: link.itemType,
    itemId: link.itemId,
    permission: link.permission,
    hasPassword: !!link.passwordHash,
    allowedEmails: link.allowedEmails,
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    lastOpenedAt: link.lastOpenedAt,
  };
}

function normalizeEmails(emails: unknown): string[] {
  const list = Array.isArray(emails) ? emails : typeof emails === "string" ? emails.split(/[,;\s]+/) : [];
  return Array.from(new Set(list.map((e) => String(e).trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))));
}

function isActive(link: ShareLinkRow | null): link is ShareLinkRow {
  return !!link && !link.revokedAt && (!link.expiresAt || link.expiresAt.getTime() > Date.now());
}

function checkRateLimit(key: string) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (entry && entry.resetAt > now && entry.count >= ATTEMPT_LIMIT) {
    throw new ShareLinkError("Terlalu banyak percobaan. Coba lagi dalam beberapa menit.", 429, "RATE_LIMITED");
  }
}

function recordFailure(key: string) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) attempts.set(key, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
  else entry.count += 1;
}

export class ShareLinkService {
  static async create(input: {
    itemType: ShareItemType;
    itemId: string;
    permission: SharePermission;
    password?: string;
    allowedEmails?: unknown;
    expiresInDays?: number;
    createdById: string;
  }) {
    if (input.itemType === "FILE" && input.permission !== "VIEW") {
      throw new ShareLinkError("Tautan berkas hanya bisa berizin lihat.", 400, "INVALID");
    }
    const exists =
      input.itemType === "FOLDER"
        ? await db.folder.findUnique({ where: { id: input.itemId } })
        : await db.file.findUnique({ where: { id: input.itemId } });
    if (!exists) throw new ShareLinkError("Item yang dibagikan tidak ditemukan.", 404, "NOT_FOUND");

    const password = input.password?.trim();
    if (password && password.length < 4) {
      throw new ShareLinkError("Kata sandi tautan minimal 4 karakter.", 400, "INVALID");
    }
    const days = Number(input.expiresInDays);
    const link = await prisma.shareLink.create({
      data: {
        // 192 random bits: the id itself is the bearer secret in the URL.
        id: crypto.randomBytes(24).toString("base64url"),
        itemType: input.itemType,
        itemId: input.itemId,
        permission: input.permission,
        passwordHash: password ? await bcrypt.hash(password, 10) : null,
        allowedEmails: normalizeEmails(input.allowedEmails),
        createdById: input.createdById,
        expiresAt: Number.isFinite(days) && days > 0 ? new Date(Date.now() + days * 86400000) : null,
      },
    });
    return presentLink(link);
  }

  static async listActive(itemType: ShareItemType, itemId: string) {
    const links = await prisma.shareLink.findMany({
      where: { itemType, itemId, revokedAt: null },
      orderBy: { createdAt: "desc" },
    });
    return links.filter(isActive).map(presentLink);
  }

  static async get(id: string) {
    return prisma.shareLink.findUnique({ where: { id } });
  }

  static async revoke(id: string) {
    await prisma.shareLink.update({ where: { id }, data: { revokedAt: new Date() } });
  }

  /** What the visitor must enter before the link opens. Reveals nothing about the item. */
  static async gate(id: string) {
    const link = await this.get(id);
    if (!isActive(link)) throw new ShareLinkError("Tautan tidak ditemukan atau sudah dicabut.", 404, "NOT_FOUND");
    return { requiresPassword: !!link.passwordHash, requiresEmail: link.allowedEmails.length > 0, itemType: link.itemType };
  }

  /** Checks the password/email on the server and issues a share session. */
  static async open(id: string, input: { password?: string; email?: string }, clientKey: string) {
    const link = await this.get(id);
    if (!isActive(link)) throw new ShareLinkError("Tautan tidak ditemukan atau sudah dicabut.", 404, "NOT_FOUND");

    const limiterKey = `${id}|${clientKey}`;
    if (link.passwordHash || link.allowedEmails.length) {
      checkRateLimit(limiterKey);
      const password = input.password || "";
      const email = (input.email || "").trim().toLowerCase();
      if ((link.passwordHash && !password) || (link.allowedEmails.length && !email)) {
        throw new ShareLinkError("Masukkan kata sandi atau email untuk membuka tautan ini.", 401, "GATE_REQUIRED");
      }
      const passwordOk = !link.passwordHash || (await bcrypt.compare(password, link.passwordHash));
      const emailOk = !link.allowedEmails.length || link.allowedEmails.includes(email);
      if (!passwordOk || !emailOk) {
        recordFailure(limiterKey);
        throw new ShareLinkError("Kata sandi atau email tidak cocok.", 403, "GATE_FAILED");
      }
    }

    const item =
      link.itemType === "FOLDER"
        ? await db.folder.findUnique({ where: { id: link.itemId } })
        : await db.file.findUnique({ where: { id: link.itemId } });
    if (!item || (item as { isTrashed?: boolean }).isTrashed) {
      throw new ShareLinkError("Isi tautan sudah dihapus.", 404, "NOT_FOUND");
    }

    await prisma.shareLink.update({ where: { id }, data: { lastOpenedAt: new Date() } });
    const grant: ShareGrant = {
      linkId: link.id,
      itemType: link.itemType as ShareItemType,
      itemId: link.itemId,
      permission: link.permission as SharePermission,
    };
    return {
      session: this.issueSession(grant),
      expiresIn: SESSION_TTL_SECONDS,
      permission: grant.permission,
      itemType: grant.itemType,
      folder: link.itemType === "FOLDER" ? item : undefined,
      file: link.itemType === "FILE" ? item : undefined,
    };
  }

  static issueSession(grant: ShareGrant) {
    return jwt.sign({ typ: "share", ...grant }, SESSION_SECRET, { expiresIn: SESSION_TTL_SECONDS });
  }

  /**
   * Validates a share session. Sessions from managed links are re-checked
   * against the database so revoking a link cuts off open sessions at once.
   */
  static async verifySession(token: string): Promise<ShareGrant | null> {
    let payload: (ShareGrant & { typ?: string }) | null = null;
    try {
      payload = jwt.verify(token, SESSION_SECRET) as ShareGrant & { typ?: string };
    } catch {
      return null;
    }
    if (!payload || payload.typ !== "share") return null;
    if (payload.linkId !== "legacy") {
      const link = await this.get(payload.linkId);
      if (!isActive(link)) return null;
    }
    return { linkId: payload.linkId, itemType: payload.itemType, itemId: payload.itemId, permission: payload.permission };
  }
}
