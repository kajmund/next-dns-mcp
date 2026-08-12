import type { NextFunction, Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Simple shared-secret bearer auth for personal MCP deploys.
 * When MCP_AUTH_TOKEN is unset, auth is disabled (local/dev only).
 */
export function createBearerAuthMiddleware(expectedToken?: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!expectedToken) {
      next();
      return;
    }

    const header = req.header("authorization");
    if (!header?.startsWith("Bearer ")) {
      res.status(401).json({ error: "missing_bearer_token" });
      return;
    }

    const token = header.slice("Bearer ".length).trim();
    if (!token || !safeEqual(token, expectedToken)) {
      res.status(401).json({ error: "invalid_token" });
      return;
    }

    next();
  };
}
