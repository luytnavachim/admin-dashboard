#!/bin/bash
# Eenmalig op de Mac: richt de alleen-lezen Hetzner-check in (wachtrij 27 november 2026).
# 1. eigen sleutel ~/.ssh/jarvis_hetzner_check (als die er nog niet is)
# 2. via de gewone root-sleutel: jarvis-check.sh naar /usr/local/bin en de beperkte regel in authorized_keys (met reservekopie)
# 3. vaste opdracht hetzner-beveiliging in brug.config.json (met reservekopie), daarna de brug los herstarten
# Mag vaker draaien: wat er al staat wordt niet dubbel gezet.
set -euo pipefail
SERVER=root@95.217.203.120
KEY="$HOME/.ssh/jarvis_hetzner_check"
DIR="$(cd "$(dirname "$0")" && pwd)"
CONF="${JARVIS_BRUG_CONFIG:-$HOME/Documents/jarvis-brein/brug.config.json}"
NODE="$(command -v node || echo /opt/homebrew/bin/node)"

if [ -z "${JARVIS_ALLEEN_CONFIG:-}" ]; then
  [ -f "$KEY" ] || ssh-keygen -q -t ed25519 -N '' -C jarvis-check -f "$KEY"
  echo "Sleutel: aanwezig (wordt niet getoond)"
  ssh -o BatchMode=yes -o ConnectTimeout=8 "$SERVER" 'cat > /usr/local/bin/jarvis-check.sh.nieuw && chown root:root /usr/local/bin/jarvis-check.sh.nieuw && chmod 755 /usr/local/bin/jarvis-check.sh.nieuw && mv /usr/local/bin/jarvis-check.sh.nieuw /usr/local/bin/jarvis-check.sh && echo "Server: jarvis-check.sh staat klaar"' < "$DIR/jarvis-check.sh"
  ssh -o BatchMode=yes -o ConnectTimeout=8 "$SERVER" 'K=$(cat); B=$(printf %s "$K" | cut -d" " -f2); F=/root/.ssh/authorized_keys; if grep -qF "$B" "$F"; then echo "Server: beperkte sleutel stond er al"; else cp -p "$F" "$F.voor-jarvis-check" && printf "restrict,command=\"/usr/local/bin/jarvis-check.sh\" %s\n" "$K" >> "$F" && echo "Server: beperkte sleutel toegevoegd (reservekopie authorized_keys.voor-jarvis-check)"; fi' < "$KEY.pub"
fi

"$NODE" - "$CONF" <<'JS'
const fs = require("fs");
const f = process.argv[2];
const c = JSON.parse(fs.readFileSync(f, "utf8"));
c.opdrachten = c.opdrachten || [];
if (c.opdrachten.some(o => o.naam === "hetzner-beveiliging")) { console.log("Brug: hetzner-beveiliging stond er al"); process.exit(0); }
fs.copyFileSync(f, f + ".voor-hetzner-check");
c.opdrachten.push({
  naam: "hetzner-beveiliging",
  omschrijving: "Alleen lezen: updates, reboot nodig, unattended-upgrades, SSH-instellingen, firewall en open poorten op de Hetzner-server",
  commando: ["bash", "-lc", "ssh -n -i \"$HOME/.ssh/jarvis_hetzner_check\" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=8 root@95.217.203.120"],
  wijzigt: false,
  timeout_s: 60
});
fs.writeFileSync(f, JSON.stringify(c, null, 2) + "\n");
console.log("Brug: hetzner-beveiliging toegevoegd (reservekopie brug.config.json.voor-hetzner-check)");
JS

if [ -z "${JARVIS_GEEN_HERSTART:-}" ]; then
  (sleep 2; launchctl kickstart -k "gui/$(id -u)/nl.triplet-it.jarvis-brug") >/dev/null 2>&1 &
  echo "Brug herstart over 2 seconden. Daarna: voer hetzner-beveiliging uit."
fi
echo KLAAR
