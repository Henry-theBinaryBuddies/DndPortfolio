# Deploying Chronomancer on Google Cloud (free VM)

This puts Chronomancer on one small always-on Google Cloud virtual machine. The website, the Discord bot and the
background loop run together in one Docker container; Caddy in front of it handles HTTPS by itself. The database is a
SQLite file in a folder on the VM, backed up every night.

**Time:** about an hour, once. After that it looks after itself: it restarts if it crashes or the VM reboots, installs
security updates automatically, and renews its own HTTPS certificate.

**Cost:** $0, if you stay inside Google's "Always Free" allowance (details at the end). Set a budget alert (step 1) so a
mistake can never become a surprise bill.

> **Not tested end to end.** The Docker image could not be built on the machine these files were written on (no Docker
> there). Everything the image runs was tested (the pinned install, the exact server command, a fresh database, the
> backup), but the first `docker compose up --build` on the VM is the first time the image itself is built. If it fails,
> send me the last 30 lines of output and I will fix it.

## What you need before starting

- A Google account and a card for Google Cloud billing (the free VM needs it on file; you are not charged inside the free allowance).
- A web address for the app. Either a domain you own (use a subdomain such as `chronomancer.yourdomain.com`), or no
  domain at all: use a free `sslip.io` address (step 4).
- Your Discord application's **bot token**, **client ID** and **client secret** (Developer Portal).
- The code on GitHub, with the branch you want to run (normally `master`) containing the `chronomancer` folder.

## 1. Create the Google Cloud project and a budget alert

1. Go to <https://console.cloud.google.com/>, create a project (for example `chronomancer`) and link a billing account.
2. **Billing > Budgets & alerts > Create budget**: set the amount to **$1** with alerts at 50% and 100%. This is your safety net.
3. Enable the **Compute Engine API** (it offers to when you open Compute Engine for the first time).

## 2. Create the VM

**Compute Engine > VM instances > Create instance**, and set exactly:

| Setting | Value | Why |
|---|---|---|
| Name | `chronomancer` | |
| Region | `us-central1` (Iowa). `us-west1` (Oregon) or `us-east1` (South Carolina) also work. | Only these three regions are in the free allowance. |
| Machine type | **E2 > e2-micro** | The free machine (2 shared vCPUs, 1 GB memory). |
| Boot disk | **Debian 13** or **Ubuntu 24.04 LTS** (the setup script supports both), size **30 GB**, type **Standard persistent disk** (`pd-standard`) | Balanced and SSD disks are not free; 30 GB standard is. |
| Firewall | tick **Allow HTTP traffic** and **Allow HTTPS traffic** | Caddy needs ports 80 and 443. |

The price estimate on the page sometimes shows a few dollars even when the settings are free; if region, machine type,
disk type and size match the table, it is a display quirk. Check **Billing > Reports** after a few days.

Prefer the command line? In Cloud Shell:

```bash
gcloud compute instances create chronomancer --zone=us-central1-a --machine-type=e2-micro \
  --image-family=ubuntu-2404-lts-amd64 --image-project=ubuntu-os-cloud \
  --boot-disk-size=30GB --boot-disk-type=pd-standard --tags=http-server,https-server
gcloud compute firewall-rules create allow-http-https --allow=tcp:80,tcp:443 --target-tags=http-server,https-server
```

## 3. Give it a fixed address

An address that changes when the VM restarts would break the domain. **VPC network > IP addresses**: find the VM's
external address, and change its type from **Ephemeral** to **Static** (name it `chronomancer-ip`). Google's free-tier
page says the free VM's external IP is not charged; confirm that on your billing report.

Note the address, for example `34.123.45.67`.

## 4. Point a web address at it

- **With your own domain:** add an **A record** for the subdomain (for example `chronomancer`) pointing to the IP.
  Your address is then `chronomancer.yourdomain.com`.
- **Without a domain:** use `34-123-45-67.sslip.io` (your IP with dashes). It resolves to your IP automatically, and
  Caddy can get a real certificate for it. No setup needed.

Wait a few minutes, then `nslookup <your address>` should show the IP.

## 5. Set up the VM

In the console, click **SSH** next to the VM. Then:

```bash
sudo apt-get update && sudo apt-get install -y git      # this VM image does not include git
git clone https://github.com/<you>/<repo>.git
cd <repo>/chronomancer
sudo bash deploy/setup-vm.sh
```

