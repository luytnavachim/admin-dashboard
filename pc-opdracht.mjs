#!/usr/bin/env node
// Vaste opdracht "pc-opdracht" van de Jarvis-brug. Haalt één keer de PowerShell-opdracht op die de Worker klaarzette
// (pas na een ja van Micha) en draait die via SSH op de Windows-pc. Op de pc mag de sleutel alleen D:\jarvis\pc\jarvis.ps1
// starten; dat script voert de opdracht uit als het beperkte account jarvis. De opdracht gaat als base64 mee, zodat
// aanhalingstekens en spaties onderweg niet veranderen.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const WORKER = process.env.JARVIS_WORKER || "https://admin-dashboard.michavantuyl.workers.dev";
const PC = process.env.JARVIS_PC || "jarvis@192.168.19.197";
const SLEUTEL_PC = process.env.JARVIS_PC_KEY || path.join(os.homedir(), ".ssh/jarvis_pc");
const wacht = ms => new Promise(r => setTimeout(r, ms));

let key = process.env.BRUG_KEY || "";
if (!key) { try { key = fs.readFileSync(process.env.BRUG_KEYFILE || path.join(os.homedir(), "Documents/jarvis-brein/brug.key"), "utf8").trim(); } catch { key = ""; } }
if (!key) { console.log("De sleutel van de brug is niet gevonden."); process.exit(1); }

let ps = "";
for (let i = 0; i < 8 && !ps; i++) {
  try {
    const r = await fetch(WORKER + "/brug/open-url", { method: "POST", headers: { "x-brug-key": key }, signal: AbortSignal.timeout(8000) });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.pc && typeof d.pc.ps === "string") ps = d.pc.ps;
  } catch { /* opnieuw proberen */ }
  if (!ps) await wacht(400);
}
if (!ps) { console.log("Er staat geen opdracht voor de pc klaar."); process.exit(1); }

const b64 = Buffer.from(ps, "utf8").toString("base64");
const k = spawn("ssh", ["-n", "-i", SLEUTEL_PC, "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", PC, "ps " + b64]);
let out = "";
const t = setTimeout(() => k.kill("SIGKILL"), 55000);
k.stdout.on("data", d => { out += d; }); k.stderr.on("data", d => { out += d; });
k.on("error", e => { clearTimeout(t); console.log("SSH starten mislukt: " + e.message); process.exit(1); });
k.on("close", code => {
  clearTimeout(t);
  out = out.replace(/\r/g, "").trim();
  console.log(out.length > 20000 ? out.slice(0, 20000) + "\n… (ingekort)" : (out || "(geen uitvoer)"));
  if (code === 255) console.log("De pc is niet bereikbaar via SSH (staat hij aan?).");
  process.exit(code || 0);
});
