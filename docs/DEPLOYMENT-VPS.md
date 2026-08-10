# Deploying to a VPS with a Static IP (recommended for LIVE trading)

Since **2026-04-01**, Angel One / SEBI rules mean **live orders are only accepted from an IP
registered in your SmartAPI app**. A VPS gives you (1) a genuine static public IP and (2) an
always-on machine for the API + live worker — your home PC can be off while strategies run.

```
┌─────────────┐   browser    ┌──────────────────────── VPS (static IP) ──────────────┐
│  Your PC    │ ───────────▶ │ algo-frontend (5173) · algo-backend (4000) · algo-worker │
└─────────────┘              └──────┬──────────────────────┬───────────────────────────┘
        ┌─────── Supabase (managed cloud, no static IP needed) ───────┐◀┘
        └─────────────────────────────────────────────────────────────┘
        Angel One SmartAPI ◀─ orders/data only from the VPS static IP (whitelisted)
```

## 1. Create the VPS (≈10 min)

Any provider works; pick one and its instructions apply:

| Provider | Cheapest suitable plan | Static IP |
|---|---|---|
| **Oracle Cloud Always Free** (`cloud.oracle.com`) — **FREE, recommended for this project** | Ampere A1.Flex ARM: up to **4 OCPU + 24 GB RAM, forever free** (create 1 VM with 2 OCPU / 8 GB) | Public IP is static; reserved IPs free |
| AWS Lightsail (`lightsail.aws.amazon.com`) | $5/mo (1 vCPU, 2 GB) | Create instance → **Networking → "Create static IP" → attach** (IP stays fixed forever, even through reboots) |
| DigitalOcean (`cloud.digitalocean.com`) | $6/mo Droplet (2 GB) | The droplet's public IP **is static** — no extra step |

**Oracle Free notes:**
- Sign-up asks for a credit/debit card for **verification only** (no charge, Always Free never expires).
- **Home region is permanent** — pick **ap-mumbai-1 (Mumbai)** at signup (fallback: ap-hyderabad-1).
- Image: **Ubuntu 24.04 (aarch64/ARM)** · Shape: **VM.Standard.A1.Flex** (2 OCPU, 8 GB is plenty).
- All project deps are pure JS and run fine on ARM64 (Node 20 from NodeSource supports it) — the setup commands below work unchanged.
- A1 capacity in Mumbai occasionally shows "out of capacity" — retry off-hours, or use the always-available fallback shape **VM.Standard.E2.1.Micro** (x86, 2 × 1 GB RAM free; add a 2 GB swapfile since the scrip-master sync is memory-hungry: `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`).
- Open ports in **two** places on OCI: the VCN **Security List** (Networking → Virtual Cloud Networks → your VCN → Security Lists → Add Ingress Rules: 22/4000/5173 TCP) **and** the VM's own firewall (`sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 4000 -j ACCEPT` → `sudo netfilter-persistent save`, repeat for 5173).

Settings: **Ubuntu 24.04 LTS**, region **Mumbai** (low latency to NSE/Angel), open ports
**22 (SSH), 4000 (API), 5173 (UI)** in the provider's networking/firewall page.

**Write down the static IP** (example below uses `15.206.90.10` — replace with yours).

## 2. Tell Angel One the static IP

SmartAPI portal → login → **My Profile → My APIs** → edit your app (or **Add App**):

- Primary Static IP = your VPS IP
- Redirect URL = `http://YOUR_IP:5173` (placeholder; our login uses API key + MPIN + TOTP)
- Post back URL: blank

## 3. Server setup (SSH in, then copy-paste)

```bash
ssh root@YOUR_IP

# ── Node.js 20 ──
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs git

# ── Get the code (private repo: use a token, or upload a zip with scp) ──
git clone https://github.com/YOU/algo-trading-platform.git
cd algo-trading-platform

# ── Install + build ──
npm install
npm run build           # builds rule-schema → backend/dist → frontend/dist
```

## 4. Environment files

`backend/.env`  (same values as your local backend/.env, **except** FRONTEND_URL):

```env
PORT=4000
FRONTEND_URL=http://YOUR_IP:5173
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
BROKER_ENCRYPTION_KEY=<same 64-hex key you use locally>
CRON_SECRET=<same random hex>
```

`frontend/.env`:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY
VITE_API_BASE_URL=http://YOUR_IP:4000
```

> ⚠️ Keep `BROKER_ENCRYPTION_KEY` identical to your local value — otherwise stored
> broker credentials can't be decrypted. Rebuild the frontend after writing its .env: `npm run build -w frontend`.

## 5. Run 24/7 with PM2

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs     # starts algo-backend, algo-worker, algo-frontend
pm2 save
pm2 startup                        # prints one more command — run it (auto-start on reboot)
```

Useful: `pm2 status` · `pm2 logs algo-worker` · `pm2 restart all`

## 6. One-time data jobs

```bash
# Load the instrument master (or wait for the 06:00 IST cron)
curl -X POST http://localhost:4000/internal/jobs/instrument-sync -H "x-cron-secret: YOUR_CRON_SECRET"
```

In the Supabase dashboard, update the edge-function secret **`INTERNAL_API_BASE_URL = http://YOUR_IP:4000`**
so the pg_cron jobs (instrument sync 06:00, token refresh 08:00, house-keeping) hit the VPS.

## 7. Use it

1. Open `http://YOUR_IP:5173` from anywhere → log in.
2. Broker page → **Connect Broker** (API key + client code + MPIN + TOTP secret).
3. Run a strategy in **paper** first; when happy, flip to **Live** — orders now originate from the whitelisted VPS IP. ✅

## Updating later

```bash
cd algo-trading-platform && git pull && npm install && npm run build && pm2 restart all
```

## (Optional) HTTPS + a domain

Browsers treat `http://IP` apps as "not secure" and some browsers nag on login forms. Cheap fix:
create a free **DuckDNS** subdomain (`yourname.duckdns.org` → your IP), install **Caddy** and point it at
port 4000 (API) and 5173 (UI) — it provisions HTTPS automatically. Then set `FRONTEND_URL`,
`VITE_API_BASE_URL=https://yourname.duckdns.org/api`-style URLs accordingly and update the SmartAPI app's
redirect URL. Plain-`http://IP` works fine for personal use without this.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Orders rejected, message about static IP | SmartAPI app IP ≠ current VPS IP → update in portal (SmartAPI → My APIs) |
| UI loads, every API call `ERR_CONNECTION_REFUSED` | `pm2 status` — backend down? Or provider firewall: port 4000 not open |
| Login works but data empty | `INTERNAL_API_BASE_URL` secret still points at localhost |
| Broker "token expired" every morning in UI | 08:00 IST cron not reaching backend (same secret issue as above) |
| RAM pressure on 1 GB plan | Scrip-master sync parses a big JSON — prefer 2 GB plan |
