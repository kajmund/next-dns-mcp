import { McpServer } from "@modelcontextprotocol/server";
import type { AppConfig } from "./config.js";
import { NextDnsClient } from "./nextdns/client.js";
import { registerNextDnsTools } from "./tools.js";

export function createNextDnsMcpServer(config: AppConfig): McpServer {
  const server = new McpServer({
    name: "next-dns-mcp",
    version: "1.0.0",
  });

  const client = new NextDnsClient(config.nextdnsApiKey);
  registerNextDnsTools(server, client, config.defaultProfileId);
  return server;
}
