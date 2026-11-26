#!/usr/bin/env node
// Werkopname op de Mac, voor het zoeken naar herhaald werk dat geautomatiseerd kan worden.
// Vaste opdrachten van de brug: opname-start, opname-stop, opname-status (node opname.mjs start|stop|status).
// De tijdlijn (tijdlijn.txt, één JSON-regel per moment) is .txt zodat Jarvis hem via mappen_lezen kan lezen.
// Tijdens een opname legt een achtergrondproces elke INTERVAL seconden vast: het programma en de venstertitel die
// voor staan, plus een verkleinde schermafbeelding. Alles blijft op de Mac in ~/Documents/jarvis-opnames/<start>/.
// Geen toetsaanslagen, geen geluid. Stopt vanzelf na MAX_UUR. Bij stoppen komt er een samenvatting.json bij,
// en maakt ffmpeg (als die op de Mac staat) op de achtergrond een versnelde video.mp4 uit de beelden (2 beelden per seconde).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const MAP = process.env.JARVIS_OPNAMES || path.join(os.homedir(), "Documents/jarvis-opnames");
const STAAT = path.join(MAP, "lopend.json");
const INTERVAL = Math.min(Math.max(Number(process.env.JARVIS_OPNAME_SEC) || 20, 5), 300);
const MAX_UUR = 4;
const wacht = ms => new Promise(r => setTimeout(r, ms));
const zeg = o => { console.log(JSON.stringify(o)); };

