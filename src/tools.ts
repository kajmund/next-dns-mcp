import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { NextDnsApiError, NextDnsClient } from "./nextdns/client.js";

const profileIdSchema = z
  .string()
  .min(1)
  .describe("NextDNS profile id (e.g. abc123). Defaults to NEXTDNS_PROFILE_ID when set.");

const dateSchema = z
  .string()
  .optional()
  .describe("Date filter: ISO8601, unix ts, or relative like -24h / -7d / now");

const analyticsTypeSchema = z.enum([
  "status",
  "domains",
  "reasons",
  "ips",
  "devices",
  "protocols",
  "queryTypes",
  "ipVersions",
  "dnssec",
  "encryption",
  "destinations",
]);

function textResult(data: unknown, isError = false) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
    isError,
  };
}

function resolveProfileId(profileId: string | undefined, defaultProfileId?: string): string {
  const resolved = profileId?.trim() || defaultProfileId?.trim();
  if (!resolved) {
    throw new Error("profileId is required (or set NEXTDNS_PROFILE_ID)");
  }
  return resolved;
}

async function runTool(fn: () => Promise<unknown>) {
  try {
    const data = await fn();
    return textResult(data);
  } catch (error) {
    if (error instanceof NextDnsApiError) {
      return textResult(
        {
          error: error.message,
          status: error.status,
          body: error.body,
        },
        true,
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    return textResult({ error: message }, true);
  }
}

export function registerNextDnsTools(
  server: McpServer,
  client: NextDnsClient,
  defaultProfileId?: string,
): void {
  server.registerTool(
    "nextdns_list_profiles",
    {
      description: "List all NextDNS profiles for the authenticated account.",
      inputSchema: z.object({}),
    },
    async () => runTool(() => client.request({ path: "/profiles" })),
  );

  server.registerTool(
    "nextdns_get_profile",
    {
      description: "Get a full NextDNS profile configuration.",
      inputSchema: z.object({
        profileId: profileIdSchema.optional(),
      }),
    },
    async ({ profileId }) =>
      runTool(() => {
        const id = resolveProfileId(profileId, defaultProfileId);
        return client.request({ path: `/profiles/${id}` });
      }),
  );

  server.registerTool(
    "nextdns_create_profile",
    {
      description: "Create a new NextDNS profile. Pass a partial or full profile JSON body.",
      inputSchema: z.object({
        name: z.string().min(1).describe("Profile name"),
        config: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Optional additional profile fields (security, privacy, settings, etc.)"),
      }),
    },
    async ({ name, config }) =>
      runTool(() =>
        client.request({
          method: "POST",
          path: "/profiles",
          body: { name, ...(config ?? {}) },
        }),
      ),
  );

  server.registerTool(
    "nextdns_update_profile",
    {
      description: "Patch a NextDNS profile (top-level fields such as name or nested objects).",
      inputSchema: z.object({
        profileId: profileIdSchema.optional(),
        patch: z.record(z.string(), z.unknown()).describe("JSON object to PATCH onto the profile"),
      }),
    },
    async ({ profileId, patch }) =>
      runTool(() => {
        const id = resolveProfileId(profileId, defaultProfileId);
        return client.request({ method: "PATCH", path: `/profiles/${id}`, body: patch });
      }),
  );

  server.registerTool(
    "nextdns_delete_profile",
    {
      description: "Delete a NextDNS profile. Irreversible.",
      inputSchema: z.object({
        profileId: profileIdSchema,
        confirm: z
          .literal(true)
          .describe("Must be true to confirm deletion"),
      }),
    },
    async ({ profileId, confirm }) =>
      runTool(async () => {
        if (confirm !== true) {
          throw new Error("confirm must be true");
        }
        return client.request({ method: "DELETE", path: `/profiles/${profileId}` });
      }),
  );

  server.registerTool(
    "nextdns_get_section",
    {
      description:
        "GET a nested profile section, e.g. security, privacy, parentalControl, denylist, allowlist, settings, settings/performance, privacy/blocklists.",
      inputSchema: z.object({
        profileId: profileIdSchema.optional(),
        section: z
          .string()
          .min(1)
          .describe("Path under /profiles/:id/, e.g. 'security' or 'settings/logs'"),
      }),
    },
    async ({ profileId, section }) =>
      runTool(() => {
        const id = resolveProfileId(profileId, defaultProfileId);
        const clean = section.replace(/^\/+/, "");
        return client.request({ path: `/profiles/${id}/${clean}` });
      }),
  );

  server.registerTool(
    "nextdns_patch_section",
    {
      description:
        "PATCH a nested profile object section, e.g. security, privacy, parentalControl, settings/performance.",
      inputSchema: z.object({
        profileId: profileIdSchema.optional(),
        section: z.string().min(1).describe("Path under /profiles/:id/"),
        patch: z.record(z.string(), z.unknown()),
      }),
    },
    async ({ profileId, section, patch }) =>
      runTool(() => {
        const id = resolveProfileId(profileId, defaultProfileId);
        const clean = section.replace(/^\/+/, "");
        return client.request({
          method: "PATCH",
          path: `/profiles/${id}/${clean}`,
          body: patch,
        });
      }),
  );

  server.registerTool(
    "nextdns_list_denylist",
    {
      description: "List denylist domains for a profile.",
      inputSchema: z.object({
        profileId: profileIdSchema.optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      }),
    },
    async ({ profileId, cursor, limit }) =>
      runTool(() => {
        const id = resolveProfileId(profileId, defaultProfileId);
        return client.request({
          path: `/profiles/${id}/denylist`,
          query: { cursor, limit },
        });
      }),
  );

  server.registerTool(
    "nextdns_add_denylist_domain",
    {
      description: "Add a domain to the denylist.",
      inputSchema: z.object({
        profileId: profileIdSchema.optional(),
        domain: z.string().min(1).describe("Domain to block, e.g. ads.example.com"),
        active: z.boolean().optional().describe("Whether the entry is active (default true)"),
      }),
    },
    async ({ profileId, domain, active }) =>
      runTool(() => {
        const id = resolveProfileId(profileId, defaultProfileId);
        return client.request({
          method: "POST",
          path: `/profiles/${id}/denylist`,
          body: { id: domain, active: active ?? true },
        });
      }),
  );

  server.registerTool(
    "nextdns_update_denylist_domain",
    {
      description: "Update a denylist domain (typically toggle active).",
      inputSchema: z.object({
        profileId: profileIdSchema.optional(),
        domain: z.string().min(1),
        active: z.boolean(),
      }),
    },
    async ({ profileId, domain, active }) =>
      runTool(() => {
        const id = resolveProfileId(profileId, defaultProfileId);
        return client.request({
          method: "PATCH",
          path: `/profiles/${id}/denylist/${encodeURIComponent(domain)}`,
          body: { active },
        });
      }),
  );

  server.registerTool(
    "nextdns_remove_denylist_domain",
    {
      description: "Remove a domain from the denylist.",
      inputSchema: z.object({
        profileId: profileIdSchema.optional(),
        domain: z.string().min(1),
      }),
    },
    async ({ profileId, domain }) =>
      runTool(() => {
        const id = resolveProfileId(profileId, defaultProfileId);
        return client.request({
          method: "DELETE",
          path: `/profiles/${id}/denylist/${encodeURIComponent(domain)}`,
        });
      }),
  );

  server.registerTool(
    "nextdns_list_allowlist",
    {
      description: "List allowlist domains for a profile.",
      inputSchema: z.object({
        profileId: profileIdSchema.optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      }),
    },
    async ({ profileId, cursor, limit }) =>
      runTool(() => {
        const id = resolveProfileId(profileId, defaultProfileId);
        return client.request({
          path: `/profiles/${id}/allowlist`,
          query: { cursor, limit },
        });
      }),
  );

  server.registerTool(
    "nextdns_add_allowlist_domain",
    {
      description: "Add a domain to the allowlist.",
      inputSchema: z.object({
        profileId: profileIdSchema.optional(),
        domain: z.string().min(1),
        active: z.boolean().optional(),
      }),
    },
    async ({ profileId, domain, active }) =>
      runTool(() => {
        const id = resolveProfileId(profileId, defaultProfileId);
        return client.request({
          method: "POST",
          path: `/profiles/${id}/allowlist`,
          body: { id: domain, active: active ?? true },
        });
      }),
  );

  server.registerTool(
    "nextdns_update_allowlist_domain",
    {
      description: "Update an allowlist domain (typically toggle active).",
      inputSchema: z.object({
        profileId: profileIdSchema.optional(),
        domain: z.string().min(1),
        active: z.boolean(),
      }),
    },
    async ({ profileId, domain, active }) =>
      runTool(() => {
        const id = resolveProfileId(profileId, defaultProfileId);
        return client.request({
          method: "PATCH",
          path: `/profiles/${id}/allowlist/${encodeURIComponent(domain)}`,
          body: { active },
        });
      }),
  );

  server.registerTool(
    "nextdns_remove_allowlist_domain",
    {
      description: "Remove a domain from the allowlist.",
      inputSchema: z.object({
        profileId: profileIdSchema.optional(),
        domain: z.string().min(1),
      }),
    },
    async ({ profileId, domain }) =>
      runTool(() => {
        const id = resolveProfileId(profileId, defaultProfileId);
        return client.request({
          method: "DELETE",
          path: `/profiles/${id}/allowlist/${encodeURIComponent(domain)}`,
        });
      }),
  );

  server.registerTool(
    "nextdns_list_blocklists",
    {
      description: "List privacy blocklists configured on a profile.",
      inputSchema: z.object({
        profileId: profileIdSchema.optional(),
      }),
    },
    async ({ profileId }) =>
      runTool(() => {
        const id = resolveProfileId(profileId, defaultProfileId);
        return client.request({ path: `/profiles/${id}/privacy/blocklists` });
      }),
  );

  server.registerTool(
    "nextdns_add_blocklist",
    {
      description: "Add a privacy blocklist by id (e.g. nextdns-recommended, oisd).",
      inputSchema: z.object({
        profileId: profileIdSchema.optional(),
        blocklistId: z.string().min(1),
      }),
    },
    async ({ profileId, blocklistId }) =>
      runTool(() => {
        const id = resolveProfileId(profileId, defaultProfileId);
        return client.request({
          method: "POST",
          path: `/profiles/${id}/privacy/blocklists`,
          body: { id: blocklistId },
        });
      }),
  );

  server.registerTool(
    "nextdns_remove_blocklist",
    {
      description: "Remove a privacy blocklist by id.",
      inputSchema: z.object({
        profileId: profileIdSchema.optional(),
        blocklistId: z.string().min(1),
      }),
    },
    async ({ profileId, blocklistId }) =>
      runTool(() => {
        const id = resolveProfileId(profileId, defaultProfileId);
        return client.request({
          method: "DELETE",
          path: `/profiles/${id}/privacy/blocklists/${encodeURIComponent(blocklistId)}`,
        });
      }),
  );

  server.registerTool(
    "nextdns_analytics",
    {
      description:
        "Fetch analytics for a profile. Use series=true for time-series (;series) endpoints.",
      inputSchema: z.object({
        profileId: profileIdSchema.optional(),
        type: analyticsTypeSchema,
        from: dateSchema,
        to: dateSchema,
        limit: z.number().int().min(1).max(500).optional(),
        cursor: z.string().optional(),
        device: z.string().optional(),
        status: z.enum(["default", "blocked", "allowed"]).optional(),
        root: z.boolean().optional().describe("For domains analytics: aggregate by root domain"),
        destinationType: z
          .enum(["countries", "gafam"])
          .optional()
          .describe("Required for destinations analytics"),
        series: z.boolean().optional().describe("Return time-series data"),
        interval: z.string().optional().describe("Series interval, e.g. 1h or 1d"),
        timezone: z.string().optional(),
      }),
    },
    async (args) =>
      runTool(() => {
        const id = resolveProfileId(args.profileId, defaultProfileId);
        if (args.type === "destinations" && !args.destinationType) {
          throw new Error("destinationType is required when type=destinations");
        }
        const suffix = args.series ? ";series" : "";
        return client.request({
          path: `/profiles/${id}/analytics/${args.type}${suffix}`,
          query: {
            from: args.from,
            to: args.to,
            limit: args.limit,
            cursor: args.cursor,
            device: args.device,
            status: args.status,
            root: args.root,
            type: args.destinationType,
            interval: args.interval,
            timezone: args.timezone,
          },
        });
      }),
  );

  server.registerTool(
    "nextdns_logs",
    {
      description: "Fetch DNS query logs for a profile.",
      inputSchema: z.object({
        profileId: profileIdSchema.optional(),
        from: dateSchema,
        to: dateSchema,
        limit: z.number().int().min(10).max(1000).optional(),
        cursor: z.string().optional(),
        device: z.string().optional(),
        status: z.enum(["default", "error", "blocked", "allowed"]).optional(),
        search: z.string().optional(),
        sort: z.enum(["asc", "desc"]).optional(),
        raw: z.boolean().optional(),
      }),
    },
    async (args) =>
      runTool(() => {
        const id = resolveProfileId(args.profileId, defaultProfileId);
        return client.request({
          path: `/profiles/${id}/logs`,
          query: {
            from: args.from,
            to: args.to,
            limit: args.limit,
            cursor: args.cursor,
            device: args.device,
            status: args.status,
            search: args.search,
            sort: args.sort,
            raw: args.raw,
          },
        });
      }),
  );

  server.registerTool(
    "nextdns_clear_logs",
    {
      description: "Clear all stored logs for a profile.",
      inputSchema: z.object({
        profileId: profileIdSchema.optional(),
        confirm: z.literal(true).describe("Must be true to confirm"),
      }),
    },
    async ({ profileId, confirm }) =>
      runTool(async () => {
        if (confirm !== true) {
          throw new Error("confirm must be true");
        }
        const id = resolveProfileId(profileId, defaultProfileId);
        return client.request({ method: "DELETE", path: `/profiles/${id}/logs` });
      }),
  );

  server.registerTool(
    "nextdns_download_logs",
    {
      description: "Get a download URL for profile logs (does not follow redirect).",
      inputSchema: z.object({
        profileId: profileIdSchema.optional(),
      }),
    },
    async ({ profileId }) =>
      runTool(() => {
        const id = resolveProfileId(profileId, defaultProfileId);
        return client.request({
          path: `/profiles/${id}/logs/download`,
          query: { redirect: 0 },
        });
      }),
  );
}
