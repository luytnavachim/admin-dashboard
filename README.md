# Administratie dashboard — standalone

Eén-persoons inkoop- en verkoopadministratie voor Triplet IT, als single-file webapp. Geen build-stap, geen bundler: pure HTML + JavaScript dat rechtstreeks met **Microsoft Graph** praat via OAuth (MSAL), en met **Moneybird** (boekhoudpakket) via een eigen **Cloudflare Worker**. Factuur-PDF's worden door **Claude** (Anthropic API) omgezet naar gestructureerde data.

**Live:** https://admin.triplet-it.nl/ — de **frontend** (`index.html`) wordt geserveerd door **Apache op een eigen Hetzner-server** (`95.217.203.120`, webroot `/var/www/admin-dashboard`). De **Cloudflare Worker** (`…workers.dev`) is alleen de **API-backend** (Moneybird-proxy + Claude-extractie + projecten-opslag). De repo op GitHub (`luytnavachim/admin-dashboard`) is versiebeheer; publiceren is **twee losse stappen** (zie [Deployen](#deployen)):

- frontend → de Hetzner-server doet `git pull` in de webroot;
- worker → `npx wrangler deploy` (alleen nodig als `worker.js` wijzigt).

> ⚠️ `git push` alleen verandert de live site niet. Voor een `index.html`-wijziging moet de Hetzner-server `git pull` doen.

> ℹ️ **Informer is uitgefaseerd** (juni 2026). De volledige administratie loopt nu via Moneybird. Sommige oude Informer-helpers staan nog ongebruikt in de code en mogen later opgeruimd worden.

---

## Wat je krijgt

Een dashboard met zes tabs:

