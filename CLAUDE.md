# Admin Dashboard — context for Claude

Standalone web-dashboard voor Micha (eenmans-IT-bedrijf Triplet IT). Vervangt het inkoop-/verkoop-administratie-process. In productie geen Cowork-afhankelijkheid: de frontend praat rechtstreeks met Microsoft Graph (OAuth/MSAL) en met Informer via een eigen Cloudflare Worker. Claude Haiku wordt server-side (in de Worker) gebruikt voor PDF-extractie.

**Live op:** `https://admin.triplet-it.nl/` — frontend draait op **Apache, eigen Hetzner-server** (`95.217.203.120`, webroot `/var/www/admin-dashboard`). GEEN GitHub Pages.
**Worker (API-backend):** `https://admin-dashboard.michavantuyl.workers.dev/`
**Repo:** `github.com/luytnavachim/admin-dashboard` (lokaal: `~/Documents/admin-standalone`)

## Files

| File | Doel |
|---|---|
| `index.html` | Hoofd-dashboard. Single-file (~2600 regels). MSAL.js voor Microsoft-login, Graph API direct. Tabs: Overzicht / Facturen verwerken / Verkoop migreren / Projecten / Instellingen / Geavanceerd. |
| `informer.html` | API-sandbox voor Informer — losse pagina om endpoints te testen. |
| `worker.js` | Cloudflare Worker — CORS-proxy naar Informer API (`/api/*`) + `/extract` & `/extract-sales` (PDF → Claude Haiku → JSON). |
| `worker.test.mjs` | Tests voor de Worker. |
| `wrangler.jsonc` | Cloudflare Worker deploy config (Worker draait ook als static-asset host, maar die kant wordt NIET gebruikt — de live site komt van Hetzner). |
| `README.md` | User-facing setup + deploy instructies. |

## Architectuur

Browser (Apache @ Hetzner) → MSAL OAuth → Microsoft Graph (mail/calendar/folders direct).
Browser → Cloudflare Worker `/api/*` → Informer API (CORS-proxy, key server-side).
Browser → Cloudflare Worker `/extract` `/extract-sales` → Anthropic API (PDF → JSON).
Browser → `localStorage` (Informer-config `informer_cfg_v1` + projecten/uren `projects_v1`).

## Belangrijke beslissingen

- **Hosting gesplitst**: frontend (statische HTML/JS) op Hetzner via Apache; Worker is puur de API-backend. Informer-key en Anthropic-key staan alleen in de Worker (Secrets), nooit in de frontend.
- **MSAL met Single-page-app type** in Azure. Redirect URI = `https://admin.triplet-it.nl/`. Scopes: `Mail.ReadWrite Mail.ReadWrite.Shared Calendars.Read User.Read`. `CLIENT_ID` staat bovenaan het script.
- **Multi-mailbox**: `MAILBOXES` bovenaan script = micha@, info@, administratie@, inkoop@, finance@ (triplet-it.nl). Eerste = primair (agenda). `/me` voor primaire, `/users/{email}` voor shared.
- **Verwerk-flow (inkoop)**: factuurmail → submap per leverancier onder `MoneyMonk Verwerkt` in dezelfde mailbox. Map+submap auto-aangemaakt (`findFolderId` + `findOrCreateSubfolder`).
- **Informer inkoop-flow**: PDF → Worker `/extract` → Claude extract → leverancier matchen/aanmaken → POST `/invoice/purchase/` (met PDF) → mail naar Verwerkt-map. Als rij-knop `→ Informer` op Overzicht en als wizard op Facturen-tab.
- **Verkoop migreren**: bulk MoneyMonk-PDF's → `/extract-sales` → klant matchen/aanmaken → POST `/invoice/sales/`.
- **Projecten (uren → factuur)**: lokaal (localStorage `projects_v1`) omdat Informer-projecten API-afgeschermd zijn. Per project: naam + Informer-klant (relation_id) + vast uurtarief. Uren boeken → knop `Factureren` bouwt **één samenvattende regel** (totaal open uren × tarief), POST `/invoice/sales/` + POST `/invoice/sales/send/` (definitief/versturen). Gefactureerde boekingen worden gemarkeerd (`invoiced`), blijven als historie staan. Pure rekenkern = `computeProjectInvoice()` (unit-getest). Sales-btw 21% = `vat_id 1478830`.
- **Sales-config in Instellingen-tab**: base URL (`<worker>/api`), ledger-/product-/template-/payment-/currency-ID, btw-optie. Defaults in `defaultConfig()`.
- **Claude model**: `claude-haiku-4-5` (was Opus, ~15x duurder). In `worker.js`.
- **Dev console**: rechts op Overzicht-tab, log van alle Graph + Informer calls. Toggle via `console`-knop.
- **Throttle**: Graph mailbox-concurrency ~4. `loadAll` per mailbox serieel, tussen mailboxen parallel. `graph()` retry't bij 429/503.

