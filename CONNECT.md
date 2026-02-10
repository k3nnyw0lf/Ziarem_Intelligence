# Connect Ziarem to Lovable, GitHub, and Hostinger

Use this guide to connect your Ziarem Intelligence project to **Lovable** (frontend/app builder), **GitHub** (code and sync), and **Hostinger** (VPS + PostgreSQL).

---

## 1. GitHub (repository and version control)

### Create a new repository on GitHub

1. Go to [github.com](https://github.com) → **Repositories** → **New**.
2. Name it (e.g. `Ziarem_Intelligence`), set **Private** or **Public**, do **not** initialize with a README (you already have one).
3. Copy the repo URL (e.g. `https://github.com/YOUR_USERNAME/Ziarem_Intelligence.git`).

### Push this project to GitHub

**One-time:** set your Git identity (use your name and GitHub email):

```powershell
git config --global user.email "your@email.com"
git config --global user.name "Your Name"
```

Then in your project folder:

```powershell
cd c:\Users\Kenne\Ziarem_Intelligence

# If you haven't committed yet:
git add .
git commit -m "Initial commit: Ziarem API, leads, raw_leads, dictionaries"
git branch -M main

git remote add origin https://github.com/YOUR_USERNAME/Ziarem_Intelligence.git
git push -u origin main
```

Replace `YOUR_USERNAME/Ziarem_Intelligence` with your actual repo URL.  
If GitHub asks for auth, use a **Personal Access Token** (Settings → Developer settings → Personal access tokens) as the password.  
*(Git is already initialized and files are staged; you only need to commit after setting user.name/user.email, then add remote and push.)*

---

## 2. Lovable (frontend / app builder)

Lovable is used to build the **frontend** (UI) that can call your Ziarem API.

### Connect Lovable to GitHub

1. Go to [lovable.dev](https://lovable.dev) and sign in.
2. In Lovable: **Settings** or **Integrations** → **Connect to GitHub**.
3. Authorize the **Lovable** GitHub app and choose which repos it can access (e.g. only `Ziarem_Intelligence`).
4. In your Lovable project: **Connect project to GitHub** and select the `Ziarem_Intelligence` repo (or the repo where your Lovable frontend lives).
5. Lovable will sync with the **main** branch: changes in Lovable push to GitHub, and pulls from GitHub update Lovable.

### Use your Hostinger API in Lovable

- In Lovable, set the **API base URL** to your Hostinger API (e.g. `https://your-domain.com` or `https://api.yourdomain.com`).
- Use **environment variables** in Lovable for that URL so you can switch between local and production.

Your Node.js API (this repo) runs on **Hostinger**; Lovable only needs the **URL** and possibly an API key if you add auth later.

---

## 3. Hostinger (VPS + database and API)

You already use Hostinger for **PostgreSQL** (Ziarem database). You can also run the **Node.js API** on the same VPS or a separate one.

### Option A: Hostinger “Node.js app” (GitHub deploy)

1. In **hPanel** (Hostinger): **Advanced** → **Node.js** (or **Applications**).
2. **Create application** → choose **Deploy from GitHub**.
3. Connect your GitHub account and select the **Ziarem_Intelligence** repo and branch (e.g. `main`).
4. Set **Build command:** `npm install` and **Start command:** `npm start` (or `node src/server.js`).
5. Add **Environment variables** (same as `.env`):
   - `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGSSLMODE=require`, `PORT=3000`
6. Deploy. Hostinger will build and run the API; note the **URL** (e.g. `https://your-app.hostinger.site`).

### Option B: Hostinger VPS (SSH + Git)

1. In **hPanel** → **VPS** → open your VPS (SSH details: IP, user, password or SSH key).
2. On the VPS (e.g. Ubuntu):
   - Install Node.js (v18+), npm, and (optional) PM2.
   - Clone the repo:  
     `git clone https://github.com/YOUR_USERNAME/Ziarem_Intelligence.git && cd Ziarem_Intelligence`
   - Create `.env` with your PostgreSQL and `PORT` settings.
   - Run `npm install` and `npm start` (or use PM2 for a long-running process).
3. Open port **3000** (or your `PORT`) in the VPS firewall and (if needed) in Hostinger’s firewall.
4. For HTTPS and a domain, use Hostinger’s proxy/SSL or Nginx as reverse proxy.

### Database (already on Hostinger)

- PostgreSQL is usually in **hPanel** → **Databases** (or on the same VPS).
- Use the same **PGHOST**, **PGUSER**, **PGPASSWORD**, **PGDATABASE** in the Node.js app’s `.env` so the API connects to the Ziarem database.
- Run the schema migrations (001–004) on that database if you haven’t already.

---

## Quick reference

| Service    | Purpose |
|-----------|--------|
| **GitHub** | Store and sync code; connect Lovable and Hostinger to the same repo. |
| **Lovable** | Build and host the frontend; connect to GitHub; call your Hostinger API URL. |
| **Hostinger** | Run PostgreSQL (Ziarem DB) and the Node.js API (this project); optionally deploy from GitHub. |

**Security:** Never commit `.env` or secrets. They are in `.gitignore`. Set them in Hostinger’s “Environment variables” and in Lovable’s env/config.
