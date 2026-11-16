import { NextFunction, Request, Response } from "express";
import { JWT_SECRET, JWT_ALGORITHM } from "@repo/backend-common/config";
import jwt from "jsonwebtoken";

type JwtPayload = { userId: string; username: string };

// Set by isLoggedIn.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      username?: string;
    }
  }
}

export function isLoggedIn(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers["authorization"];
  const raw = Array.isArray(auth) ? auth[0] : auth || "";
  const token = (raw.startsWith("Bearer ") ? raw.slice(7) : raw).trim();

  if (!token) {
    return res.status(401).json({ message: "Login again" });
  }

  try {
    // Pin the algorithm; otherwise verify trusts the token's own header.
    const decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: [JWT_ALGORITHM],
    }) as JwtPayload;
    if (typeof decoded?.userId !== "string" || decoded.userId.length === 0) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }

    // Responses are per-account: keep shared caches (CDN, proxy) from serving
    // one user's data to another. Vary covers caches that ignore no-store.
    res.set("Cache-Control", "private, no-store");
    // vary() appends; set() would drop the Accept-Encoding that compression adds
    res.vary("Authorization");

    req.userId = decoded.userId;
    req.username = decoded.username;
    return next();
  } catch (err) {
    console.error("[auth] jwt verify failed:", err);
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}
