# Deploying Creature Cauldron

```
visitor's browser
   ├── https://creaturecauldron.com          Cloudflare Pages: the page (static files, free)
   └── https://api.creaturecauldron.com      Cloudflare Tunnel ──► your PC: the server on 127.0.0.1:8000
                                                                    └── Anthropic API (only when generating)
```

The page works without the server (the 939-monster library, encounters, exports); only Generate, Reskin and Polymorph need it. If your PC is
off, the page says "Can't reach the generator server just now" and everything else keeps working.

The tunnel only makes an *outbound* connection from your PC, so there is no port forwarding and your home address is never exposed. The server
listens on `127.0.0.1` only: the tunnel is the one door.

## What is already in the repository

| File | What it does |
|---|---|
| `frontend/.env.production` | Bakes the server's public address (`https://api.creaturecauldron.com`) into the build. Not a secret. |
| `frontend/public/_headers` | Security headers Cloudflare Pages sends: a strict Content-Security-Policy (own files only; the page may talk to the API and nothing else), no sniffing, no camera or microphone. Checked against the built page: no violations. |
| `deploy/run-server.ps1` | Starts the server for real use and starts it again if it stops. Reads the API key and settings from a file **outside** the project, into that process only. Writes one log file per day (stopping at 50 MB a day), keeps two weeks, and warns if the key looks mistyped. |
| `deploy/secrets.env.example` | The shape of that file. |
| `deploy/backup_db.py` | A safe copy of the database (every generated monster, plus the day's spend count). Keeps the newest 14. |
| `python -m cauldron.service.smoke` | A real-key check: plain, `--remix`, `--reflavor`, `--polymorph`. |
| `.gitignore` | Now ignores `.env`, `*.env` and `secrets/`. |

## One-time setup

### 1. The page on Cloudflare Pages

Cloudflare dashboard, **Workers & Pages**, **Create**, **Pages**, **Connect to Git**, choose the `DndPortfolio` repository.

- Production branch: the branch you merge to (`master`).
- Framework preset: none.
- Root directory: `creature-cauldron/frontend`
- Build command: `npm ci && npm run build`
- Build output directory: `dist`
- Environment variable: `NODE_VERSION` = `22` (if the build complains, try `24`).

After the first deploy: **Custom domains**, add `creaturecauldron.com` (Cloudflare adds the DNS record for you). Add `www.creaturecauldron.com` too and
redirect it to the main address (a Redirect Rule: hostname equals `www.creaturecauldron.com`, redirect to `https://creaturecauldron.com`).

Every push now rebuilds the page. Branch previews on `*.pages.dev` are created too; the server's CORS list allows only `https://creaturecauldron.com`, so a preview
can show the library but cannot call the server. That is intended.

### 2. The server on your PC

1. Make sure the tests pass here: `backend\.venv\Scripts\python -m pytest -q`.
2. Make the secrets folder and file, **outside the project**:
   ```powershell
   New-Item -ItemType Directory -Force C:\cauldron
   Copy-Item deploy\secrets.env.example C:\cauldron\secrets.env
   icacls C:\cauldron\secrets.env /inheritance:r /grant:r "${env:USERNAME}:(R,W)"
   notepad C:\cauldron\secrets.env      # fill in ANTHROPIC_API_KEY on launch day, not before
   ```
3. Try it: `powershell -ExecutionPolicy Bypass -File deploy\run-server.ps1`, and in a second window `curl http://127.0.0.1:8000/api/v1/health`. It should say `{"status":"ok"}`.
   (Without a key the server still starts: the library and anything cached work, and generating says the forge cannot be reached.)
4. Start it at boot and restart it on failure. In an **administrator** PowerShell (change the path to where the project is):
   ```powershell
   $script = "C:\Users\iamlo\IdeaProjects\UWSchoolWork\DndPortfolio\creature-cauldron\deploy\run-server.ps1"
   $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`""
   $trigger = New-ScheduledTaskTrigger -AtStartup
   $settings = New-ScheduledTaskSettingsSet -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable
   $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Limited
   Register-ScheduledTask -TaskName "Creature Cauldron server" -Action $action -Trigger $trigger -Settings $settings -Principal $principal
   ```
   Then set the PC's power plan to never sleep while plugged in, or the site goes quiet at night.
5. A nightly backup of the database, as a second task that also runs when you are logged out (the script finds the database the server uses, including one set
   with `CAULDRON_DATABASE` in the secrets file):
   ```powershell
   $python = "C:\Users\iamlo\IdeaProjects\UWSchoolWork\DndPortfolio\creature-cauldron\backend\.venv\Scripts\python.exe"
   $script = "C:\Users\iamlo\IdeaProjects\UWSchoolWork\DndPortfolio\creature-cauldron\deploy\backup_db.py"
   $action = New-ScheduledTaskAction -Execute $python -Argument "`"$script`""
   $trigger = New-ScheduledTaskTrigger -Daily -At 3am
   $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Limited
   Register-ScheduledTask -TaskName "Creature Cauldron backup" -Action $action -Trigger $trigger -Principal $principal
   ```
   Copies go to `C:\cauldron\backups`. Once in a while, copy that folder somewhere that is not this PC.

### 3. The tunnel

1. Install: `winget install --id Cloudflare.cloudflared`.
2. Cloudflare dashboard, **Zero Trust**, **Networks**, **Tunnels**, **Create a tunnel**, **Cloudflared**, name it `cauldron`, choose **Windows**. The page shows an
   install command ending in a long token; run it in an administrator terminal. It installs a Windows service that starts at boot and reconnects by itself.
   **The token is a password for your tunnel: do not paste it in chat, the repository or a screenshot.** (Zero Trust may ask you to pick the free plan and add
   a payment method for verification; the plan costs nothing.)
3. On the tunnel's **Public hostname** tab: subdomain `api`, domain `creaturecauldron.com`, service type `HTTP`, URL `127.0.0.1:8000` (use the numbers, not `localhost`).
4. On `creaturecauldron.com`: **SSL/TLS** set to Full, **Always Use HTTPS** on, minimum TLS 1.2.
5. **Security, WAF, Rate limiting rules** (the free plan has one rule): when the URI Path starts with `/api/v1/`, block an address that makes more than 20 requests
   in 10 seconds. The server's own limits (3 a minute, 10 an hour for AI work) do the real job; this stops floods before they reach your PC.

### 4. Why the visitor's address comes from a header

Behind a tunnel every request arrives from the tunnel program, not from the visitor. Cloudflare adds the real address in `CF-Connecting-IP`, and
`run-server.ps1` sets `CAULDRON_TRUSTED_PROXY_HEADER=CF-Connecting-IP`, so the per-visitor limits count real people. The header is believed only because the
server is reachable *only* through the tunnel; never open the server to the network directly. An IPv6 visitor is counted by their /64 network prefix, not their single address: one home
connection owns billions of addresses and could otherwise start every request from a new one.

## Key safety

- The key lives in `C:\cauldron\secrets.env` only (permissions: you). It is read into the server process by `run-server.ps1`; the settings code never sees it, the logs
  never print it, and failed calls show visitors a generic message.
- It is never in the repository (`.gitignore` blocks `.env`, `*.env` and `secrets/`), never in the page (the build gets only the public server address), and never in a URL.
- Make a **new key just before launch** in the Console workspace that has the spend limit, and revoke any older key. If a key ever leaks, revoke it in the Console and put a new one
  in the secrets file; nothing else changes.
- Layers between a stranger and your bill: the page shows cached monsters first (free); the edge rule above; 3 a minute and 10 an hour per visitor; a daily cap of 100 AI calls
  (under 20 cents a day at worst, retries included); challenge rating capped at 17; small request bodies; and the Console's own monthly spend limit, which stops everything.

## Launch day checklist

- [ ] Both suites pass; `npm run build` works.
- [ ] The second code review pass is done (it should cover Reflavor, Polymorph and the A5E import).
- [ ] The A5E line in `frontend/public/legal/OGL-1.0a.txt` (Section 15) is checked against the printed book; the Licences page reads right.
- [ ] New key made and put in `C:\cauldron\secrets.env`; old key revoked; the Console spend limit and workspace confirmed.
- [ ] Real-key checks, one at a time (each costs a fraction of a cent). In a terminal in `backend`, type the key for this window only, then close the window afterwards:
      ```powershell
      $env:ANTHROPIC_API_KEY = "paste it here"
      .venv\Scripts\python -m cauldron.service.smoke --yes
      .venv\Scripts\python -m cauldron.service.smoke --yes --remix
      .venv\Scripts\python -m cauldron.service.smoke --yes --reflavor
      .venv\Scripts\python -m cauldron.service.smoke --yes --polymorph
      ```
      Reflavor and Polymorph (the forge choosing features and naming legendary actions) have only been tested with stand-ins so far: this is their first real run.
- [ ] Start (or restart) the task and the tunnel. `https://api.creaturecauldron.com/api/v1/health` answers `{"status":"ok"}` from your phone on mobile data.
- [ ] Open `https://creaturecauldron.com`: no "Can't reach" note; Generate, Reskin, Reflavor and Polymorph work.
- [ ] Prove the per-visitor limit sees real addresses: press Generate four times quickly on the PC (the fourth is told to slow down), then try once on the phone on mobile data (it works).
- [ ] The backup task ran once (`C:\cauldron\backups` has a file) and the Cloudflare rate rule is on.
- [ ] For the first month, glance at the Console's usage page and Cloudflare's analytics once a week.

## Day to day

- **Page changes:** push; Cloudflare rebuilds.
- **Server changes:** stop the task, `git pull`, run the tests, start the task. The log is `C:\cauldron\logs\server-<date>.log`.
- **Library changes** (new importer runs): rebuild the JSON files, push; the server reads them at start, so restart it too.
- **Take generation offline at once:** stop the tunnel (Zero Trust, Tunnels, `cauldron`, stop) or the scheduled task. The static library keeps working.
- **Costs look wrong:** lower `CAULDRON_DAILY_CAP` in the secrets file and restart; the Console limit remains the hard stop.

## What is stored and logged

Visitors have no accounts and no cookies; saved encounters and generated monsters stay in their own browser. The server remembers addresses only in memory, for the rate
limits (cleared on restart). Its log files hold the address and path of each request for two weeks, and Cloudflare keeps its own analytics. The database holds the monsters
the forge has made (shared with every visitor) and the day's call count.

## Known limits

One PC is one point of failure (power, sleep, Windows updates). The per-visitor limit is per address, so a visitor on a shared network shares a bucket. The limits reset when the
server restarts, but the daily cap does not (it lives in the database). The cap counts UTC days. A "let the forge choose" polymorph, and a reflavor of a monster that has fewer than three, are never reused, so each
press is a fresh AI call: a handful of visitors can use up the day's allowance in a few hours, which puts the forge in "resting" (the library keeps working). The cap and
the Console limit, not the cache, are the ceiling for those two paths. Several people pressing Reflavor at the same moment can also leave a monster with a fourth reflavor; that is harmless.
