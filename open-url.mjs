#!/usr/bin/env node
// Vaste opdracht "open-webadres" van de Jarvis-brug. Haalt op wat Jarvis zojuist heeft klaargezet (één keer, kort geldig):
//  - een webadres: opent het in een nieuw venster van Google Chrome;
//  - een opdracht voor Chrome: lezen, ergens heen gaan, klikken, typen, scrollen in het voorste venster.
// Veiligheid zit hier, niet bij het taalmodel: knoppen, verzenden en riskante links worden alleen uitgevoerd met bevestigd:true
// (dat de pagina pas meestuurt na een ja van Micha); wachtwoorden en betaalgegevens worden nooit getypt.
// Het antwoord staat als JSON op de laatste regel.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const WORKER = process.env.JARVIS_WORKER || "https://admin-dashboard.michavantuyl.workers.dev";
const wacht = ms => new Promise(r => setTimeout(r, ms));
function run(cmd, args, ms = 12000) {
  return new Promise(resolve => {
    let out = "", err = ""; const k = spawn(cmd, args);
    const t = setTimeout(() => k.kill("SIGKILL"), ms);
    k.stdout.on("data", d => { out += d; }); k.stderr.on("data", d => { err += d; });
    k.on("error", e => { clearTimeout(t); resolve({ code: 1, out, err: String(e.message) }); });
    k.on("close", code => { clearTimeout(t); resolve({ code, out: out.trim(), err: err.trim() }); });
  });
}
const CHROME = 'tell application "Google Chrome"';
function uitleg(err) {
  if (/turned off|uitgeschakeld|Allow JavaScript from Apple Events/i.test(err)) return "Chrome staat niet toe dat Jarvis de pagina bedient. Zet in Chrome aan: menu Weergave > Ontwikkelaar > JavaScript van Apple Events toestaan.";
  if (/-1743|not authori[sz]ed|geen toestemming/i.test(err)) return "macOS staat niet toe dat Jarvis Chrome bedient. Zet aan: Systeeminstellingen > Privacy en beveiliging > Automatisering > node (of Terminal) > Google Chrome.";
  if (/-25211|assistive|hulpapparaten|niet toegestaan om toetsaanslagen|not allowed to send keystrokes|-1002/i.test(err)) return "macOS staat niet toe dat Jarvis toetsen en klikken naar andere programma's stuurt. Zet aan: Systeeminstellingen > Privacy en beveiliging > Toegankelijkheid > node (of Terminal).";
  if (/-1719|-1728|Can.t get (front )?window|Invalid index|Geen ander venster/i.test(err)) return "Er staat geen Chrome-venster open naast Jarvis zelf. Laat Jarvis eerst een pagina openen.";
  if (/-600|isn.t running/i.test(err)) return "Google Chrome draait niet.";
  return "Chrome gaf een fout: " + err.slice(0, 200);
}
// Jarvis draait zelf ook in een Chrome-venster en staat voor zodra Micha ertegen praat. Daarom: het voorste venster dat níet Jarvis is.
const DOEL = ["-e", "on doel()", "-e", CHROME, "-e", "repeat with x in windows", "-e", 'if (URL of active tab of x) does not start with "https://claude.ai" then return x', "-e", "end repeat", "-e", "end tell",
  "-e", 'error "Geen ander venster" number -1728', "-e", "end doel"];
async function js(code) {
  const r = await run("osascript", [...DOEL, "-e", "on run a", "-e", "set w to doel()", "-e", CHROME + " to return execute active tab of w javascript (item 1 of a)", "-e", "end run", code]);
  if (r.code !== 0) return { fout: uitleg(r.err) };
  try { return JSON.parse(r.out); } catch { return { fout: "De pagina gaf geen leesbaar antwoord (mogelijk is hij nog aan het laden)." }; }
}

