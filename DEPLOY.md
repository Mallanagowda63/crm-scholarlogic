# Hosting a test copy

There are two ways to put a **test copy** online, with sample data and demo sign-in buttons. Before real students' details go on either, work through `GO_LIVE.md`.

- **Render**: quickest, with no server to manage. See [On Render](#on-render).
- **A VPS**, such as the Hostinger KVM 2 server. See [On a VPS](#on-a-vps).

## On Render

`render.yaml` in this repository describes the app and its database, so Render sets them up together.

1. Sign in at [render.com](https://render.com) with your GitHub account.
2. Click **New → Blueprint**, choose the `crm-scholarlogic` repository, and click **Apply**. Render creates the database, builds the app from the `phase-9` branch, and starts it. The first build takes about 5–10 minutes.
3. When `scholarlogic-crm` shows **Live**, open its address, such as `https://scholarlogic-crm.onrender.com`. The sign-in page appears, but there are no accounts yet.
4. Fill the database with sample data and the demo accounts. This runs on your own computer:
   1. In Render, open **scholarlogic-db** and copy the **External Database URL**.
   2. Note its host: the part between `@` and the next `/`, such as `dpg-abc123-a.singapore-postgres.render.com`.
   3. In PowerShell, in the project folder, run these, pasting in your URL and host:

   ```powershell
   $env:DATABASE_URL = "<External Database URL>"
   $env:ALLOW_SEED_ON_HOST = "<host>"
   npm run seed
   Remove-Item Env:DATABASE_URL, Env:ALLOW_SEED_ON_HOST
   ```

   It takes a few minutes over the internet. The last line makes sure later commands go back to your local database.
5. Reload the site and click **Admin** on the sign-in page.

Things to know about Render's free plans:

- **Sleeping:** the app sleeps after 15 minutes without visitors, and the next visit takes about a minute to wake it.
- **Database expiry:** the free database expires after 30 days.
- **Uploaded documents:** these are lost whenever the app restarts or redeploys, because free plans have no lasting disk. Add a Render disk on a paid plan and set `UPLOAD_DIR` to its path to keep them.
- **Updates:** pushing to `phase-9` redeploys the app automatically.
- **Turning off the demo buttons:** delete `SHOW_DEMO_ACCOUNTS` under the service's **Environment** tab, and create a real admin from your computer. Set `$env:DATABASE_URL` to the External Database URL as in step 4, then run `npm run create-admin`.

## On a VPS

These steps put ScholarLogic on an Ubuntu VPS. Each command runs on the server unless it says otherwise.

### 1. Connect to the server

On your own computer, open a terminal and run:

```bash
ssh root@187.127.170.122
```

Use the root password from the Hostinger panel. If you've forgotten it, click **Reset password** on the VPS Overview page.

### 2. Install what the app needs

```bash
apt update && apt upgrade -y
apt install -y git nginx ufw

# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# Docker, which runs the database. Skip this if `docker --version` already works.
curl -fsSL https://get.docker.com | sh

# Keeps the app running and restarts it after a reboot
npm install -g pm2
```

### 3. Turn on the firewall

This allows only SSH and web traffic, so the app's own port (3000) and the database stay private.

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
```

### 4. Download the code

```bash
cd /opt
git clone https://github.com/Mallanagowda63/crm-scholarlogic.git
cd crm-scholarlogic
git checkout phase-9
```

If the GitHub repository is private, Git asks for a username and password. Use your GitHub username and a **personal access token** (GitHub → Settings → Developer settings → Personal access tokens) as the password.

### 5. Create the settings file

Create two random secrets and note them down:

```bash
openssl rand -hex 24      # database password
openssl rand -base64 32   # sign-in secret
```

Then create `.env` with `nano .env` and paste the lines below, filling in both secrets. The database password appears twice and must match.

```bash
POSTGRES_PASSWORD="<database password>"
DATABASE_URL="postgresql://scholarlogic:<database password>@localhost:5433/scholarlogic"
AUTH_SECRET="<sign-in secret>"
AUTH_TRUST_HOST=true
UPLOAD_DIR="/opt/crm-scholarlogic/uploads"

# Test copy only. Anyone who opens the site can sign in as admin while this is on.
SHOW_DEMO_ACCOUNTS="true"
```

Save with Ctrl+O, Enter, then Ctrl+X.

### 6. Set up the database and sample data

```bash
npm ci
npm run db:up        # starts Postgres in Docker
npm run db:deploy    # creates the tables
npm run seed         # sample data and the demo accounts
```

`npm run seed` erases everything in the database, so only run it on a test copy.

### 7. Build and start the app

```bash
npm run build
pm2 start npm --name scholarlogic -- start -- -H 127.0.0.1 -p 3000
pm2 save
pm2 startup          # then run the command it prints
```

`-H 127.0.0.1` keeps the app private, so visitors reach it through Nginx in the next step.

### 8. Put Nginx in front

Create the site with `nano /etc/nginx/sites-available/scholarlogic`:

```nginx
server {
    listen 80;
    server_name 187.127.170.122;

    # Documents can be up to 5 MB.
    client_max_body_size 6m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        # Replaces any address the browser sends, so sign-in limits can't be dodged.
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Then turn it on:

```bash
ln -s /etc/nginx/sites-available/scholarlogic /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

Open **http://187.127.170.122** in a browser. The sign-in page shows the demo buttons.

### 9. Optional: use a web address with HTTPS

1. In the DNS settings for `scholarlogiclms.in`, add an **A record**: name `crm`, value `187.127.170.122`.
2. Once it's live, replace the `server_name` line in the Nginx file with `server_name crm.scholarlogiclms.in;`, then run `nginx -t && systemctl reload nginx`.
3. Get a free certificate:

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d crm.scholarlogiclms.in
```

The app is then at **https://crm.scholarlogiclms.in**.

### Updating after a new push

```bash
cd /opt/crm-scholarlogic
git pull
npm ci
npm run db:deploy
npm run build
pm2 restart scholarlogic
```

### When something goes wrong

| Problem | Check |
|---|---|
| The page doesn't load | `pm2 logs scholarlogic` for app errors, and `systemctl status nginx` |
| "502 Bad Gateway" | The app isn't running. Use `pm2 restart scholarlogic`, then check the logs |
| Database errors | `docker ps` should list `scholarlogic-postgres-1` as healthy. If not, run `npm run db:up` |
| Sign-in fails on HTTPS | `AUTH_TRUST_HOST=true` must be in `.env`. Restart after changing `.env` |
