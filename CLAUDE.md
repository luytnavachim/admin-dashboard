# Admin Dashboard — context for Claude

Standalone web-dashboard voor Micha (eenmans-IT-bedrijf Triplet IT). Vervangt het inkoop-administratie-process. Geen Cowork/Claude afhankelijkheid in productie — alles draait via Microsoft Graph (OAuth/MSAL) en een eigen Cloudflare Worker.

**Live op:** `https://luytnavachim.github.io/admin-dashboard/`
**Worker:** `https://admin-dashboard.michavantuyl.workers.dev/`
**Repo:** `github.com/luytnavachim/admin-dashboard`

## Files

| File | Doel |
|---|---|
| `index.html` | Hoofd-dashboard. Single-file. MSAL.js voor Microsoft-login, Graph API direct. Tabs: Overzicht / Facturen verwerken / Verkoop migreren / Instellingen / Geavanceerd. |
| `informer.html` | API-sandbox voor Informer (boekhoudpakket) — losse pagina om endpoints te testen. |
| `worker.js` | Cloudflare Worker — CORS-proxy naar Informer API + `/extract` endpoint dat PDF's door Claude Haiku haalt voor invoice-data. |
| `wrangler.jsonc` | Cloudflare Worker deploy config. |
| `README.md` | User-facing setup instructies (Azure app, GitHub Pages, etc.). |

## Architectuur

Browser (GitHub Pages) → MSAL OAuth → Microsoft Graph (mail/calendar/folders direct).
Browser → Cloudflare Worker → Informer API (CORS-proxy).
Browser → Cloudflare Worker → Anthropic API (`/extract` voor PDF → JSON).

## Belangrijke beslissingen

- **MSAL met Single-page-app type** in Azure. Redirect URI = `https://luytnavachim.github.io/admin-dashboard/`. Scopes: `Mail.ReadWrite Mail.ReadWrite.Shared Calendars.Read User.Read`.
- **Multi-mailbox**: shared mailboxen (info@, finance@, administratie@, inkoop@, crediteuren@). Lijst staat in `MAILBOXES` bovenaan script. `/me` voor primaire, `/users/{email}` voor shared.
- **Verwerk-flow**: factuurmail → submap per leverancier onder `MoneyMonk Verwerkt` in dezelfde mailbox. Map+submap worden auto-aangemaakt (`findFolderId` + `findOrCreateSubfolder`).
- **Informer-flow**: PDF → Worker `/extract` → Claude extract → leverancier matchen/aanmaken → POST `/invoice/purchase/` → mail naar Verwerkt-map. Beschikbaar als rij-knop `→ Informer` op Overzicht en als wizard op Facturen-tab.
- **Claude model**: `claude-haiku-4-5` (was Opus, ~15x duurder, geswitched ivm kosten). In `worker.js`.
- **Dev console**: rechts in beeld op Overzicht-tab, terminal-style log van alle Graph + Informer calls. Toggle via `console`-knop rechtsboven.
- **Throttle**: Graph heeft mailbox-concurrency-limit van ~4. `loadAll` doet per mailbox serieel, tussen mailboxen parallel. `graph()` retry'd auto bij 429/503.

## Bekende beperkingen / wensen

- **Informer banktransacties** niet via API beschikbaar — alleen "Open in Informer" knop per openstaande factuur, koppelen blijft handmatig in Informer-web.
- **Forward naar MoneyMonk-inkoopadres** niet via Graph mogelijk met bijlage. Outlook server-side rule of handmatige forward is de workaround.
- **Tab overlap**: Overzicht (snel acties per rij) en Facturen verwerken (wizard met flow-log) overlappen. Wizard mag weg als debug-tool niet nodig blijkt.
- **Lokale LLM via Mac Mini** (LM Studio/llama.cpp) — open: tunnel via cloudflared opzetten, `worker.js` switchen naar local OpenAI-compatible endpoint i.p.v. Anthropic. Setup nog niet voltooid.

## Common commands

```bash
cd ~/Documents/admin-standalone

# Lokaal testen (8000 → http://localhost:8000)
python3 -m http.server 8000

# Worker deployen
npx wrangler deploy

# Naar GitHub
git add -A && git commit -m "..." && git push
```

## Conventions

- Nederlands in UI én commit-messages.
- Geen build-stap, geen bundler — alles single-file HTML met inline JS.
- Externe libs via jsDelivr (MSAL).
- Comments in code zijn beknopt en functioneel.
- `devLog()` calls toevoegen bij nieuwe user-acties zodat ze in de console verschijnen.

## Volgende sessie

Voor je iets verandert: lees deze file + grep relevante sectie in `index.html`. Het bestand is ~2400 regels — niet in één keer lezen.