- **Overzicht** — live status over alle gemonitorde mailboxen: facturen die verwerkt/betaald moeten worden, mails die antwoord vragen, openstaande inkoopfacturen uit Moneybird, en je agenda voor de komende 2 dagen. Per factuurrij een `→ Moneybird`-knop (boekt de factuur direct in) en een `Verwerkt ✓`-knop die de mail naar `MoneyMonk Verwerkt` verplaatst.
- **Facturen verwerken** — wizard met flow-log: kies een factuurmail, het dashboard leest de PDF (en eventuele UBL-bijlage), extraheert leverancier + bedragen via Claude, matcht/maakt het contact in Moneybird, maakt de inkoopfactuur aan (ingeboekt, niet betaald) mét PDF als bijlage, en verplaatst de mail naar `MoneyMonk Verwerkt`. Ook een **losse-PDF-upload** voor facturen die niet in je inbox zitten.
- **Verkoop migreren** — bulk-import van MoneyMonk PDF-exports als verkoopfacturen in Moneybird (per PDF: Claude extraheert klant + bedragen → contact matchen/aanmaken → verkoopfactuur). Met **Direct inboeken** worden ze gemarkeerd als verstuurd (zonder e-mail), anders blijven ze concept; al bestaande referenties worden overgeslagen.
- **Projecten** — uren registreren per project en er met één klik een verkoopfactuur (concept) van maken. Elke uren-boeking komt ook direct als **tijdregistratie** in Moneybird. Zie [Projecten & facturen](#projecten--facturen-uren--verkoopfactuur) hieronder. Data staat **cross-device** in **Cloudflare Workers KV** (`/projects`), beveiligd via je **Microsoft-login**.
- **Instellingen** — Moneybird-verbindingstest. Token + administratie-ID staan in de Worker, niet in de browser.
- **Uitleg** — beknopte handleiding per tab.

Verder: persistente login (MSAL-token in `localStorage`, automatische refresh), licht/donker-thema, en een toggelbare dev-console die alle Graph- en Moneybird-calls logt.

---

## Architectuur

```
Browser  ←─ index.html geserveerd door Apache op de Hetzner-server (95.217.203.120)
  ├── MSAL OAuth → Microsoft Graph        (mail + agenda + mappen, direct)
  ├── localStorage                        (projecten-cache + thema + testfactuur-vinkje)
  └── Cloudflare Worker (…workers.dev)     — alleen API-backend
        ├── /mb/<path> → Moneybird API v2  (CORS-proxy, Bearer-token server-side)
        ├── /extract  /extract-sales       (PDF → Claude Haiku → JSON)
        └── /projects → Workers KV         (projecten/uren, cross-device; auth via Graph-token)
```

De frontend (statische HTML/JS) draait op je eigen Hetzner-box; de Cloudflare Worker is puur de backend. Moneybird staat geen directe browser-calls toe (CORS) en de API-token mag niet in de frontend staan — daarom loopt al het Moneybird-verkeer via de Worker, die de token server-side bewaart. Diezelfde Worker draait ook de Claude-extractie, zodat de Anthropic-key eveneens server-side blijft. De Worker forwardt body + content-type ongewijzigd, dus ook multipart-uploads (PDF-bijlage bij een inkoopfactuur).

| Bestand | Doel |
|---|---|
| `index.html` | De hele app (single-file). MSAL-login, Graph-calls, alle tabs, Moneybird-flows, projecten/uren. |
| `worker.js` | Cloudflare Worker: Moneybird-proxy (`/mb/*`), PDF-extractie (`/extract`, `/extract-sales`) en projecten-opslag (`/projects` → KV). Bevat nog een ongebruikte Informer-proxy (`/api/*`). |
| `worker.test.mjs` | Tests voor de Worker. |
| `informer.html` | Oude API-sandbox voor Informer — niet meer in gebruik. |
| `wrangler.jsonc` | Worker deploy-config (incl. KV-binding `PROJECTS_KV` en `MONEYBIRD_ADMIN_ID`). |

---

## Projecten & facturen (uren → verkoopfactuur)

Je neemt projecten hier één keer over en registreert de uren in het dashboard. Bij factureren maakt het dashboard **altijd alleen een concept** in Moneybird (`POST /mb/sales_invoices.json`) — versturen doe je zelf vanuit Moneybird (zo kun je er eventueel een bijlage aan koppelen, wat de API niet ondersteunt).

**Een project aanmaken** (inklapbaar formulier "+ Nieuw project"):

- **Projectnummer** — komt als referentie op de factuur (en wordt gebruikt om de Moneybird-tijdregistratie aan het juiste project te koppelen).
- **Relatie/klant** — gekozen uit je **Moneybird-contacten** (autocomplete, op bedrijfsnaam). Bepaalt ook of BTW verlegd nodig is (niet-NL → automatisch aan).
- **Tarieven** — één of meer (`label` + bedrag). Bij meerdere kun je per urenboeking kiezen welk tarief geldt.
- **Factuurregels** — `samengevat per tarief` (één regel per tarief, met de datums in de specificatie) óf `aparte regel per boeking`.
- **BTW verlegd** — voor buitenland/EU B2B (bv. België): 0% reverse-charge i.p.v. 21%.
- **Opmerking op factuur** — vrije tekst die in het Opmerking-veld van de Moneybird-factuur komt.

De meeste van deze instellingen zijn ook achteraf per project aan te passen op de (uitklapbare) projectkaart.

**Uren boeken & factureren:**

- Boek uren (datum, uren, tarief, omschrijving). Elke boeking wordt ook direct een **tijdregistratie in Moneybird**, gekoppeld aan het contact en het juiste Moneybird-project (gematcht op projectnummer + uurtarief), `billable`. De knop **"Bestaande uren → Moneybird"** zet eerder geboekte uren die er nog niet in staan alsnog over (idempotent — geen dubbele).
- **Factureren** maakt het concept aan en markeert de uren als gefactureerd (terugdraaibaar met ↩). Met het **Testfactuur**-vinkje blijft het een dry-run (uren blijven open).
- **Markeer als gefactureerd** markeert open uren als gefactureerd *zonder* een Moneybird-concept aan te maken — voor uren die al elders gefactureerd zijn.
- Rekenkern = `computeProjectInvoice()` (unit-getest): groepeert per tarief, of maakt regels per boeking.

**Doorbelasting** (bv. Nova Trinity → Orange): in een project kun je een inkoopfactuur inlezen — via **PDF-upload** (Claude leest aantal + omschrijvingen per regel) óf **uit Moneybird** (bestaande inkoopfactuur kiezen). Elke factuurregel wordt een uren-boeking (aantal = uren) tegen een vast doorbelasttarief (€100/uur; inkoop €80). Daarna direct doorzetten naar een concept kan.

**Gefactureerd-overzicht** (boven in de tab): alle aangemaakte facturen met datum, factuur-id (link naar Moneybird), project, klant en bedrag. Per factuur een statusbadge **concept/definitief** met een ✓-knop om 'm op definitief te zetten zodra je 'm in Moneybird hebt verstuurd, en een ↩ om 'm terug te draaien (uren weer open).

**Opslag:** alles staat **cross-device** in **Workers KV** via `/projects` (GET/PUT), beveiligd via je Microsoft-login — de Worker verifieert je token bij Graph `/me` tegen toegestane gebruikers. `localStorage` is alleen offline-cache.

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

### Stap 2 — Cloudflare Worker deployen (Moneybird + Claude)

1. [cloudflare.com](https://cloudflare.com) → Workers & Pages → Create Worker → plak `worker.js`, Save & deploy. (Of lokaal vanuit de repo: `npx wrangler deploy`.)
2. Worker → Settings → Variables & Secrets, voeg toe:
   - `MONEYBIRD_TOKEN` — je Moneybird personal API-token *(Secret)*.
   - `MONEYBIRD_ADMIN_ID` — je administratie-ID *(variabele; staat ook al in `wrangler.jsonc`)*.
   - `ANTHROPIC_API_KEY` — voor de PDF-extractie *(Secret)*.
   - `ALLOWED_ORIGIN` — `*` of je dashboard-URL(s), komma-gescheiden.
   - `PROJECTS_ALLOWED_USERS` *(optioneel)* — komma-gescheiden e-mailadressen die de Projecten-data mogen lezen/schrijven. Leeg laten = iedereen op `@triplet-it.nl` mag (zie hieronder).
3. Test de verbinding op de **Instellingen**-tab van het dashboard.

> De Worker gebruikt `claude-haiku-4-5` voor extractie (~15× goedkoper dan Opus, identieke resultaten voor gestructureerde `tool_choice`-extractie). Terugschakelen naar Sonnet/Opus alleen als Haiku op specifieke PDF's faalt.

#### Moneybird-token

In Moneybird: **Instellingen → Koppelingen → API-tokens → nieuw token**. Het token krijgt toegang tot jouw administratie; de administratie-ID staat in de URL als je in Moneybird bent ingelogd (`https://moneybird.com/<admin-id>/…`).

#### Projecten-opslag (Workers KV) — éénmalig

De Projecten-tab bewaart projecten + uren cross-device in een KV-store. Setup vanuit de repo:

```bash
npx wrangler kv namespace create PROJECTS   # geeft een id terug
# → plak die id in wrangler.jsonc bij kv_namespaces (binding PROJECTS_KV)
npx wrangler deploy
```

**Beveiliging via Microsoft-login (geen wachtwoord).** De frontend stuurt je Microsoft-token mee; de Worker controleert bij Microsoft Graph (`/me`) wie je bent en staat alleen toegestane gebruikers toe. Standaard mag iedereen op `@triplet-it.nl`. Wil je 't strakker? Zet `PROJECTS_ALLOWED_USERS` (komma-gescheiden e-mailadressen) in de Worker-variabelen. Op een nieuw apparaat hoef je dus niets in te vullen — inloggen met Microsoft is genoeg.

### Stap 3 — Client-ID invullen

Open `index.html`, zoek bovenaan in het CONFIG-blok:

```js
const CLIENT_ID = "...";
```

Vervang door je client-ID uit stap 1. In dezelfde sectie staan ook `MAILBOXES`, `MONEYMONK_ADDRESS`, `PROCESSED_FOLDER_NAME` en `SELF_EMAILS`/`SELF_DOMAINS` — pas die aan naar je eigen situatie.

---

## Deployen

`git push` zet de code op GitHub maar publiceert **niets**. Publiceren is twee losse stappen:

### Frontend (`index.html` e.d.) → Hetzner

De live frontend draait op Apache op de Hetzner-server (`95.217.203.120`, webroot `/var/www/admin-dashboard`). Die moet `git pull` doen:

```bash
cd ~/Documents/admin-standalone
git add -A && git commit -m "..." && git push
ssh root@95.217.203.120 "cd /var/www/admin-dashboard && git pull --ff-only"
```

Dit gaat normaal via het lokale **Deploy Dashboard** (`~/Documents/git-deploy`, `http://127.0.0.1:4000`): de Push-knop pusht naar GitHub en draait dan automatisch de server-side `git pull`.

### Worker (`worker.js`) → Cloudflare

Alleen nodig als `worker.js` wijzigt:

```bash
npx wrangler deploy
```

**Eerste keer / na een verlopen sessie** vraagt wrangler om login:

```bash
npx wrangler login        # opent browser → Allow
```

Lukt deployen niet met `Authentication error [code: 10000]`, dan zit er meestal een verlopen `CLOUDFLARE_API_TOKEN` in je shell-omgeving die de browser-login overschrijft. Oplossing:

```bash
unset CLOUDFLARE_API_TOKEN CLOUDFLARE_API_KEY CLOUDFLARE_EMAIL CLOUDFLARE_ACCOUNT_ID
npx wrangler logout && npx wrangler login && npx wrangler deploy
```

Check ook of zo'n token in `~/.zshrc` / `~/.zprofile` staat (`grep CLOUDFLARE ~/.zshrc`).

**Lokaal testen** (zonder deploy): `python3 -m http.server 8000` → `http://localhost:8000/` (`file://` werkt niet door OAuth-restricties). Voor de Moneybird/Claude-endpoints lokaal: `npx wrangler dev`. Zorg dat elke host-URL (incl. `http://localhost:8000/`) exact als Redirect URI in Azure staat (stap 1), anders weigert de login.

---

## Aanpassen

Alle vaste instellingen staan in het `CONFIG`-blok bovenaan het `<script>` in `index.html`:

- `MAILBOXES` — lijst met te monitoren mailboxen (primaire = eerste, gebruikt voor agenda).
- `PROCESSED_FOLDER_NAME` — doelmap voor verwerkte facturen (default `MoneyMonk Verwerkt`).
- `MONEYMONK_ADDRESS` — inkoopadres voor doorsturen.
- `SELF_EMAILS` / `SELF_DOMAINS` — eigen adressen die als "eigen factuur" worden uitgefilterd.
- Factuur-/betaling-detectie: zoek `looksLikeInvoice` en `looksLikePayment` in de code.

Moneybird-ID's (btw-tarieven, grootboeken, administratie-ID, user-ID voor tijdregistratie) staan als constanten in `index.html` (`MB_SALES_TAX`, `MB_PURCHASE_TAX`, `MB_SALES_LEDGER`, `MB_PURCHASE_LEDGER`, `MB_ADMIN_ID`, `MB_USER_ID`). De Moneybird-token en administratie-ID voor de API zelf staan in de Worker.

---

## Veiligheid

- De Client-ID is geen geheim — die mag in publieke broncode staan.
- De Moneybird API-token en de Anthropic API-key staan **alleen** in de Worker (server-side Secrets), nooit in de frontend.
- Graph-tokens worden door MSAL.js in `localStorage` bewaard, met automatische refresh. Scopes blijven beperkt tot `SCOPES` (geen Mail.Send, geen OneDrive/Teams).
- Uitloggen op alle apparaten: [account.microsoft.com](https://account.microsoft.com) → Privacy → Apps en services → Admin Dashboard → Revoke.

---

## Troubleshooting

**"AADSTS50011: Reply URL mismatch"** → De browser-URL komt niet exact overeen met de Redirect URI in Azure (trailing slash, http vs https tellen mee).

**"Map 'MoneyMonk Verwerkt' niet gevonden"** → De map wordt normaal auto-aangemaakt; controleer anders `PROCESSED_FOLDER_NAME` en de mailbox-permissies.

**Moneybird-call faalt** → Test de verbinding op de **Instellingen**-tab en check de dev-console. Vaak een ontbrekende Worker-variabele (`MONEYBIRD_TOKEN`, `MONEYBIRD_ADMIN_ID`). De foutmelding uit Moneybird wordt doorgegeven naar het dashboard.

**PDF-bijlage mislukt bij inkoop** → De factuur is dan wél ingeboekt, alleen de bijlage niet. Endpoint is `POST /mb/documents/purchase_invoices/{id}/attachments.json` (meervoud "attachments"); sleep de PDF anders handmatig in Moneybird.

**"0%-inkoop-btw-tarief ontbreekt"** → Moneybird laat btw-tarieven niet via de API aanmaken. Maak eenmalig een 0%-inkooptarief in Moneybird (Instellingen → Btw-tarieven) en probeer opnieuw.

**Extractie faalt** → Controleer `ANTHROPIC_API_KEY` in de Worker; de `/extract`-respons bevat bij fouten de Anthropic-statuscode en -body.

**Graph 429/503** → Throttling; de app retry't automatisch. Mailboxen worden parallel opgehaald, per mailbox serieel (Graph-concurrency-limit ~4).

---

## Wat dit dashboard NIET doet

- **Geen auto-forward naar MoneyMonk** — niet meer nodig: de inkoop-flow boekt facturen rechtstreeks in Moneybird, inclusief PDF-bijlage.
- **Geen projecten/uren-sync vanuit een boekhoudpakket via API** — projecten/uren worden in het dashboard bijgehouden (KV) en als tijdregistratie naar Moneybird gepusht.
- **Verkoopfacturen worden niet automatisch verstuurd** — het dashboard maakt alleen een concept; versturen (en evt. een bijlage koppelen) doe je zelf in Moneybird. De API ondersteunt geen bijlage op verkoopfacturen.
- **Geen agenda-sync** — alleen lezen.
- **Geen pushnotificaties** — laat een tab open of installeer als PWA.
