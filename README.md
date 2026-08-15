# The Reading Room

A personal PDF reader: upload books, read them with a smooth virtualized
viewer (only nearby pages render, unlike Brave's built-in viewer), your
page position is saved automatically, and you can select any passage and
ask an AI to summarize it or answer a question about it.

Same codebase runs **locally only** or **deployed** — nothing to rewrite,
just a couple of settings change. See the bottom of this file for the
tradeoffs.

---

## 1. Software you need to install (one-time)

| Tool | Why | Get it |
|---|---|---|
| **Node.js** (v20 or later) | Runs both the backend and frontend | [nodejs.org](https://nodejs.org) — installer for macOS |
| **Git** | To keep this in version control (and required for deploying) | Usually already on macOS; check with `git --version` |
| **VS Code** (or any editor) | Editing the code | [code.visualstudio.com](https://code.visualstudio.com) |
| **A free Gemini API key** | Powers the "Ask AI" feature | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) — sign in with any Google account, click "Create API key". No credit card needed. |

Check Node installed correctly:
```bash
node -v   # should print v20.x or higher
npm -v
```

---

## 2. Project structure

```
pdf-reader/
├── backend/     ← Express API: file storage, progress, AI proxy
└── frontend/    ← React app: library grid + PDF reader
```

---

## 3. Run it locally first

Open **two terminal tabs** — one for the backend, one for the frontend.

**Terminal 1 — backend:**
```bash
cd backend
npm install
cp .env.example .env
```
Open `.env` and paste your Gemini API key into `GEMINI_API_KEY=`. Leave
`APP_PASSWORD` blank for local use.
```bash
npm start
```
You should see `Reader backend running on http://localhost:3001`.

**Terminal 2 — frontend:**
```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```
Open the URL it prints (usually `http://localhost:5173`). Upload a PDF and
start reading.

That's it — this is a fully working local app. Your PDFs live in
`backend/uploads/`, your progress lives in `backend/library.db`.

---

## 4. If you decide to host it instead

The exact same code deploys with **three configuration changes**, no code
rewrites:

1. **Backend → Azure VM** (use your GitHub Student Pack credit)
   - Create a small Ubuntu VM (B1s/B2s tier is plenty)
   - `git clone` your repo onto it, `cd backend`, `npm install`
   - Set real values in `.env`: crucially, set `APP_PASSWORD` to something
     only you know (this app has no user accounts — a shared password is
     the whole auth model), and set `ALLOWED_ORIGINS` to your Vercel URL
   - Run it persistently with [pm2](https://pm2.keymetrics.io/):
     `npm install -g pm2 && pm2 start server.js --name reader && pm2 save`
   - Put nginx in front for HTTPS via Certbot, or use your free Namecheap
     SSL cert, and point your free `.me`/`.tech` domain at the VM

2. **Frontend → Vercel**
   - Push `frontend/` to GitHub, import it in Vercel
   - Set the environment variable `VITE_API_URL` to your backend's public
     URL (e.g. `https://api.yourdomain.me`)
   - Deploy — Vercel handles the rest

3. **Update CORS**
   - Make sure `ALLOWED_ORIGINS` in the backend `.env` includes your real
     Vercel domain (comma-separated if you need more than one)

Once `APP_PASSWORD` is set, the app automatically shows a login screen —
no extra code needed, it's already built in.

Want the detailed step-by-step for the Azure VM (firewall rules, nginx
config, Certbot commands)? Just ask and I'll walk through it.

---

## 5. Local-only vs. hosted — pros and cons

### Running it only on your Mac
**Pros**
- Completely free, forever — no credits to track or run out
- Fastest possible experience — zero network latency
- Total privacy — your books and reading data never leave your laptop
- Nothing to secure — it's not reachable from the internet, so no
  password/auth system needed
- Simplest to maintain — no server, domain, or certificate to manage

**Cons**
- Only usable on that one Mac — no reading from your phone or another
  computer
- You have to manually start both servers each time you want to read
  (or set up a background launch agent)
- No off-machine backup by default — if the laptop's drive fails, your
  library and progress go with it (mitigate with Time Machine/iCloud)

### Deployed (Azure VM + Vercel)
**Pros**
- Read from anywhere — phone, another computer, a friend's browser
- Always on — no need to remember to start anything
- Feels like a real product, with your own domain and HTTPS
- Free at this scale thanks to your Student Pack credit

**Cons**
- More moving parts — VM, DNS, HTTPS, deployments to keep working
- You're responsible for securing it (the built-in password gate covers
  the basics, but it's still a public URL)
- Slight network latency vs. local
- Credit isn't infinite — worth glancing at usage occasionally, though a
  personal-scale app will sip it slowly

**A reasonable middle ground:** run it locally for a week or two first —
confirm you like the reading experience and the AI panel is useful —
then deploy once you're sure it's worth having on your phone too.
