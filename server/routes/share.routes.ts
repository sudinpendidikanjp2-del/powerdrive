import { Response, Router } from "express";
import { authenticate, AuthenticatedRequest, requireAuth } from "../middleware/auth.ts";
import { AccessService } from "../services/access.service.ts";
import { ShareItemType, ShareLinkError, ShareLinkService, SharePermission } from "../services/share-link.service.ts";

export const shareRouter = Router();
shareRouter.use(authenticate);

function fail(res: Response, err: unknown) {
  if (err instanceof ShareLinkError) {
    res.status(err.status).json({ success: false, error: err.message, code: err.code });
    return;
  }
  res.status(500).json({ success: false, error: (err as Error)?.message || "Terjadi kesalahan." });
}

const itemTypeOf = (v: unknown): ShareItemType | null => (v === "FOLDER" || v === "FILE" ? v : null);

// --- Visitors (no login) ---

/** Which credentials the link asks for. Says nothing about what it opens. */
shareRouter.get("/:id/gate", async (req: AuthenticatedRequest, res) => {
  try {
    res.json({ success: true, data: await ShareLinkService.gate(req.params.id) });
  } catch (err) {
    fail(res, err);
  }
});

/** Verifies password/email on the server and returns a short-lived share session. */
shareRouter.post("/:id/open", async (req: AuthenticatedRequest, res) => {
  try {
    const clientKey = req.ip || req.socket.remoteAddress || "unknown";
    const result = await ShareLinkService.open(
      req.params.id,
      { password: req.body?.password, email: req.body?.email },
      clientKey
    );
    res.json({ success: true, data: result });
  } catch (err) {
    fail(res, err);
  }
});

// --- Owners ---

shareRouter.use(requireAuth);

shareRouter.get("/", async (req: AuthenticatedRequest, res) => {
  try {
    const itemType = itemTypeOf(req.query.itemType);
    const itemId = String(req.query.itemId || "");
    if (!itemType || !itemId) {
      res.status(400).json({ success: false, error: "itemType dan itemId wajib diisi." });
      return;
    }
    if (!(await AccessService.canShare(req.user, itemType, itemId))) {
      res.status(403).json({ success: false, error: "Hanya pemilik yang dapat melihat tautan bagikan." });
      return;
    }
    res.json({ success: true, data: { links: await ShareLinkService.listActive(itemType, itemId) } });
  } catch (err) {
    fail(res, err);
  }
});

shareRouter.post("/", async (req: AuthenticatedRequest, res) => {
  try {
    const itemType = itemTypeOf(req.body?.itemType);
    const itemId = String(req.body?.itemId || "");
    const permission: SharePermission = req.body?.permission === "EDIT" ? "EDIT" : "VIEW";
    if (!itemType || !itemId) {
      res.status(400).json({ success: false, error: "itemType dan itemId wajib diisi." });
      return;
    }
    if (!(await AccessService.canShare(req.user, itemType, itemId))) {
      res.status(403).json({ success: false, error: "Hanya pemilik yang dapat membagikan item ini." });
      return;
    }
    const link = await ShareLinkService.create({
      itemType,
      itemId,
      permission,
      password: req.body?.password,
      allowedEmails: req.body?.allowedEmails,
      expiresInDays: req.body?.expiresInDays,
      createdById: req.user!.id,
    });
    res.status(201).json({ success: true, data: { link } });
  } catch (err) {
    fail(res, err);
  }
});

shareRouter.delete("/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const link = await ShareLinkService.get(req.params.id);
    if (!link || link.revokedAt) {
      res.status(404).json({ success: false, error: "Tautan tidak ditemukan." });
      return;
    }
    const allowed =
      link.createdById === req.user!.id || (await AccessService.canShare(req.user, link.itemType as ShareItemType, link.itemId));
    if (!allowed) {
      res.status(403).json({ success: false, error: "Hanya pemilik yang dapat mencabut tautan ini." });
      return;
    }
    await ShareLinkService.revoke(link.id);
    res.json({ success: true, data: { revoked: link.id } });
  } catch (err) {
    fail(res, err);
  }
});