## Deployen — BELANGRIJK

`git push` zet code op GitHub maar publiceert NIETS. Twee losse stappen:

- **Frontend** → de Hetzner-server moet `git pull` doen in `/var/www/admin-dashboard`. Dit gebeurt automatisch via het lokale **Deploy Dashboard** (`~/Documents/git-deploy`, `http://127.0.0.1:4000`): de Push-knop pusht naar GitHub en draait dan de `POST_PUSH_HOOK` voor `admin-standalone` (SSH `root@95.217.203.120` → `git pull --ff-only`). Handmatig kan ook: `ssh root@95.217.203.120 "cd /var/www/admin-dashboard && git pull --ff-only"`.
- **Worker** → `npx wrangler deploy` (alleen nodig als `worker.js` wijzigt; vereist `wrangler login`).

Let op: het Deploy Dashboard heeft voor admin-standalone een `AUTO_MERGE` die `claude/continue-work-9xVz7` in `main` merget vóór de push. Na wijzigingen aan `server.js` van git-deploy moet de launchd-service herladen worden om nieuwe hooks te activeren.

## Bekende beperkingen / wensen

- **Informer banktransacties** + **projecten/uren** niet via API — projecten daarom lokaal in de browser (zie boven).
- **Forward naar MoneyMonk-inkoopadres** niet via Graph met bijlage. Outlook server-side rule of handmatig is de workaround. (Informer-flow vervangt dit grotendeels.)
- **Projecten-data is browser-lokaal** (localStorage) — single-device, geen sync/backup.
- **Tab overlap**: Overzicht (snelle rij-acties) en Facturen verwerken (wizard met flow-log) overlappen deels.
- **Lokale LLM via Mac Mini** (LM Studio/llama.cpp) — open: cloudflared-tunnel + `worker.js` naar local OpenAI-compatible endpoint. Nog niet voltooid.

## Common commands

```bash
cd ~/Documents/admin-standalone

# Lokaal testen (8000 → http://localhost:8000)
python3 -m http.server 8000

# Worker lokaal draaien (incl. /api en /extract)
npx wrangler dev

# Worker deployen (alleen bij worker.js-wijziging)
npx wrangler deploy

# Publiceren: push via Deploy Dashboard (127.0.0.1:4000) — pusht + server-side git pull.
# Of handmatig:
git add -A && git commit -m "..." && git push
ssh root@95.217.203.120 "cd /var/www/admin-dashboard && git pull --ff-only"
```

## Conventions

- Nederlands in UI én commit-messages.
- Geen build-stap, geen bundler — alles single-file HTML met inline JS.
- Externe libs via jsDelivr (MSAL).
- Comments in code zijn beknopt en functioneel.
- `devLog()` calls toevoegen bij nieuwe user-acties zodat ze in de console verschijnen.

## Volgende sessie

Voor je iets verandert: lees deze file + grep de relevante sectie in `index.html`. Het bestand is groot — niet in één keer lezen. Vergeet na een wijziging het deployen niet (zie Deployen).
