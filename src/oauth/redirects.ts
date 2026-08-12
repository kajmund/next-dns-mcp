/**
 * Host callback patterns we accept for MCP connectors.
 * ChatGPT issues a unique redirect per connector instance:
 *   https://chatgpt.com/connector/oauth/{callback_id}
 */

const EXACT_REDIRECT_URIS = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
  "https://chatgpt.com/connector_platform_oauth_redirect",
  "https://chat.openai.com/connector_platform_oauth_redirect",
] as const;

const PREFIX_REDIRECT_URIS = [
  "https://chatgpt.com/connector/oauth/",
  "https://chat.openai.com/connector/oauth/",
] as const;

export function defaultStaticRedirectUris(): string[] {
  return [...EXACT_REDIRECT_URIS];
}

export function isTrustedConnectorRedirectUri(redirectUri: string): boolean {
  if (!redirectUri) return false;

  try {
    const url = new URL(redirectUri);
    if (url.protocol !== "https:") return false;
  } catch {
    return false;
  }

  if (EXACT_REDIRECT_URIS.includes(redirectUri as (typeof EXACT_REDIRECT_URIS)[number])) {
    return true;
  }

  return PREFIX_REDIRECT_URIS.some((prefix) => {
    if (!redirectUri.startsWith(prefix)) return false;
    const rest = redirectUri.slice(prefix.length);
    // One path segment, no extra slashes/query/fragment surprises.
    return rest.length > 0 && !rest.includes("/") && !rest.includes("?") && !rest.includes("#");
  });
}

export function parseExtraRedirectUris(raw?: string): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
}
