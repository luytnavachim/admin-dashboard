#!/usr/bin/env node
// Vaste opdracht "open-webadres" van de Jarvis-brug. Haalt op wat Jarvis zojuist heeft klaargezet (één keer, kort geldig):
//  - een webadres: opent het als tabblad in het eigen Jarvis-venster van Google Chrome (zie openInJarvisVenster);
//  - een opdracht voor Chrome: lezen, ergens heen gaan, klikken, typen, scrollen in het voorste venster;
//  - dezelfde opdrachten voor Safari als de opdracht browser:"safari" heeft (zie safari()).
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

// Safari (27 november): zelfde acties als Chrome, met de scripttaal van Safari (do JavaScript, current tab). Het voorste venster dat niet Jarvis is.
// Eenmalig nodig: in Safari 'Sta JavaScript van Apple Events toe' (Instellingen > Ontwikkelaar) en de macOS-vraag of node Safari mag bedienen.
const SAFARI = 'tell application "Safari"';
function uitlegSafari(err) {
  if (/Allow JavaScript from Apple Events|JavaScript van Apple Events|turned off|uitgeschakeld/i.test(err)) return "Safari staat niet toe dat Jarvis de pagina bedient. Zet aan: Safari > Instellingen > Geavanceerd > 'Toon functies voor webontwikkelaars', daarna tabblad Ontwikkelaar > 'Sta JavaScript van Apple Events toe'.";
  if (/-1743|not authori[sz]ed|geen toestemming/i.test(err)) return "macOS staat niet toe dat Jarvis Safari bedient. Zet aan: Systeeminstellingen > Privacy en beveiliging > Automatisering > node (of Terminal) > Safari.";
  if (/-1719|-1728|Can.t get (front )?window|Invalid index|Geen ander venster/i.test(err)) return "Er staat geen Safari-venster open. Laat Jarvis eerst een pagina openen in Safari.";
  if (/-600|isn.t running/i.test(err)) return "Safari draait niet.";
  return "Safari gaf een fout: " + err.slice(0, 200);
}
const SDOEL = ["-e", "on doel()", "-e", SAFARI, "-e", "repeat with i from 1 to count of windows", "-e", "try", "-e", "set u to URL of current tab of window i", "-e", 'if u is missing value then set u to ""',
  "-e", 'if u does not start with "https://claude.ai" then return i', "-e", "end try", "-e", "end repeat", "-e", "end tell", "-e", 'error "Geen ander venster" number -1728', "-e", "end doel"];