The script installs Docker (from Docker's own package repository, so it works the same on Debian and Ubuntu), adds 2 GB of swap (the VM only has 1 GB of memory), turns on automatic security updates and
prepares the data folder. When it finishes, **log out of SSH and back in once** so the Docker permission applies.

> **Heads-up:** your repo also serves the `chronomancer/` folder through GitHub Pages as plain files. It is not
> functional there and contains no secrets (`.env` is never committed), but it is why the app itself lives here.

## 6. Create the settings file

```bash
cd ~/<repo>/chronomancer
cp .env.production.example .env
chmod 600 .env
python3 -c "import secrets; print(secrets.token_urlsafe(48))"      # copy this output
nano .env
```

Fill in:

- `SITE_ADDRESS` : your address without `https://` (for example `chronomancer.yourdomain.com`)
- `PUBLIC_BASE_URL` : the same address with `https://` in front
- `SECRET_KEY` : the random string you just generated
- `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` : from the Discord Developer Portal

Leave everything else alone. Do not add `CHRONOMANCER_DEV`. Save with Ctrl+O, Enter, Ctrl+X.

## 7. Start it

```bash
docker compose up -d --build
```

The first build takes a few minutes on this small machine. Then:

```bash
docker compose ps                  # both should say running, and app should say healthy
docker compose logs -f app         # Ctrl+C to leave. Look for "bot ready as ..." and "synced ... global commands"
```

Open `https://<your address>`. You should see the login page with a padlock. (If the certificate takes a minute, wait
and reload: Caddy is fetching it.)

## 8. Tell Discord where the app lives

In the [Developer Portal](https://discord.com/developers/applications), open your application:

1. **OAuth2 > Redirects**: add `https://<your address>/auth/callback` (exactly that), and save.
2. **General Information**: set **Privacy Policy URL** to `https://<your address>/privacy.html` and **Terms of Service
   URL** to `https://<your address>/terms.html`. Add the app name, icon and description people will see.
3. **Bot**: turn on **Public Bot** if other servers should be able to add it. Leave privileged intents **off**; the bot
   does not need them.
4. Slash commands sync to every server on start. A brand-new global command can take up to an hour to show up in Discord.

Your existing bot invite link keeps working.

## 9. Check it works

- Log in with Discord on the site. Create a group and open its page.
- In a Discord server where the bot is installed, in a channel: `/chronomancer setup`, then `/chronomancer poll`.
- Confirm a session and check that the Discord event appears and a reminder arrives.
- Have a second account join, then leave the server, and confirm they stop counting after a minute or two.
- Open `/privacy.html` and `/terms.html`.

## 10. Backups

The database is the only thing worth protecting. Set up the nightly copy:

```bash
chmod +x deploy/backup.sh
./deploy/backup.sh                         # run once by hand; it should print "backed up to data/backups/..."
crontab -e                                 # choose nano if asked, then add this line at the bottom:
17 3 * * * /home/<your-user>/<repo>/chronomancer/deploy/backup.sh >> /home/<your-user>/chronomancer-backup.log 2>&1
```

It keeps the newest 14 copies in `data/backups/`. These are on the same disk as the database, which protects you from
mistakes but not from losing the VM. For that, also copy them off the VM (recommended, and still free: Cloud Storage
includes 5 GB-months in the same three US regions):

```bash
gcloud storage buckets create gs://<unique-bucket-name> --location=us-central1
```

then add `BACKUP_BUCKET=<unique-bucket-name>` to `.env`. The VM needs permission to write to Cloud Storage: when you
create the VM, under **Access scopes** choose **Set access for each API** and give **Storage** *Read Write*. (On an
existing VM, stop it and edit its access scopes.)

**To restore a backup:**

```bash
cd ~/<repo>/chronomancer
docker compose stop app
cp data/backups/chronomancer-<date>.db data/chronomancer.db
sudo chown 10001:10001 data/chronomancer.db
docker compose start app
```

## 11. Updating later

```bash
cd ~/<repo>
./chronomancer/deploy/backup.sh             # always take a backup first
git pull
cd chronomancer
docker compose up -d --build
```

The database upgrades itself on start. Updates are manual on purpose: nothing deploys by itself. To go back to an
earlier version, `git checkout <older commit>` and run the last command again (if a newer version had already changed the
database, restore the backup from before the update).

## Looking after it (almost nothing)

- `docker compose ps` shows whether it is running; `docker compose logs --tail 50 app` shows what it has been doing.
- Optional but nice: a free uptime monitor (for example UptimeRobot) pinging `https://<your address>/api/config` emails you if the site goes down.
- If the bot or login ever misbehaves after a Discord change, the log usually says why.

## What the free allowance is, and what could change it

Google's Always Free tier includes **one e2-micro VM per month** in `us-west1`, `us-central1` or `us-east1`, **30 GB of
standard disk**, and **1 GB of outbound traffic per month** (more than this app will use). Snapshots, balanced/SSD
disks, a second VM, or other regions are billed. These terms are Google's and can change (Oracle halved its free
allowance this year), which is why the budget alert exists. Nothing here ties you to Google: the same `Dockerfile` and
`docker-compose.yml` run unchanged on any small Linux server, so moving later is a copy of `data/` and `.env`.

## Troubleshooting

| What you see | Likely cause and fix |
|---|---|
| Browser says the connection is not private, or the site will not load | The address does not point at the VM yet (check `nslookup`), or ports 80/443 are closed (check the VM's firewall tags). Look at `docker compose logs caddy`. |
| 502 Bad Gateway | The app is not healthy. `docker compose logs --tail 80 app`. A bad `SECRET_KEY` or `.env` typo shows up here. |
| Discord says "invalid redirect_uri" when logging in | The redirect in the Developer Portal must match `https://<address>/auth/callback` exactly. |
| The bot is offline | Wrong or reset `DISCORD_BOT_TOKEN`; the log says "Discord rejected the bot token". |
| Slash commands missing | Global commands can take up to an hour after the first start. Check the log for "synced". |
| `docker compose` says permission denied | Log out of SSH and back in after the setup script. |
| Build fails while compiling a package | The base image in `Dockerfile` (`python:3.15-slim`) may be missing prebuilt packages. Change it to `python:3.13-slim`, rebuild, and tell me. |
| The VM is slow or the build is killed | The VM has 1 GB of memory. Confirm swap is on with `swapon --show`; the setup script adds it. |