// Hulpfuncties die in de pagina zelf draaien.
export const HULP = `
const zicht=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>2&&r.height>2&&s.visibility!=='hidden'&&s.display!=='none';};
const kort=t=>String(t||'').replace(/\\s+/g,' ').trim();
const naam=e=>kort(e.innerText||e.value||e.getAttribute('aria-label')||e.title||e.alt||(e.querySelector&&e.querySelector('img[alt]')||{}).alt||'').slice(0,80);
const klikbaar=()=>[...document.querySelectorAll('a[href],button,[role=button],[role=link],[role=tab],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=option],[role=treeitem],[aria-haspopup],[aria-expanded],[onclick],input[type=submit],input[type=button],summary')].filter(zicht).filter(e=>naam(e));
const velden=()=>[...document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=image]):not([type=reset]),textarea,select,[contenteditable=true],[role=searchbox],[role=textbox],[role=combobox]')].filter(zicht);
const veldnaam=e=>{let l='';if(e.id){const x=document.querySelector('label[for="'+CSS.escape(e.id)+'"]');if(x)l=x.innerText;}if(!l&&e.closest('label'))l=e.closest('label').innerText;return kort(l||e.getAttribute('aria-label')||e.placeholder||e.name||e.id||e.type||'veld').slice(0,60);};
const zoek=(lijst,fn,t)=>{t=kort(t).toLowerCase();const n=lijst.map(e=>[e,fn(e).toLowerCase()]),kortst=a=>a.sort((p,q)=>p[1].length-q[1].length)[0];return (n.find(x=>x[1]===t)||kortst(n.filter(x=>x[1].startsWith(t)))||kortst(n.filter(x=>x[1].includes(t)))||[null])[0];};
const uniek=a=>[...new Set(a)];
const RISICO=/verwijder|delete|remove|wissen|uitlog|afmeld|log ?out|sign ?out|betaal|betalen|pay|afreken|checkout|bestel|order|koop|kopen|buy|verzend|verstuur|send|submit|plaats|post|publice|publish|bevestig|confirm|annule|cancel|opzeg|unsubscribe|akkoord|accept|toestaan|allow|authori|installe|download|overmak|transfer|deel|share/i;
const GEHEIM=e=>e.type==='password'||/cc-|one-time-code|current-password|new-password/.test(e.autocomplete||'')||/pass|wachtwoord|pwd|card|kaartn|cvc|cvv|iban|pincode|otp|token/i.test((e.name||'')+' '+(e.id||'')+' '+(e.placeholder||''));
const waar=()=>({titel:kort(document.title).slice(0,120),url:location.href.slice(0,300)});
`;
export const SCRIPTS = {
  lees: j => `(()=>{${HULP}
    const k=klikbaar();
    return JSON.stringify({...waar(),tekst:(document.body?document.body.innerText:'').replace(/[ \\t]+/g,' ').replace(/\\n{3,}/g,'\\n\\n').trim().slice(0,${Number(j.tekens) || 5000}),
      links:uniek(k.filter(e=>e.tagName==='A').map(naam)).slice(0,50),knoppen:uniek(k.filter(e=>e.tagName!=='A').map(naam)).slice(0,30),velden:uniek(velden().filter(e=>!GEHEIM(e)).map(veldnaam)).slice(0,20)});})()`,
  klik: j => `(()=>{${HULP}
    const e=zoek(klikbaar(),naam,${JSON.stringify(j.tekst)});
    if(!e)return JSON.stringify({fout:'Geen link of knop gevonden met die tekst.',wel_gevonden:uniek(klikbaar().map(naam)).slice(0,25)});
    const n=naam(e),link=e.tagName==='A',verstuurt=(e.tagName==='INPUT'&&e.type==='submit')||(e.tagName==='BUTTON'&&!!e.form&&e.type!=='button'),vrij=!RISICO.test(n)&&!verstuurt;
    if(!vrij&&!${j.bevestigd === true})return JSON.stringify({voorvertoning:true,soort:link?'link':'knop',tekst:n,pagina:location.hostname,let_op:'Nog niet geklikt: dit kan iets versturen of veranderen. Vraag Micha om bevestiging.'});
    e.scrollIntoView({block:'center'});e.click();return JSON.stringify({geklikt:n,soort:link?'link':'knop'});})()`,
  typ: j => `(()=>{${HULP}
    const v=velden(),t=${JSON.stringify(j.veld || "")};
    let f=t?zoek(v,veldnaam,t):null;
    if(!f&&!t){const a=document.activeElement;f=(a&&v.includes(a))?a:(v.filter(e=>!GEHEIM(e)).length===1?v.filter(e=>!GEHEIM(e))[0]:null);}
    if(!f)return JSON.stringify({fout:t?'Geen invulveld gevonden met die naam.':'Zeg in welk veld het moet.',velden:uniek(v.filter(e=>!GEHEIM(e)).map(veldnaam)).slice(0,20)});
    if(GEHEIM(f))return JSON.stringify({fout:'Wachtwoorden, codes en betaalgegevens typt Jarvis niet. Dat doet Micha zelf.'});
    const tekst=${JSON.stringify(j.tekst || "")},enter=${j.enter === true};
    const zoekveld=f.type==='search'||f.getAttribute('role')==='searchbox'||/^(q|s|search|query|zoek)/i.test(f.name||'')||/zoek|search/i.test(veldnaam(f))||(f.form&&String(f.form.getAttribute('method')||'get').toLowerCase()==='get'&&f.form.querySelectorAll('input:not([type=hidden]),textarea,select').length<=2);
    if(enter&&!zoekveld&&!${j.bevestigd === true})return JSON.stringify({voorvertoning:true,veld:veldnaam(f),tekst:tekst.slice(0,300),pagina:location.hostname,let_op:'Nog niets ingevuld of verstuurd: met enter gaat dit de deur uit. Vraag Micha om bevestiging.'});
    f.scrollIntoView({block:'center'});f.focus();
    if(f.isContentEditable){document.execCommand('selectAll',false,null);document.execCommand('insertText',false,tekst);}
    else if(f.tagName==='SELECT'){const o=[...f.options].find(o=>kort(o.text).toLowerCase().includes(tekst.toLowerCase()));if(!o)return JSON.stringify({fout:'Die keuze staat niet in de lijst.',keuzes:[...f.options].map(o=>kort(o.text)).slice(0,30)});f.value=o.value;f.dispatchEvent(new Event('change',{bubbles:true}));}
    else{const set=Object.getOwnPropertyDescriptor(f.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;set.call(f,tekst);f.dispatchEvent(new Event('input',{bubbles:true}));f.dispatchEvent(new Event('change',{bubbles:true}));}
    if(enter){for(const s of ['keydown','keypress','keyup'])f.dispatchEvent(new KeyboardEvent(s,{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));if(f.form){try{f.form.requestSubmit();}catch(_){}}}
    return JSON.stringify({ingevuld:veldnaam(f),verstuurd:enter});})()`,
  scroll: j => `(()=>{${HULP}
    const r=${JSON.stringify(j.richting || "neer")};
    if(r==='boven')scrollTo(0,0);else if(r==='onder')scrollTo(0,document.documentElement.scrollHeight);else scrollBy(0,(r==='op'?-1:1)*innerHeight*.85);
    return JSON.stringify({...waar(),positie:Math.round(100*scrollY/Math.max(1,document.documentElement.scrollHeight-innerHeight))+'%'});})()`,
  terug: () => `(()=>{history.back();return JSON.stringify({terug:true});})()`,
  waar: () => `(()=>{${HULP}return JSON.stringify(waar());})()`
};

