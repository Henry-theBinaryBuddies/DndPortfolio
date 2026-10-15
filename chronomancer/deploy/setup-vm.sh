#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 VM (the Google Cloud e2-micro). Run it once, from the repo folder:
#   cd ~/<repo>/chronomancer && sudo bash deploy/setup-vm.sh
# It is safe to run again. It installs Docker, adds swap (the e2-micro has only 1 GB of memory), turns on
# automatic security updates, and prepares the data folder.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this with sudo: sudo bash deploy/setup-vm.sh" >&2
  exit 1
fi
cd "$(dirname "$0")/.."

echo "== Installing Docker, Compose and automatic security updates"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y docker.io docker-compose-v2 unattended-upgrades cron
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
