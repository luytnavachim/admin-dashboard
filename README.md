# Administratie dashboard — standalone

Eén-persoons inkoop- en verkoopadministratie voor Triplet IT, als single-file webapp. Geen build-stap, geen bundler: pure HTML + JavaScript dat rechtstreeks met **Microsoft Graph** praat via OAuth (MSAL), en met **Informer** (boekhoudpakket) via een eigen **Cloudflare Worker**. Factuur-PDF's worden door **Claude** (Anthropic API) omgezet naar gestructureerde data.

**Live:** https://admin.triplet-it.nl/ — de **frontend** (`index.html`) wordt geserveerd door **Apache op een eigen Hetzner-server** (`95.217.203.120`). De **Cloudflare Worker** (`…workers.dev`) is alleen de **API-backend** (Informer-proxy + Claude-extractie). De repo op GitHub (`luytnavachim/admin-dashboard`) is versiebeheer; publiceren is **twee losse stappen** (zie [Deployen](#deployen)):

- frontend → SSH naar de Hetzner-server + `git pull` in de webroot;
- worker → `npx wrangler deploy` (alleen nodig als `worker.js` wijzigt).

> ⚠️ `git push` alleen verandert de live site niet. Voor een `index.html`-wijziging moet de Hetzner-server `git pull` doen.

---

## Wat je krijgt

Een dashboard met zes tabs:

- **Overzicht** — live status over alle gemonitorde mailboxen: facturen die verwerkt/betaald moeten worden, mails die antwoord vragen, openstaande inkoopfacturen uit Informer, en je agenda voor de komende 2 dagen. Per factuurrij een `→ Informer`-knop en een `Verwerkt ✓`-knop die de mail naar `MoneyMonk Verwerkt` verplaatst.
- **Facturen verwerken** — wizard met flow-log: kies een factuurmail, het dashboard leest de PDF (en eventuele UBL-bijlage), extraheert leverancier + bedragen via Claude, matcht/maakt de relation in Informer, maakt de inkoopfactuur aan mét PDF als bijlage, en verplaatst de mail naar `MoneyMonk Verwerkt`. Ook een **losse-PDF-upload** voor facturen die niet in je inbox zitten.
- **Verkoop migreren** — bulk-import van MoneyMonk PDF-exports als verkoopfacturen in Informer (per PDF: Claude extraheert klant + bedragen → klant matchen/aanmaken → POST naar het sales-endpoint).
- **Projecten** — uren registreren per project en factureren met één klik. Je neemt een project uit Informer over (projectnummer + naam + relatie + vast uurtarief), boekt er uren op (datum, uren, omschrijving), en met `Factureren` bouwt het dashboard er één samenvattende verkoopfactuurregel van (totaal open uren × tarief), maakt de factuur aan via `/invoice/sales/` en maakt 'm definitief/verstuurt 'm via `/invoice/sales/send/` (het projectnummer komt als referentie op de factuur). Gefactureerde uren blijven als historie staan, gemarkeerd zodat ze niet dubbel op een volgende factuur komen. Informer-projecten zelf zijn API-afgeschermd, daarom voer je ze hier één keer in. De data wordt **cross-device** bewaard in **Cloudflare Workers KV** (endpoint `/projects` op de Worker, beveiligd via je **Microsoft-login** — de Worker verifieert je token bij Microsoft Graph); `localStorage` dient alleen als offline-cache.
- **Instellingen** — Informer-verbinding (base URL via de Worker, endpoints, sales ledger-/product-/template-/currency-IDs, BTW-optie).
- **Geavanceerd** — API-sandbox: verbinding testen, bestaande inkoopfacturen ophalen, test-inkoopfactuur aanmaken, plus een debug-log van de laatste Informer request/response.

Verder: persistente login (MSAL-token in `localStorage`, automatische refresh) en een toggelbare dev-console rechts in beeld die alle Graph- en Informer-calls logt.

---

## Architectuur

```
Browser  ←─ index.html geserveerd door Apache op de Hetzner-server (95.217.203.120)
  ├── MSAL OAuth → Microsoft Graph        (mail + agenda + mappen, direct)
  ├── localStorage                        (Informer-config + projecten/uren)
  └── Cloudflare Worker (…workers.dev)     — alleen API-backend
        ├── /api/<path> → Informer API     (CORS-proxy, auth server-side)
        └── /extract  /extract-sales       (PDF → Claude Haiku → JSON)
```

De frontend (statische HTML/JS) draait dus op je eigen Hetzner-box; de Cloudflare Worker is puur de backend. Informer staat geen directe browser-calls toe (CORS) en de API-key mag niet in de frontend staan — daarom loopt al het Informer-verkeer via de Worker, die de key server-side bewaart. Diezelfde Worker draait ook de Claude-extractie, zodat de Anthropic-key eveneens server-side blijft.

