#!/bin/sh
# Yangi Ubuntu serverni tayyorlaydi: swap, Docker, Compose. Qayta yurgizsa ham xavfsiz.
# Foydalanish:  sudo sh deploy/server-init.sh
set -eu

SWAP_FILE=/swapfile
SWAP_SIZE=2G

if [ "$(id -u)" -ne 0 ]; then
  echo "sudo bilan yurgizing" >&2
  exit 1
fi

if ! swapon --show=NAME --noheadings | grep -qx "$SWAP_FILE"; then
  [ -f "$SWAP_FILE" ] || fallocate -l "$SWAP_SIZE" "$SWAP_FILE"
  chmod 600 "$SWAP_FILE"
  mkswap "$SWAP_FILE"
  swapon "$SWAP_FILE"
fi
grep -q "^$SWAP_FILE " /etc/fstab || echo "$SWAP_FILE none swap sw 0 0" >> /etc/fstab

# Xotira to'lmaguncha swap'ga kam murojaat qilinsin
echo "vm.swappiness=10" > /etc/sysctl.d/90-chronix-swap.conf
sysctl -q --system

if ! command -v docker >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -q
  apt-get install -y -q docker.io docker-compose-v2
fi
systemctl enable --now docker

# Konteyner loglari diskni to'ldirmasin
if [ ! -f /etc/docker/daemon.json ]; then
  cat > /etc/docker/daemon.json <<'JSON'
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
JSON
  systemctl restart docker
fi

free -h
docker --version
docker compose version
