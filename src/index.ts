import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createBearerAuthMiddleware } from "./auth.js";
import { loadConfig } from "./config.js";
import { createNextDnsMcpServer } from "./server.js";

const config = loadConfig();

const handler = createMcpHandler(() => createNextDnsMcpServer(config));
const nodeHandler = toNodeHandler(handler);

const app = createMcpExpressApp({
  host: config.host,
  allowedHosts: config.allowedHosts.length > 0 ? config.allowedHosts : undefined,
});

app.get("/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "next-dns-mcp",
    authRequired: Boolean(config.mcpAuthToken),
    defaultProfileConfigured: Boolean(config.defaultProfileId),
  });
});

app.get("/", (_req, res) => {
  res.status(200).json({
    name: "next-dns-mcp",
    transport: "streamable-http",
    mcp: "/mcp",
    health: "/health",
  });
});

const auth = createBearerAuthMiddleware(config.mcpAuthToken);
app.all("/mcp", auth, (req, res) => {
  void nodeHandler(req, res, req.body);
});

const server = app.listen(config.port, config.host, () => {
  console.error(
    `next-dns-mcp listening on http://${config.host}:${config.port}/mcp` +
      (config.mcpAuthToken ? " (auth enabled)" : " (auth disabled)"),
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
