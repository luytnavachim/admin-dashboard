# Admin Dashboard — context for Claude

Standalone web-dashboard voor Micha (eenmans-IT-bedrijf Triplet IT). Vervangt het inkoop-/verkoop-administratie-proces. In productie geen Cowork-afhankelijkheid: de frontend praat rechtstreeks met Microsoft Graph (OAuth/MSAL) en met **Moneybird** via een eigen Cloudflare Worker. Claude Haiku wordt server-side (in de Worker) gebruikt voor PDF-extractie.

**Live op:** `https://admin.triplet-it.nl/` — frontend draait op **Apache, eigen Hetzner-server** (`95.217.203.120`, webroot `/var/www/admin-dashboard`). GEEN GitHub Pages.
**Worker (API-backend):** `https://admin-dashboard.michavantuyl.workers.dev/`
**Repo:** `github.com/luytnavachim/admin-dashboard` (lokaal: `~/Documents/admin-standalone`)

> **Boekhouding = Moneybird.** Informer is volledig uitgefaseerd (juni 2026). Alle live flows lopen nu via Moneybird (`/mb/*`-proxy). De oude Informer-helpers staan deels nog ongebruikt in `index.html` (informerFetch, migrateContacts/Sales/Purchase, e.d.) maar worden nergens meer aangeroepen — mogen later weg.

## Files

| File | Doel |
|---|---|
| `index.html` | Hoofd-dashboard. Single-file (~3900 regels). MSAL.js voor Microsoft-login, Graph API direct, Moneybird via de Worker. Tabs: Overzicht / Facturen verwerken / Verkoop migreren / Projecten / Afboeken / Moneybird / Instellingen / Uitleg. |
| `worker.js` | Cloudflare Worker — CORS-proxy naar Moneybird (`/mb/*`) + `/extract` & `/extract-sales` (PDF → Claude Haiku → JSON) + `/projects` (Workers KV). Bevat nog een ongebruikte Informer-proxy (`/api/*`). |
| `worker.test.mjs` | Tests voor de Worker. |
| `informer.html` | Oude API-sandbox voor Informer — niet meer in gebruik. |
| `wrangler.jsonc` | Cloudflare Worker deploy config. |
| `README.md` | User-facing setup + deploy instructies. |

## Architectuur

Browser (Apache @ Hetzner) → MSAL OAuth → Microsoft Graph (mail/agenda/mappen direct).
Browser → Cloudflare Worker `/mb/*` → Moneybird API v2 (CORS-proxy, token server-side).
Browser → Cloudflare Worker `/extract` `/extract-sales` → Anthropic API (PDF → JSON).
Browser → Cloudflare Worker `/projects` → Workers KV (projecten/uren, cross-device, beveiligd via Microsoft-login: Worker checkt Graph `/me`).
Browser → `localStorage` (projecten-offline-cache `projects_v1` + testfactuur-vinkje `proj-test-mode` + thema `admin-theme`).

## Moneybird — vaste ID's (deze administratie)

Administratie-ID `489478494017815934` (ook in `wrangler.jsonc` als `MONEYBIRD_ADMIN_ID`). Owner/user-ID voor tijdregistratie `211695746093679828`.

