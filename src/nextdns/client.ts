const NEXTDNS_BASE_URL = "https://api.nextdns.io";

export type NextDnsErrorBody = {
  errors?: Array<{
    code?: string;
    detail?: string;
    source?: { parameter?: string; pointer?: string };
  }>;
};

export class NextDnsApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.name = "NextDnsApiError";
    this.status = status;
    this.body = body;
  }
}

export type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
};

export class NextDnsClient {
  constructor(private readonly apiKey: string) {}

  async request<T = unknown>(options: RequestOptions): Promise<T> {
    const url = new URL(options.path.replace(/^\//, ""), `${NEXTDNS_BASE_URL}/`);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value === undefined || value === null || value === "") continue;
        url.searchParams.set(key, String(value));
      }
    }

    const headers: Record<string, string> = {
      "X-Api-Key": this.apiKey,
      Accept: "application/json",
    };

    const init: RequestInit = {
      method: options.method ?? "GET",
      headers,
    };

    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, init);
    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = text;
      }
    }

    if (!response.ok) {
      const detail = formatApiErrors(parsed) || response.statusText || "NextDNS API error";
      throw new NextDnsApiError(response.status, parsed, `NextDNS API ${response.status}: ${detail}`);
    }

    // NextDNS often returns 204 No Content for successful mutations.
    if (parsed === null || parsed === "") {
      return { ok: true, status: response.status } as T;
    }

    return parsed as T;
  }
}

function formatApiErrors(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const errors = (body as NextDnsErrorBody).errors;
  if (!Array.isArray(errors) || errors.length === 0) return undefined;
  return errors
    .map((e) => e.detail || e.code || "unknown error")
    .filter(Boolean)
    .join("; ");
}