async function sjs(code) {
  const r = await run("/usr/bin/osascript", [...SDOEL, "-e", "on run a", "-e", "set i to doel()", "-e", SAFARI + " to return do JavaScript (item 1 of a) in current tab of window i", "-e", "end run", code]);
  if (r.code !== 0) return { fout: uitlegSafari(r.err) };
  try { return JSON.parse(r.out); } catch { return { fout: "De pagina gaf geen leesbaar antwoord (mogelijk is hij nog aan het laden)." }; }
}
async function sTabs() {   // aantal tabbladen van het doelvenster
  const r = await run("/usr/bin/osascript", [...SDOEL, "-e", "on run", "-e", "set i to doel()", "-e", SAFARI + " to return count of tabs of window i", "-e", "end run"], 5000);
  return r.code === 0 ? Number(r.out) || 0 : 0;
}
async function safari(job) {
  const uit = x => ({ browser: "safari", ...x });
  if (job.actie === "tabs") {
    const r = await run("/usr/bin/osascript", ["-e", SAFARI, "-e", 'set uit to ""', "-e", "repeat with w in windows", "-e", "try", "-e", "repeat with t in tabs of w", "-e", 'set uit to uit & (name of t) & "\t" & (URL of t) & "\n"', "-e", "end repeat", "-e", "end try", "-e", "end repeat", "-e", "return uit", "-e", "end tell"]);
    if (r.code !== 0) return uit({ fout: uitlegSafari(r.err) });
    return uit({ tabs: r.out.split("\n").filter(Boolean).slice(0, 40).map(l => { const [titel, url] = l.split("\t"); return { titel: (titel || "").slice(0, 100), url: (url || "").slice(0, 200) }; }) });
  }
  if (job.actie === "ga") {
    let u; try { u = new URL(job.url); } catch { u = null; }
    if (!u || !/^https?:$/.test(u.protocol)) return uit({ fout: "Dit adres wordt niet geopend." });
    const kaal = u.href.replace(/[#?].*$/, "").replace(/\/$/, "");
    // staat het adres al open: dat tabblad naar voren; anders in het doelvenster laden; is er geen venster: Safari het adres laten openen
    const al = await run("/usr/bin/osascript", ["-e", "on run a", "-e", SAFARI, "-e", "repeat with w in windows", "-e", "try", "-e", "repeat with t in tabs of w", "-e", "if (URL of t) starts with (item 1 of a) then", "-e", "set current tab of w to t", "-e", "set index of w to 1", "-e", 'return "ok"', "-e", "end if", "-e", "end repeat", "-e", "end try", "-e", "end repeat", "-e", "end tell", "-e", 'return "nee"', "-e", "end run", kaal], 6000);
    if (al.code === 0 && al.out === "ok") { await wacht(400); const w = await sjs(SCRIPTS.waar()); return uit({ tabblad_naar_voren: true, ...(w.fout ? {} : w) }); }
    let r = await run("/usr/bin/osascript", [...SDOEL, "-e", "on run a", "-e", "set i to doel()", "-e", SAFARI + " to set URL of current tab of window i to (item 1 of a)", "-e", "end run", u.href]);
    if (r.code !== 0 && /-1719|-1728|Invalid index|Geen ander venster|-600|isn.t running/i.test(r.err)) r = await run("/usr/bin/open", ["-a", "Safari", u.href]);
    if (r.code !== 0) return uit({ fout: uitlegSafari(r.err) });
    await wacht(2500); const w = await sjs(SCRIPTS.waar()); return uit({ gegaan_naar: u.href, ...(w.fout ? {} : w) });
  }
  if (!SCRIPTS[job.actie] || job.actie === "waar") return uit({ fout: "Deze actie werkt niet in Safari." });
  const voor = job.actie === "klik" ? await sTabs() : 0;
  const r = await sjs(SCRIPTS[job.actie](job));
  if (r.fout || r.voorvertoning || job.actie === "lees" || job.actie === "scroll") return uit(r);
  await wacht(job.actie === "typ" && !job.enter ? 300 : 2200);
  let nieuwTab = false;
  if (voor && await sTabs() > voor) {   // de klik opende een nieuw tabblad: dat naar voren, anders leest Jarvis daarna de oude pagina
    const t = await run("/usr/bin/osascript", [...SDOEL, "-e", "on run", "-e", "set i to doel()", "-e", SAFARI + " to set current tab of window i to last tab of window i", "-e", "end run"], 5000);
    if (t.code === 0) { nieuwTab = true; await wacht(900); }
  }
  const w = await sjs(SCRIPTS.waar()); return uit({ ...r, ...(nieuwTab ? { nieuw_tabblad: true } : {}), nu: w.fout ? undefined : w });
}

// Hulpfuncties die in de pagina zelf draaien.
export const HULP = `
const zicht=e=>{const r=e.getBoundingClientRect(),s=e.ownerDocument.defaultView.getComputedStyle(e);return r.width>2&&r.height>2&&s.visibility!=='hidden'&&s.display!=='none';};
const DICHT=[];
const docs=()=>{const uit=[document];DICHT.length=0;const loop=d=>{for(const f of d.querySelectorAll('iframe,frame')){let x=null;try{x=f.contentDocument;}catch(_){}if(x&&x.body){if(zicht(f)){uit.push(x);loop(x);}}else if(zicht(f)){let h='';try{h=new URL(f.src,location.href).hostname;}catch(_){}DICHT.push(h||'onbekend');}}};loop(document);return uit;};
const alle=sel=>docs().flatMap(d=>[...d.querySelectorAll(sel)]);
const kort=t=>String(t||'').replace(/\\s+/g,' ').trim();
const naam=e=>kort(e.innerText||e.value||e.getAttribute('aria-label')||e.title||e.alt||(e.querySelector&&e.querySelector('img[alt]')||{}).alt||'').slice(0,80);
const klikbaar=()=>alle('a[href],button,[role=button],[role=link],[role=tab],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=option],[role=treeitem],[aria-haspopup],[aria-expanded],[onclick],input[type=submit],input[type=button],summary').filter(zicht).filter(e=>naam(e));
const velden=()=>alle('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=image]):not([type=reset]),textarea,select,[contenteditable=true],[role=searchbox],[role=textbox],[role=combobox]').filter(zicht);
const veldnaam=e=>{let l='';if(e.id){const x=e.ownerDocument.querySelector('label[for="'+CSS.escape(e.id)+'"]');if(x)l=x.innerText;}if(!l&&e.closest('label'))l=e.closest('label').innerText;return kort(l||e.getAttribute('aria-label')||e.placeholder||e.name||e.id||e.type||'veld').slice(0,60);};
const zoek=(lijst,fn,t)=>{t=kort(t).toLowerCase();const n=lijst.map(e=>[e,fn(e).toLowerCase()]),kortst=a=>a.sort((p,q)=>p[1].length-q[1].length)[0];return (n.find(x=>x[1]===t)||kortst(n.filter(x=>x[1].startsWith(t)))||kortst(n.filter(x=>x[1].includes(t)))||[null])[0];};
const uniek=a=>[...new Set(a)];
const RISICO=/verwijder|delete|remove|wissen|uitlog|afmeld|log ?out|sign ?out|betaal|betalen|pay|afreken|checkout|bestel|order|koop|kopen|buy|verzend|verstuur|send|submit|plaats|post|publice|publish|bevestig|confirm|annule|cancel|opzeg|unsubscribe|akkoord|accept|toestaan|allow|authori|installe|download|overmak|transfer|deel|share/i;
const GEHEIM=e=>e.type==='password'||/cc-|one-time-code|current-password|new-password/.test(e.autocomplete||'')||/pass|wachtwoord|pwd|card|kaartn|cvc|cvv|iban|pincode|otp|token/i.test((e.name||'')+' '+(e.id||'')+' '+(e.placeholder||''));
const waar=()=>({titel:kort(document.title).slice(0,120),url:location.href.slice(0,300)});
const eigen=e=>kort([...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join(' ')).slice(0,80);
const tekstEl=t=>{t=kort(t).toLowerCase();const n=alle('body *').filter(e=>!/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(e.tagName)).map(e=>[e,eigen(e).toLowerCase()]).filter(x=>x[1]&&x[1].includes(t)&&zicht(x[0]));const k=a=>a.sort((p,q)=>p[1].length-q[1].length)[0];return (n.find(x=>x[1]===t)||k(n.filter(x=>x[1].startsWith(t)))||k(n)||[null])[0];};
const druk=e=>{e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;const W=e.ownerDocument.defaultView;let d=e.ownerDocument.elementFromPoint(x,y);if(!d||!(e.contains(d)||d.contains(e)))d=e;if(d.contains(e)&&d!==e)d=e;
  const o={bubbles:true,cancelable:true,composed:true,view:W,clientX:x,clientY:y,button:0};
  for(const s of ['pointerover','mouseover','pointerenter','mouseenter','pointermove','mousemove'])d.dispatchEvent(new (s[0]==='p'?W.PointerEvent:W.MouseEvent)(s,o));
  d.dispatchEvent(new W.PointerEvent('pointerdown',{...o,buttons:1}));d.dispatchEvent(new W.MouseEvent('mousedown',{...o,buttons:1}));try{(d.closest('a,button,[tabindex]')||d).focus({preventScroll:true});}catch(_){}
  d.dispatchEvent(new W.PointerEvent('pointerup',o));d.dispatchEvent(new W.MouseEvent('mouseup',o));d.click();};
`;
export const SCRIPTS = {
  lees: j => `(()=>{${HULP}
    const k=klikbaar();
    const tk=docs().map(d=>d.body?d.body.innerText:'').join('\\n\\n').replace(/[ \\t]+/g,' ').replace(/\\n{3,}/g,'\\n\\n').trim();
    return JSON.stringify({...waar(),tekst:tk.slice(0,${Number(j.tekens) || 5000}),ingekort:tk.length>${Number(j.tekens) || 5000}||undefined,niet_leesbare_kaders:DICHT.length?uniek(DICHT):undefined,
      links:uniek(k.filter(e=>e.tagName==='A').map(naam)).slice(0,50),knoppen:uniek(k.filter(e=>e.tagName!=='A').map(naam)).slice(0,30),velden:uniek(velden().filter(e=>!GEHEIM(e)).map(veldnaam)).slice(0,20)});})()`,
  klik: j => `(()=>{${HULP}
    let e=zoek(klikbaar(),naam,${JSON.stringify(j.tekst)}),los=false;
    if(!e){e=tekstEl(${JSON.stringify(j.tekst)});los=!!e;}   // geen link of knop: dan de tekst zelf op de pagina (menu's zonder knoprol)
    if(!e)return JSON.stringify({fout:'Die tekst staat niet zichtbaar op de pagina.',wel_gevonden:uniek(klikbaar().map(naam)).slice(0,25)});
    const n=los?eigen(e):naam(e),link=e.tagName==='A',verstuurt=(e.tagName==='INPUT'&&e.type==='submit')||(e.tagName==='BUTTON'&&!!e.form&&e.type!=='button'),vrij=!RISICO.test(n)&&!verstuurt;
    if(!vrij&&!${j.bevestigd === true})return JSON.stringify({voorvertoning:true,soort:link?'link':'knop',tekst:n,pagina:location.hostname,let_op:'Nog niet geklikt: dit kan iets versturen of veranderen. Vraag Micha om bevestiging.'});
    druk(e);return JSON.stringify({geklikt:n,soort:los?'tekst':link?'link':'knop'});})()`,
  typ: j => `(()=>{${HULP}
    const v=velden(),t=${JSON.stringify(j.veld || "")};
    let f=t?zoek(v,veldnaam,t):null;
    if(!f&&!t){let a=document.activeElement;while(a&&/^I?FRAME$/.test(a.tagName)){try{a=a.contentDocument.activeElement;}catch(_){break;}}f=(a&&v.includes(a))?a:(v.filter(e=>!GEHEIM(e)).length===1?v.filter(e=>!GEHEIM(e))[0]:null);}
    if(!f)return JSON.stringify({fout:t?'Geen invulveld gevonden met die naam.':'Zeg in welk veld het moet.',velden:uniek(v.filter(e=>!GEHEIM(e)).map(veldnaam)).slice(0,20)});
    if(GEHEIM(f))return JSON.stringify({fout:'Wachtwoorden, codes en betaalgegevens typt Jarvis niet. Dat doet Micha zelf.'});
    const tekst=${JSON.stringify(j.tekst || "")},enter=${j.enter === true};
    const zoekveld=f.type==='search'||f.getAttribute('role')==='searchbox'||/^(q|s|search|query|zoek)/i.test(f.name||'')||/zoek|search/i.test(veldnaam(f))||(f.form&&String(f.form.getAttribute('method')||'get').toLowerCase()==='get'&&f.form.querySelectorAll('input:not([type=hidden]),textarea,select').length<=2);
    if(enter&&!zoekveld&&!${j.bevestigd === true})return JSON.stringify({voorvertoning:true,veld:veldnaam(f),tekst:tekst.slice(0,300),pagina:location.hostname,let_op:'Nog niets ingevuld of verstuurd: met enter gaat dit de deur uit. Vraag Micha om bevestiging.'});
    f.scrollIntoView({block:'center'});f.focus();
    const FW=f.ownerDocument.defaultView;
    if(f.isContentEditable){f.ownerDocument.execCommand('selectAll',false,null);f.ownerDocument.execCommand('insertText',false,tekst);}
    else if(f.tagName==='SELECT'){const o=[...f.options].find(o=>kort(o.text).toLowerCase().includes(tekst.toLowerCase()));if(!o)return JSON.stringify({fout:'Die keuze staat niet in de lijst.',keuzes:[...f.options].map(o=>kort(o.text)).slice(0,30)});f.value=o.value;f.dispatchEvent(new FW.Event('change',{bubbles:true}));}
    else{const set=Object.getOwnPropertyDescriptor(f.tagName==='TEXTAREA'?FW.HTMLTextAreaElement.prototype:FW.HTMLInputElement.prototype,'value').set;set.call(f,tekst);f.dispatchEvent(new FW.Event('input',{bubbles:true}));f.dispatchEvent(new FW.Event('change',{bubbles:true}));}
    if(enter){for(const s of ['keydown','keypress','keyup'])f.dispatchEvent(new FW.KeyboardEvent(s,{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));if(f.form){try{f.form.requestSubmit();}catch(_){}}}
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
// De mail die in de Outlook-app open staat als tekst ophalen: het leesvenster de focus geven, alles selecteren en kopiëren.
// Het klembord van Micha wordt daarna teruggezet (alleen tekst; een gekopieerde afbeelding of bestand gaat verloren).
function pijp(cmd, args, invoer) {
  return new Promise(resolve => { let out = ""; const k = spawn(cmd, args, { env: { ...process.env, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" } }); const t = setTimeout(() => k.kill("SIGKILL"), 3000);   // UTF-8, anders raken letters als ó en ë beschadigd
    k.stdout.on("data", d => { out += d; }); k.on("error", () => { clearTimeout(t); resolve(null); }); k.on("close", () => { clearTimeout(t); resolve(out); });
    if (invoer != null) k.stdin.end(invoer); else k.stdin.end(); });
}
async function outlookLees(max = 9000) {
  const oud = await pijp("pbpaste", []), merk = "jarvis-leest-" + Date.now();
  await pijp("pbcopy", [], merk);
  // Outlook moet voor staan, anders gaan de toetsen naar een ander programma. Daarna klikken we op de onderwerpregel bovenin het leesvenster
  // (geen link, dus veilig) om het de focus te geven.
  await run("open", ["-a", "Microsoft Outlook"], 4000); await wacht(500);
  // Het leesvenster bestaat uit een kop en daaronder de tekst; de opbouw wisselt per mail. We nemen het laatste grote vlak rechts van de berichtenlijst.
  const g = await run("osascript", ["-e", 'tell application "System Events" to tell process "Microsoft Outlook"',
    "-e", "set sg to splitter group 1 of splitter group 1 of splitter group 1 of window 1", "-e", "set n to count of UI elements of sg",
    "-e", "repeat with i from n to 2 by -1", "-e", "set {b, h} to size of UI element i of sg", "-e", "if h > 300 and b > 300 then", "-e", "set {x0, y0} to position of UI element i of sg",
    "-e", 'return (x0 as text) & "," & (y0 as text) & "," & (b as text) & "," & (h as text)', "-e", "end if", "-e", "end repeat", "-e", 'return "niets"', "-e", "end tell"], 7000);
  const m = /^(-?\d+),(-?\d+),(\d+),(\d+)$/.exec(g.out || "");
  let r = g;
  if (g.code === 0 && m && Number(m[3]) > 200) {
    // klikplek: de smalle witte marge links van de mailtekst, halverwege het venster (geen tekst, dus geen link)
    const px = Number(m[1]) + 7, py = Number(m[2]) + Math.round(Number(m[4]) * 0.5);
    await run("osascript", ["-l", "JavaScript", "-e", "ObjC.import('CoreGraphics'); var p={x:" + px + ",y:" + py + "}; var d=$.CGEventCreateMouseEvent(null,$.kCGEventLeftMouseDown,p,$.kCGMouseButtonLeft); $.CGEventPost($.kCGHIDEventTap,d); delay(0.08); var u=$.CGEventCreateMouseEvent(null,$.kCGEventLeftMouseUp,p,$.kCGMouseButtonLeft); $.CGEventPost($.kCGHIDEventTap,u); 'ok'"], 3000);
    await wacht(250);
    r = await run("osascript", ["-e", 'tell application "System Events"', "-e", 'if (name of first process whose frontmost is true) is not "Microsoft Outlook" then error "Outlook staat niet voor"',
      "-e", 'keystroke "a" using command down', "-e", "delay 0.25", "-e", 'keystroke "c" using command down', "-e", "delay 0.4", "-e", "key code 123", "-e", "end tell"], 8000);   // pijltje links heft de selectie op: staat er een concept open, dan zou één toets anders alles overschrijven
  } else if (g.code === 0) r = { code: 1, out: "", err: "Het leesvenster van Outlook is niet gevonden" };
  const nu = await pijp("pbpaste", []);
  if (oud != null) await pijp("pbcopy", [], oud);
  // De kop (onderwerp, afzender, datum) staat in een eigen vlak boven de tekst; die lezen we los uit.
  const kop = "";   // de kop (afzender, datum) los uitlezen lukte niet; staat meestal ook in de tekst van een doorgestuurde of beantwoorde mail
  const gelukt = nu != null && nu !== merk && nu.trim().length > 0;
  if (r.code !== 0 && !gelukt) return { fout: !r.err ? "Outlook reageerde niet op tijd bij het lezen (stap " + (r === g ? "venster zoeken" : "kopiëren") + ")." : /niet gevonden|niet voor/.test(r.err) ? r.err.replace(/^.*?: /, "").slice(0, 120) + "." : uitleg(r.err) };
  if (nu == null || nu === merk || !nu.trim()) return { fout: "De open mail kon niet gekopieerd worden (het leesvenster kreeg de focus niet)." };
  const t = nu.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return { kop: kop || undefined, tekst: t.slice(0, max), ingekort: t.length > max || undefined };
}
// Antwoord klaarzetten op de mail die in de Outlook-app open staat (elk account): menu Bericht > Beantwoorden, de tekst plakken en het venster laten staan.
// Er wordt NIET verzonden: Micha leest het na en verstuurt zelf. Outlook bewaart het vanzelf als concept.
async function outlookAntwoord(tekst) {
  tekst = String(tekst || "").replace(/\r/g, "").trim();
  if (tekst.length < 2) return { fout: "Geef de tekst van het antwoord." };
  await run("open", ["-a", "Microsoft Outlook"], 4000); await wacht(500);
  const a = await run("osascript", ["-e", 'tell application "System Events" to tell process "Microsoft Outlook"',
    "-e", 'click menu item "Beantwoorden" of menu 1 of menu bar item "Bericht" of menu bar 1', "-e", "end tell"], 9000);
  if (a.code !== 0) return { fout: !a.err ? "Outlook reageerde niet op tijd." : /menu item|Beantwoorden|Bericht/i.test(a.err) && !/-25211|assistive|-1002|toetsaanslagen|keystrokes/i.test(a.err) ? "Beantwoorden lukte niet: staat er een mail open in Outlook?" : uitleg(a.err) };
  await wacht(1800);   // het antwoordvenster opent met de cursor bovenaan in de tekst
  const oud = await pijp("pbpaste", []);
  await pijp("pbcopy", [], tekst + "\n\n");
  const v = await run("osascript", ["-e", 'tell application "System Events"', "-e", 'if (name of first process whose frontmost is true) is not "Microsoft Outlook" then error "Outlook staat niet voor"',
    "-e", 'keystroke "v" using command down', "-e", "delay 0.6", "-e", "end tell"], 6000);
  if (oud != null) await pijp("pbcopy", [], oud);
  if (v.code !== 0) return { fout: "Het antwoordvenster is geopend, maar de tekst plakken lukte niet" + (v.err ? " (" + v.err.replace(/^.*?: /, "").slice(0, 100) + ")" : "") + "." };
  return { antwoord_klaar: true, niet_verstuurd: true, waar: "een antwoordvenster in de Outlook-app, vanuit het account waar de mail in staat", tekens: tekst.length,
    let_op: "Zeg dat het antwoord klaarstaat in Outlook en dat Micha het zelf naleest en verstuurt. Of de tekst goed in het venster staat, kun je niet zien." };
}
async function outlook(zoek) {
  if (zoek === "#lees") { const l = await outlookLees(); return l.fout ? l : { outlook: "open mail gelezen", ...l, let_op: "Dit is de mail die nu in de Outlook-app open staat." }; }
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
  await wacht(Math.max(1500, Math.min(3600, 14500 - (Date.now() - t0) - 2500)));   // ruim wachten: te vroeg klikken pakt nog het resultaat van de vorige zoekopdracht
  const p = await run("osascript", [...ZOEKRIJ, "-e", "on run", "-e", 'tell application "System Events" to set w to window 1 of process "Microsoft Outlook"', "-e", "set p to my zoekRij(w)", "-e", 'if p is missing value then return "niets"', "-e", 'return ((item 1 of p) as text) & "," & ((item 2 of p) as text)', "-e", "end run"], 4000);
  const m = /^(\d+),(\d+)$/.exec(p.out || "");
  if (!m) waarom = p.code !== 0 ? "de berichtenlijst is niet gevonden" : "er staat geen bericht in de zoekresultaten";
  else {
    const k = await run("osascript", ["-l", "JavaScript", "-e", "ObjC.import('CoreGraphics'); var p={x:" + Number(m[1]) + ",y:" + Number(m[2]) + "}; var d=$.CGEventCreateMouseEvent(null,$.kCGEventLeftMouseDown,p,$.kCGMouseButtonLeft); $.CGEventPost($.kCGHIDEventTap,d); delay(0.08); var u=$.CGEventCreateMouseEvent(null,$.kCGEventLeftMouseUp,p,$.kCGMouseButtonLeft); $.CGEventPost($.kCGHIDEventTap,u); 'ok'"], 3000);
    klik = k.code === 0; if (!klik) waarom = "de muisklik is geweigerd (" + (k.err || "geen melding").slice(0, 100) + ")";
  }
  let gelezen = null;
  // Na het openen meteen lezen: klik in de marge van het leesvenster, alles selecteren, kopiëren (werkt sinds 25 november 15:40).
  if (klik && Date.now() - t0 < 13000) { await wacht(1200); gelezen = await outlookLees(); }
  if (gelezen && gelezen.tekst) return { outlook: "mail geopend en gelezen", gezocht_op: zoek, tekst: gelezen.tekst, ingekort: gelezen.ingekort, let_op: "Dit is het bovenste zoekresultaat in de Outlook-app (alle postvakken). Controleer aan afzender en datum in de tekst of het de bedoelde mail is." };
  return { outlook: "naar voren gehaald", gezocht_op: zoek, bovenste_resultaat_aangeklikt: klik, waarom_niet: waarom, niet_gelezen: gelezen && gelezen.fout ? gelezen.fout : undefined,
    let_op: klik ? "Het bovenste zoekresultaat is aangeklikt. Zeg wat je gezocht hebt; of het de juiste mail is, kun je niet zien." : "De zoekresultaten staan in beeld, maar de mail zelf is niet geopend. Zeg dat Micha de mail in de lijst aanklikt." };
}

// Tabbladen van het doelvenster: id's opvragen, en een tabblad naar voren halen (op id, of op webadres in welk venster dan ook).
async function tabIds() {
  const r = await run("osascript", [...DOEL, "-e", "on run", "-e", "set w to doel()", "-e", CHROME, "-e", "set AppleScript's text item delimiters to \",\"", "-e", "return (id of tabs of w) as text", "-e", "end tell", "-e", "end run"], 5000);
  return r.code === 0 ? r.out.split(",").map(x => x.trim()).filter(Boolean) : null;
}
async function tabVoor(id) {
  const r = await run("osascript", [...DOEL, "-e", "on run a", "-e", "set w to doel()", "-e", CHROME, "-e", "repeat with i from 1 to count of tabs of w", "-e", "if ((id of tab i of w) as text) is (item 1 of a) then", "-e", "set active tab index of w to i", "-e", "return \"ok\"", "-e", "end if", "-e", "end repeat", "-e", "end tell", "-e", "return \"nee\"", "-e", "end run", String(id)], 5000);
  return r.code === 0 && r.out === "ok";
}
// Nieuw tabblad na een klik (bijv. een PDF of loonstrook) naar een eigen, nieuw Chrome-venster verplaatsen (wens Micha, 26 november).
// Lukt het verplaatsen niet, dan wordt het lege venster weer gesloten en blijft het tabblad waar het was. Uit met JARVIS_TAB_VENSTER=0.
async function tabNaarVenster(id) {
  if (process.env.JARVIS_TAB_VENSTER === "0") return false;
  const r = await run("osascript", [...DOEL, "-e", "on run a", "-e", "set w to doel()", "-e", CHROME,
    "-e", "repeat with i from 1 to count of tabs of w", "-e", "if ((id of tab i of w) as text) is (item 1 of a) then",
    "-e", "if (count of tabs of w) < 2 then return \"nee\"",
    "-e", "set t to tab i of w", "-e", "set nw to make new window", "-e", "set leeg to id of active tab of nw",
    "-e", "try", "-e", "move t to end of tabs of nw", "-e", "on error", "-e", "close nw", "-e", "return \"nee\"", "-e", "end try",
    "-e", "repeat with x in (tabs of nw)", "-e", "if (id of x) is leeg then close x", "-e", "end repeat",
    "-e", "set index of nw to 1", "-e", "return \"ok\"", "-e", "end if", "-e", "end repeat", "-e", "end tell", "-e", "return \"nee\"", "-e", "end run", String(id)], 8000);
  return r.code === 0 && r.out === "ok";
}
async function tabMetAdres(href) {   // staat dit adres al open? dan dat tabblad naar voren in plaats van opnieuw laden
  const r = await run("osascript", ["-e", "on run a", "-e", CHROME, "-e", "repeat with w in windows", "-e", "repeat with i from 1 to count of tabs of w", "-e", "if (URL of tab i of w) starts with (item 1 of a) then", "-e", "set active tab index of w to i", "-e", "set index of w to 1", "-e", "return \"ok\"", "-e", "end if", "-e", "end repeat", "-e", "end repeat", "-e", "end tell", "-e", "return \"nee\"", "-e", "end run", href], 6000);
  return r.code === 0 && r.out === "ok";
}

// Doel: hooguit 22 kB JPEG (base64 ruim 29 kB), zodat het beeld ook door een doorgifte met 32 kB-grens past. Lukt dat niet, dan gaat de kleinste versie mee.
const SCHERM_DOEL = 22000;
const SCHERM_STAPPEN = (z) => [[z, 50], [Math.min(z, 1200), 40], [1000, 32], [900, 26], [800, 22], [700, 18], [600, 15]];
// Schermafbeelding van het hoofdscherm (alles wat er staat, ook RDP/Citrix): screencapture, verkleinen met sips, afleveren bij de Worker.
// Vraagt eenmalig Schermopname voor node in de systeeminstellingen; zonder die toestemming toont macOS alleen bureaublad en menubalk.
// Eén venster in plaats van het hele scherm (27 november): het venster van een programma naar voren halen, zo groot als het scherm maken,
// eventueel inzoomen (cmd +), alleen dat venster vastleggen en daarna alles terugzetten (zoom, maat, plek en het programma dat voor stond).
// Het terugzetten gebeurt hier in een finally, niet door het taalmodel. Wachtwoordprogramma's worden nooit vastgelegd.
const GEHEIM_APP = /^(strongbox|wachtwoorden|passwords|sleutelhangertoegang|keychain access|1password.*|bitwarden|keepassxc)$/i;
const DELEN = { linksboven: [0, 0, .5, .5], rechtsboven: [.5, 0, .5, .5], linksonder: [0, .5, .5, .5], rechtsonder: [.5, .5, .5, .5], boven: [0, 0, 1, .5], onder: [0, .5, 1, .5], links: [0, 0, .5, 1], rechts: [.5, 0, .5, 1] };
// Het vak (x, y, breed, hoog in schermpunten) dat vastgelegd wordt: het hele venster of een deel ervan.
function schermVak(v, deel) {
  const d = DELEN[deel] || [0, 0, 1, 1];
  return [Math.round(v.x + v.b * d[0]), Math.round(v.y + v.h * d[1]), Math.max(1, Math.round(v.b * d[2])), Math.max(1, Math.round(v.h * d[3]))];
}
const OSA = "/usr/bin/osascript", SE = 'tell application "System Events"';
async function vensterKlaar(job) {
  const naam = String(job.app || ""), zoom = Math.min(Math.max(Math.round(Number(job.zoom) || 0), 0), 3);
  if (naam && !/^[\p{L}\p{N}][\p{L}\p{N} ._+&-]*$/u.test(naam)) return { fout: "Geen geldige programmanaam." };
  // stap 1: alleen kijken (programma naar voren, plek en maat van het voorste venster); nog niets veranderd
  const a = await run(OSA, ["-e", "on run a", "-e", "set naam to item 1 of a", "-e", SE,
    "-e", "set vorig to name of (first application process whose frontmost is true)",
    "-e", 'if naam is "" then', "-e", "set p to first application process whose frontmost is true", "-e", "else",
    "-e", "if not (exists application process naam) then", "-e", 'set AppleScript\'s text item delimiters to ", "',
    "-e", 'error "NIETOPEN " & ((name of every application process whose background only is false) as text) number 9001', "-e", "end if",
    "-e", "set p to application process naam", "-e", "set frontmost of p to true", "-e", "delay 0.5", "-e", "end if",
    "-e", 'if (count of windows of p) is 0 then error "GEENVENSTER" number 9002', "-e", "set w to window 1 of p",
    "-e", "set {x0, y0} to position of w", "-e", "set {b0, h0} to size of w",
    "-e", 'return (name of p) & tab & vorig & tab & x0 & tab & y0 & tab & b0 & tab & h0', "-e", "end tell", "-e", "end run", naam], 8000);
  if (a.code !== 0) {
    const open = (a.err.match(/NIETOPEN (.*?)(?: \(-?\d+\))?$/) || [])[1];
    if (open != null) return { fout: "Dat programma staat niet open onder die naam.", open_programmas: open.split(", ").filter(x => x && !GEHEIM_APP.test(x)).slice(0, 30) };
    if (/GEENVENSTER/.test(a.err)) return { fout: "Dat programma heeft geen venster open." };
    return { fout: a.err ? uitleg(a.err).replace(/^Chrome gaf een fout/, "Het venster zoeken gaf een fout") : "Het venster zoeken duurde te lang." };
  }
  const [prog, vorig, x0, y0, b0, h0] = a.out.split("\t"), begin = { x: +x0, y: +y0, b: +b0, h: +h0 };
  const stand = { prog, vorig, begin, zoom: 0, vergroot: false, nu: begin };
  if (GEHEIM_APP.test(prog.trim())) { await vensterTerug(stand); return { fout: "Van een wachtwoordprogramma maakt Jarvis geen opname." }; }
  if (![begin.x, begin.y, begin.b, begin.h].every(Number.isFinite) || begin.b < 50 || begin.h < 50) { await vensterTerug(stand); return { fout: "De maat van het venster is niet te lezen." }; }
  // stap 2: vergroten tot het hele hoofdscherm en inzoomen; lukt vergroten niet (schermvullend venster), dan blijft het zoals het is
  let scherm = null;
  if (job.groot !== false) {
    const m = await run(OSA, ["-l", "JavaScript", "-e", 'ObjC.import("AppKit"); var f = $.NSScreen.mainScreen.frame; Math.round(f.size.width) + " " + Math.round(f.size.height)'], 6000);
    const [sb, sh] = m.out.split(" ").map(Number); if (m.code === 0 && sb > 400 && sh > 300) scherm = sb + ";" + (sh - 25);
  }
  stand.zoom = zoom; stand.vergroot = !!scherm;   // vanaf hier altijd terugzetten, ook als de stap halverwege misgaat
  const b = await run(OSA, ["-e", "on run a", "-e", 'set AppleScript\'s text item delimiters to ";"', "-e", SE, "-e", "set p to application process (item 1 of a)", "-e", "set w to window 1 of p",
    "-e", 'if (item 2 of a) is not "" then', "-e", "try", "-e", "set m to text items of (item 2 of a)", "-e", "set position of w to {0, 25}",
    "-e", "set size of w to {(item 1 of m) as integer, (item 2 of m) as integer}", "-e", "delay 0.6", "-e", "end try", "-e", "end if",
    "-e", "repeat (item 3 of a) as integer times", "-e", 'keystroke "+" using command down', "-e", "delay 0.3", "-e", "end repeat", "-e", "delay 0.5",
    "-e", "set {x1, y1} to position of w", "-e", "set {b1, h1} to size of w", "-e", 'return "" & x1 & tab & y1 & tab & b1 & tab & h1', "-e", "end tell", "-e", "end run", prog, scherm || "", String(zoom)], 9000);
  const n = b.out.split("\t").map(Number);
  if (b.code !== 0 || n.length !== 4 || !n.every(Number.isFinite)) { await vensterTerug(stand); return { fout: b.err ? uitleg(b.err).replace(/^Chrome gaf een fout/, "Het venster vergroten gaf een fout") : "Het venster vergroten duurde te lang." }; }
  stand.nu = { x: n[0], y: n[1], b: n[2], h: n[3] };
  stand.vergroot = !!scherm && (stand.nu.b !== begin.b || stand.nu.h !== begin.h || stand.nu.x !== begin.x || stand.nu.y !== begin.y);
  return stand;
}
// Alles terug: uitzoomen (zelfde aantal stappen), maat en plek van het venster, en het programma dat voor stond weer naar voren.
async function vensterTerug(st) {
  const g = st.begin, r = await run(OSA, ["-e", "on run a", "-e", 'set AppleScript\'s text item delimiters to ";"', "-e", "set m to text items of (text 2 thru -1 of (item 3 of a))", "-e", SE,
    "-e", "set p to application process (item 1 of a)",
    "-e", "if ((item 2 of a) as integer) > 0 then", "-e", "set frontmost of p to true", "-e", "delay 0.3", "-e", "repeat (item 2 of a) as integer times", "-e", 'keystroke "-" using command down', "-e", "delay 0.25", "-e", "end repeat", "-e", "end if",
    "-e", 'if (item 4 of a) is "1" then', "-e", "set w to window 1 of p", "-e", "set size of w to {(item 3 of m) as integer, (item 4 of m) as integer}",
    "-e", "set position of w to {(item 1 of m) as integer, (item 2 of m) as integer}", "-e", "end if",
    "-e", "if (item 5 of a) is not (item 1 of a) then", "-e", "try", "-e", "set frontmost of application process (item 5 of a) to true", "-e", "end try", "-e", "end if",
    "-e", "end tell", "-e", 'return "ok"', "-e", "end run", st.prog, String(st.zoom), "p" + [g.x, g.y, g.b, g.h].join(";"), st.vergroot ? "1" : "0", st.vorig], 8000);
  return r.code === 0;
}
async function scherm(job, key) {
  const id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36), ruw = path.join(os.tmpdir(), "jarvis-scherm-" + id + ".jpg"), klein = ruw.replace(".jpg", "-k.jpg");
  let st = null, terug = null;
  try {
    if (job.venster) { st = await vensterKlaar(job); if (st.fout) { const f = st; st = null; return f; } }
    const c = await run("/usr/sbin/screencapture", ["-x", ...(st ? ["-R", schermVak(st.nu, job.deel).join(",")] : []), "-t", "jpg", ruw], 10000);   // vol pad: de brug draait als launchd-dienst zonder /usr/sbin in PATH
    if (st) { terug = await vensterTerug(st); const klaar = st; st = null; job = { ...job, _v: klaar }; }   // meteen terugzetten, vóór het verkleinen en afleveren
    if (/ENOENT/.test(c.err)) return { fout: "Het programma screencapture is niet gevonden op de Mac (/usr/sbin/screencapture)." };
    if (c.code !== 0 || !fs.existsSync(ruw) || !fs.statSync(ruw).size) return { fout: "Schermafbeelding maken mislukt" + (c.err ? " (" + c.err.slice(0, 120) + ")" : "") + ". Zet aan: Systeeminstellingen > Privacy en beveiliging > Schermopname > node (of Terminal)." };
    let buf = null, zijde = Number(job.breed) || 1440;
    for (const [z, q] of SCHERM_STAPPEN(zijde)) {   // steeds kleiner en lager tot hij onder SCHERM_DOEL zit
      const s = await run("/usr/bin/sips", ["-Z", String(z), "-s", "format", "jpeg", "-s", "formatOptions", String(q), ruw, "--out", klein], 10000);
      if (s.code !== 0 || !fs.existsSync(klein)) return { fout: "Verkleinen van de schermafbeelding mislukt." };
      buf = fs.readFileSync(klein); zijde = z;
      if (buf.length <= SCHERM_DOEL) break;
    }
    if (buf.length > 1000000) return { fout: "De schermafbeelding blijft te groot om door te geven (" + Math.round(buf.length / 1024) + " kB)." };
    const r = await fetch(WORKER + "/brug/scherm", { method: "POST", headers: { "x-brug-key": key, "Content-Type": "application/json" }, body: JSON.stringify({ id, mime: "image/jpeg", beeld: buf.toString("base64") }), signal: AbortSignal.timeout(15000) });
    if (!r.ok) return { fout: "De Worker nam de schermafbeelding niet aan (" + r.status + ")." };
    const v = job._v;
    return { afgeleverd: id, breedte: zijde, kb: Math.round(buf.length / 1024), ...(v ? { programma: v.prog, vergroot: v.vergroot, zoom: v.zoom, ...(DELEN[job.deel] ? { deel: job.deel } : {}), teruggezet: terug === true } : {}) };
  } catch (e) { return { fout: "Schermafbeelding doorgeven mislukt: " + String((e && e.message) || e).slice(0, 120) }; }
  finally { if (st) await vensterTerug(st); for (const f of [ruw, klein]) { try { fs.unlinkSync(f); } catch {} } }
}

async function chrome(job, key) {
  if (job.actie === "scherm") return scherm(job, key);
  if (job.actie === "app") return appOpen(String(job.naam || ""));
  if (job.actie === "typ" && String(job.veld || "") === "#outlook-antwoord") return outlookAntwoord(job.tekst);   // via 'typ' omdat de Worker daar lange tekst doorlaat
  if (job.actie === "outlook") return outlook(String(job.zoek || "").trim().slice(0, 120));
  if (job.browser === "safari") return safari(job);
  if (job.actie === "tabs") {
    const r = await run("osascript", ["-e", CHROME, "-e", 'set uit to ""', "-e", "repeat with w in windows", "-e", "repeat with t in tabs of w", "-e", 'set uit to uit & (title of t) & "\t" & (URL of t) & "\n"', "-e", "end repeat", "-e", "end repeat", "-e", "return uit", "-e", "end tell"]);
    if (r.code !== 0) return { fout: uitleg(r.err) };
    return { tabs: r.out.split("\n").filter(Boolean).slice(0, 40).map(l => { const [titel, url] = l.split("\t"); return { titel: (titel || "").slice(0, 100), url: (url || "").slice(0, 200) }; }) };
  }
  if (job.actie === "ga") {
    let u; try { u = new URL(job.url); } catch { u = null; }
    if (!u || !/^https?:$/.test(u.protocol)) return { fout: "Dit adres wordt niet geopend." };
    if (!u.href.startsWith("https://claude.ai") && await tabMetAdres(u.href.replace(/[#?].*$/, "").replace(/\/$/, ""))) { await wacht(400); const w = await js(SCRIPTS.waar()); return { tabblad_naar_voren: true, ...(w.fout ? {} : w) }; }
    const r = await run("osascript", [...DOEL, "-e", "on run a", "-e", "set w to doel()", "-e", CHROME + " to set URL of active tab of w to (item 1 of a)", "-e", "end run", u.href]);
    if (r.code !== 0) return { fout: uitleg(r.err) };
    await wacht(2500); const w = await js(SCRIPTS.waar()); return { gegaan_naar: u.href, ...(w.fout ? {} : w) };
  }
  if (!SCRIPTS[job.actie] || job.actie === "waar") return { fout: "Onbekende actie." };
  const voor = job.actie === "klik" ? await tabIds() : null;
  const r = await js(SCRIPTS[job.actie](job));
  if (r.fout || r.voorvertoning || job.actie === "lees" || job.actie === "scroll") return r;
  await wacht(job.actie === "typ" && !job.enter ? 300 : 2200);   // de pagina laten reageren en melden waar we nu staan
  let nieuwTab = false, eigenVenster = false;
  if (voor) {   // opende de klik een nieuw tabblad? dan naar een eigen venster (of anders naar voren), anders leest Jarvis daarna de oude pagina
    const na = await tabIds(), bij = na ? na.filter(x => !voor.includes(x)) : [], id = bij[bij.length - 1];
    if (id && await tabNaarVenster(id)) { nieuwTab = eigenVenster = true; await wacht(900); }
    else if (id && await tabVoor(id)) { nieuwTab = true; await wacht(900); }
  }
  const w = await js(SCRIPTS.waar()); return { ...r, ...(nieuwTab ? { nieuw_tabblad: true } : {}), ...(eigenVenster ? { eigen_venster: true } : {}), nu: w.fout ? undefined : w };
}

// Eén eigen Jarvis-venster in Chrome (wens Micha, 28 november): elk geopend webadres (ook favorieten) komt als nieuw tabblad in dat venster.
// Het venster-id staat in een klein bestand; is dat venster weg (of Chrome herstart), dan komt er een nieuw venster en wordt dat het Jarvis-venster.
// Uit met JARVIS_EIGEN_VENSTER=0 (dan weer elk adres een nieuw venster). Lukt het script niet, dan ook de oude manier.
const VENSTER_BESTAND = process.env.JARVIS_VENSTER_BESTAND || path.join(os.homedir(), ".jarvis-chrome-venster");
function leesVenster() { try { const v = fs.readFileSync(VENSTER_BESTAND, "utf8").trim(); return /^\d{1,12}$/.test(v) ? v : ""; } catch { return ""; } }
function bewaarVenster(id) { try { if (/^\d{1,12}$/.test(String(id))) fs.writeFileSync(VENSTER_BESTAND, String(id)); } catch {} }
const EIGEN_VENSTER = ["-e", "on run a", "-e", CHROME, "-e", "set u to item 1 of a", "-e", "set oud to item 2 of a", "-e", "set w to missing value",
  "-e", "if oud is not \"\" then", "-e", "repeat with x in windows", "-e", "if ((id of x) as text) is oud then set w to contents of x", "-e", "end repeat", "-e", "end if",
  "-e", "if w is missing value then", "-e", "set w to make new window", "-e", "set URL of active tab of w to u", "-e", "set uit to \"venster\"",
  "-e", "else", "-e", "tell w to make new tab at end of tabs with properties {URL:u}", "-e", "set active tab index of w to (count of tabs of w)", "-e", "set uit to \"tabblad\"", "-e", "end if",
  "-e", "set index of w to 1", "-e", "activate", "-e", "return uit & \",\" & ((id of w) as text)", "-e", "end tell", "-e", "end run"];
// Uitkomst van het script lezen: "tabblad,1234" of "venster,1234" → { soort, id }; anders null.
function vensterUitkomst(out) { const m = /^(tabblad|venster),(\d{1,12})$/.exec(String(out || "").trim()); return m ? { soort: m[1], id: m[2] } : null; }
async function openInJarvisVenster(href) {
  if (process.env.JARVIS_EIGEN_VENSTER === "0") return null;
  const r = await run("/usr/bin/osascript", [...EIGEN_VENSTER, href, leesVenster()], 10000);
  const u = r.code === 0 ? vensterUitkomst(r.out) : null;
  if (u) bewaarVenster(u.id);
  return u;
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
  if (d.job) { console.log(JSON.stringify(await chrome(d.job, key))); process.exit(0); }
  let u; try { u = new URL(d.url); } catch { u = null; }
  if (!u || !/^https?:$/.test(u.protocol)) { console.log("Dit adres wordt niet geopend."); process.exit(1); }
  const eigen = await openInJarvisVenster(u.href);
  if (eigen) { console.log((eigen.soort === "tabblad" ? "Geopend als tabblad in het Jarvis-venster: " : "Geopend in een nieuw Jarvis-venster: ") + u.hostname); process.exit(0); }
  const r = await run("open", ["-na", "Google Chrome", "--args", "--new-window", u.href]);
  console.log(r.code === 0 ? "Geopend in Chrome: " + u.hostname : "Chrome starten mislukt: " + (r.err || "foutcode " + r.code)); process.exit(r.code || 0);
}
export { SDOEL, safari, schermVak, DELEN, GEHEIM_APP, EIGEN_VENSTER, vensterUitkomst };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
