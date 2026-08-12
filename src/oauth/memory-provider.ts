import type { AuthInfo } from "@modelcontextprotocol/server";
import {
  InvalidGrantError,
  InvalidTokenError,
  type AuthorizationParams,
  type OAuthRegisteredClientsStore,
  type OAuthServerProvider,
} from "@modelcontextprotocol/server-legacy/auth";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
} from "@modelcontextprotocol/core/internal";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Response } from "express";

type PendingAuthorization = {
  clientId: string;
  params: AuthorizationParams;
  createdAt: number;
};

type AuthorizationCode = {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  scopes: string[];
  resource?: string;
  createdAt: number;
};

type IssuedToken = {
  clientId: string;
  scopes: string[];
  resource?: string;
  expiresAt: number;
  refreshToken?: string;
};

type RefreshRecord = {
  clientId: string;
  scopes: string[];
  resource?: string;
  expiresAt: number;
};

type PersistedStore = {
  clients: Array<[string, OAuthClientInformationFull]>;
  accessTokens: Array<[string, IssuedToken]>;
  refreshTokens: Array<[string, RefreshRecord]>;
};

const CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TOKEN_TTL_SEC = 7 * 24 * 60 * 60; // 7 days
const REFRESH_TOKEN_TTL_SEC = 90 * 24 * 60 * 60; // 90 days
const PENDING_TTL_MS = 10 * 60 * 1000;

function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export type MemoryOAuthOptions = {
  consentPassword: string;
  staticClientId: string;
  staticClientSecret: string;
  staticRedirectUris: string[];
  /** Persist clients/tokens across restarts (Fly volume path). */
  storePath?: string;
};

export class MemoryOAuthProvider implements OAuthServerProvider {
  private readonly clients = new Map<string, OAuthClientInformationFull>();
  private readonly pending = new Map<string, PendingAuthorization>();
  private readonly codes = new Map<string, AuthorizationCode>();
  private readonly accessTokens = new Map<string, IssuedToken>();
  private readonly refreshTokens = new Map<string, RefreshRecord>();
  private readonly storePath?: string;
  private persistTimer: ReturnType<typeof setTimeout> | undefined;

  readonly clientsStore: OAuthRegisteredClientsStore;

  constructor(private readonly options: MemoryOAuthOptions) {
    this.storePath = options.storePath;
    this.loadFromDisk();

    const issuedAt = Math.floor(Date.now() / 1000);
    const existing = this.clients.get(options.staticClientId);
    this.clients.set(options.staticClientId, {
      client_id: options.staticClientId,
      client_secret: options.staticClientSecret,
      client_id_issued_at: existing?.client_id_issued_at ?? issuedAt,
      client_secret_expires_at: 0,
      // Merge persisted redirect URIs (e.g. ChatGPT callbacks) with defaults.
      redirect_uris: uniqueStrings([
        ...options.staticRedirectUris,
        ...(existing?.redirect_uris ?? []),
      ]),
      token_endpoint_auth_method: "client_secret_post",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: "NextDNS MCP",
      scope: "mcp",
    });

    this.clientsStore = {
      getClient: async (clientId) => this.clients.get(clientId),
      registerClient: async (client) => {
        const clientId = randomToken(16);
        const full: OAuthClientInformationFull = {
          ...client,
          client_id: clientId,
          client_id_issued_at: Math.floor(Date.now() / 1000),
          token_endpoint_auth_method: client.token_endpoint_auth_method ?? "none",
          grant_types: client.grant_types ?? ["authorization_code", "refresh_token"],
          response_types: client.response_types ?? ["code"],
        };
        this.clients.set(clientId, full);
        this.schedulePersist();
        return full;
      },
    };
  }

