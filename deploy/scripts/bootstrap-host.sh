#!/usr/bin/env bash
# One-time hardening and Docker install for a fresh Debian 12 / Ubuntu 24.04 VPS. Run as root:
#
#   ssh root@<ip> 'bash -s' -- --user gameclaw --pubkey "$(cat ~/.ssh/id_ed25519.pub)" < bootstrap-host.sh
#
# Idempotent: safe to run again after a change.
#
# It locks SSH to keys before anything else, because a budget VPS with password login is being
# brute-forced within minutes of its first boot - the provider's IP ranges are well known.
set -euo pipefail

USERNAME="gameclaw"; PUBKEY=""; SSH_PORT=22
while [ $# -gt 0 ]; do
  case "$1" in
    --user)     USERNAME=$2; shift 2 ;;
    --pubkey)   PUBKEY=$2;   shift 2 ;;
    --ssh-port) SSH_PORT=$2; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }
[ -n "$PUBKEY" ] || { echo "--pubkey is required: this script disables password login" >&2; exit 1; }
case "$PUBKEY" in ssh-ed25519*|ssh-rsa*|ecdsa-sha2*) ;; *) echo "--pubkey does not look like an SSH public key" >&2; exit 1 ;; esac

echo "== packages =="
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg ufw fail2ban unattended-upgrades \
  postgresql-client age jq

echo "== user $USERNAME =="
id -u "$USERNAME" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$USERNAME"
install -d -m 700 -o "$USERNAME" -g "$USERNAME" "/home/$USERNAME/.ssh"
printf '%s\n' "$PUBKEY" > "/home/$USERNAME/.ssh/authorized_keys"
chmod 600 "/home/$USERNAME/.ssh/authorized_keys"
chown "$USERNAME:$USERNAME" "/home/$USERNAME/.ssh/authorized_keys"

echo "== ssh: keys only, no root =="
cat > /etc/ssh/sshd_config.d/10-gameclaw.conf <<SSHD
Port $SSH_PORT
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PubkeyAuthentication yes
PermitEmptyPasswords no
X11Forwarding no
AllowTcpForwarding yes
MaxAuthTries 3
LoginGraceTime 20
AllowUsers $USERNAME
SSHD
# Verified before restarting: a syntax error here with the old config already replaced is how a
# fresh VPS becomes unreachable with no console.
sshd -t
systemctl restart ssh 2>/dev/null || systemctl restart sshd

echo "== firewall =="
# Default deny inbound. Postgres is never opened: it lives on an internal Docker network and is
# reached only from the API container on the same host.
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow "$SSH_PORT"/tcp comment 'ssh'
ufw allow 80/tcp  comment 'http (acme + redirect)'
ufw allow 443/tcp comment 'https'
ufw --force enable
ufw status verbose | sed 's/^/  /'

echo "== fail2ban =="
cat > /etc/fail2ban/jail.d/sshd.local <<F2B
[sshd]
enabled  = true
port     = $SSH_PORT
maxretry = 4
findtime = 10m
bantime  = 1h
F2B
systemctl enable --now fail2ban

echo "== unattended security upgrades =="
cat > /etc/apt/apt.conf.d/20auto-upgrades <<AU
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
AU
# Security updates only, and no automatic reboot: a reboot that happens unattended at 06:00 takes
# the API down without anybody knowing why. Kernel updates get applied on a reboot you choose.
sed -i 's|^//\s*"\${distro_id}:\${distro_codename}-security";|        "${distro_id}:${distro_codename}-security";|' \
  /etc/apt/apt.conf.d/50unattended-upgrades || true
systemctl enable --now unattended-upgrades

echo "== swap (2 GB) =="
# Not for routine use: it is the difference between a Postgres autovacuum spike being slow and the
# OOM killer choosing the API process.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
sysctl -qw vm.swappiness=10
grep -q '^vm.swappiness' /etc/sysctl.d/99-gameclaw.conf 2>/dev/null || echo 'vm.swappiness=10' > /etc/sysctl.d/99-gameclaw.conf

echo "== docker engine =="
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  . /etc/os-release
  curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$ID $VERSION_CODENAME stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
usermod -aG docker "$USERNAME"
systemctl enable --now docker

echo "== done =="
docker --version | sed 's/^/  /'
docker compose version | sed 's/^/  /'
cat <<NEXT

  Next:
    1. ssh -p $SSH_PORT $USERNAME@<ip>        (root and passwords are now refused)
    2. git clone the repository, cd deploy
    3. cp .env.example .env and fill it in
    4. ./scripts/preflight.sh
    5. ./scripts/deploy.sh

  Verify you can get back in on a SECOND terminal before closing this one.
NEXT
