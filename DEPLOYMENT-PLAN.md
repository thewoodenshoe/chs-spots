no, # Continuous Deployment (CD) Architecture Plan

## Architecture Overview

```
┌─────────────────┐
│  Local Dev      │
│  (Your Laptop)  │
└────────┬────────┘
         │
         │ git push
         │
         ▼
┌─────────────────────────────────────┐
│     GitHub Repository               │
│     (thewoodenshoe/chs-spots)      │
└────────┬────────────────────────────┘
         │
         │ Trigger on push to main
         │
         ▼
┌─────────────────────────────────────┐
│     GitHub Actions (CI/CD)          │
│                                     │
│  1. Run Tests (existing)            │
│  2. Build Next.js App               │
│  3. Create Deployment Artifact      │
│  4. SSH to Ubuntu Server            │
│  5. Deploy & Restart Service        │
└────────┬────────────────────────────┘
         │
         │ SSH + rsync/scp
         │
         ▼
┌─────────────────────────────────────┐
│     Ubuntu Server (NUC)             │
│                                     │
│  ┌─────────────────────────────┐   │
│  │  Nginx (Port 80/443)        │   │
│  │  Reverse Proxy              │   │
│  └──────────┬──────────────────┘   │
│             │                       │
│             ▼                       │
│  ┌─────────────────────────────┐   │
│  │  Next.js App                │   │
│  │  (PM2/Systemd)              │   │
│  │  Port 3000                  │   │
│  └─────────────────────────────┘   │
│                                     │
│  ┌─────────────────────────────┐   │
│  │  Data Directory             │   │
│  │  /opt/chs-spots/data/       │   │
│  │  (persistent)               │   │
│  │  + SQLite DB (chs-spots.db) │   │
│  └─────────────────────────────┘   │
│                                     │
│  ┌─────────────────────────────┐   │
│  │  App Directory              │   │
│  │  /opt/chs-spots/app/        │   │
│  │  (deployed via CI/CD)       │   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

## Directory Structure on Server

```
/opt/chs-spots/
├── app/                      # Current deployed app
│   ├── .next/               # Next.js build output
│   ├── node_modules/        # Production dependencies
│   ├── public/              # Static assets
│   ├── src/                 # Source code
│   ├── scripts/             # Pipeline scripts
│   ├── package.json
│   └── package-lock.json
│
├── data/                     # Persistent data (gitignored)
│   ├── chs-spots.db         # SQLite database (all structured data)
│   ├── raw/
│   ├── silver_merged/
│   ├── silver_trimmed/
│   └── gold/
│
├── backups/                  # Deployment backups
│   └── 2026-01-20_14-30-00/
│
├── .env                      # Environment variables (secure)
└── pm2.config.js            # PM2 process manager config
```

## Environment Variables Required

**On GitHub (Secrets):**
- `DEPLOY_HOST` - Ubuntu server IP or domain
- `DEPLOY_USER` - SSH username (e.g., `deploy`)
- `DEPLOY_SSH_KEY` - Private SSH key for deployment
- `NEXT_PUBLIC_GOOGLE_MAPS_KEY` - Google Maps API key

**On Ubuntu Server (`.env` file):**
- `NEXT_PUBLIC_GOOGLE_MAPS_KEY` - Google Maps API key
- `GROK_API_KEY` - Grok API key for LLM extraction
- `DB_PATH` - SQLite database path (defaults to `<project>/data/chs-spots.db`)
- `NODE_ENV=production`
- `PORT=3000` (optional, Next.js default)

## Proposed Action Steps

### Phase 1: Server Setup & Configuration

#### Step 1.1: Initial Server Setup
- [ ] SSH into Ubuntu server on NUC
- [ ] Create deployment user (`deploy`) with sudo privileges (or use existing user)
- [ ] Set up SSH key authentication for `deploy` user
- [ ] Install Node.js 20.x (LTS) via nvm or official repository
- [ ] Install npm and verify Node.js version
- [ ] Create application directory structure:
  ```bash
  sudo mkdir -p /opt/chs-spots/{app,data,backups}
  sudo chown -R deploy:deploy /opt/chs-spots
  ```
- [ ] Set up proper permissions (755 for directories, 644 for files)

#### Step 1.2: Install & Configure Process Manager (PM2)
- [ ] Install PM2 globally: `npm install -g pm2`
- [ ] Create PM2 ecosystem config file at `/opt/chs-spots/pm2.config.js`
- [ ] Configure PM2 to start on system boot: `pm2 startup systemd`
- [ ] Test PM2 with a simple Node.js script

#### Step 1.3: Install & Configure Nginx
- [ ] Install Nginx: `sudo apt update && sudo apt install nginx -y`
- [ ] Create Nginx config file: `/etc/nginx/sites-available/chs-spots`
- [ ] Configure reverse proxy to forward port 80/443 → 3000
- [ ] Set up SSL/TLS with Let's Encrypt (if using domain name)
- [ ] Enable site: `sudo ln -s /etc/nginx/sites-available/chs-spots /etc/nginx/sites-enabled/`
- [ ] Test Nginx config: `sudo nginx -t`
- [ ] Start and enable Nginx: `sudo systemctl start nginx && sudo systemctl enable nginx`

#### Step 1.4: Configure Firewall
- [ ] Configure UFW (Uncomplicated Firewall):
  ```bash
  sudo ufw allow 22/tcp      # SSH
  sudo ufw allow 80/tcp      # HTTP
  sudo ufw allow 443/tcp     # HTTPS
  sudo ufw enable
  ```
- [ ] Verify firewall rules: `sudo ufw status`

#### Step 1.5: Set Up Environment Variables
- [ ] Create `.env` file at `/opt/chs-spots/.env` with production secrets
- [ ] Set proper permissions: `chmod 600 /opt/chs-spots/.env`
- [ ] Verify `.env` file is in `.gitignore` (should already be)

#### Step 1.6: Set Up Data Directory Persistence
- [ ] Create initial data directory structure under `/opt/chs-spots/data/`
- [ ] Set up cron job or systemd timer for data pipeline scripts (if needed)
- [ ] Document data backup strategy

### Phase 2: GitHub Actions Workflow Setup

#### Step 2.1: Generate SSH Key Pair for Deployment
- [ ] Generate SSH key pair (dedicated for deployment):
  ```bash
  ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/github_actions_deploy
  ```
- [ ] Copy public key to server's `~/.ssh/authorized_keys`:
  ```bash
  ssh-copy-id -i ~/.ssh/github_actions_deploy.pub deploy@YOUR_SERVER_IP
  ```
- [ ] Test SSH connection from local machine
- [ ] Add private key content to GitHub Secrets as `DEPLOY_SSH_KEY`

#### Step 2.2: Add GitHub Secrets
- [ ] Go to GitHub repo → Settings → Secrets and variables → Actions
- [ ] Add the following secrets:
  - `DEPLOY_HOST`: Your Ubuntu server IP or domain
  - `DEPLOY_USER`: SSH username (e.g., `deploy`)
  - `DEPLOY_SSH_KEY`: Private SSH key content (from Step 2.1)
  - `NEXT_PUBLIC_GOOGLE_MAPS_KEY`: Google Maps API key (if not already set)

#### Step 2.3: Create Deployment Workflow File
- [ ] Create `.github/workflows/deploy.yml`
- [ ] Configure workflow to trigger on push to `main` branch
- [ ] Set up workflow dependencies (run after test workflow passes)
- [ ] Configure build, deployment, and restart steps

### Phase 3: Deployment Script Creation

#### Step 3.1: Create Deployment Helper Script
- [ ] Create `scripts/deploy.sh` (to be executed on server via SSH)
- [ ] Script should handle:
  - Creating backup of current deployment
  - Extracting new deployment artifact
  - Installing production dependencies
  - Building Next.js app
  - Restarting PM2 process
  - Health check verification
  - Rollback on failure

#### Step 3.2: Create Pre-Deployment Validation
- [ ] Add health check endpoint to Next.js app (optional)
- [ ] Create deployment verification script
- [ ] Set up monitoring/logging for deployment status

### Phase 4: Initial Deployment & Testing

#### Step 4.1: Manual First Deployment
- [ ] Test deployment script manually on server
- [ ] Verify app builds successfully
- [ ] Verify PM2 starts app correctly
- [ ] Verify Nginx serves the app
- [ ] Test app functionality (maps, API endpoints)

#### Step 4.2: Test Automated Deployment
- [ ] Push a small change to `main` branch
- [ ] Monitor GitHub Actions workflow execution
- [ ] Verify deployment completes successfully
- [ ] Verify app is accessible and functional

#### Step 4.3: Test Rollback Procedure
- [ ] Intentionally break deployment (test)
- [ ] Verify rollback mechanism works
- [ ] Restore working version

### Phase 5: Monitoring & Maintenance Setup

#### Step 5.1: Set Up Logging
- [ ] Configure PM2 logs: `pm2 logs chs-spots`
- [ ] Set up log rotation for PM2 logs
- [ ] Configure application logs in `/opt/chs-spots/data/logs/`
- [ ] Set up log monitoring/alerting (optional)

#### Step 5.2: Set Up Health Checks
- [ ] Create health check endpoint (`/api/health`)
- [ ] Set up monitoring (PM2 monitoring or external service)
- [ ] Configure alerting for downtime (optional)

#### Step 5.3: Backup Strategy
- [ ] Document backup procedure for `/opt/chs-spots/data/`
- [ ] Set up automated backups (cron job or systemd timer)
- [ ] Test backup restoration procedure

## Deployment Workflow (GitHub Actions)

**Workflow Steps:**
1. ✅ **CI Phase** (existing test workflow)
   - Run all tests
   - Validate code quality
   
2. 🚀 **Build Phase** (new deployment workflow)
   - Install dependencies
   - Build Next.js app (`npm run build`)
   - Create deployment artifact (tar.gz or zip)
   - Upload artifact temporarily

3. 📦 **Deploy Phase**
   - Connect to server via SSH
   - Create backup of current deployment
   - Transfer new deployment artifact
   - Extract artifact on server
   - Install production dependencies (`npm ci --production`)
   - Build Next.js app on server (or use pre-built)
   - Restart PM2 process
   - Run health check
   - Rollback if health check fails

4. ✅ **Verification Phase**
   - Verify app is running
   - Verify endpoints respond
   - Clean up temporary artifacts

## Security Considerations

- ✅ Use dedicated deployment user with minimal privileges
- ✅ SSH key-based authentication (no passwords)
- ✅ Private keys stored in GitHub Secrets (encrypted)
- ✅ `.env` file not in repository (gitignored)
- ✅ Nginx rate limiting and security headers
- ✅ Firewall restricts access to necessary ports only
- ✅ Regular security updates on Ubuntu server
- ✅ SSL/TLS encryption for HTTPS traffic

## Rollback Strategy

**Automatic Rollback:**
- If health check fails after deployment, automatically restore previous backup
- Previous deployment stored in `/opt/chs-spots/backups/`

**Manual Rollback:**
```bash
# On server
cd /opt/chs-spots
pm2 stop chs-spots
rm -rf app
cp -r backups/LATEST_BACKUP app
cd app
npm ci --production
npm run build
pm2 restart chs-spots
```

## Next Steps After Basic CD Setup

- [ ] Set up staging environment (optional)
- [ ] Implement blue-green deployments (advanced)
- [ ] Set up monitoring and alerting (e.g., UptimeRobot, Sentry)
- [x] ~~Implement database migrations~~ (SQLite migration implemented)
- [ ] Set up CDN for static assets (optional)
- [ ] Implement deployment notifications (Slack, email)
e