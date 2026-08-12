/**
 * Local smoke test against a running server.
 * Usage: MCP_URL=http://127.0.0.1:8080/mcp MCP_AUTH_TOKEN=... npm run smoke
 */

const mcpUrl = process.env.MCP_URL ?? "http://127.0.0.1:8080/mcp";
const token = process.env.MCP_AUTH_TOKEN;

const headers: Record<string, string> = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};
if (token) {
  headers.Authorization = `Bearer ${token}`;
}

const body = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/list",
};

const response = await fetch(mcpUrl, {
  method: "POST",
  headers,
  body: JSON.stringify(body),
});

const text = await response.text();
console.log(`HTTP ${response.status}`);
console.log(text);

if (!response.ok) {
  process.exit(1);
}

const toolNames =
  text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice(6))
    .flatMap((payload) => {
      try {
        const parsed = JSON.parse(payload) as {
          result?: { tools?: Array<{ name: string }> };
        };
        return parsed.result?.tools?.map((t) => t.name) ?? [];
      } catch {
        return [];
      }
    }) ?? [];

if (toolNames.length === 0) {
  // Some transports return plain JSON
  try {
    const parsed = JSON.parse(text) as {
      result?: { tools?: Array<{ name: string }> };
    };
    for (const t of parsed.result?.tools ?? []) toolNames.push(t.name);
  } catch {
    // ignore
  }
}

console.log(`tools: ${toolNames.length}`);
if (!toolNames.includes("nextdns_list_profiles")) {
  console.error("Expected nextdns_list_profiles in tools/list");
  process.exit(1);
}

console.log("smoke ok");
