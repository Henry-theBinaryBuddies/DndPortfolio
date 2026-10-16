#!/usr/bin/env bash
# One-time setup of a fresh Debian 12/13 or Ubuntu 22.04/24.04 VM (the Google Cloud e2-micro). Run it once,
# from the repo folder:
#   cd ~/<repo>/chronomancer && sudo bash deploy/setup-vm.sh
# It is safe to run again. It installs Docker from Docker's own package repository, adds swap (the e2-micro has
# only 1 GB of memory), turns on automatic security updates, and prepares the data folder.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this with sudo: sudo bash deploy/setup-vm.sh" >&2
  exit 1
fi
cd "$(dirname "$0")/.."

. /etc/os-release
case "${ID}" in
  debian|ubuntu) ;;
  *) echo "This script supports Debian and Ubuntu, not '${ID}'." >&2; exit 1 ;;
esac

echo "== Installing Docker (from Docker's repository for ${ID} ${VERSION_CODENAME}) and automatic security updates"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl unattended-upgrades cron
if ! docker compose version >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi
systemctl enable --now docker
systemctl enable --now cron
dpkg-reconfigure -f noninteractive unattended-upgrades || true

echo "== Adding 2 GB of swap (so a memory spike cannot kill the bot)"
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== Preparing the data folder (the container runs as user 10001)"
mkdir -p data/backups
chown -R 10001:10001 data

if [ -n "${SUDO_USER:-}" ]; then
  usermod -aG docker "${SUDO_USER}"
  echo "== Added ${SUDO_USER} to the docker group: log out and back in once so it takes effect."
fi

echo "== Done. Next: create .env (see .env.production.example), then: docker compose up -d --build"