// Programma openen: alleen een programma dat echt in een programmamap staat.
async function appOpen(naam) {
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._+&-]*$/u.test(naam)) return { fout: "Geen geldige programmanaam." };
  const mappen = ["/Applications", "/System/Applications", "/System/Applications/Utilities", "/Applications/Utilities", path.join(os.homedir(), "Applications")];
  if (!mappen.some(m => fs.existsSync(path.join(m, naam + ".app")))) {
    let lijkt = []; try { lijkt = fs.readdirSync("/Applications").filter(f => f.endsWith(".app") && f.toLowerCase().includes(naam.toLowerCase().split(" ").pop())).map(f => f.slice(0, -4)).slice(0, 8); } catch { lijkt = []; }
    return { fout: "Dat programma staat niet op deze Mac onder die naam.", lijkt_op: lijkt };
  }
  const r = await run("open", ["-a", naam]);
  return r.code === 0 ? { geopend: naam } : { fout: "Openen mislukt: " + (r.err || "foutcode " + r.code).slice(0, 160) };
}
// Outlook-app: naar voren halen en zoeken (menu Bewerken > Zoeken > Zoeken in Outlook-items), daarna het bovenste resultaat aanklikken.
// De nieuwe Outlook voor Mac kan niet per script een bepaalde mail openen; zoeken via het scherm is de enige weg.
async function outlook(zoek) {
  if (!zoek) { const r = await run("open", ["-a", "Microsoft Outlook"]); return r.code === 0 ? { geopend: "Microsoft Outlook" } : { fout: "Outlook openen mislukt." }; }
  if (zoek.startsWith("#diag")) {   // hulpmiddel om de opbouw van het Outlook-venster te zien (alleen rollen en maten, geen inhoud)
    const max = Number(zoek.split(" ")[1]) || 14;
    const d = await run("osascript", ["-e", "property uit : \"\"", "-e", "property teller : 0", "-e", "on loop(el, pad)", "-e", 'tell application "System Events"', "-e", "if teller > " + max + " then return", "-e", "set teller to teller + 1",
      "-e", "set rollen to role of UI elements of el", "-e", "set maten to size of UI elements of el", "-e", "set regel to pad & \"=\"",
      "-e", "repeat with i from 1 to count of rollen", "-e", "set regel to regel & (item i of rollen) & \":\" & (item 1 of item i of maten) & \"x\" & (item 2 of item i of maten) & \" \"", "-e", "end repeat",
      "-e", "set uit to uit & regel & \"|\"", "-e", "set kinderen to UI elements of el",
      "-e", "repeat with i from 1 to count of rollen", "-e", "set r to item i of rollen", "-e", 'if r is "AXSplitGroup" or r is "AXGroup" or r is "AXScrollArea" then', "-e", "if (item 1 of item i of maten) > 300 and (item 2 of item i of maten) > 300 then my loop(item i of kinderen, pad & \".\" & i)", "-e", "end if", "-e", "end repeat",
      "-e", "end tell", "-e", "end loop",
      "-e", "on run", "-e", 'tell application "System Events" to set w to window 1 of process "Microsoft Outlook"', "-e", "my loop(w, \"w\")", "-e", "return uit", "-e", "end run"], 16500);
    return { diag: (d.out || d.err || "tijd op").slice(0, 3000) };
  }
  // De berichtenlijst zit diep in het venster en de plek verschilt per versie: daarom zoeken we de tabel met hoge rijen (berichten) in plaats van een vast pad.
  // De berichtenlijst: venster > splitter > splitter > splitter > groep > tabel (zo gemeten op 25 november 2026 in de nieuwe Outlook voor Mac).
  // Een zoektocht door het hele venster duurt te lang; daarom dit vaste pad. Wijzigt Outlook zijn opbouw: draai outlook met zoek "#diag 8".
  const ZOEKRIJ = ["-e", "on zoekRij(w)", "-e", 'tell application "System Events"',
    "-e", "set k to table 1 of group 1 of splitter group 1 of splitter group 1 of splitter group 1 of w",
    "-e", "repeat with j from 1 to 6", "-e", "set {b, h} to size of row j of k", "-e", "if h > 34 and b > 180 then", "-e", "set {x0, y0} to position of row j of k", "-e", "return {x0 + (b div 2), y0 + (h div 2)}", "-e", "end if", "-e", "end repeat",
    "-e", "end tell", "-e", "return missing value", "-e", "end zoekRij"];
  if (zoek === "#rij") {   // alleen meten: waar staat het bovenste bericht en hoe lang duurt het vinden (klikt niet)
    const t0 = Date.now(), d = await run("osascript", [...ZOEKRIJ, "-e", "on run", "-e", 'tell application "System Events" to set w to window 1 of process "Microsoft Outlook"', "-e", "set p to my zoekRij(w)", "-e", "if p is missing value then return \"niets\"", "-e", "return ((item 1 of p) as text) & \",\" & ((item 2 of p) as text)", "-e", "end run"], 16500);
    return { rij: d.out || d.err || "tijd op", ms: Date.now() - t0 };
  }
  // Stap 1: Outlook naar voren, zoekveld via het menu, zoekterm typen en enter.
  const t0 = Date.now();
  const r = await run("osascript", ["-e", "on run a", "-e", 'tell application "Microsoft Outlook" to activate', "-e", "delay 0.6",
    "-e", 'tell application "System Events" to tell process "Microsoft Outlook"',
    "-e", 'click menu item "Zoeken in Outlook-items" of menu 1 of menu item "Zoeken" of menu 1 of menu bar item "Bewerken" of menu bar 1',
    "-e", "delay 0.4", "-e", 'keystroke "a" using command down', "-e", "keystroke (item 1 of a)", "-e", "delay 0.3", "-e", "key code 36",
    "-e", "end tell", "-e", "end run", zoek], 12000);
  if (r.code !== 0) return { fout: !r.err ? "Outlook reageerde niet op tijd." : /menu item|Bewerken|Zoeken/i.test(r.err) && !/-25211|assistive|-1002|toetsaanslagen|keystrokes/i.test(r.err) ? "Het zoekmenu van Outlook is niet gevonden (" + r.err.slice(0, 120) + ")." : uitleg(r.err) };
  // Stap 2: wachten op de resultaten, het bovenste bericht opzoeken en er met een echte muisklik op klikken.
  // ('click at' van System Events doet hier seconden over; een muisklik via CoreGraphics is direct.)
  let klik = false, waarom;
  await wacht(Math.max(1200, Math.min(2800, 15500 - (Date.now() - t0) - 2500)));
  const p = await run("osascript", [...ZOEKRIJ, "-e", "on run", "-e", 'tell application "System Events" to set w to window 1 of process "Microsoft Outlook"', "-e", "set p to my zoekRij(w)", "-e", 'if p is missing value then return "niets"', "-e", 'return ((item 1 of p) as text) & "," & ((item 2 of p) as text)', "-e", "end run"], 4000);
  const m = /^(\d+),(\d+)$/.exec(p.out || "");
  if (!m) waarom = p.code !== 0 ? "de berichtenlijst is niet gevonden" : "er staat geen bericht in de zoekresultaten";
  else {
    const k = await run("osascript", ["-l", "JavaScript", "-e", "ObjC.import('CoreGraphics'); var p={x:" + Number(m[1]) + ",y:" + Number(m[2]) + "}; var d=$.CGEventCreateMouseEvent(null,$.kCGEventLeftMouseDown,p,$.kCGMouseButtonLeft); $.CGEventPost($.kCGHIDEventTap,d); delay(0.08); var u=$.CGEventCreateMouseEvent(null,$.kCGEventLeftMouseUp,p,$.kCGMouseButtonLeft); $.CGEventPost($.kCGHIDEventTap,u); 'ok'"], 3000);
    klik = k.code === 0; if (!klik) waarom = "de muisklik is geweigerd (" + (k.err || "geen melding").slice(0, 100) + ")";
  }
  return { outlook: "naar voren gehaald", gezocht_op: zoek, bovenste_resultaat_aangeklikt: klik, waarom_niet: waarom,
    let_op: klik ? "Het bovenste zoekresultaat is aangeklikt. Zeg wat je gezocht hebt; of het de juiste mail is, kun je niet zien." : "De zoekresultaten staan in beeld, maar de mail zelf is niet geopend. Zeg dat Micha de mail in de lijst aanklikt." };
}