  /**
   * ChatGPT generates a unique callback URL per connector. Allow it on the
   * static client (and any existing client) so authorize() accepts it.
   */
  allowRedirectUri(clientId: string, redirectUri: string): boolean {
    const client = this.clients.get(clientId);
    if (!client) return false;
    if (!client.redirect_uris.includes(redirectUri)) {
      client.redirect_uris.push(redirectUri);
      this.schedulePersist();
    }
    return true;
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    this.gc();
    const requestId = randomToken(18);
    this.pending.set(requestId, {
      clientId: client.client_id,
      params,
      createdAt: Date.now(),
    });

    const clientLabel = escapeHtml(client.client_name || client.client_id);
    res.status(200).type("html").send(`<!doctype html>
<html lang="sv">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>NextDNS MCP – Authorize</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0f1419; color: #e7ecf1; }
    form { width: min(420px, calc(100vw - 2rem)); background: #1a222c; padding: 1.5rem; border-radius: 12px; border: 1px solid #2c3845; }
    h1 { font-size: 1.15rem; margin: 0 0 .5rem; }
    p { margin: 0 0 1rem; color: #a9b4c0; line-height: 1.4; font-size: .95rem; }
    label { display: block; font-size: .85rem; margin-bottom: .35rem; color: #c5d0db; }
    input[type=password] { width: 100%; box-sizing: border-box; padding: .7rem .8rem; border-radius: 8px; border: 1px solid #3a4654; background: #10161c; color: inherit; }
    button { margin-top: 1rem; width: 100%; padding: .75rem; border: 0; border-radius: 8px; background: #3d8bfd; color: white; font-weight: 600; cursor: pointer; }
    .err { color: #ff8e8e; margin: .75rem 0 0; font-size: .9rem; }
  </style>
</head>
<body>
  <form method="POST" action="/authorize/consent">
    <h1>Godkänn NextDNS MCP</h1>
    <p><strong>${clientLabel}</strong> vill ansluta till din NextDNS MCP-server.</p>
    <label for="password">MCP auth-token (lösenord)</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required />
    <input type="hidden" name="request_id" value="${escapeHtml(requestId)}" />
    <button type="submit">Godkänn</button>
  </form>
</body>
</html>`);
  }

  completeConsent(requestId: string, password: string): { redirectTo: string } | { error: string } {
    this.gc();
    const pending = this.pending.get(requestId);
    if (!pending) {
      return { error: "Authorization request expired. Try connecting again." };
    }
    if (!safeEqual(password, this.options.consentPassword)) {
      return { error: "Invalid password." };
    }

    this.pending.delete(requestId);
    const code = randomToken(24);
    this.codes.set(code, {
      clientId: pending.clientId,
      codeChallenge: pending.params.codeChallenge,
      redirectUri: pending.params.redirectUri,
      scopes: pending.params.scopes?.length ? pending.params.scopes : ["mcp"],
      resource: pending.params.resource?.href,
      createdAt: Date.now(),
    });

    const url = new URL(pending.params.redirectUri);
    url.searchParams.set("code", code);
    if (pending.params.state) {
      url.searchParams.set("state", pending.params.state);
    }
    if (pending.params.issuer) {
      url.searchParams.set("iss", pending.params.issuer);
    }
    return { redirectTo: url.toString() };
  }

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const code = this.codes.get(authorizationCode);
    if (!code || code.clientId !== client.client_id) {
      throw new InvalidGrantError("Unknown or expired authorization code");
    }
    return code.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    this.gc();
    const code = this.codes.get(authorizationCode);
    if (!code || code.clientId !== client.client_id) {
      throw new InvalidGrantError("Unknown or expired authorization code");
    }
    if (redirectUri && redirectUri !== code.redirectUri) {
      throw new InvalidGrantError("redirect_uri mismatch");
    }
    this.codes.delete(authorizationCode);

    return this.issueTokens(
      client.client_id,
      code.scopes,
      resource?.href ?? code.resource,
    );
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    this.gc();
    const existing = this.refreshTokens.get(refreshToken);
    if (!existing || existing.clientId !== client.client_id) {
      throw new InvalidGrantError("Unknown refresh token");
    }
    if (existing.expiresAt <= Math.floor(Date.now() / 1000)) {
      this.refreshTokens.delete(refreshToken);
      this.schedulePersist();
      throw new InvalidGrantError("Refresh token expired");
    }

    // Rotate refresh token.
    this.refreshTokens.delete(refreshToken);
    for (const [access, issued] of this.accessTokens) {
      if (issued.refreshToken === refreshToken) {
        this.accessTokens.delete(access);
      }
    }

