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
  nextdnsApiKey: string;
  defaultProfileId?: string;
  mcpAuthToken?: string;
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

  return {
    port,
    host,
    allowedHosts,
    nextdnsApiKey: required("NEXTDNS_API_KEY"),
    defaultProfileId: optional("NEXTDNS_PROFILE_ID"),
    mcpAuthToken: optional("MCP_AUTH_TOKEN"),
  };
}
