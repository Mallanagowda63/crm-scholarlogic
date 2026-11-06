# Hosting a test copy on a VPS

These steps put ScholarLogic on an Ubuntu VPS, such as the Hostinger KVM 2 server, so people can try it in a browser. Each command runs on the server unless it says otherwise.

This is a **test copy** with sample data and demo sign-in buttons. Before real students' details go on it, work through `GO_LIVE.md`.

## 1. Connect to the server

On your own computer, open a terminal and run:

```bash
ssh root@187.127.170.122
```

Use the root password from the Hostinger panel. If you've forgotten it, click **Reset password** on the VPS Overview page.

## 2. Install what the app needs

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

## 3. Turn on the firewall

This allows only SSH and web traffic, so the app's own port (3000) and the database stay private.

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
```

## 4. Download the code

```bash
cd /opt
git clone https://github.com/Mallanagowda63/crm-scholarlogic.git
cd crm-scholarlogic
git checkout phase-9
```

If the GitHub repository is private, Git asks for a username and password. Use your GitHub username and a **personal access token** (GitHub → Settings → Developer settings → Personal access tokens) as the password.

## 5. Create the settings file

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

## 6. Set up the database and sample data

```bash
npm ci
npm run db:up        # starts Postgres in Docker
npm run db:deploy    # creates the tables
npm run seed         # sample data and the demo accounts
```

`npm run seed` erases everything in the database, so only run it on a test copy.

## 7. Build and start the app

```bash
npm run build
pm2 start npm --name scholarlogic -- start -- -H 127.0.0.1 -p 3000
pm2 save
pm2 startup          # then run the command it prints
```

`-H 127.0.0.1` keeps the app private, so visitors reach it through Nginx in the next step.

## 8. Put Nginx in front

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

## 9. Optional: use a web address with HTTPS

1. In the DNS settings for `scholarlogiclms.in`, add an **A record**: name `crm`, value `187.127.170.122`.
2. Once it's live, replace the `server_name` line in the Nginx file with `server_name crm.scholarlogiclms.in;`, then run `nginx -t && systemctl reload nginx`.
3. Get a free certificate:

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d crm.scholarlogiclms.in
```

The app is then at **https://crm.scholarlogiclms.in**.

## Updating after a new push

```bash
cd /opt/crm-scholarlogic
git pull
npm ci
npm run db:deploy
npm run build
pm2 restart scholarlogic
```

## When something goes wrong

| Problem | Check |
|---|---|
| The page doesn't load | `pm2 logs scholarlogic` for app errors, and `systemctl status nginx` |
| "502 Bad Gateway" | The app isn't running. Use `pm2 restart scholarlogic`, then check the logs |
| Database errors | `docker ps` should list `scholarlogic-postgres-1` as healthy. If not, run `npm run db:up` |
| Sign-in fails on HTTPS | `AUTH_TRUST_HOST=true` must be in `.env`. Restart after changing `.env` |
