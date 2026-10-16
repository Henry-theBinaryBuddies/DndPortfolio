# Operating Chronomancer

For after it is deployed (see [`DEPLOY.md`](DEPLOY.md)). Everything here is run in the **VM's own SSH window** (the Google Cloud console, Compute Engine > VM instances > **SSH**; the prompt ends in `@chronomancer-vm`), from the project folder:

```bash
cd ~/DndPortfolio/chronomancer
```

`<angle brackets>` below mean "replace this with your value, without the brackets".

## Is it healthy?

```bash
docker compose ps                    # app and caddy should be "running"; app should say "healthy"
docker compose logs --tail 50 app    # the last 50 lines; look for "bot ready as ..."
curl -s https://35-225-68-147.sslip.io/api/config      # should print {"discord_login":true,"dev_login":false}
```

Healthy means: both containers running, the log shows the bot is ready, and the site loads over HTTPS. `dev_login` must be `false` on the live site.

An uptime monitor (for example UptimeRobot, free) pointed at `https://35-225-68-147.sslip.io/api/config` emails you if it stops answering.

## Looking at logs

```bash
docker compose logs -f app           # follow live (Ctrl+C to stop)
docker compose logs --since 1h app   # the last hour
docker compose logs caddy            # certificate and web-server messages
```

Logs rotate on their own (3 files of 10 MB each).

## Restarting

```bash
docker compose restart app           # just the app (safe; a few seconds)
docker compose up -d                 # start anything that is not running
```

After a VM reboot everything comes back by itself. If it ever does not, `docker compose up -d` does it.

## Updating to a new version

```bash
./deploy/backup.sh                   # always take a backup first
cd ~/DndPortfolio && git pull
cd chronomancer
docker compose up -d --build
docker compose ps
docker compose logs --tail 30 app
```

The database upgrades itself on start. Nothing deploys automatically; this is the only way a change reaches the live site. To go back to an earlier version: `git checkout <older commit>` and run the last three commands again. If the newer version had already changed the database, restore the backup you took first (below).

## Backups

A backup runs every night at 03:17 (the VM's clock is UTC). Each is a complete copy of the database; the newest 14 stay on the VM in `data/backups/`, and every one is also copied to your Cloud Storage bucket (`BACKUP_BUCKET` in `.env`).

```bash
./deploy/backup.sh                                   # take one right now
ls -la data/backups/                                 # the copies on the VM
gcloud storage ls gs://<your bucket>/                # the copies in the bucket
tail -5 ~/chronomancer-backup.log                    # what the last nightly runs said
crontab -l                                           # confirm the nightly line is there
```

### Restoring

```bash
docker compose stop app
cp data/backups/chronomancer-<date>.db data/chronomancer.db
sudo chown 10001:10001 data/chronomancer.db
docker compose start app
```

To restore from the bucket (for example on a brand-new VM, after `DEPLOY.md` steps 5 to 7), first fetch it: `gcloud storage cp gs://<your bucket>/chronomancer-<date>.db data/chronomancer.db`, then do the `chown` and start lines above.

## Rotating secrets

| What | How |
|---|---|
| **Bot token** (leaked, or you want a new one) | Developer Portal > Bot > **Reset Token**. Put the new value in `.env` as `DISCORD_BOT_TOKEN`, then `docker compose up -d`. The old token stops working at once. |
| **Client secret** | Developer Portal > OAuth2 > **Reset Secret**. Update `DISCORD_CLIENT_SECRET` in `.env`, then `docker compose up -d`. |
| **`SECRET_KEY`** | Put a new random string in `.env` (`python3 -c "import secrets; print(secrets.token_urlsafe(48))"`) and `docker compose up -d`. Everyone is logged out once; nothing else is affected. |

Edit `.env` with `nano .env` (Ctrl+O, Enter, Ctrl+X to save). It holds secrets: never paste it into chat or commit it. Check which keys are filled in without showing them:

```bash
awk -F= '/^(SECRET_KEY|DISCORD_BOT_TOKEN|DISCORD_CLIENT_ID|DISCORD_CLIENT_SECRET)=/{print $1, (length($2)>0 ? "set" : "EMPTY")}' .env
```

## Changing the web address

The address appears in three places. Change all of them, then `docker compose up -d`:
1. `.env` on the VM: `SITE_ADDRESS` and `PUBLIC_BASE_URL`.
2. Developer Portal > OAuth2 > Redirects: `https://<new address>/auth/callback`.
3. Developer Portal > General Information: the Privacy Policy and Terms of Service URLs.

The sslip.io address contains the VM's IP (`35-225-68-147` is `35.225.68.147`), so it changes only if the static IP is released. Keep that IP reserved and in use.

## A person asks you to delete their data

They can do it themselves with **Delete my data** on the home page. If they cannot (for example they cannot log in), you can do it for them. It is refused while they still run a group, which has to be deleted first.

```bash
docker compose exec app python -c "
from sqlalchemy import select
from app import db, services
from app.models import User
with db.SessionLocal() as s:
    user = s.scalar(select(User).where(User.discord_id == '<their discord id>'))
    print(services.delete_user_data(s, user) if user else 'no such person')
"
```

It prints how many rows of each kind it removed.

## Common problems

| Symptom | What to check |
|---|---|
| The site will not load | `docker compose ps`. If `caddy` is down, `docker compose up -d`. If both are running, check the VM is running in the console and ports 80 and 443 are open (VPC network > Firewall). |
| "502 Bad Gateway" | The app is unhealthy: `docker compose logs --tail 80 app`. |
| The bot is offline in Discord | `docker compose logs app | grep -i -E "token|rejected|ready"`. A rejected token means the token was reset: update `.env`. |
| Slash commands missing or old | They sync when the app starts; a change can take up to an hour to reach every server. |
| Logging in fails with "invalid redirect_uri" | The redirect in the Developer Portal must be exactly `https://<address>/auth/callback`. |
| Links in Discord point to `localhost` | A second copy of the bot is running somewhere with the same token (a laptop, an IDE). Stop it, or reset the token so only the VM has the new one. |
| Reminders did not arrive | The log says why (`docker compose logs app | grep -i reminder`). Members who closed their direct messages still get the channel post. |
| Disk is filling up | `df -h` and `docker system df`. Free space with `docker image prune -f`. Old backups beyond the newest 14 are removed automatically. |
| The VM seems slow | It has 1 GB of memory and 2 GB of swap (`free -h`). Restarting the app is safe: `docker compose restart app`. |

## Costs to keep an eye on

The VM is free inside Google's "Always Free" allowance (one `e2-micro` in `us-central1`, 30 GB of standard disk). Your **$1 budget alert** emails you if that changes. Look at **Billing > Reports** now and then. The free terms are Google's and can change; the same Docker setup runs on any small Linux server.

## Turning things off

- `CHRONOMANCER_COMPACT=0` in `.env`: stop dropping old availability.
- `CHRONOMANCER_BOT=0` in `.env`: run only the website (the bot goes offline).
- `docker compose down`: stop everything (data stays in `data/`). `docker compose up -d` brings it back.
