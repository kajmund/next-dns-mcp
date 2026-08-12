# next-dns-mcp

MCP-server för [NextDNS](https://nextdns.io) med **Streamable HTTP**, redo att deployas på [Fly.io](https://fly.io).

## Funktioner

- Lista/skapa/uppdatera/ta bort profiler
- Denylist / allowlist / blocklists
- Analytics (status, domains, devices, … + time-series)
- DNS-loggar (hämtning, clear, download-URL)
- Generiska GET/PATCH för nästlade sektioner (`security`, `privacy`, `settings/…`)

## Snabbstart lokalt

```bash
cp .env.example .env
# fyll i NEXTDNS_API_KEY (från https://my.nextdns.io/account)
# valfritt: NEXTDNS_PROFILE_ID, MCP_AUTH_TOKEN

npm install
npm run dev
```

Health: `GET http://127.0.0.1:8080/health`  
MCP: `POST http://127.0.0.1:8080/mcp`

Smoke-test:

```bash
NEXTDNS_API_KEY=… MCP_AUTH_TOKEN=dev npm run dev &
MCP_URL=http://127.0.0.1:8080/mcp MCP_AUTH_TOKEN=dev npm run smoke
```

## Deploy till Fly.io

### 1. Förutsättningar

- [flyctl](https://fly.io/docs/flyctl/install/) installerat och inloggat (`fly auth login`)
- NextDNS API-nyckel

### 2. Skapa app + secrets

```bash
fly apps create next-dns-mcp   # hoppa över om appen redan finns
fly secrets set \
  NEXTDNS_API_KEY="din_nextdns_api_key" \
  MCP_AUTH_TOKEN="$(openssl rand -hex 32)" \
  NEXTDNS_PROFILE_ID="valfri_default_profil"
```

Uppdatera `ALLOWED_HOSTS` i `fly.toml` om appnamnet skiljer sig från `next-dns-mcp`.

### 3. Deploy

```bash
fly deploy
fly status
fly open /health
```

MCP-URL: `https://next-dns-mcp.fly.dev/mcp`

## Anslut från Cursor

```json
{
  "mcpServers": {
    "next-dns": {
      "url": "https://next-dns-mcp.fly.dev/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_AUTH_TOKEN>"
      }
    }
  }
}
```

Transport: **Streamable HTTP**.

## Anslut från Claude (iPhone / web / Desktop)

Claude kräver OAuth (Client ID + Secret). Konfigurera på **claude.ai** (synkas till iPhone-appen):

1. **Customize → Connectors → Add custom connector**
2. **URL:** `https://next-dns-mcp.fly.dev/mcp`
3. **OAuth Client ID:** värdet av `OAUTH_CLIENT_ID` (default `nextdns-mcp-claude`)
4. **OAuth Client Secret:** värdet av `OAUTH_CLIENT_SECRET` (Fly secret)
5. Klicka **Add** → **Connect**
6. I webbläsaren: ange `MCP_AUTH_TOKEN` som lösenord och godkänn

I iPhone-appen: **+ → Connectors** och aktivera NextDNS.

> Lämna Client ID/Secret tomma om Claude använder Dynamic Client Registration hos dig — annars fyll i de statiska värdena ovan.

## Miljövariabler

| Variabel | Obligatorisk | Beskrivning |
|---|---|---|
| `NEXTDNS_API_KEY` | ja | API-nyckel från NextDNS-kontot |
| `MCP_AUTH_TOKEN` | ja | Bearer-token + lösenord på OAuth-consent |
| `OAUTH_CLIENT_SECRET` | ja | Secret till Claude custom connector |
| `OAUTH_CLIENT_ID` | nej | Default `nextdns-mcp-claude` |
| `PUBLIC_BASE_URL` | ja i prod | t.ex. `https://next-dns-mcp.fly.dev` |
| `NEXTDNS_PROFILE_ID` | nej | Default-profil om `profileId` utelämnas |
| `PORT` | nej | Default `8080` |
| `HOST` | nej | Default `0.0.0.0` |
| `ALLOWED_HOSTS` | nej | Reserved for future host checks |

## Verktyg (urval)

| Tool | Syfte |
|---|---|
| `nextdns_list_profiles` | Lista profiler |
| `nextdns_get_profile` | Hämta profil |
| `nextdns_add_denylist_domain` | Blockera domän |
| `nextdns_add_allowlist_domain` | Tillåt domän |
| `nextdns_analytics` | Analytics / time-series |
| `nextdns_logs` | DNS-loggar |
| `nextdns_get_section` / `nextdns_patch_section` | Nästlade sektioner |

### Föräldrakontroll

| Tool | Syfte |
|---|---|
| `nextdns_get_parental_control` | Hämta hela parentalControl |
| `nextdns_list_available_services` | Katalog: appar/spel (minecraft, tiktok, …) |
| `nextdns_list_available_categories` | Katalog: kategorier (porn, gaming, …) |
| `nextdns_set_service` | Blockera/schemalägg app (`active`, `recreation`) |
| `nextdns_remove_service` | Ta bort app-regel |
| `nextdns_set_category` | Blockera/schemalägg kategori |
| `nextdns_remove_category` | Ta bort kategori-regel |
| `nextdns_set_recreation` | Sätt fritidstider + timezone |
| `nextdns_set_parental_settings` | safeSearch / youtubeRestrictedMode / blockBypass |

`recreation: true` = tillåten bara under fritidstiderna. `recreation: false` + `active: true` = alltid blockerad.

## Utveckling

```bash
npm run typecheck
npm run build
npm start
```

API-dokumentation: https://nextdns.github.io/api/
