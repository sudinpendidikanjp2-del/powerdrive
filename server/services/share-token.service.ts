import crypto from "crypto";
import { FolderPermission } from "../types/index.ts";

// Cryptographic secret for signing share links
const SHARE_SECRET = process.env.JWT_SECRET || "power-drive-secure-share-signature-secret-2026";

/**
 * Legacy signed share links (?folderId=&perm=&sig=). New links are managed by
 * ShareLinkService; these signatures are only verified so links that were
 * already sent out keep working. No new legacy links are minted.
 */
export class ShareTokenService {
  /**
   * Generates a tamper-proof HMAC-SHA256 signature for a specific folder/file, permission level, and optional settings
   */
  public static generateSignature(
    itemId: string,
    permission: FolderPermission | "VIEW" | "EDIT" | string,
    pwdHash?: string,
    emails?: string
  ): string {
    let payload = `power-drive:${itemId}:${permission}`;
    if (pwdHash) {
      payload += `:${pwdHash}`;
    }
    if (emails) {
      payload += `:${emails}`;
    }
    return crypto
      .createHmac("sha256", SHARE_SECRET)
      .update(payload)
      .digest("hex")
      .substring(0, 32); // 32 chars hex signature
  }

  /**
   * Validates whether a provided signature matches the given itemId, permission, and options
   */
  public static verifySignature(
    itemId: string,
    permission: string,
    signature: string,
    pwdHash?: string,
    emails?: string
  ): boolean {
    if (!itemId || !permission || !signature) return false;
    const expected = this.generateSignature(itemId, permission, pwdHash, emails);
    try {
      const bufA = Buffer.from(signature.trim());
      const bufB = Buffer.from(expected);
      if (bufA.length !== bufB.length) return false;
      return crypto.timingSafeEqual(bufA, bufB);
    } catch {
      return signature.trim() === expected;
    }
  }
}
