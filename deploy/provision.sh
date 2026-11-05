#!/usr/bin/env bash
# Lightsail Ubuntu 24.04 호스트 준비. ubuntu 사용자로 실행한다(sudo 사용). 여러 번 실행해도 안전하다.
#   bash provision.sh
# 하는 일: apt 갱신·무인 업그레이드, 시간대, 스왑 2GB, ufw(22·80·443), fail2ban, Docker Engine+Compose, 로그 회전,
#          nvm+Node 22 LTS+pm2, uv, /srv/relay·/srv/apps 디렉터리, PostgreSQL 비밀번호·.env 생성(없을 때만).
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

log() { printf '\n== %s\n' "$*"; }

log "패키지 갱신"
sudo apt-get update -q
sudo apt-get -y -q full-upgrade
sudo apt-get install -y -q ca-certificates curl gnupg git ufw fail2ban unattended-upgrades apt-transport-https
sudo dpkg-reconfigure -f noninteractive unattended-upgrades
sudo timedatectl set-timezone Asia/Seoul

log "스왑 2GB"
if ! sudo swapon --show | grep -q '^/swapfile'; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-relay.conf >/dev/null
sudo sysctl -q -p /etc/sysctl.d/99-relay.conf

log "방화벽(ufw)과 fail2ban"
sudo ufw default deny incoming >/dev/null
sudo ufw default allow outgoing >/dev/null
sudo ufw allow 22/tcp >/dev/null
sudo ufw allow 80/tcp >/dev/null
sudo ufw allow 443/tcp >/dev/null
sudo ufw --force enable >/dev/null
sudo systemctl enable --now fail2ban >/dev/null

log "Docker Engine + Compose"
if ! command -v docker >/dev/null 2>&1; then
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -q
  sudo apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
sudo usermod -aG docker "$USER"
if [ ! -f /etc/docker/daemon.json ]; then
  printf '{\n  "log-driver": "json-file",\n  "log-opts": { "max-size": "10m", "max-file": "3" }\n}\n' | sudo tee /etc/docker/daemon.json >/dev/null
  sudo systemctl restart docker
fi
sudo systemctl enable --now docker >/dev/null

log "nvm + Node 22 LTS + pm2 (호스트에서 돌릴 비-docker 프로세스용)"
export NVM_DIR="$HOME/.nvm"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
fi
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm install 22 >/dev/null
nvm alias default 22 >/dev/null
npm install -g pm2 >/dev/null
pm2 startup systemd -u "$USER" --hp "$HOME" >/dev/null 2>&1 || true

log "uv"
if ! command -v uv >/dev/null 2>&1 && [ ! -x "$HOME/.local/bin/uv" ]; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi

log "디렉터리"
sudo mkdir -p /srv/relay/nginx/conf.d /srv/relay/certbot/www /srv/relay/certbot/conf /srv/relay/secrets /srv/relay/files /srv/relay/backups /srv/apps
sudo chown -R "$USER":"$USER" /srv/relay /srv/apps
chmod 700 /srv/relay/secrets

log "PostgreSQL 비밀번호와 .env (없을 때만 만든다)"
if [ ! -s /srv/relay/secrets/pg_password ]; then
  openssl rand -hex 24 | tr -d '\n' > /srv/relay/secrets/pg_password
  chmod 600 /srv/relay/secrets/pg_password
fi
if [ ! -s /srv/relay/.env ]; then
  PG_PASSWORD="$(cat /srv/relay/secrets/pg_password)"
  cat > /srv/relay/.env <<EOF
DATABASE_URL=postgres://relay:${PG_PASSWORD}@postgres:5432/relay
PORT=3000
RELAY_RETENTION_DAYS=30
RELAY_FILES_ROOT=/data/files
RELAY_BOOTSTRAP_USER=relay
LOG_LEVEL=info
EOF
  chmod 600 /srv/relay/.env
fi

log "완료. docker 그룹 반영을 위해 다시 로그인하세요. 버전:"
docker --version
docker compose version
node --version
pm2 --version
"$HOME/.local/bin/uv" --version 2>/dev/null || uv --version
