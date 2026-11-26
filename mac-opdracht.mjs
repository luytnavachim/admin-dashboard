#!/usr/bin/env node
// Vaste opdracht "mac-opdracht" van de Jarvis-brug. Haalt één keer de shell-opdracht op die de Worker klaarzette
// (pas na een ja van Micha) en draait die met zsh in de thuismap, als Micha. Hooguit 18 seconden: de brug geeft
// een opdracht 20 seconden. Herstart van de brug zelf: los laten lopen, bijv. (sleep 2; launchctl kickstart -k …) >/dev/null 2>&1 &
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const WORKER = process.env.JARVIS_WORKER || "https://admin-dashboard.michavantuyl.workers.dev";
const wacht = ms => new Promise(r => setTimeout(r, ms));

let key = process.env.BRUG_KEY || "";
if (!key) { try { key = fs.readFileSync(process.env.BRUG_KEYFILE || path.join(os.homedir(), "Documents/jarvis-brein/brug.key"), "utf8").trim(); } catch { key = ""; } }
if (!key) { console.log("De sleutel van de brug is niet gevonden."); process.exit(1); }

let sh = "";
for (let i = 0; i < 8 && !sh; i++) {
  try {
    const r = await fetch(WORKER + "/brug/open-url", { method: "POST", headers: { "x-brug-key": key }, signal: AbortSignal.timeout(8000) });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.mac && typeof d.mac.sh === "string") sh = d.mac.sh;
  } catch { /* opnieuw proberen */ }
  if (!sh) await wacht(400);
}
if (!sh) { console.log("Er staat geen opdracht voor de Mac klaar."); process.exit(1); }

const PATH = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin", process.env.PATH || ""].join(":");
const k = spawn("/bin/zsh", ["-lc", sh], { cwd: os.homedir(), env: { ...process.env, PATH, LANG: "en_US.UTF-8" }, stdio: ["ignore", "pipe", "pipe"] });
let out = "";
const t = setTimeout(() => { out += "\n(afgebroken na 18 seconden)"; k.kill("SIGKILL"); }, 18000);
k.stdout.on("data", d => { out += d; }); k.stderr.on("data", d => { out += d; });
k.on("error", e => { clearTimeout(t); console.log("Starten mislukt: " + e.message); process.exit(1); });
k.on("close", code => {
  clearTimeout(t);
  out = out.trim();
  console.log(out.length > 20000 ? out.slice(0, 20000) + "\n… (ingekort)" : (out || "(geen uitvoer)"));
  process.exit(code || 0);
});
