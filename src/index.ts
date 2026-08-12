import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { mcpAuthRouter } from "@modelcontextprotocol/server-legacy/auth";
import express from "express";
import { createMcpAuthMiddleware } from "./auth.js";
import { loadConfig } from "./config.js";
import { MemoryOAuthProvider } from "./oauth/memory-provider.js";
import { createNextDnsMcpServer } from "./server.js";

const config = loadConfig();
const issuerUrl = new URL(config.publicBaseUrl);
const mcpUrl = new URL("/mcp", config.publicBaseUrl);

const oauthProvider = new MemoryOAuthProvider({
  consentPassword: config.mcpAuthToken,
  staticClientId: config.oauthClientId,
  staticClientSecret: config.oauthClientSecret,
  staticRedirectUris: [
    "https://claude.ai/api/mcp/auth_callback",
    "https://claude.com/api/mcp/auth_callback",
  ],
});

const handler = createMcpHandler(() => createNextDnsMcpServer(config));
const nodeHandler = toNodeHandler(handler);

const app = express();
app.set("trust proxy", true);
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: "4mb" }));

app.use(
  mcpAuthRouter({
    provider: oauthProvider,
    issuerUrl,
    baseUrl: issuerUrl,
    resourceServerUrl: mcpUrl,
    resourceName: "NextDNS MCP",
    scopesSupported: ["mcp"],
  }),
);

app.post("/authorize/consent", (req, res) => {
  const requestId = String(req.body?.request_id ?? "");
  const password = String(req.body?.password ?? "");
  const result = oauthProvider.completeConsent(requestId, password);
  if ("error" in result) {
    res.status(401).type("html").send(`<!doctype html>
<html lang="sv"><body style="font-family:sans-serif;padding:2rem">
  <p>${result.error}</p>
  <p><a href="javascript:history.back()">Tillbaka</a></p>
</body></html>`);
    return;
  }
  // OAuth 2.1 / Claude expect 302 (not 307).
  res.redirect(302, result.redirectTo);
});

app.get("/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "next-dns-mcp",
    authRequired: true,
    oauth: true,
    defaultProfileConfigured: Boolean(config.defaultProfileId),
  });
});

app.get("/", (_req, res) => {
  res.status(200).json({
    name: "next-dns-mcp",
    transport: "streamable-http",
    mcp: "/mcp",
    health: "/health",
    oauth: {
      authorizationServer: "/.well-known/oauth-authorization-server",
      protectedResource: "/.well-known/oauth-protected-resource",
    },
  });
});

const auth = createMcpAuthMiddleware(oauthProvider, mcpUrl);
app.all("/mcp", auth, (req, res) => {
  void nodeHandler(req, res, req.body);
});

const server = app.listen(config.port, config.host, () => {
  console.error(
    `next-dns-mcp listening on ${config.publicBaseUrl}/mcp (oauth + bearer)`,
  );
});

async function shutdown(signal: string) {
  console.error(`Received ${signal}, shutting down…`);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await handler.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
