# VPS Setup and Configuration

This document outlines the steps required to initialize and manage the backend VPS on Hetzner, including system configuration, Docker installation, environment variables, and Git setup.

## Initial Server Setup (Cloud-Config)

The initial server configuration is handled via a `cloud-config` script upon provisioning the Hetzner VPS.

### System Updates & Timezone
```yaml
timezone: Europe/Berlin
package_update: true
package_upgrade: true
```

### User Configuration
A non-root user `gregor` is created with `sudo` privileges and passwordless sudo access. Authentication is locked down to SSH keys only.
```yaml
users:
  - name: gregor
    groups: sudo
    shell: /bin/bash
    sudo: ALL=(ALL) NOPASSWD:ALL
    lock_passwd: true
    ssh_authorized_keys:
      - ssh-rsa AAAAB3NzaC1yc2EAAA... diden@gregdesk
```

### Security and Hardening
Root login and password authentication are disabled for SSH. Fail2ban is installed to protect against brute-force attacks.
```yaml
ssh_pwauth: false
disable_root: true

packages:
  - fail2ban
  - curl
  - git
  - ca-certificates

write_files:
  - path: /etc/ssh/sshd_config.d/99-hardening.conf
    permissions: "0644"
    content: |
      PermitRootLogin no
      PasswordAuthentication no
      KbdInteractiveAuthentication no
      PubkeyAuthentication yes
      X11Forwarding no
      AllowUsers gregor

runcmd:
  - systemctl restart ssh
  - systemctl enable --now fail2ban
```

## Docker Setup

Docker and Docker Compose are installed and enabled to start on boot. The user `gregor` is added to the `docker` group to allow running containers without `sudo`.

```bash
# Add Docker's official GPG key
sudo apt update
sudo apt install ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

# Add repository
sudo tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

# Install Docker
sudo apt update
sudo apt install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker gregor
```

## Python Environment Setup (uv)

The backend runs on Python, and dependencies are managed via [uv](https://github.com/astral-sh/uv).

```bash
# Install uv
curl -LsSf https://astral.sh/uv/install.sh | sh
source $HOME/.local/bin/env

# Install build tools
sudo apt install -y build-essential

# Sync dependencies and run
uv sync --python 3.12
uv run uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

## GDAL Environment Variables

To optimize Rasterio and Titiler performance on the backend, several GDAL environment variables are configured:

```bash
export GDAL_HTTP_MERGE_CONSECUTIVE_RANGES="YES"
export GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"
export GDAL_CACHEMAX="200" # 5% of RAM default
export CPL_VSIL_CURL_CACHE_SIZE="200000000" # Global LRU cache
export VSI_CACHE="TRUE"
export VSI_CACHE_SIZE="5000000" # 5Mb per file handle
export GDAL_HTTP_MULTIPLEX="YES" # Requires HTTP/2
export GDAL_HTTP_VERSION="2"
```

## Git Configuration

Git is configured to ensure proper pulls and repository interactions:

```bash
git config --global user.email "didenko_g@gmx.de"
git config --global user.name "gregor d"
git config --global pull.ff only
```

A deploy key is used to access the repository securely from the VPS:

```bash
# Add config file to use key for GitHub
echo -e 'Host github.com\n HostName github.com\n User git\n IdentityFile ~/.ssh/github_deploy_key\n IdentitiesOnly yes' > ~/.ssh/config
chmod 600 ~/.ssh/config
```

## Strato

For reference, the Strato SSH access is:
`ssh stu952230246@59831152.ssh.w1.strato.hosting`
Directory: `/alleinseinkarte`
