import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db } from "../db/index.ts";
import { Role, UserRecord } from "../types/index.ts";
import type { ShareGrant } from "../services/access.service.ts";

const JWT_SECRET = process.env.SESSION_SECRET || "default-insecure-dev-session-secret-change-in-production";
const REFRESH_JWT_SECRET = process.env.REFRESH_SESSION_SECRET || "default-insecure-refresh-secret-change-in-production";

export interface AuthenticatedRequest extends Request {
  user?: UserRecord;
  /** Set when the request carries a valid share session (from a share link). */
  share?: ShareGrant;
}

export function generateToken(user: UserRecord): string {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    },
    JWT_SECRET,
    { expiresIn: "15m" }
  );
}

export function generateRefreshToken(user: { id: string }): string {
  return jwt.sign(
    {
      id: user.id,
    },
    REFRESH_JWT_SECRET,
    { expiresIn: "7d" }
  );
}

export function verifyToken(token: string): { id: string; email: string; role: Role; name: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { id: string; email: string; role: Role; name: string };
  } catch {
    return null;
  }
}

export function verifyRefreshToken(token: string): { id: string } | null {
  try {
    return jwt.verify(token, REFRESH_JWT_SECRET) as { id: string };
  } catch {
    return null;
  }
}

export async function authenticate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // A share session can accompany a login (a signed-in user opening a link).
    const shareToken =
      (req.headers["x-share-session"] as string | undefined) ||
      (typeof req.query.share_session === "string" ? req.query.share_session : undefined);
    if (shareToken) {
      const { ShareLinkService } = await import("../services/share-link.service.ts");
      const grant = await ShareLinkService.verifySession(shareToken);
      if (grant) req.share = grant;
    }

    let token: string | undefined = req.cookies?.token;

    if (!token && req.headers.authorization) {
      const authHeader = req.headers.authorization;
      if (authHeader.startsWith("Bearer ")) {
        token = authHeader.substring(7);
      }
    }

    if (!token && req.query.token) {
      token = String(req.query.token);
    }

    if (token) {
      const payload = verifyToken(token);
      if (payload) {
        const user = await db.user.findUnique({ where: { id: payload.id } });
        if (user && user.isActive) {
          req.user = user;
          return next();
        }
      }
    }

    // Access token is missing, expired, or invalid. Check refresh token.
    const refreshToken = req.cookies?.refreshToken;
    if (refreshToken) {
      const refreshPayload = verifyRefreshToken(refreshToken);
      if (refreshPayload) {
        const user = await db.user.findUnique({ where: { id: refreshPayload.id } });
        if (user && user.isActive) {
          // Transparently generate a new short-lived access token
          const newToken = generateToken(user);
          
          res.cookie("token", newToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: 15 * 60 * 1000, // 15 minutes
          });

          req.user = user;
          return next();
        }
      }
    }

    next();
  } catch (error) {
    next(error);
  }
}

export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: "Authentication required. Please log in.",
    });
    return;
  }
  next();
}

export function requireAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: "Authentication required. Please log in.",
    });
    return;
  }

  if (req.user.role !== Role.ADMIN) {
    res.status(403).json({
      success: false,
      error: "Access forbidden. Administrator privileges required.",
    });
    return;
  }

  next();
}
