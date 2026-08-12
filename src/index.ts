import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { mcpAuthRouter } from "@modelcontextprotocol/server-legacy/auth";
import express from "express";
import { createMcpAuthMiddleware } from "./auth.js";
import { loadConfig } from "./config.js";
import { MemoryOAuthProvider } from "./oauth/memory-provider.js";
import {
  defaultStaticRedirectUris,
  isTrustedConnectorRedirectUri,
  parseExtraRedirectUris,
} from "./oauth/redirects.js";
import { createNextDnsMcpServer } from "./server.js";

const config = loadConfig();
const issuerUrl = new URL(config.publicBaseUrl);
const mcpUrl = new URL("/mcp", config.publicBaseUrl);

const staticRedirectUris = [
  ...defaultStaticRedirectUris(),
  ...parseExtraRedirectUris(process.env.OAUTH_EXTRA_REDIRECT_URIS),
];

const oauthProvider = new MemoryOAuthProvider({
  consentPassword: config.mcpAuthToken,
  staticClientId: config.oauthClientId,
  staticClientSecret: config.oauthClientSecret,
  staticRedirectUris,
  storePath: config.oauthStorePath,
});

const handler = createMcpHandler(() => createNextDnsMcpServer(config));
const nodeHandler = toNodeHandler(handler);

const app = express();
// Fly terminates TLS; trust a single proxy hop.
app.set("trust proxy", 1);
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: "4mb" }));

// ChatGPT uses https://chatgpt.com/connector/oauth/{unique_id}. Accept those
// (and any OAUTH_EXTRA_REDIRECT_URIS) by injecting into the client allowlist
// before the OAuth router's exact-match check runs.
app.use((req, _res, next) => {
  const path = req.path.replace(/\/$/, "") || "/";
  if (path !== "/authorize") {
    next();
    return;
  }

  const clientId = String(
    (req.method === "POST" ? req.body?.client_id : req.query.client_id) ?? "",
  );
  const redirectUri = String(
    (req.method === "POST" ? req.body?.redirect_uri : req.query.redirect_uri) ?? "",
  );

  if (
    clientId &&
    redirectUri &&
    (isTrustedConnectorRedirectUri(redirectUri) ||
      staticRedirectUris.includes(redirectUri))
  ) {
    oauthProvider.allowRedirectUri(clientId, redirectUri);
  }

  next();
});

app.use(
  mcpAuthRouter({
    provider: oauthProvider,
    issuerUrl,
    baseUrl: issuerUrl,
    resourceServerUrl: mcpUrl,
    resourceName: "NextDNS MCP",
    scopesSupported: ["mcp"],
    // Avoid express-rate-limit fighting Fly's proxy headers.
    authorizationOptions: { rateLimit: false },
    tokenOptions: { rateLimit: false },
    clientRegistrationOptions: { rateLimit: false },
    revocationOptions: { rateLimit: false },
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
  // OAuth 2.1 / Claude / ChatGPT expect 302 (not 307).
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
      clientId: config.oauthClientId,
      acceptedRedirects: [
        "https://claude.ai/api/mcp/auth_callback",
        "https://chatgpt.com/connector/oauth/{callback_id}",
        "https://chatgpt.com/connector_platform_oauth_redirect",
        ...parseExtraRedirectUris(process.env.OAUTH_EXTRA_REDIRECT_URIS),
      ],
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
  oauthProvider.flush();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await handler.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