async function chrome(job) {
  if (job.actie === "app") return appOpen(String(job.naam || ""));
  if (job.actie === "outlook") return outlook(String(job.zoek || "").trim().slice(0, 120));
  if (job.actie === "tabs") {
    const r = await run("osascript", ["-e", CHROME, "-e", 'set uit to ""', "-e", "repeat with w in windows", "-e", "repeat with t in tabs of w", "-e", 'set uit to uit & (title of t) & "\t" & (URL of t) & "\n"', "-e", "end repeat", "-e", "end repeat", "-e", "return uit", "-e", "end tell"]);
    if (r.code !== 0) return { fout: uitleg(r.err) };
    return { tabs: r.out.split("\n").filter(Boolean).slice(0, 40).map(l => { const [titel, url] = l.split("\t"); return { titel: (titel || "").slice(0, 100), url: (url || "").slice(0, 200) }; }) };
  }
  if (job.actie === "ga") {
    let u; try { u = new URL(job.url); } catch { u = null; }
    if (!u || !/^https?:$/.test(u.protocol)) return { fout: "Dit adres wordt niet geopend." };
    const r = await run("osascript", [...DOEL, "-e", "on run a", "-e", "set w to doel()", "-e", CHROME + " to set URL of active tab of w to (item 1 of a)", "-e", "end run", u.href]);
    if (r.code !== 0) return { fout: uitleg(r.err) };
    await wacht(2500); const w = await js(SCRIPTS.waar()); return { gegaan_naar: u.href, ...(w.fout ? {} : w) };
  }
  if (!SCRIPTS[job.actie] || job.actie === "waar") return { fout: "Onbekende actie." };
  const r = await js(SCRIPTS[job.actie](job));
  if (r.fout || r.voorvertoning || job.actie === "lees" || job.actie === "scroll") return r;
  await wacht(job.actie === "typ" && !job.enter ? 300 : 2200);   // de pagina laten reageren en melden waar we nu staan
  const w = await js(SCRIPTS.waar()); return { ...r, nu: w.fout ? undefined : w };
}