| Bestand | Doel |
|---|---|
| `index.html` | De hele app (single-file, ~2400 regels). MSAL-login, Graph-calls, alle tabs, Informer-flow. |
| `worker.js` | Cloudflare Worker: Informer-proxy (`/api/*`) + PDF-extractie (`/extract`, `/extract-sales`). |
| `worker.test.mjs` | Tests voor de Worker. |
| `informer.html` | Losse API-sandbox om Informer-endpoints te testen (los van het dashboard). |
| `wrangler.jsonc` | Worker deploy-config. |

---

## Setup

### Stap 1 — Azure AD app registreren

Microsoft Graph vereist een geregistreerde "app" zodat de pagina mag inloggen. Gratis, geen credit card.

1. Ga naar [portal.azure.com](https://portal.azure.com) → log in.
2. Zoek **App registrations** → **+ New registration**.
3. Vul in:
   - **Name**: `Admin Dashboard`
   - **Supported account types**: *Accounts in any organizational directory ... and personal Microsoft accounts*.
   - **Redirect URI**: type **Single-page application (SPA)**, URL = waar je host (bv. `https://admin.triplet-it.nl/`, of `http://localhost:8000/` om lokaal te testen — let op de trailing slash).
4. Klik **Register** en kopieer de **Application (client) ID**.
5. Links → **API permissions** → **+ Add** → **Microsoft Graph** → **Delegated**. Vink aan: `Mail.ReadWrite`, `Mail.ReadWrite.Shared`, `Calendars.Read`, `User.Read`. → **Add permissions**.

### Stap 2 — Cloudflare Worker deployen (Informer + Claude)

1. [cloudflare.com](https://cloudflare.com) → Workers & Pages → Create Worker → plak `worker.js`, Save & deploy. (Of lokaal: `npx wrangler deploy`.)
2. Worker → Settings → Variables, voeg toe:
   - `INFORMER_API_KEY` — je Informer API-key *(Secret)*.
   - `INFORMER_SECURITY_CODE` — alleen als die afwijkt van de API-key *(Secret)*.
   - `INFORMER_AUTH_METHOD` — `apikey` (default) | `bearer` | `basic-key` | `basic-user` | `x-api-key`.
   - `INFORMER_BASE_URL` — bv. `https://api.informer.eu/v1`.
   - `ANTHROPIC_API_KEY` — voor de PDF-extractie *(Secret)*.
   - `ALLOWED_ORIGIN` — `*` of je dashboard-URL(s), komma-gescheiden.
   - `PROJECTS_ALLOWED_USERS` *(optioneel)* — komma-gescheiden e-mailadressen die de Projecten-data mogen lezen/schrijven. Leeg laten = iedereen op `@triplet-it.nl` mag (zie hieronder).
3. Kopieer de Worker-URL (eindigt op `.workers.dev`). De Informer-base-URL in het dashboard wordt dan `<worker-url>/api`.

> De Worker gebruikt `claude-haiku-4-5` voor extractie (~15× goedkoper dan Opus, identieke resultaten voor gestructureerde `tool_choice`-extractie). Terugschakelen naar Sonnet/Opus alleen als Haiku op specifieke PDF's faalt.

#### Projecten-opslag (Workers KV) — éénmalig

De Projecten-tab bewaart projecten + uren cross-device in een KV-store. Setup vanuit de repo:

```bash
npx wrangler kv namespace create PROJECTS   # geeft een id terug
# → plak die id in wrangler.jsonc bij kv_namespaces (binding PROJECTS_KV)
npx wrangler deploy
```

**Beveiliging via Microsoft-login (geen wachtwoord).** De frontend stuurt je Microsoft-token mee; de Worker controleert bij Microsoft Graph (`/me`) wie je bent en staat alleen toegestane gebruikers toe. Standaard mag iedereen op `@triplet-it.nl`. Wil je 't strakker? Zet `PROJECTS_ALLOWED_USERS` (komma-gescheiden e-mailadressen) in de Worker-variabelen. Je hoeft op een nieuw apparaat dus niets in te vullen — inloggen met Microsoft is genoeg.

### Stap 3 — Client-ID invullen

Open `index.html`, zoek bovenaan in het CONFIG-blok:

```js
const CLIENT_ID = "...";
```

Vervang door je client-ID uit stap 1. In dezelfde sectie staan ook `MAILBOXES`, `MONEYMONK_ADDRESS`, `PROCESSED_FOLDER_NAME` en `SELF_EMAILS`/`SELF_DOMAINS` — pas die aan naar je eigen situatie.

### Stap 4 — Hosten & deployen (Cloudflare)

De site draait op de Cloudflare Worker uit `worker.js`; `wrangler.jsonc` zet `assets.directory: "./"`, dus de Worker serveert ook `index.html` en de andere statische bestanden uit de repo-root. Het custom domein `admin.triplet-it.nl` hangt aan deze Worker (geen GitHub Pages, geen CNAME-bestand in de repo).

**Live zetten van een wijziging:**

```bash
cd ~/Documents/admin-standalone
git add -A && git commit -m "..." && git push   # versiebeheer — NIET de deploy
npx wrangler deploy                              # DIT publiceert naar admin.triplet-it.nl
```

> ⚠️ `git push` alleen is niet genoeg — de live site verandert pas na `wrangler deploy`. De "Auto deploy …"-commits in de history zijn gewoon git-commits, geen Cloudflare-deploys.

**Eerste keer / na een verlopen sessie** vraagt wrangler om login:

```bash
npx wrangler login        # opent browser → Allow
```

Lukt deployen niet met `Authentication error [code: 10000]`, dan zit er meestal een verlopen `CLOUDFLARE_API_TOKEN` in je shell-omgeving die de browser-login overschrijft. Oplossing:

```bash
unset CLOUDFLARE_API_TOKEN CLOUDFLARE_API_KEY CLOUDFLARE_EMAIL CLOUDFLARE_ACCOUNT_ID
npx wrangler logout && npx wrangler login && npx wrangler deploy
```

Check ook of zo'n token in `~/.zshrc` / `~/.zprofile` staat (`grep CLOUDFLARE ~/.zshrc`). Het Cloudflare-account is `12663d0e232c029c7a69c8c166efd87c` — die kun je desnoods vastzetten met `"account_id": "…"` in `wrangler.jsonc`.

**Lokaal testen** (zonder deploy): `python3 -m http.server 8000` → `http://localhost:8000/` (`file://` werkt niet door OAuth-restricties). Voor de Informer/Claude-endpoints lokaal: `npx wrangler dev`.

Zorg dat elke host-URL (incl. `http://localhost:8000/`) exact als Redirect URI in Azure staat (stap 1), anders weigert de login.

### Stap 5 — Instellingen invullen

Log in via **Inloggen met Microsoft**. Ga naar de **Instellingen**-tab en vul de Informer-base-URL (`<worker-url>/api`) en de verkoop-IDs (ledger, product, template, currency) in. Voor verbinding testen en losse calls: de **Geavanceerd**-tab.

---

## Aanpassen

Alle vaste instellingen staan in het `CONFIG`-blok bovenaan het `<script>` in `index.html`:

- `MAILBOXES` — lijst met te monitoren mailboxen (primaire = eerste, gebruikt voor agenda).
- `PROCESSED_FOLDER_NAME` — doelmap voor verwerkte facturen (default `MoneyMonk Verwerkt`).
- `MONEYMONK_ADDRESS` — inkoopadres voor doorsturen.
- `SELF_EMAILS` / `SELF_DOMAINS` — eigen adressen die als "eigen factuur" worden uitgefilterd.
- Factuur-/betaling-detectie: zoek `looksLikeInvoice` en `looksLikePayment` in de code.

Informer-endpoints en sales-IDs worden in de UI (Instellingen-tab) ingesteld en in `localStorage` bewaard; defaults staan in `defaultConfig()`.

---

## Veiligheid

- De Client-ID is geen geheim — die mag in publieke broncode staan.
- De Informer API-key en de Anthropic API-key staan **alleen** in de Worker (server-side Secrets), nooit in de frontend.
- Graph-tokens worden door MSAL.js in `localStorage` bewaard, met automatische refresh. Scopes blijven beperkt tot `SCOPES` (geen Mail.Send, geen OneDrive/Teams).
- Uitloggen op alle apparaten: [account.microsoft.com](https://account.microsoft.com) → Privacy → Apps en services → Admin Dashboard → Revoke.

---

## Troubleshooting

**"AADSTS50011: Reply URL mismatch"** → De browser-URL komt niet exact overeen met de Redirect URI in Azure (trailing slash, http vs https tellen mee).

**"Map 'MoneyMonk Verwerkt' niet gevonden"** → De map wordt normaal auto-aangemaakt; controleer anders `PROCESSED_FOLDER_NAME` en de mailbox-permissies.

**Informer-call faalt / lege secties** → Check de **Geavanceerd**-tab (debug-log) en de dev-console. Vaak een ontbrekende Worker-variabele (`INFORMER_API_KEY`, `INFORMER_BASE_URL`) of een verkeerde base-URL in Instellingen. De Worker vertaalt Informer-validatiefouten (HTTP 200 met `error` in de body) naar een echte 4xx.

**Extractie faalt** → Controleer `ANTHROPIC_API_KEY` in de Worker; de `/extract`-respons bevat bij fouten de Anthropic-statuscode en -body.

**Graph 429/503** → Throttling; de app retry't automatisch. Mailboxen worden parallel opgehaald, per mailbox serieel (Graph-concurrency-limit ~4).

---

## Wat dit dashboard NIET doet

- **Geen auto-forward naar MoneyMonk** — de browser kan geen mails inclusief bijlage forwarden via Graph. Workaround: een Outlook server-side rule of handmatig doorsturen. (De Informer-flow vervangt dit grotendeels: facturen gaan rechtstreeks de boekhouding in.)
- **Geen Informer-banktransacties** — niet via de API beschikbaar; koppelen blijft handmatig in Informer-web ("Open in Informer"-knop per openstaande factuur).
- **Geen agenda-sync** — alleen lezen.
- **Geen pushnotificaties** — laat een tab open of installeer als PWA.