function leesStaat() { try { return JSON.parse(fs.readFileSync(STAAT, "utf8")); } catch { return null; } }
function leeft(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
function stempel(d = new Date()) { const p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`; }

function voorgrond() {
  const r = spawnSync("/usr/bin/osascript", ["-e", 'tell application "System Events"', "-e", "set p to first process whose frontmost is true",
    "-e", "set n to name of p", "-e", 'set t to ""', "-e", "try", "-e", "set t to name of front window of p", "-e", "end try", "-e", "end tell",
    "-e", 'return n & (character id 9) & t'], { encoding: "utf8", timeout: 5000 });
  const [app = "", titel = ""] = String(r.stdout || "").replace(/\n$/, "").split("\t");
  return { app: app.slice(0, 80), titel: titel.slice(0, 200) };
}
// Wachtwoordbeheerders: geen schermbeeld en geen venstertitel, alleen 'verborgen' in de tijdlijn (keuze Micha, 26 november).
const VERBORGEN = /^(strongbox|wachtwoorden|passwords|sleutelhangertoegang|keychain access|1password.*|bitwarden|keepassxc)$/i;
const verborgen = app => VERBORGEN.test(String(app || "").trim());
function beeld(map, nr) {
  // screencapture en sips mogen niet in ~/Documents schrijven (macOS-bescherming); node wel. Dus eerst in de tijdelijke map.
  const tmp = path.join(os.tmpdir(), `jarvis-opname-${process.pid}-${nr}`), ruw = tmp + "-ruw.jpg", klein = tmp + ".jpg", uit = path.join(map, `${String(nr).padStart(5, "0")}.jpg`);
  const c = spawnSync("/usr/sbin/screencapture", ["-x", "-t", "jpg", ruw], { timeout: 10000, encoding: "utf8" });
  if (c.status !== 0 || !fs.existsSync(ruw)) return { fout: String(c.stderr || (c.error && c.error.message) || ("code " + c.status)).trim().slice(0, 160) };
  spawnSync("/usr/bin/sips", ["-Z", "1600", "-s", "format", "jpeg", "-s", "formatOptions", "45", ruw, "--out", klein], { timeout: 10000 });
  let fout = null;
  try { fs.copyFileSync(fs.existsSync(klein) ? klein : ruw, uit); } catch (e) { fout = "opslaan mislukt: " + String(e.message).slice(0, 120); }
  for (const f of [ruw, klein]) { try { fs.unlinkSync(f); } catch {} }
  return fout ? { fout } : { naam: path.basename(uit) };
}

// De opname draait als eigen launchd-taak (launchctl submit), net als de brug: alleen dan rekent macOS de schermopname
// toe aan node, dat de toestemming heeft. Een los (detached) proces kreeg geen beelden. submit herstart een taak die stopt,
// daarom stopt een lus die zijn map al afgerond ziet direct, en haalt hij zichzelf aan het eind weg.
const LABEL = "nl.triplet-it.jarvis-opname";
const launchctl = (...a) => spawnSync("/bin/launchctl", a, { encoding: "utf8", timeout: 5000 });
function taakLoopt() { return launchctl("list", LABEL).status === 0; }
async function lus(map) {
  if (!map || fs.existsSync(path.join(map, "stop")) || fs.existsSync(path.join(map, "samenvatting.json"))) { launchctl("remove", LABEL); return; }
  const eind = Date.now() + MAX_UUR * 3600000, log = path.join(map, "tijdlijn.txt");
  let nr = 0;
  while (Date.now() < eind && !fs.existsSync(path.join(map, "stop"))) {
    nr++;
    const v = voorgrond(), geheim = verborgen(v.app), b = geheim ? {} : beeld(map, nr);
    if (geheim) v.titel = "";
    fs.appendFileSync(log, JSON.stringify({ t: new Date().toISOString(), ...v, beeld: b.naam || null, ...(geheim ? { verborgen: true } : {}), ...(b.fout ? { beeld_fout: b.fout } : {}) }) + "\n");
    for (let i = 0; i < INTERVAL * 2 && !fs.existsSync(path.join(map, "stop")); i++) await wacht(500);
  }
  samenvatting(map);
  try { const s = leesStaat(); if (s && s.map === map) fs.unlinkSync(STAAT); } catch {}
  launchctl("remove", LABEL);
}

function samenvatting(map) {
  let regels = [];
  try { regels = fs.readFileSync(path.join(map, "tijdlijn.txt"), "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l)); } catch { regels = []; }
  const perApp = {}, perVenster = {};
  regels.forEach((r, i) => {
    const volgende = regels[i + 1] ? Date.parse(regels[i + 1].t) : Date.parse(r.t) + INTERVAL * 1000;
    const sec = Math.max(0, Math.min((volgende - Date.parse(r.t)) / 1000, INTERVAL * 3));
    perApp[r.app] = (perApp[r.app] || 0) + sec;
    const k = r.app + " — " + r.titel; perVenster[k] = (perVenster[k] || 0) + sec;
  });
  const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([naam, s]) => ({ naam, minuten: Math.round(s / 6) / 10 }));
  // wissels tussen programma's: veel heen-en-weer tussen dezelfde twee is vaak overtypwerk
  const wissels = {};
  for (let i = 1; i < regels.length; i++) if (regels[i].app !== regels[i - 1].app) { const k = regels[i - 1].app + " → " + regels[i].app; wissels[k] = (wissels[k] || 0) + 1; }
  const s = { van: regels[0] && regels[0].t, tot: regels.length ? regels[regels.length - 1].t : null, momenten: regels.length, interval_sec: INTERVAL,
    beelden: regels.filter(r => r.beeld).length, verborgen: regels.filter(r => r.verborgen).length, ...(regels.some(r => r.beeld_fout) ? { beeld_fout: regels.find(r => r.beeld_fout).beeld_fout } : {}),
    per_programma: top(perApp, 15), per_venster: top(perVenster, 25),
    wissels: Object.entries(wissels).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([van_naar, keer]) => ({ van_naar, keer })) };
  fs.writeFileSync(path.join(map, "samenvatting.json"), JSON.stringify(s, null, 2));
  return s;
}

// Versnelde video uit de losse beelden (keuze Micha, 26 november: ffmpeg, klein bestand). Draait als eigen launchd-taak,
// want de brug geeft een opdracht maar 20 seconden. Kopie via de tijdelijke map: ffmpeg mag niet in ~/Documents lezen of schrijven.
const VIDEO_LABEL = LABEL + ".video";
const FPS = 2;
function ffmpegPad() { return [process.env.JARVIS_FFMPEG, "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"].find(p => p && fs.existsSync(p)) || null; }
function videoStaat(map) {
  try { return JSON.parse(fs.readFileSync(path.join(map, "video.json"), "utf8")); } catch {}
  return fs.existsSync(path.join(map, "video.mp4")) ? { klaar: true, bestand: path.join(map, "video.mp4") } : null;
}
export function maakVideo(map, ffmpeg = ffmpegPad()) {
  const meld = o => { fs.writeFileSync(path.join(map, "video.json"), JSON.stringify({ ...o, op: new Date().toISOString() })); return o; };
  if (!ffmpeg) return meld({ fout: "ffmpeg niet gevonden (brew install ffmpeg)." });
  const beelden = fs.readdirSync(map).filter(f => /^\d{5}\.jpg$/.test(f)).sort();
  if (!beelden.length) return meld({ fout: "Geen beelden in deze opname." });
  meld({ bezig: true, beelden: beelden.length });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-video-"));
  try {
    // doorlopend nummeren: verborgen momenten hebben geen beeld, ffmpeg wil een ononderbroken reeks
    beelden.forEach((f, i) => fs.copyFileSync(path.join(map, f), path.join(tmp, String(i + 1).padStart(5, "0") + ".jpg")));
    const r = spawnSync(ffmpeg, ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(tmp, "%05d.jpg"),
      "-vf", "scale=1280:-2,format=yuv420p", "-c:v", "libx264", "-crf", "30", "-movflags", "+faststart", path.join(tmp, "video.mp4")],
      { encoding: "utf8", timeout: 30 * 60000 });
    if (r.status !== 0 || !fs.existsSync(path.join(tmp, "video.mp4"))) return meld({ fout: "ffmpeg: " + String(r.stderr || (r.error && r.error.message) || r.status).trim().slice(0, 200) });
    fs.copyFileSync(path.join(tmp, "video.mp4"), path.join(map, "video.mp4"));
    const mb = Math.round(fs.statSync(path.join(map, "video.mp4")).size / 1e5) / 10;
    return meld({ klaar: true, bestand: path.join(map, "video.mp4"), beelden: beelden.length, seconden: Math.round(beelden.length / FPS), mb });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
function startVideo(map) {
  if (!ffmpegPad()) return { video: "niet gemaakt: ffmpeg staat niet op de Mac (brew install ffmpeg)" };
  launchctl("remove", VIDEO_LABEL);
  const sub = launchctl("submit", "-l", VIDEO_LABEL, "--", process.execPath, fileURLToPath(import.meta.url), "maakvideo", map);
  if (sub.status !== 0) spawn(process.execPath, [fileURLToPath(import.meta.url), "maakvideo", map], { detached: true, stdio: "ignore" }).unref();
  return { video: "wordt gemaakt (versneld, " + FPS + " beelden per seconde); opname-status meldt wanneer hij klaar is" };
}
function laatsteMap() {
  try { return fs.readdirSync(MAP).filter(d => /^\d{4}-\d\d-\d\d_\d{4}$/.test(d)).sort().map(d => path.join(MAP, d)).pop() || null; } catch { return null; }
}

const [, , cmd, arg] = process.argv;
const alsProgramma = !!process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);   // niet bij import (test)
if (alsProgramma) {
fs.mkdirSync(MAP, { recursive: true });
if (cmd === "lus") { await lus(arg); process.exit(0); }
if (cmd === "maakvideo") { if (arg) maakVideo(arg); launchctl("remove", VIDEO_LABEL); process.exit(0); }
const s = leesStaat(), loopt = !!(s && (s.label ? taakLoopt() : leeft(s.pid)));
if (cmd === "start") {
  if (loopt) { zeg({ al_bezig: true, sinds: s.sinds, map: s.map }); process.exit(0); }
  const map = path.join(MAP, stempel()); fs.mkdirSync(map, { recursive: true });
  launchctl("remove", LABEL);   // restje van een vorige opname
  const sub = launchctl("submit", "-l", LABEL, "--", process.execPath, fileURLToPath(import.meta.url), "lus", map);
  if (sub.status === 0) fs.writeFileSync(STAAT, JSON.stringify({ label: LABEL, sinds: new Date().toISOString(), map }));
  else {   // geen launchd (of submit geweigerd): los proces, dan wel zonder zekerheid over beelden
    const k = spawn(process.execPath, [fileURLToPath(import.meta.url), "lus", map], { detached: true, stdio: "ignore" });
    k.unref();
    fs.writeFileSync(STAAT, JSON.stringify({ pid: k.pid, sinds: new Date().toISOString(), map }));
  }
  zeg({ gestart: true, map, elke_seconden: INTERVAL, stopt_uiterlijk_na_uur: MAX_UUR, let_op: "Alles blijft op de Mac. Geen toetsaanslagen of geluid." });
} else if (cmd === "stop") {
  if (!s) { zeg({ fout: "Er loopt geen opname." }); process.exit(0); }
  fs.writeFileSync(path.join(s.map, "stop"), "");
  if (s.label) { for (let i = 0; i < 20 && !fs.existsSync(path.join(s.map, "samenvatting.json")); i++) await wacht(500); launchctl("remove", LABEL); }
  else { for (let i = 0; i < 20 && leeft(s.pid); i++) await wacht(500); if (leeft(s.pid)) { try { process.kill(s.pid); } catch {} } }
  try { fs.unlinkSync(STAAT); } catch {}
  const sam = samenvatting(s.map);
  const vid = sam.beelden ? startVideo(s.map) : {};
  zeg({ gestopt: true, map: s.map, momenten: sam.momenten, beelden: sam.beelden, ...(sam.beeld_fout ? { beeld_fout: sam.beeld_fout } : {}), ...vid, per_programma: sam.per_programma.slice(0, 8), wissels: sam.wissels.slice(0, 5) });
} else if (cmd === "status") {
  if (!loopt) {
    if (s) try { fs.unlinkSync(STAAT); } catch {}
    const m = laatsteMap(), v = m && videoStaat(m);
    zeg({ bezig: false, ...(m ? { laatste_opname: m } : {}), ...(v ? { video: v } : {}) }); process.exit(0);
  }
  let n = 0; try { n = fs.readFileSync(path.join(s.map, "tijdlijn.txt"), "utf8").trim().split("\n").filter(Boolean).length; } catch {}
  zeg({ bezig: true, sinds: s.sinds, momenten: n, map: s.map });
} else { zeg({ fout: "Gebruik: start, stop of status." }); process.exit(1); }
}
