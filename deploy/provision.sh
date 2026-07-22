#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# ShuleHQ — Contabo VPS provisioning & hardening (Phase 2).
#
# Run ONCE on a fresh Ubuntu 22.04/24.04 VPS as root. Idempotent — safe to
# re-run. Turns a bare box into a hardened Docker host the CI can deploy to.
#
#   curl -fsSL <this file> -o provision.sh   # or scp it
#   sudo bash provision.sh
#
# What it does:
#   1. Non-root deploy user with the CI public key
#   2. SSH hardening (keys only, no root login, no passwords)
#   3. UFW firewall — only 22, 80, 443
#   4. fail2ban (SSH brute-force protection)
#   5. unattended-upgrades (automatic security patches)
#   6. Docker Engine + compose plugin
#   7. 4 GB swap (protects live containers from build/traffic OOM spikes)
#   8. Deploy directory + log rotation
#
# Edit the CONFIG block, then run.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

# ── CONFIG ───────────────────────────────────────────────────────────────────
DEPLOY_USER="deploy"
DEPLOY_PATH="/opt/shulehq"
# CI key — PUBLIC half of the key whose PRIVATE half is the GitHub secret
# PRODUCTION_SSH_PRIVATE_KEY (contents of shulehq_ci_key.pub). CI logs in as
# ${DEPLOY_USER} with it.
CI_PUBLIC_KEY="ssh-ed25519 AAAA...REPLACE_ME_CI... ci@shulehq"
# YOUR admin key — PUBLIC half of your personal key (contents of
# shulehq_admin_key.pub), so you can SSH in as ${DEPLOY_USER} too. Both keys
# are authorized for the deploy user.
ADMIN_PUBLIC_KEY="ssh-ed25519 AAAA...REPLACE_ME_ADMIN... admin@shulehq"
SWAP_GB="4"
# ─────────────────────────────────────────────────────────────────────────────

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "Run as root."; exit 1; }
case "$CI_PUBLIC_KEY" in *REPLACE_ME_CI*) echo "ERROR: set CI_PUBLIC_KEY in CONFIG first."; exit 1;; esac
case "$ADMIN_PUBLIC_KEY" in *REPLACE_ME_ADMIN*) echo "ERROR: set ADMIN_PUBLIC_KEY in CONFIG first."; exit 1;; esac

log "System update"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y && apt-get upgrade -y

log "Base packages"
apt-get install -y ca-certificates curl gnupg ufw fail2ban unattended-upgrades \
  apt-transport-https software-properties-common

log "Deploy user: ${DEPLOY_USER}"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/${DEPLOY_USER}/.ssh"
# Both keys authorized: CI (automation) + your personal admin key (interactive).
printf '%s\n%s\n' "$CI_PUBLIC_KEY" "$ADMIN_PUBLIC_KEY" > "/home/${DEPLOY_USER}/.ssh/authorized_keys"
chmod 600 "/home/${DEPLOY_USER}/.ssh/authorized_keys"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "/home/${DEPLOY_USER}/.ssh"

log "SSH hardening (keys only, no root, no passwords)"
SSHD=/etc/ssh/sshd_config.d/99-shulehq.conf
cat > "$SSHD" <<EOF
PermitRootLogin no
PasswordAuthentication no
ChallengeResponseAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
X11Forwarding no
MaxAuthTries 3
EOF
systemctl restart ssh || systemctl restart sshd || true

log "Firewall (UFW): allow 22, 80, 443"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

log "fail2ban (SSH)"
cat > /etc/fail2ban/jail.d/sshd.local <<'EOF'
[sshd]
enabled = true
maxretry = 4
bantime = 1h
findtime = 10m
EOF
systemctl enable --now fail2ban

log "unattended-upgrades (security patches)"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

log "Docker Engine + compose plugin"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker
usermod -aG docker "$DEPLOY_USER"

log "Swap: ${SWAP_GB}G"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l "${SWAP_GB}G" /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=$((SWAP_GB*1024))
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10
  echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf
fi

log "Docker daemon log rotation"
cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
systemctl restart docker

log "Deploy directory: ${DEPLOY_PATH}"
install -d -m 750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DEPLOY_PATH"

cat <<EOF

╔════════════════════════════════════════════════════════════════════╗
  Provisioning complete.

  Next:
   1. Confirm you can SSH:  ssh ${DEPLOY_USER}@<vps-ip>   (key only)
   2. Set GitHub secrets    (deploy/GITHUB_SECRETS.md):
        PRODUCTION_SSH_HOST=<vps-ip>
        PRODUCTION_SSH_USER=${DEPLOY_USER}
        PRODUCTION_DEPLOY_PATH=${DEPLOY_PATH}
        PRODUCTION_ENV_FILE=<filled deploy/.env.production.example>
        PRODUCTION_SSH_PRIVATE_KEY=<private half of the CI key>
   3. Point DNS A records (incl. *.shulehq.co.ke) at this VPS.
   4. Run the deploy-production workflow (dress rehearsal first).
╚════════════════════════════════════════════════════════════════════╝
EOF
