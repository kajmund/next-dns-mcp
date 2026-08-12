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

  registerParentalControlTools(server, client, defaultProfileId);
}

const timeOfDaySchema = z
  .string()
  .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Use "HH:MM" or "HH:MM:SS"')
  .describe('Start/end time as "HH:MM" or "HH:MM:SS"');

const dayWindowSchema = z
  .object({
    start: timeOfDaySchema,
    end: timeOfDaySchema,
  })
  .nullable()
  .describe("Recreation window for the day, or null to clear that day");

const recreationTimesSchema = z.object({
  monday: dayWindowSchema.optional(),
  tuesday: dayWindowSchema.optional(),
  wednesday: dayWindowSchema.optional(),
  thursday: dayWindowSchema.optional(),
  friday: dayWindowSchema.optional(),
  saturday: dayWindowSchema.optional(),
  sunday: dayWindowSchema.optional(),
});

type ServiceEntry = {
  id: string;
  active?: boolean;
  recreation?: boolean;
  website?: string;
};

type CategoryEntry = {
  id: string;
  active?: boolean;
  recreation?: boolean;
};

function normalizeTime(value: string): string {
  return value.length === 5 ? `${value}:00` : value;
}

async function listProfileServices(
  client: NextDnsClient,
  profileId: string,
): Promise<ServiceEntry[]> {
  const response = await client.request<{ data: ServiceEntry[] }>({
    path: `/profiles/${profileId}/parentalControl/services`,
  });
  return response.data ?? [];
}

async function listProfileCategories(
  client: NextDnsClient,
  profileId: string,
): Promise<CategoryEntry[]> {
  const response = await client.request<{ data: CategoryEntry[] }>({
    path: `/profiles/${profileId}/parentalControl/categories`,
  });
  return response.data ?? [];
}

async function upsertListEntry(
  client: NextDnsClient,
  profileId: string,
  kind: "services" | "categories",
  id: string,
  active: boolean,
  recreation: boolean,
  existingIds: Set<string>,
): Promise<unknown> {
  const path = `/profiles/${profileId}/parentalControl/${kind}/${encodeURIComponent(id)}`;
  const collection = `/profiles/${profileId}/parentalControl/${kind}`;
  if (existingIds.has(id)) {
    return client.request({
      method: "PATCH",
      path,
      body: { active, recreation },
    });
  }
  return client.request({
    method: "POST",
    path: collection,
    body: { id, active, recreation },
  });
}