    return this.issueTokens(
      client.client_id,
      scopes?.length ? scopes : existing.scopes,
      resource?.href ?? existing.resource,
    );
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    this.gc();
    if (safeEqual(token, this.options.consentPassword)) {
      return {
        token,
        clientId: "static-bearer",
        scopes: ["mcp"],
        expiresAt: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
      };
    }

    const issued = this.accessTokens.get(token);
    if (!issued || issued.expiresAt <= Math.floor(Date.now() / 1000)) {
      throw new InvalidTokenError("Invalid or expired access token");
    }

    return {
      token,
      clientId: issued.clientId,
      scopes: issued.scopes,
      expiresAt: issued.expiresAt,
      resource: issued.resource ? new URL(issued.resource) : undefined,
    };
  }

  async revokeToken(
    _client: OAuthClientInformationFull,
    request: { token: string },
  ): Promise<void> {
    const access = this.accessTokens.get(request.token);
    if (access?.refreshToken) {
      this.refreshTokens.delete(access.refreshToken);
    }
    this.accessTokens.delete(request.token);
    this.refreshTokens.delete(request.token);
    this.schedulePersist();
  }

  flush(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
    this.persistToDisk();
  }

  private issueTokens(clientId: string, scopes: string[], resource?: string): OAuthTokens {
    const accessToken = randomToken(32);
    const refreshToken = randomToken(32);
    const now = Math.floor(Date.now() / 1000);
    this.accessTokens.set(accessToken, {
      clientId,
      scopes,
      resource,
      expiresAt: now + ACCESS_TOKEN_TTL_SEC,
      refreshToken,
    });
    this.refreshTokens.set(refreshToken, {
      clientId,
      scopes,
      resource,
      expiresAt: now + REFRESH_TOKEN_TTL_SEC,
    });
    this.schedulePersist();
    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: ACCESS_TOKEN_TTL_SEC,
      scope: scopes.join(" "),
      refresh_token: refreshToken,
    };
  }

  private gc(): void {
    const now = Date.now();
    const nowSec = Math.floor(now / 1000);
    for (const [key, value] of this.pending) {
      if (value.createdAt + PENDING_TTL_MS <= now) this.pending.delete(key);
    }
    for (const [key, value] of this.codes) {
      if (value.createdAt + CODE_TTL_MS <= now) this.codes.delete(key);
    }
    for (const [token, issued] of this.accessTokens) {
      if (issued.expiresAt <= nowSec) {
        this.accessTokens.delete(token);
      }
    }
    for (const [token, refresh] of this.refreshTokens) {
      if (refresh.expiresAt <= nowSec) {
        this.refreshTokens.delete(token);
      }
    }
  }

  private schedulePersist(): void {
    if (!this.storePath) return;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      this.persistToDisk();
    }, 50);
    this.persistTimer.unref?.();
  }

  private persistToDisk(): void {
    if (!this.storePath) return;
    try {
      this.gc();
      const payload: PersistedStore = {
        clients: [...this.clients.entries()],
        accessTokens: [...this.accessTokens.entries()],
        refreshTokens: [...this.refreshTokens.entries()],
      };
      mkdirSync(dirname(this.storePath), { recursive: true });
      const tmp = `${this.storePath}.tmp`;
      writeFileSync(tmp, JSON.stringify(payload), { mode: 0o600 });
      renameSync(tmp, this.storePath);
    } catch (error) {
      console.error("Failed to persist OAuth store:", error);
    }
  }

  private loadFromDisk(): void {
    if (!this.storePath || !existsSync(this.storePath)) return;
    try {
      const raw = readFileSync(this.storePath, "utf8");
      const parsed = JSON.parse(raw) as PersistedStore;
      for (const [id, client] of parsed.clients ?? []) {
        this.clients.set(id, client);
      }
      for (const [token, issued] of parsed.accessTokens ?? []) {
        this.accessTokens.set(token, issued);
      }
      for (const [token, refresh] of parsed.refreshTokens ?? []) {
        // Backward compat: old format mapped refresh -> access token string.
        if (typeof refresh === "string") continue;
        this.refreshTokens.set(token, refresh);
      }
      this.gc();
      console.error(
        `Loaded OAuth store: ${this.clients.size} clients, ${this.accessTokens.size} access tokens, ${this.refreshTokens.size} refresh tokens`,
      );
    } catch (error) {
      console.error("Failed to load OAuth store:", error);
    }
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
