# Push to GitHub

Your latest changes are **committed** on branch `main`. To push:

### 1. Create the repo on GitHub (if you haven’t)

- Go to [github.com](https://github.com) → **Repositories** → **New**
- Name: `Ziarem_Intelligence` (or any name)
- **Do not** add a README or .gitignore (you already have them)
- Create the repository

### 2. Add your repo and push

In PowerShell, from the project folder:

```powershell
cd c:\Users\Kenne\Ziarem_Intelligence

git remote add origin https://github.com/YOUR_USERNAME/Ziarem_Intelligence.git
git push -u origin main
```

Replace `YOUR_USERNAME/Ziarem_Intelligence` with your real GitHub username and repo name.

If GitHub asks for a password, use a **Personal Access Token** (GitHub → Settings → Developer settings → Personal access tokens), not your account password.

---

**Optional:** Update your Git identity for future commits:

```powershell
git config --global user.email "your@email.com"
git config --global user.name "Your Name"
```

(For this repo we used a local identity so the first commit could be made.)
