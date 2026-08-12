import {
  getOAuthProtectedResourceMetadataUrl,
  requireBearerAuth,
} from "@modelcontextprotocol/server-legacy/auth";
import type { MemoryOAuthProvider } from "./oauth/memory-provider.js";

export function createMcpAuthMiddleware(
  provider: MemoryOAuthProvider,
  mcpUrl: URL,
) {
  return requireBearerAuth({
    verifier: provider,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl),
  });
}