async function main() {
  let key = process.env.BRUG_KEY || "";
  if (!key) { try { key = fs.readFileSync(process.env.BRUG_KEYFILE || path.join(os.homedir(), "Documents/jarvis-brein/brug.key"), "utf8").trim(); } catch { key = ""; } }
  if (!key) { console.log("De sleutel van de brug is niet gevonden."); process.exit(1); }
  let d = null;
  try {
    for (let i = 0; i < 8; i++) {   // de opslag van de Worker kan een tel achterlopen: een paar keer proberen
      const r = await fetch(WORKER + "/brug/open-url", { method: "POST", headers: { "x-brug-key": key }, signal: AbortSignal.timeout(8000) });
      d = await r.json().catch(() => null);
      if (r.ok && d && (d.url || d.job)) break;
      d = null; await wacht(500);
    }
    if (!d) { console.log("Er staat niets klaar."); process.exit(1); }
  } catch (e) { console.log("De Worker is niet bereikbaar: " + (e.message || e)); process.exit(1); }
  if (d.job) { console.log(JSON.stringify(await chrome(d.job))); process.exit(0); }
  let u; try { u = new URL(d.url); } catch { u = null; }
  if (!u || !/^https?:$/.test(u.protocol)) { console.log("Dit adres wordt niet geopend."); process.exit(1); }
  const r = await run("open", ["-na", "Google Chrome", "--args", "--new-window", u.href]);
  console.log(r.code === 0 ? "Geopend in Chrome: " + u.hostname : "Chrome starten mislukt: " + (r.err || "foutcode " + r.code)); process.exit(r.code || 0);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
