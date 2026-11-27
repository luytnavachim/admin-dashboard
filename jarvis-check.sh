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