function registerParentalControlTools(
  server: McpServer,
  client: NextDnsClient,
  defaultProfileId?: string,
): void {
  server.registerTool(
    "nextdns_get_parental_control",
    {
      description:
        "Get parental control settings: services (apps/games), categories, recreation schedule, safeSearch, etc.",
      inputSchema: z.object({
        profileId: profileIdSchema.optional(),
      }),
    },
    async ({ profileId }) =>
      runTool(() => {
        const id = resolveProfileId(profileId, defaultProfileId);
        return client.request({ path: `/profiles/${id}/parentalControl` });
      }),
  );

  server.registerTool(
    "nextdns_list_available_services",
    {
      description:
        "List the global NextDNS catalog of blockable apps/games/services (ids like minecraft, tiktok, steam).",
      inputSchema: z.object({}),
    },
    async () => runTool(() => client.request({ path: "/parentalControl/services" })),
  );

  server.registerTool(
    "nextdns_list_available_categories",
    {
      description:
        "List the global NextDNS catalog of parental-control categories (porn, gambling, gaming, social-networks, …).",
      inputSchema: z.object({}),
    },
    async () => runTool(() => client.request({ path: "/parentalControl/categories" })),
  );

  server.registerTool(
    "nextdns_set_service",
    {
      description:
        "Block or schedule an app/game/service. active=true blocks it; recreation=true allows it only during recreation times. Creates the entry if missing.",
      inputSchema: z.object({
        profileId: profileIdSchema.optional(),
        serviceId: z
          .string()
          .min(1)
          .describe("Service id from nextdns_list_available_services, e.g. minecraft, tiktok, steam"),
        active: z.boolean().describe("Whether the service is blocked"),
        recreation: z
          .boolean()
          .optional()
          .describe("If true, blocked outside recreation hours only (default false)"),
      }),
    },
    async ({ profileId, serviceId, active, recreation }) =>
      runTool(async () => {
        const id = resolveProfileId(profileId, defaultProfileId);
        const existing = await listProfileServices(client, id);
        const result = await upsertListEntry(
          client,
          id,
          "services",
          serviceId,
          active,
          recreation ?? false,
          new Set(existing.map((s) => s.id)),
        );
        return { serviceId, active, recreation: recreation ?? false, result };
      }),
  );

  server.registerTool(
    "nextdns_remove_service",
    {
      description: "Remove a parental-control service entry from the profile.",
      inputSchema: z.object({
        profileId: profileIdSchema.optional(),
        serviceId: z.string().min(1),
      }),
    },
    async ({ profileId, serviceId }) =>
      runTool(() => {
        const id = resolveProfileId(profileId, defaultProfileId);
        return client.request({
          method: "DELETE",
          path: `/profiles/${id}/parentalControl/services/${encodeURIComponent(serviceId)}`,
        });
      }),
  );

  server.registerTool(
    "nextdns_set_category",
    {
      description:
        "Block or schedule a content category. active=true blocks it; recreation=true allows it only during recreation times.",
      inputSchema: z.object({
        profileId: profileIdSchema.optional(),
        categoryId: z
          .string()
          .min(1)
          .describe(
            "Category id from nextdns_list_available_categories, e.g. porn, gambling, gaming, social-networks, video-streaming",
          ),
        active: z.boolean(),
        recreation: z.boolean().optional(),
      }),
    },
    async ({ profileId, categoryId, active, recreation }) =>
      runTool(async () => {
        const id = resolveProfileId(profileId, defaultProfileId);
        const existing = await listProfileCategories(client, id);
        const result = await upsertListEntry(
          client,
          id,
          "categories",
          categoryId,
          active,
          recreation ?? false,
          new Set(existing.map((c) => c.id)),
        );
        return { categoryId, active, recreation: recreation ?? false, result };
      }),
  );

  server.registerTool(
    "nextdns_remove_category",
    {
      description: "Remove a parental-control category entry from the profile.",
      inputSchema: z.object({
        profileId: profileIdSchema.optional(),
        categoryId: z.string().min(1),
      }),
    },
    async ({ profileId, categoryId }) =>
      runTool(() => {
        const id = resolveProfileId(profileId, defaultProfileId);
        return client.request({
          method: "DELETE",
          path: `/profiles/${id}/parentalControl/categories/${encodeURIComponent(categoryId)}`,
        });
      }),
  );

  server.registerTool(
    "nextdns_set_recreation",
    {
      description:
        "Set recreation (fritid) schedule. Services/categories with recreation=true are allowed only inside these windows.",
      inputSchema: z.object({
        profileId: profileIdSchema.optional(),
        timezone: z
          .string()
          .min(1)
          .describe('IANA timezone, e.g. "Europe/Stockholm"'),
        times: recreationTimesSchema.describe(
          "Per-weekday windows. Omit days you do not want to change; set a day to null to clear it.",
        ),
      }),
    },
    async ({ profileId, timezone, times }) =>
      runTool(async () => {
        const id = resolveProfileId(profileId, defaultProfileId);
        const current = await client.request<{
          data: {
            recreation?: {
              timezone?: string;
              times?: Record<string, { start?: string; end?: string } | null>;
            };
          };
        }>({ path: `/profiles/${id}/parentalControl` });

        const mergedTimes: Record<string, { start: string; end: string } | null> = {};
        for (const [day, window] of Object.entries(current.data?.recreation?.times ?? {})) {
          if (window?.start && window?.end) {
            mergedTimes[day] = {
              start: normalizeTime(window.start),
              end: normalizeTime(window.end),
            };
          }
        }

        for (const [day, window] of Object.entries(times)) {
          if (window === undefined) continue;
          if (window === null) {
            mergedTimes[day] = null;
            continue;
          }
          mergedTimes[day] = {
            start: normalizeTime(window.start),
            end: normalizeTime(window.end),
          };
        }

        // Drop nulls from payload — NextDNS expects absent days, not null objects.
        const cleanedTimes: Record<string, { start: string; end: string }> = {};
        for (const [day, window] of Object.entries(mergedTimes)) {
          if (window) {
            cleanedTimes[day] = window;
          }
        }

        await client.request({
          method: "PATCH",
          path: `/profiles/${id}/parentalControl`,
          body: {
            recreation: {
              timezone,
              times: cleanedTimes,
            },
          },
        });

        return {
          timezone,
          times: cleanedTimes,
        };
      }),
  );

  server.registerTool(
    "nextdns_set_parental_settings",
    {
      description:
        "Update parental-control toggles: safeSearch, youtubeRestrictedMode, blockBypass.",
      inputSchema: z.object({
        profileId: profileIdSchema.optional(),
        safeSearch: z.boolean().optional(),
        youtubeRestrictedMode: z.boolean().optional(),
        blockBypass: z.boolean().optional(),
      }),
    },
    async ({ profileId, safeSearch, youtubeRestrictedMode, blockBypass }) =>
      runTool(async () => {
        const id = resolveProfileId(profileId, defaultProfileId);
        const patch: Record<string, boolean> = {};
        if (safeSearch !== undefined) patch.safeSearch = safeSearch;
        if (youtubeRestrictedMode !== undefined) {
          patch.youtubeRestrictedMode = youtubeRestrictedMode;
        }
        if (blockBypass !== undefined) patch.blockBypass = blockBypass;
        if (Object.keys(patch).length === 0) {
          throw new Error("Provide at least one of safeSearch, youtubeRestrictedMode, blockBypass");
        }
        await client.request({
          method: "PATCH",
          path: `/profiles/${id}/parentalControl`,
          body: patch,
        });
        return { ok: true, ...patch };
      }),
  );
}
