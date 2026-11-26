#!/usr/bin/env node
// Werkopname op de Mac, voor het zoeken naar herhaald werk dat geautomatiseerd kan worden.
// Vaste opdrachten van de brug: opname-start, opname-stop, opname-status (node opname.mjs start|stop|status).
// De tijdlijn (tijdlijn.txt, één JSON-regel per moment) is .txt zodat Jarvis hem via mappen_lezen kan lezen.
// Tijdens een opname legt een achtergrondproces elke INTERVAL seconden vast: het programma en de venstertitel die
// voor staan, plus een verkleinde schermafbeelding. Alles blijft op de Mac in ~/Documents/jarvis-opnames/<start>/.
// Geen toetsaanslagen, geen geluid. Stopt vanzelf na MAX_UUR. Bij stoppen komt er een samenvatting.json bij.
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
function beeld(map, nr) {
  const ruw = path.join(map, `.ruw-${nr}.jpg`), uit = path.join(map, `${String(nr).padStart(5, "0")}.jpg`);
  const c = spawnSync("/usr/sbin/screencapture", ["-x", "-t", "jpg", ruw], { timeout: 10000 });
  if (c.status !== 0 || !fs.existsSync(ruw)) return null;
  spawnSync("/usr/bin/sips", ["-Z", "1600", "-s", "format", "jpeg", "-s", "formatOptions", "45", ruw, "--out", uit], { timeout: 10000 });
  try { fs.unlinkSync(ruw); } catch {}
  return fs.existsSync(uit) ? path.basename(uit) : null;
}

async function lus(map) {
  const eind = Date.now() + MAX_UUR * 3600000, log = path.join(map, "tijdlijn.txt");
  let nr = 0;
  while (Date.now() < eind && !fs.existsSync(path.join(map, "stop"))) {
    nr++;
    const v = voorgrond(), b = beeld(map, nr);
    fs.appendFileSync(log, JSON.stringify({ t: new Date().toISOString(), ...v, beeld: b }) + "\n");
    for (let i = 0; i < INTERVAL * 2 && !fs.existsSync(path.join(map, "stop")); i++) await wacht(500);
  }
  samenvatting(map);
  try { const s = leesStaat(); if (s && s.map === map) fs.unlinkSync(STAAT); } catch {}
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
    beelden: regels.filter(r => r.beeld).length,
    per_programma: top(perApp, 15), per_venster: top(perVenster, 25),
    wissels: Object.entries(wissels).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([van_naar, keer]) => ({ van_naar, keer })) };
  fs.writeFileSync(path.join(map, "samenvatting.json"), JSON.stringify(s, null, 2));
  return s;
}

const [, , cmd, arg] = process.argv;
fs.mkdirSync(MAP, { recursive: true });
if (cmd === "lus") { await lus(arg); process.exit(0); }
const s = leesStaat(), loopt = !!(s && leeft(s.pid));
if (cmd === "start") {
  if (loopt) { zeg({ al_bezig: true, sinds: s.sinds, map: s.map }); process.exit(0); }
  const map = path.join(MAP, stempel()); fs.mkdirSync(map, { recursive: true });
  const k = spawn(process.execPath, [fileURLToPath(import.meta.url), "lus", map], { detached: true, stdio: "ignore" });
  k.unref();
  fs.writeFileSync(STAAT, JSON.stringify({ pid: k.pid, sinds: new Date().toISOString(), map }));
  zeg({ gestart: true, map, elke_seconden: INTERVAL, stopt_uiterlijk_na_uur: MAX_UUR, let_op: "Alles blijft op de Mac. Geen toetsaanslagen of geluid." });
} else if (cmd === "stop") {
  if (!s) { zeg({ fout: "Er loopt geen opname." }); process.exit(0); }
  fs.writeFileSync(path.join(s.map, "stop"), "");
  for (let i = 0; i < 20 && leeft(s.pid); i++) await wacht(500);
  if (leeft(s.pid)) { try { process.kill(s.pid); } catch {} }
  try { fs.unlinkSync(STAAT); } catch {}
  const sam = samenvatting(s.map);
  zeg({ gestopt: true, map: s.map, momenten: sam.momenten, beelden: sam.beelden, per_programma: sam.per_programma.slice(0, 8), wissels: sam.wissels.slice(0, 5) });
} else if (cmd === "status") {
  if (!loopt) { if (s) try { fs.unlinkSync(STAAT); } catch {} zeg({ bezig: false }); process.exit(0); }
  let n = 0; try { n = fs.readFileSync(path.join(s.map, "log.jsonl"), "utf8").trim().split("\n").filter(Boolean).length; } catch {}
  zeg({ bezig: true, sinds: s.sinds, momenten: n, map: s.map });
} else { zeg({ fout: "Gebruik: start, stop of status." }); process.exit(1); }
