# VPS Setup and Configuration

This document outlines the steps required to initialize and manage the backend VPS on Hetzner, including system configuration, Docker installation, environment variables, and Git setup.

## Initial Server Setup (Cloud-Config)

The initial server configuration is handled via a `cloud-config` script upon provisioning the Hetzner VPS.

### Complete Cloud-Config File

Paste this into the Hetzner VPS "User data" field when creating the server:

```yaml
#cloud-config

timezone: Europe/Berlin

package_update: true
package_upgrade: true

users:
  - name: gregor
    groups: sudo
    shell: /bin/bash
    sudo: ALL=(ALL) NOPASSWD:ALL
    lock_passwd: true
    ssh_authorized_keys:
      - ssh-rsa AAA......sJDCE= diden@gregdesk

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

### Docker Log Rotation

By default the `json-file` log driver has **no size limit**, so a long-running
container's logs grow until they fill the host disk. Cap them at the daemon level
so every container inherits the limit:

```bash
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" }
}
EOF
sudo systemctl restart docker
```

Note the limit only
applies to containers **created after** the change — recreate existing ones
(`docker compose up -d --force-recreate`) for it to take effect.

> The `alleinsein` `tiler` service also pins the same cap in
> [docker-compose.yaml](../docker-compose.yaml) so the limit travels with the
> project even on a host without the daemon default.

## Python Environment Setup (uv)

The backend runs on Python, and dependencies are managed via [uv](https://github.com/astral-sh/uv).

```bash
# Install uv
curl -LsSf https://astral.sh/uv/install.sh | sh
source $HOME/.local/bin/env

# Install build tools
sudo apt install -y build-essential
```

## Git Configuration

Git is configured to ensure proper pulls and repository interactions:

```bash
# copy ssh key to vps
scp "$env:USERPROFILE\.ssh\github_deploy_key" gregor@$IP_VPS:/home/gregor/.ssh/github_deploy_key
ssh gregor@$IP_VPS "chmod 600 ~/.ssh/github_deploy_key"
# add a config file so the key gets used for git with this content: Host github.com
#    HostName github.com
#    User git
#    IdentityFile ~/.ssh/github_deploy_key
#    IdentitiesOnly yes
ssh gregor@$IP_VPS "echo -e 'Host github.com\n HostName github.com\n User git\n IdentityFile ~/.ssh/github_deploy_key\n IdentitiesOnly yes' > ~/.ssh/config"
ssh gregor@$IP_VPS "chmod 600 ~/.ssh/config"
```

```bash
# git config
git config --global user.email "gregor@email.de"
git config --global user.name "gregor d"
git config --global pull.ff only
```
