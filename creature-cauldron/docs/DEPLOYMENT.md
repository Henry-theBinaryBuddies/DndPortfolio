# Deploying Creature Cauldron

```
visitor's browser
   ├── https://creaturecauldron.com          Cloudflare Pages: the page (static files, free)
   └── https://api.creaturecauldron.com      Cloudflare Tunnel ──► your Ubuntu server: the app on 127.0.0.1:8000
                                                                    └── Anthropic API (only when generating)

you, from anywhere ──► Tailscale (private VPN) ──► SSH into the same server
```

The page works without the server (the 939-monster library, encounters, exports); only Generate, Reskin, Reflavor and Polymorph need it. If the server is off,
the page says "Can't reach the generator server just now" and everything else keeps working.

The tunnel only makes an *outbound* connection from your server, so there is no port forwarding for the website, and your home address is never exposed. The app
listens on `127.0.0.1` only: the tunnel is the one door for visitors. Tailscale is a separate, private door for **you**.

## What is in the repository

| File | What it does |
|---|---|
| `frontend/.env.production` | Bakes the server's public address (`https://api.creaturecauldron.com`) into the page build. Not a secret. |
| `frontend/public/_headers` | Security headers Cloudflare Pages sends: a strict Content-Security-Policy (own files only; the page may talk to the API and nothing else), no sniffing, no camera or microphone. Checked against the built page: no violations. |
| `deploy/creature-cauldron.service` | The app as a systemd service: its own unprivileged user, restarts itself, logs to the journal, locked down to the network and its own database folder. The API key is read by systemd from `/etc/cauldron/secrets.env`. |
| `deploy/secrets.env.example` | The shape of that file. |
| `deploy/cauldron-backup.service` and `.timer` | A safe copy of the database every night at 03:00 (every generated monster, plus the day's spend count); the newest 14 are kept in `/var/lib/cauldron/backups`. |
| `deploy/backup_db.py` | What the backup runs (uses SQLite's own backup call, so the copy is consistent while the app writes). |
| `python -m cauldron.service.smoke` | A real-key check: plain, `--remix`, `--reflavor`, `--polymorph`. |
| `.gitignore` | Ignores `.env`, `*.env`, `.env.local` and `secrets/`. |

## Part 1: Make the server safe to reach (Ubuntu 24.04)

Do this at the server first (keyboard and screen, or a session you already have).

### 1. Updates

```bash
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y unattended-upgrades
systemctl status unattended-upgrades --no-pager
```

Security updates now install themselves. Reboot when `full-upgrade` says the kernel changed.

### 2. SSH, with keys only

```bash
sudo apt install -y openssh-server
```

On the server, note two things: your user name (`whoami`) and its home-network address (`hostname -I`, the first one). Check SSH is running: `systemctl status ssh --no-pager` should say `active (running)`.

On your laptop (PowerShell), make a key, send the public half to the server (it asks for your server password this once), and log in. Replace `you` and the address:

```powershell
ssh-keygen -t ed25519
scp $env:USERPROFILE\.ssh\id_ed25519.pub you@192.168.1.50:
ssh you@192.168.1.50
```

Then, in that session on the server, file the key and tidy it (the last command removes any Windows line ending from the key):

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
cat ~/id_ed25519.pub >> ~/.ssh/authorized_keys
sed -i 's/\r$//' ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
rm ~/id_ed25519.pub
exit
```

Now `ssh you@192.168.1.50` from the laptop should log you in **without a password**. **Only then** turn passwords off, on the server:

```bash
sudo tee /etc/ssh/sshd_config.d/00-hardening.conf >/dev/null <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
sudo sshd -t && sudo systemctl restart ssh
```

Keep your current session open, and check from a **second** window that `ssh you@192.168.1.50` still works before you close anything.

### 3. Tailscale: your VPN from outside the house

Tailscale is a private network (built on WireGuard) between your own devices. SSH then works from anywhere without opening anything on your router.

On the server:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

It prints a login address; open it and sign in (one free personal account). Install Tailscale on your laptop and phone and sign in to the same account. Then:

```powershell
ssh you@<the server's name in the Tailscale app>
```

That works from any network. In Tailscale's admin page (login.tailscale.com), find the server and choose **Disable key expiry**, so it never drops off the network after six months.

**Optional, if you want your whole home network from outside** (printers, other devices, not just this server): on the server, find your home network with `ip route` (something like `192.168.1.0/24`), then:

```bash
echo 'net.ipv4.ip_forward = 1' | sudo tee /etc/sysctl.d/99-tailscale.conf
echo 'net.ipv6.conf.all.forwarding = 1' | sudo tee -a /etc/sysctl.d/99-tailscale.conf
sudo sysctl -p /etc/sysctl.d/99-tailscale.conf
sudo tailscale up --advertise-routes=192.168.1.0/24
```

and approve the route in the admin page (the server's menu, **Edit route settings**). If you later want all your internet traffic to leave from home (a classic VPN), add `--advertise-exit-node` and approve that too.

### 4. A firewall

Nothing from the internet needs to reach this machine, so close everything except your own ways in:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow in on tailscale0
sudo ufw allow from 192.168.1.0/24 to any port 22 proto tcp
sudo ufw enable
sudo ufw status verbose
```

(`192.168.1.0/24` is only an example: use your own home network, which `ip -4 addr` shows next to the server's address. If the server is `10.0.0.63`, write `10.0.0.0/24`. A wrong network here locks your home computers out of SSH. Check from a second window that SSH still works, over the home network and over Tailscale.) If you used the subnet-router option and
home devices become unreachable through Tailscale, tell me: forwarded traffic may need a `ufw route` rule.

### 5. Come back after a power cut

In the server's BIOS setting look for **Restore on AC power loss** and set it to **Power on**. Everything below starts by itself at boot.

## Part 2: The page on Cloudflare Pages

Cloudflare dashboard, **Workers & Pages**, **Create**, **Pages**, **Connect to Git**, choose the `DndPortfolio` repository.

- Production branch: the branch you merge to (`master`).
- Framework preset: none.
- Root directory: `creature-cauldron/frontend`
- Build command: `npm ci && npm run build`
- Build output directory: `dist`
- Environment variable: `NODE_VERSION` = `22` (if the build complains, try `24`).

After the first deploy: **Custom domains**, add `creaturecauldron.com` (Cloudflare adds the DNS record for you). Add `www.creaturecauldron.com` too and redirect it to the main address
(a Redirect Rule: hostname equals `www.creaturecauldron.com`, redirect to `https://creaturecauldron.com`).

Every push now rebuilds the page. Branch previews on `*.pages.dev` are created too; the server's CORS list allows only `https://creaturecauldron.com`, so a preview can show the library
but cannot call the server. That is intended.

## Part 3: The app on the server

### 1. Install it

```bash
sudo apt install -y git python3-venv python3-pip
sudo git clone https://github.com/Henry-theBinaryBuddies/DndPortfolio.git /opt/DndPortfolio
cd /opt/DndPortfolio/creature-cauldron/backend
sudo python3 -m venv .venv
sudo .venv/bin/python -m pip install -e .
sudo useradd --system --home-dir /var/lib/cauldron --shell /usr/sbin/nologin cauldron
```

(If the repository is private, give the server a read-only *deploy key* in the repository's settings, or clone with a token.) Ubuntu 24.04's Python 3.12 is what the app needs.

Optional: run the tests on the server (`sudo .venv/bin/python -m pip install -e ".[dev]"`, then `sudo .venv/bin/python -m pytest -q`).

### 2. The secrets file (the key lives here and nowhere else)

```bash
sudo install -d -m 755 /etc/cauldron
sudo install -m 600 /opt/DndPortfolio/creature-cauldron/deploy/secrets.env.example /etc/cauldron/secrets.env
```

It is owned by root and unreadable by anyone else. systemd reads it and gives the values to the app's environment; the app's own user never opens the file. Leave the key empty until launch day.

### 3. Start it and keep it running

```bash
sudo cp /opt/DndPortfolio/creature-cauldron/deploy/creature-cauldron.service /etc/systemd/system/
sudo cp /opt/DndPortfolio/creature-cauldron/deploy/cauldron-backup.service /opt/DndPortfolio/creature-cauldron/deploy/cauldron-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now creature-cauldron
sudo systemctl enable --now cauldron-backup.timer
systemctl status creature-cauldron --no-pager
curl http://127.0.0.1:8000/api/v1/health
```

The health check should say `{"status":"ok"}`. (Without a key the app still starts: the library and anything cached work, and generating says the forge cannot be reached.)

Try the backup once by hand: `sudo systemctl start cauldron-backup`, then `sudo ls /var/lib/cauldron/backups`. Once in a while copy that folder somewhere that is not this machine.

Logs go to the journal: `journalctl -u creature-cauldron -f` follows them. To keep two weeks of journals at most:

```bash
sudo mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nMaxRetentionSec=2week\nSystemMaxUse=500M\n' | sudo tee /etc/systemd/journald.conf.d/cauldron.conf
sudo systemctl restart systemd-journald
```

### 4. The tunnel

1. In the Cloudflare dashboard: **Zero Trust**, **Networks**, **Tunnels**, **Create a tunnel**, **Cloudflared**, name it `cauldron`, choose **Debian** and **64-bit**. The page lists the exact commands to add Cloudflare's package source, install `cloudflared`, and finish with
   `sudo cloudflared service install <token>`. Run them on the server. **The token is a password for your tunnel: do not paste it in chat, the repository or a screenshot.**
   (Zero Trust may ask you to pick the free plan and add a payment method for verification; the plan costs nothing.)
2. Check it: `systemctl status cloudflared --no-pager`. The service starts at boot and reconnects by itself.
3. On the tunnel's **Public hostname** tab: subdomain `api`, domain `creaturecauldron.com`, service type `HTTP`, URL `127.0.0.1:8000` (use the numbers, not `localhost`).
4. On `creaturecauldron.com`: **SSL/TLS** set to Full, **Always Use HTTPS** on, minimum TLS 1.2.
5. **Security, WAF, Rate limiting rules** (the free plan has one rule): when the URI Path starts with `/api/v1/`, block an address that makes more than 20 requests in 10 seconds.
   The app's own limits (3 a minute, 10 an hour for AI work) do the real job; this stops floods before they reach your server.

### 5. Why the visitor's address comes from a header

Behind a tunnel every request arrives from the tunnel program, not from the visitor. Cloudflare adds the real address in `CF-Connecting-IP`, and the service file sets
`CAULDRON_TRUSTED_PROXY_HEADER=CF-Connecting-IP`, so the per-visitor limits count real people. The header is believed only because the app is reachable *only* through the tunnel
(it listens on `127.0.0.1`, and the firewall allows nothing else in). An IPv6 visitor is counted by their /64 network prefix, not their single address: one home connection owns
billions of addresses and could otherwise start every request from a new one.

## Key safety

- The key lives in `/etc/cauldron/secrets.env` only (root-only). It never appears in the repository (`.gitignore` blocks `.env`, `*.env`, `.env.local` and `secrets/`), the page (the build gets
  only the public server address), a URL, the unit file, or the logs (failed calls show visitors a generic message).
- Make a **new key just before launch** in the Console workspace that has the spend limit, and revoke any older key. If a key ever leaks, revoke it in the Console and put a new one in the
  secrets file (`sudo nano /etc/cauldron/secrets.env`, then `sudo systemctl restart creature-cauldron`); nothing else changes.
- Layers between a stranger and your bill: the page shows cached monsters first (free); the edge rule above; 3 a minute and 10 an hour per visitor; a daily cap of 100 AI calls
  (under 20 cents a day at worst, retries included); challenge rating capped at 17; small request bodies; and the Console's own monthly spend limit, which stops everything.
- The service itself is locked down (`NoNewPrivileges`, read-only system, no home folders, only its own database folder writable), so a flaw in the app would find very little to work with.

## Launch day checklist

- [ ] Both suites pass here; the branch is merged and the page builds on Cloudflare Pages.
- [ ] The A5E line in `frontend/public/legal/OGL-1.0a.txt` (Section 15) is checked against the printed book; the Licences page reads right.
- [ ] Part 1 done: you can SSH to the server over Tailscale from a different network (try your phone's mobile data with the Tailscale app), and the firewall is on.
- [ ] Part 3 done: `curl http://127.0.0.1:8000/api/v1/health` answers on the server; the backup timer is listed in `systemctl list-timers`.
- [ ] New key made; old key revoked; the Console spend limit and workspace confirmed.
- [ ] Real-key checks, one at a time, **on the server** (each costs a fraction of a cent). The key is typed hidden and only lives in this window:
      ```bash
      cd /opt/DndPortfolio/creature-cauldron/backend
      read -rs ANTHROPIC_API_KEY && export ANTHROPIC_API_KEY
      PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m cauldron.service.smoke --yes
      PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m cauldron.service.smoke --yes --remix
      PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m cauldron.service.smoke --yes --reflavor
      PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m cauldron.service.smoke --yes --polymorph
      unset ANTHROPIC_API_KEY
      ```
      Reflavor and Polymorph (the forge choosing features and naming legendary actions) have only been tested with stand-ins so far: this is their first real run.
- [ ] Put the key in `/etc/cauldron/secrets.env` and restart: `sudo systemctl restart creature-cauldron`.
- [ ] `https://api.creaturecauldron.com/api/v1/health` answers `{"status":"ok"}` from your phone on mobile data.
- [ ] Open `https://creaturecauldron.com`: no "Can't reach" note; Generate, Reskin, Reflavor and Polymorph work.
- [ ] Prove the per-visitor limit sees real addresses: press Generate four times quickly on a computer (the fourth is told to slow down), then try once on your phone on mobile data (it works).
- [ ] An uptime monitor is watching `https://api.creaturecauldron.com/api/v1/health` (UptimeRobot, Better Stack and Healthchecks.io all have free plans) and emails you if it stops answering.
- [ ] The Cloudflare rate rule is on; after 03:00 `/var/lib/cauldron/backups` has a copy.
- [ ] For the first month, glance at the Console's usage page and Cloudflare's analytics once a week.

## Day to day

- **Page changes:** push; Cloudflare rebuilds.
- **Server changes:**
  ```bash
  cd /opt/DndPortfolio && sudo git pull
  cd creature-cauldron/backend && sudo .venv/bin/python -m pip install -e .
  sudo systemctl restart creature-cauldron
  ```
  New monster files come with the pull; the app reads them at start, so restart it too.
- **Is it running?** `systemctl status creature-cauldron cloudflared --no-pager`, and `journalctl -u creature-cauldron -n 50`.
- **Take generation offline at once:** `sudo systemctl stop cloudflared` (the website keeps working from Cloudflare Pages, without generation) or `sudo systemctl stop creature-cauldron`.
- **Costs look wrong:** lower `CAULDRON_DAILY_CAP` in the secrets file and restart; the Console limit remains the hard stop.

## What is stored and logged

Visitors have no accounts and no cookies; saved encounters and generated monsters stay in their own browser. The app remembers addresses only in memory, for the rate limits (cleared on restart).
The journal holds the address and path of each request for up to two weeks (the settings above), and Cloudflare keeps its own analytics. The database (`/var/lib/cauldron/cauldron.sqlite3`)
holds the monsters the forge has made (shared with every visitor) and the day's call count.

## When something is wrong

- **The page says it can't reach the server:** `curl http://127.0.0.1:8000/api/v1/health` on the server. If that works, check `systemctl status cloudflared` and the tunnel's status in Zero Trust.
- **Everyone is told to slow down:** the visitor-address header is not arriving, so every visitor is one bucket. Check the app is reached only through the tunnel and the service file's `CAULDRON_TRUSTED_PROXY_HEADER`.
- **"The forge is resting":** the daily cap is used up; it resets at midnight UTC (the library keeps working).
- **The app won't start:** `journalctl -u creature-cauldron -n 50`. A mistyped setting names its variable in the message.
- **You can't SSH in from outside:** check the Tailscale app shows the server online; on the server `tailscale status`, `systemctl status ssh`, `sudo ufw status`.

## Known limits

One server is one point of failure (power, network, a bad update); the backups and the BIOS power setting soften that. The per-visitor limit is per address (per /64 for IPv6), so a visitor on a shared network shares a bucket.
The limits reset when the app restarts, but the daily cap does not (it lives in the database). The cap counts UTC days. A "let the forge choose" polymorph, and a reflavor of a monster that has fewer than three, are never reused,
so each press is a fresh AI call: a handful of visitors can use up the day's allowance in a few hours, which puts the forge in "resting" (the library keeps working). The cap and the Console limit, not the cache, are the ceiling
for those two paths. Several people pressing Reflavor at the same moment can also leave a monster with a fourth reflavor; that is harmless.
