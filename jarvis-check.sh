#!/bin/sh
# /usr/local/bin/jarvis-check.sh op de Hetzner-server (alleen lezen; root:root, chmod 755).
# Wordt gestart door de beperkte sleutel jarvis-check (restrict,command=); zie hetzner-check-inrichten.sh.
export LC_ALL=C
echo "== Systeem"; . /etc/os-release; echo "$PRETTY_NAME, kernel $(uname -r), $(uptime -p)"
echo "== Openstaande updates"; T=$(mktemp); apt-get -s upgrade 2>/dev/null | grep '^Inst' > "$T"; echo "totaal: $(wc -l < "$T"), security: $(grep -ci security "$T")"; rm -f "$T"
echo "== Laatste apt update"; ls -l --time-style=+%F\ %R /var/lib/apt/periodic/update-success-stamp 2>/dev/null | awk '{print $6, $7}'
echo "== Reboot nodig"; if [ -f /var/run/reboot-required ]; then echo ja; cat /var/run/reboot-required.pkgs 2>/dev/null; else echo nee; fi
echo "== unattended-upgrades"; systemctl is-enabled unattended-upgrades 2>&1; systemctl is-active unattended-upgrades 2>&1; cat /etc/apt/apt.conf.d/20auto-upgrades 2>/dev/null; tail -n 5 /var/log/unattended-upgrades/unattended-upgrades.log 2>/dev/null
echo "== SSH"; sshd -T 2>/dev/null | grep -E '^(port|permitrootlogin|passwordauthentication|kbdinteractiveauthentication|pubkeyauthentication|maxauthtries) '
echo "== Firewall"; ufw status verbose 2>/dev/null || nft list ruleset 2>/dev/null | head -60
echo "== Open poorten"; ss -tulpnH
echo "== fail2ban"; fail2ban-client status 2>/dev/null || echo "niet actief"
# Uitbreiding 28 november 2026 (Hetzner-overzicht in Jarvis), ook alleen lezen.
echo "== Belasting"; echo "$(cut -d' ' -f1-3 /proc/loadavg) cpu $(nproc)"
echo "== Geheugen"; free -m | awk '/^Mem:/{print "mem", $2, $3} /^Swap:/{print "swap", $2, $3}'
echo "== Schijf"; df -P -m -x tmpfs -x devtmpfs -x overlay -x squashfs 2>/dev/null | awk 'NR>1{print $6, $2, $3}'
echo "== Diensten"; systemctl list-units --type=service --state=running --no-legend --plain 2>/dev/null | awk '{print $1}'
echo "== Versies"; dpkg-query -W -f='${Package} ${Version}\n' apache2 nginx openssh-server fail2ban mariadb-server mysql-server postgresql docker-ce docker.io nodejs certbot ufw 'php[0-9]*' 2>/dev/null | awk 'NF==2'
echo "== Docker"; command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}} {{.Image}} {{.Status}}' 2>/dev/null
echo "== fail2ban IP"; for j in $(fail2ban-client status 2>/dev/null | sed -n 's/.*Jail list:[[:space:]]*//p' | tr ',' ' '); do echo "$j $(fail2ban-client status "$j" 2>/dev/null | sed -n 's/.*Banned IP list:[[:space:]]*//p')"; done
echo "== SSH mislukt 24u"; { journalctl -q --no-pager -u ssh -u sshd --since "-24h" 2>/dev/null || cat /var/log/auth.log 2>/dev/null; } | grep -E 'Failed password|Invalid user|authentication failure' | grep -oE 'from [0-9a-fA-F.:]+' | awk '{print $2}' | sort | uniq -c | sort -rn | head -n 60
