function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export type AppConfig = {
  port: number;
  host: string;
  allowedHosts: string[];
  publicBaseUrl: string;
  nextdnsApiKey: string;
  defaultProfileId?: string;
  mcpAuthToken: string;
  oauthClientId: string;
  oauthClientSecret: string;
  oauthStorePath: string;
};

export function loadConfig(): AppConfig {
  const port = Number(process.env.PORT ?? "8080");
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error("PORT must be a positive number");
  }

  const host = process.env.HOST?.trim() || "0.0.0.0";
  const allowedHosts = (process.env.ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);

  const publicBaseUrl = (
    process.env.PUBLIC_BASE_URL?.trim() || `http://127.0.0.1:${port}`
  ).replace(/\/$/, "");

  return {
    port,
    host,
    allowedHosts,
    publicBaseUrl,
    nextdnsApiKey: required("NEXTDNS_API_KEY"),
    defaultProfileId: optional("NEXTDNS_PROFILE_ID"),
    mcpAuthToken: required("MCP_AUTH_TOKEN"),
    oauthClientId: process.env.OAUTH_CLIENT_ID?.trim() || "nextdns-mcp-claude",
    oauthClientSecret: required("OAUTH_CLIENT_SECRET"),
    oauthStorePath:
      process.env.OAUTH_STORE_PATH?.trim() ||
      (process.env.NODE_ENV === "production"
        ? "/data/oauth-store.json"
        : ".data/oauth-store.json"),
  };
}