- Sales-btw-tarieven (`MB_SALES_TAX`): 21% `489478495131403774`, 9% `489478495134549503`, 0% `489478495137695232`. Sales-grootboek "Omzet" `489478494297785771`.
- Inkoop-btw-tarieven (`MB_PURCHASE_TAX`): 21% `489478495139792385`, 9% `489478495142938114`. Inkoop-grootboek "Ongecategoriseerde uitgaven" `489478494294640040`. 0%/buitenlandse btw → 0%-inkooptarief opgezocht via `mbFindPurchase0Rate()` (Moneybird laat btw-tarieven NIET via API aanmaken; bestaat 'm niet, dan nette foutmelding).

## Belangrijke beslissingen

- **Hosting gesplitst**: frontend (statische HTML/JS) op Hetzner via Apache; Worker is puur de API-backend. Moneybird-token en Anthropic-key staan alleen in de Worker (Secrets), nooit in de frontend.
- **MSAL met Single-page-app type** in Azure. Redirect URI = `https://admin.triplet-it.nl/`. Scopes: `Mail.ReadWrite Mail.ReadWrite.Shared Mail.Send Mail.Send.Shared Calendars.ReadWrite Calendars.ReadWrite.Shared User.Read`. `CLIENT_ID` staat bovenaan het script. **Mail.Send(.Shared)** is nodig voor "Doorsturen naar Moneybird" (`forwardToMoneybird` → Graph `/messages/{id}/forward` naar `MONEYBIRD_INBOX`); na het toevoegen moeten deze permissions in Azure → API permissions staan én moet de gebruiker opnieuw inloggen (consent). Doorsturen vanuit shared mailboxes vereist Send-As/Send-on-Behalf op die mailbox.
- **Multi-mailbox**: `MAILBOXES` bovenaan script = micha@vantuyl.it + micha@, info@, administratie@, inkoop@, finance@ (triplet-it.nl). Eerste = primair (agenda). `/me` voor primaire, `/users/{email}` voor shared.
- **Moneybird-proxy**: `mbFetch(path, opts)` → `<worker>/mb/<path>`. De Worker forwardt body + content-type ongewijzigd (dus ook multipart voor bijlagen) en zet `Authorization: Bearer MONEYBIRD_TOKEN`. `mbBase()` leidt de Worker-origin af via `projWorkerBase()` (niet meer uit de oude Informer-config).
- **Facturen verwerken (inkoop)**: factuurmail (of losse PDF) → PDF/UBL lezen → `/extract` (Claude) → `mbBookPurchaseFromExtracted()`: contact zoeken op naam (`mbContactId`) of aanmaken (`mbContactIdOrCreate`) → `POST /mb/documents/purchase_invoices.json` (ingeboekt, niet betaald) → PDF als bijlage via `POST /mb/documents/purchase_invoices/{id}/attachments.json` (multipart, veld `file`, **meervoud** "attachments") → mail naar `MoneyMonk Verwerkt`. Knop `→ Moneybird` op Overzicht (`sendRowToMoneybird`) en wizard op Facturen-tab (`sendSelectedToMoneybird`) delen dezelfde kern. Losse upload = `sendUploadedPdfToMoneybird`.
- **Verkoop migreren**: bulk MoneyMonk-PDF's → `/extract-sales` → `mbBookSalesFromExtracted()`: contact match/aanmaken → `POST /mb/sales_invoices.json`. Vinkje "Direct inboeken" → daarna `POST /mb/sales_invoices/{id}/send_invoice.json` met `delivery_method: "Manual"` (gemarkeerd verstuurd, zonder e-mail); anders blijft het een concept. Dedupe op `reference` via `mbLoadExistingSalesRefs()`.
- **Overzicht — openstaande inkoop**: `loadOpenInvoices()` haalt `GET /mb/documents/purchase_invoices.json` op, filtert `state !== "paid"`, sorteert op vervaldatum.
- **Projecten (uren → factuur)**: projecten worden hier handmatig overgenomen (projectnummer + naam + klant). Per project: **meerdere tarieven** (`rates[]` label+bedrag, keuze per urenboeking), een **factuur-template** (cosmetisch — Moneybird-payload gebruikt 'm niet) en **regelmodus** (`lineMode`: `summary` of `perEntry`). Klant-picker laadt **Moneybird-contacten** (`loadProjectRelations` → `mbLoadAllContacts`). Opslag **cross-device in Workers KV** via `/projects` (GET/PUT), beveiligd via Microsoft-login (`PROJECTS_ALLOWED_USERS`, default domein `@triplet-it.nl`). `Factureren` maakt **altijd alleen een concept** in Moneybird (`POST /mb/sales_invoices.json`) — NIET versturen; gebruiker verstuurt zelf vanuit Moneybird (ivm bijlagen). Pure rekenkern = `computeProjectInvoice()` (unit-getest, groepeert per tarief). Sales 21% = `MB_SALES_TAX["21"]`, btw verlegd → `MB_SALES_TAX["0"]`. Knop **"Factureer maand"** (`invoiceProjectsForMonth`) maakt in bulk per project een concept uit de open uren van een gekozen maand (respecteert testmode).
- **Uren → Moneybird-tijdregistratie**: elke uren-boeking (`addEntry`) maakt óók een time entry in Moneybird (`mbCreateTimeEntry`): gekoppeld aan het contact + het juiste Moneybird-project (gematcht op projectnummer-prefix én budget==uurtarief via `mbFindProjectId`), start 09:00 + duur = aantal uren, `billable: true`. De Moneybird-id wordt op de boeking bewaard (`entry.mbTimeEntryId`). Knop **"Bestaande uren → Moneybird"** (`backfillTimeEntries`) zet bestaande boekingen zonder id alsnog over (idempotent). Elke uren-boeking maakt óók een **Outlook-agenda-afspraak** (`createAgendaEvent` → Graph `POST /users/{AGENDA_CALENDAR}/events`, of `/me/events` als het de ingelogde account is; vereist `Calendars.ReadWrite(.Shared)`). `AGENDA_CALENDAR` staat bovenaan het script (nu `venebrugge16@outlook.com`); leeg = uit. De event-id wordt bewaard op `entry.outlookEventId`.
- **Doorbelasting**: in een project een inkoopfactuur inlezen — PDF-upload óf bestaande **uit Moneybird** (`loadDoorbelastingInformer` → `GET /mb/documents/purchase_invoices.json`); elke regel → uren-boeking (aantal = bedrag/80) tegen vast doorbelasttarief.
- **Moneybird-tab (mailbox ↔ Moneybird controle)**: `reconcileMailboxes()` scant de **hele mailbox** (Graph `searchMessagesAll` — alle mappen incl. Verwerkt/Archief/subfolders, instelbare periode) op inkoopfactuur-mails met PDF, extraheert (UBL/`/extract`), en matcht op factuurnummer tegen Moneybird-inkoopfacturen (`recLoadMbPurchaseList`). Groepen: **book** (ontbreekt → `mbBookPurchaseFromExtracted`), **attach** (bestaat zonder bijlage, mail gevonden → `mbAttachPdfToPurchase`), **mb-only** (`recMbOnly`: zonder bijlage, géén mail — handmatige upload), **compleet** (factuur+bijlage aanwezig → mail naar Verwerkt via `recMoveMail`). Na book/attach wordt de mail automatisch naar `MoneyMonk Verwerkt` verplaatst. Reviewbaar: per regel of bulk (`recBookAll`/`recAttachAll`/`recMoveAllCompleet`), dedupe op factuurnummer. Ook op de Facturen-tab een losse "Ontbrekende bijlagen aanvullen" (`loadMissingAttachments`/`mbAttachFileToPurchase`).
- **Inkoop-categorisatie**: trefwoord→grootboek-regels (`inkoop_rules_v1` in localStorage, editor op Moneybird-tab). `mbResolvePurchaseLedgerId()` matcht leveranciersnaam+omschrijving en kiest het juiste grootboek per regel (anders `MB_PURCHASE_LEDGER`). Purchase-grootboeken geladen via `mbLoadPurchaseLedgers` (allowed_document_types incl. `purchase_invoice`).
- **Vreemde valuta**: `mbPurchaseFromExtractedPayload` zet `currency` op de inkoopfactuur als de extractie iets anders dan EUR teruggeeft (bv. USD); Moneybird rekent de koers. De Worker-extractie levert `currency` al.
- **Afboeken-tab**: nog niet-geboekte banktransacties uit Moneybird (`GET /mb/financial_mutations.json?filter=period:<p>,state:unprocessed`) koppelen aan een grootboek. Trefwoord-regels (`afboek_rules_v1` in localStorage) → categorie; suggestie per transactie; boeken via `PATCH /mb/financial_mutations/{id}/link_booking.json` met `booking_type: "LedgerAccount"`, `booking_id`, `price_base: amount_open`. Categorie-dropdown = grootboeken met `allowed_document_types` incl. `financial_mutation` (`mbLoadBankLedgers`). Vereist dat de bankkoppeling in Moneybird transacties importeert; ontbrekende categorieën (DGA-loon, vpb, rekening-courant DGA, loonheffing, pensioen, bankkosten) maak je in Moneybird aan. Boekt het volledige openstaande bedrag op één categorie (splitsen = in Moneybird).
- **Instellingen-tab**: alleen nog een Moneybird-verbindingstest (`testMoneybird`). De Moneybird-config (token + admin-id) zit in de Worker, niet in de frontend.
- **Claude model**: `claude-haiku-4-5`. In `worker.js`.
- **Thema**: licht/donker via `:root.dark` + localStorage `admin-theme`. App-shell-layout (zijbalk-nav + topbar).
- **Dev console**: rechts op Overzicht-tab, log van alle Graph + Moneybird calls. Toggle via `console`-knop.
- **Throttle**: Graph mailbox-concurrency ~4. `loadAll` per mailbox serieel, tussen mailboxen parallel. `graph()` retry't bij 429/503.

## Deployen — BELANGRIJK

`git push` zet code op GitHub maar publiceert NIETS. Twee losse stappen:

- **Frontend** → de Hetzner-server moet `git pull` doen in `/var/www/admin-dashboard`. Dit gebeurt automatisch via het lokale **Deploy Dashboard** (`~/Documents/git-deploy`, `http://127.0.0.1:4000`): de Push-knop pusht naar GitHub en draait dan de `POST_PUSH_HOOK` voor `admin-standalone` (SSH `root@95.217.203.120` → `git pull --ff-only`). Handmatig kan ook: `ssh root@95.217.203.120 "cd /var/www/admin-dashboard && git pull --ff-only"`.
- **Worker** → `npx wrangler deploy` (alleen nodig als `worker.js` wijzigt; vereist `wrangler login`).

Let op: het Deploy Dashboard heeft voor admin-standalone een `AUTO_MERGE` die `claude/continue-work-9xVz7` in `main` merget vóór de push. Na wijzigingen aan `server.js` van git-deploy moet de launchd-service herladen worden om nieuwe hooks te activeren.

## Bekende beperkingen / wensen

- **Moneybird-btw-tarieven niet via API aan te maken** — een ontbrekend 0%-inkooptarief moet handmatig in Moneybird gemaakt worden (de inkoop-flow geeft dan een nette melding).
- **Forward naar MoneyMonk-inkoopadres** niet meer nodig: de inkoop-flow boekt rechtstreeks in Moneybird inclusief PDF-bijlage.
- **Verkoopfactuur-bijlagen** ondersteunt de Moneybird-API niet → daarom blijft "Factureren" een concept dat je zelf in Moneybird verstuurt.
- **Dode Informer-code** in `index.html`/`worker.js` mag opgeruimd worden (informerFetch, migrate*, `/api`-proxy, `informer.html`).

## Common commands

```bash
cd ~/Documents/admin-standalone

# Lokaal testen (8000 → http://localhost:8000)
python3 -m http.server 8000

# Worker lokaal draaien (incl. /mb en /extract)
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
- Na wijziging aan `index.html`: even syntax-checken (`new Function` over de `<script>`-inhoud) vóór deploy.

## Volgende sessie

Voor je iets verandert: lees deze file + grep de relevante sectie in `index.html`. Het bestand is groot — niet in één keer lezen. Vergeet na een wijziging het deployen niet (zie Deployen).
