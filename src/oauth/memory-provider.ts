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

const CODE_TTL_MS = 5 * 60 * 1000;
const TOKEN_TTL_SEC = 60 * 60;
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
};

export class MemoryOAuthProvider implements OAuthServerProvider {
  private readonly clients = new Map<string, OAuthClientInformationFull>();
  private readonly pending = new Map<string, PendingAuthorization>();
  private readonly codes = new Map<string, AuthorizationCode>();
  private readonly accessTokens = new Map<string, IssuedToken>();
  private readonly refreshTokens = new Map<string, string>();

  readonly clientsStore: OAuthRegisteredClientsStore;

  constructor(private readonly options: MemoryOAuthOptions) {
    const issuedAt = Math.floor(Date.now() / 1000);
    this.clients.set(options.staticClientId, {
      client_id: options.staticClientId,
      client_secret: options.staticClientSecret,
      client_id_issued_at: issuedAt,
      client_secret_expires_at: 0,
      redirect_uris: options.staticRedirectUris,
      token_endpoint_auth_method: "client_secret_post",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: "Claude NextDNS MCP",
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
        return full;
      },
    };
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
    const accessToken = this.refreshTokens.get(refreshToken);
    if (!accessToken) {
      throw new InvalidGrantError("Unknown refresh token");
    }
    const existing = this.accessTokens.get(accessToken);
    if (!existing || existing.clientId !== client.client_id) {
      throw new InvalidGrantError("Refresh token client mismatch");
    }

    this.accessTokens.delete(accessToken);
    this.refreshTokens.delete(refreshToken);

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

    const mappedAccess = this.refreshTokens.get(request.token);
    if (mappedAccess) {
      this.accessTokens.delete(mappedAccess);
      this.refreshTokens.delete(request.token);
    }
  }

  private issueTokens(clientId: string, scopes: string[], resource?: string): OAuthTokens {
    const accessToken = randomToken(32);
    const refreshToken = randomToken(32);
    const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC;
    this.accessTokens.set(accessToken, {
      clientId,
      scopes,
      resource,
      expiresAt,
      refreshToken,
    });
    this.refreshTokens.set(refreshToken, accessToken);
    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: TOKEN_TTL_SEC,
      scope: scopes.join(" "),
      refresh_token: refreshToken,
    };
  }

  private gc(): void {
    const now = Date.now();
    for (const [key, value] of this.pending) {
      if (value.createdAt + PENDING_TTL_MS <= now) this.pending.delete(key);
    }
    for (const [key, value] of this.codes) {
      if (value.createdAt + CODE_TTL_MS <= now) this.codes.delete(key);
    }
    for (const [token, issued] of this.accessTokens) {
      if (issued.expiresAt * 1000 <= now) {
        if (issued.refreshToken) this.refreshTokens.delete(issued.refreshToken);
        this.accessTokens.delete(token);
      }
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
