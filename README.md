# Administratie dashboard — standalone

Geen Cowork, geen Claude, geen backend. Pure HTML + JavaScript dat rechtstreeks met Microsoft Graph praat via OAuth. Hosten op GitHub Pages of Netlify (gratis) en je hebt een eigen URL die je kunt bookmarken.

---

## Wat je krijgt

- Live overzicht: openstaande facturen/betalingen, mails die antwoord vragen, deadlines uit mails (regex), agenda voor de komende 2 dagen.
- Acties: één-klik "Verwerkt ✓" verplaatst factuur naar `MoneyMonk Verwerkt`, "Klaar ✓" markeert reply als gelezen.
- Persistente login (token wordt veilig in browser opgeslagen via MSAL).

---

## Setup — éénmalig, ~10 minuten

### Stap 1: Azure AD app registreren

Microsoft Graph vereist een geregistreerde "app" zodat de pagina mag inloggen. Gratis, geen credit card.

1. Ga naar [portal.azure.com](https://portal.azure.com) → log in met je Microsoft-account.
2. Zoekbalk bovenaan: typ **App registrations** → open dat scherm.
3. Klik **+ New registration**.
4. Vul in:
   - **Name**: `Admin Dashboard` (of wat je wilt)
   - **Supported account types**: kies **"Accounts in any organizational directory ... and personal Microsoft accounts"** (laatste optie). Dat werkt voor zowel zakelijke als persoonlijke accounts.
   - **Redirect URI**: kies **Single-page application (SPA)** uit de dropdown en vul de URL in waar je het dashboard gaat hosten. Bijvoorbeeld:
     - GitHub Pages: `https://JOUWUSERNAME.github.io/admin-dashboard/`
     - Netlify: `https://JOUWSITE.netlify.app/`
     - Lokaal testen: `http://localhost:8000/` (let op de trailing slash)
5. Klik **Register**.
6. Op de pagina die nu opent: kopieer de **Application (client) ID** — een lange string als `12345678-abcd-...`. Bewaar 'm.

### Stap 2: API-toestemmingen geven

1. In de zojuist aangemaakte app: links → **API permissions**.
2. **+ Add a permission** → **Microsoft Graph** → **Delegated permissions**.
3. Zoek en vink aan:
   - `Mail.ReadWrite`
   - `Calendars.Read`
   - `User.Read` (staat er standaard al)
4. Klik **Add permissions**.
5. Optioneel maar handig: klik **Grant admin consent for ...** als die knop er is (alleen voor zakelijke tenants). Voor persoonlijke accounts hoef je dit niet — Microsoft vraagt toestemming bij het inloggen zelf.

### Stap 3: Client-ID invullen

1. Open `index.html` in een editor.
2. Zoek bovenaan in het `<script>`-blok:
   ```js
   const CLIENT_ID = "PASTE_YOUR_CLIENT_ID_HERE";
   ```
3. Vervang `PASTE_YOUR_CLIENT_ID_HERE` door je client-ID uit stap 1.
4. Sla op.

### Stap 4: Hosten

#### Optie A: GitHub Pages

1. Maak een nieuwe (publieke) repo op GitHub, bijv. `admin-dashboard`.
2. Upload `index.html` en `README.md` naar de root van de repo.
3. Repo-instellingen → **Pages** → **Branch**: `main` / **Folder**: `/ (root)` → **Save**.
4. Wacht ~1 minuut. Je krijgt een URL als `https://JOUWUSERNAME.github.io/admin-dashboard/`.
5. Zorg dat die exacte URL in stap 1 (Redirect URI in Azure) staat — anders weigert de login.

#### Optie B: Netlify (Drag & Drop)

1. Ga naar [app.netlify.com/drop](https://app.netlify.com/drop).
2. Sleep de map met `index.html` erin op de zone.
3. Netlify geeft je een URL. Eventueel hernoemen naar iets leesbaars in Site settings.
4. Zet die URL als Redirect URI in Azure (stap 1).

#### Optie C: Lokaal proberen

Een lokale http-server is genoeg (file:// werkt niet vanwege OAuth-restricties):

```bash
cd admin-standalone
python3 -m http.server 8000
```

Open dan `http://localhost:8000/`. Vergeet niet om die URL ook in Azure toe te voegen.

### Stap 5: Inloggen

Open je gehoste URL. Klik **Inloggen met Microsoft** → popup → keur de permissies goed → dashboard laadt.

---

## Aanpassen

- Andere map dan `MoneyMonk Verwerkt`: pas `PROCESSED_FOLDER_NAME` aan.
- Ander MoneyMonk-adres: pas `MONEYMONK_ADDRESS` aan.
- Eigen e-mailadressen die als "eigen factuur" gefilterd worden: `SELF_EMAILS` en `SELF_DOMAINS`.
- Toegevoegde patronen voor factuur/betaling-detectie: zoek in de code `looksLikeInvoice` en `looksLikePayment`.

---

## Veiligheid

- De Client-ID is niet geheim — die mag in publieke broncode staan (het is geen wachtwoord, eerder een unieke app-identifier).
- Access-tokens worden in `localStorage` opgeslagen door MSAL.js, met automatische refresh.
- De pagina vraagt alleen de scopes die in `SCOPES` staan. Geen Mail.Send, geen toegang tot OneDrive/Teams.
- Wil je later uitloggen op alle apparaten: in [account.microsoft.com](https://account.microsoft.com) → Privacy → Apps en services → Admin Dashboard → Revoke.

---

## Troubleshooting

**"AADSTS50011: Reply URL mismatch"** → De URL in je browser komt niet exact overeen met de Redirect URI in Azure. Trailing slashes en http vs https tellen mee. Voeg de juiste URL toe in Azure → Authentication → Redirect URIs.

**"Map 'MoneyMonk Verwerkt' niet gevonden"** → De map bestaat niet in je Outlook, of heeft een andere naam. Maak hem aan onder `Financieel & Boekhouding` of pas `PROCESSED_FOLDER_NAME` aan.

**Lege secties** → Open de browser console (F12) en kijk naar de fouten. Vaak is het een ontbrekende permissie — dan terug naar stap 2.

**Inloggen geeft "consent_required" loop** → Klik in Azure op **Grant admin consent**, of log uit van alle Microsoft-accounts en weer in.

---

## Wat dit dashboard NIET doet

- Geen auto-forward naar MoneyMonk (browser kan geen mails forwarden inclusief bijlage — daarvoor heb je een Outlook-server-side rule nodig).
- Geen AI-classificatie meer (geen Claude-aanroepen). Antwoord-detectie en deadline-extractie zijn nu pure regex/heuristiek.
- Geen agenda-sync — alleen lezen.
- Geen pushnotificaties — wel kun je de pagina als PWA installeren of een tab open laten.
