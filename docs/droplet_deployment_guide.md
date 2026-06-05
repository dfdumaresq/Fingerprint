# DigitalOcean Droplet Deployment & Hardening Guide

This guide outlines the step-by-step procedure to provision, secure, and configure an Ubuntu LTS Droplet on DigitalOcean, ready for deploying the **Medical AI Audit Ledger & Integrity Platform** using Docker Compose.

---

## Step 1: Droplet Provisioning in DigitalOcean

Go to your DigitalOcean Control Panel and create a new Droplet with the following recommended specifications:

1. **Choose an Image**: 
   - **Distribution**: `Ubuntu`
   - **Version**: `24.04 LTS (x64)` or `22.04 LTS (x64)`
2. **Choose Size**:
   - **Droplet Type**: `Basic` (Shared CPU)
   - **CPU Options**: `Regular` or `Premium Intel/AMD`
   - **RAM/SSD**: Minimum `2 GB RAM / 1 vCPU` (recommended for compiling TypeScript/Webpack builds smoothly on the server if building container images locally is not configured). If building images in CI/CD and only pulling on the server, `1 GB RAM` is sufficient for runtime.
3. **Choose Additional Storage**: None required for MVP.
4. **Choose Datacenter Region**: Select the region closest to your users (e.g., NYC, SFO, AMS).
5. **VPC Network**: Default is fine.
6. **Authentication Method**: 
   - ⚠️ **CRITICAL**: Select **SSH Keys**. Do not use password authentication.
   - Add your local public SSH key (`~/.ssh/id_rsa.pub` or similar) to your DigitalOcean account and check its box.
7. **Recommended Options**:
   - Check **Monitoring** (adds free resource utilization charts in the DO console).
8. **Hostname**: Choose a clean name, e.g., `medical-ai-audit-ledger-mvp`.
9. Click **Create Droplet**.

---

## Step 2: Initial Server Setup & Hardening

Once the Droplet status turns active, copy the IPv4 address. Open your local terminal and follow these steps to secure the host immediately.

### 2.1. Establish Initial Root Session
Connect via SSH as the `root` user:
```bash
ssh root@YOUR_DROPLET_IP
```

### 2.2. Update System Packages
Ensure all base repositories and security patches are up to date:
```bash
apt update && apt upgrade -y
```

### 2.3. Create a Non-Root Administrative User
Running applications or management tasks directly as `root` is a security risk. Create a dedicated administrative user (e.g., `auditadmin`):
```bash
# Create user
adduser auditadmin

# Add user to the sudo group to allow root command execution privileges
usermod -aG sudo auditadmin
```

### 2.4. Set Up SSH Keys for the New User
Copy your authorized keys from the `root` account to the new user's home directory so you can authenticate:
```bash
# Sync SSH folder and correct file permissions and ownership
rsync --archive --chown=auditadmin:auditadmin ~/.ssh /home/auditadmin
```

Verify that you can open a new terminal window on your local machine and log in as the new user:
```bash
ssh auditadmin@YOUR_DROPLET_IP
# Validate sudo access:
sudo whoami
# (Should return 'root' after asking for the password you set)
```
**Keep your root session open in the first window until you verify this step succeeds!**

### 2.5. Harden the SSH Daemon Configurations
Disable password authentication and direct root logins over SSH:
```bash
sudo nano /etc/ssh/sshd_config
```
Find and edit the following lines to match:
```text
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
```
*(If you want to use a custom port like `2222` to reduce brute-force spam logs, edit `Port 22` to `Port 2222` as well).*

Save and close the file (`Ctrl+O`, `Enter`, `Ctrl+X`), then test the configuration syntax before restarting the daemon:
```bash
sudo sshd -t
```
If no errors are printed, restart the SSH service:
```bash
sudo systemctl restart ssh
```

### 2.6. Configure the Uncomplicated Firewall (UFW)
Only open the explicit ports required for SSH, HTTP, and HTTPS:
```bash
# Set strict default policies
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Allow SSH (use your custom port number if changed in sshd_config)
sudo ufw allow 22/tcp comment 'SSH'

# Allow Web traffic
sudo ufw allow 80/tcp comment 'HTTP'
sudo ufw allow 443/tcp comment 'HTTPS'

# Enable the firewall
sudo ufw enable
```
Verify the status:
```bash
sudo ufw status verbose
```

---

## Step 3: Install Docker Engine from the Official Repository

Do not use default Ubuntu apt repositories, as they often contain outdated versions of Docker.

### 3.1. Clean Conflicting Packages
```bash
for pkg in docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc; do sudo apt-get remove $pkg; done
```

### 3.2. Setup Docker Apt Repository
```bash
# Add Docker's official GPG key:
sudo apt-get update
sudo apt-get install ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

# Add the repository to Apt sources:
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
```

### 3.3. Install Docker and Compose Plugin
Install the core Docker engine and the official Docker Compose v2 plugin:
```bash
sudo apt-get install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin -y
```

### 3.4. Manage Docker as a Non-Root User
To run Docker commands without prepending `sudo` (which helps prevent directory permission pollution during local build cycles):
```bash
# Add user to the docker group
sudo usermod -aG docker auditadmin
```
⚠️ **IMPORTANT**: Log out of your SSH session and log back in (or run `newgrp docker`) for these group membership changes to take effect.

### 3.5. Verify Installation
```bash
docker --version
docker compose version
docker run hello-world
```

---

## Next Steps: App Dockerization & Compose Setup

Now that the host environment is secured and Docker is configured, we will need:
1. A multi-stage `Dockerfile` for the TypeScript/Express API backend.
2. A `Dockerfile` utilizing an Nginx server to build and serve the React frontend client and route API requests.
3. A `docker-compose.yml` to orchestrate:
   - PostgreSQL (ledger storage)
   - Redis (caching and verification state)
   - Express Backend Service
   - Nginx Frontend Service
   - Certbot container for automatic SSL provisioning.
