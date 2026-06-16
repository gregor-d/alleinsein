# Tailscale Environment Setup

Tailscale is utilized to create a secure, private network (Tailnet) between developer machines and the VPS backend, eliminating the need to expose SSH or internal services to the public internet.

## Installing Tailscale

1. **On the VPS (Hetzner)**:
   Follow the standard Tailscale installation script:
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up
   ```
   Authenticate using the link provided in the console to add the VPS to your Tailnet.

2. **On the Local Development Machine**:
   Install the Tailscale client for your operating system (Windows, macOS, or Linux) from the [Tailscale website](https://tailscale.com/download) and authenticate to the same network.

## Using Tailscale for Interaction

Once both devices are on the Tailnet, you can interact with the VPS using its Tailscale IP (e.g., `100.x.y.z`) instead of its public Hetzner IP.

### SSH Access
Connect to the server securely via SSH over the Tailnet:
```bash
ssh gregor@<tailscale-ip>
```
Or, if you have Tailscale SSH enabled:
```bash
ssh <hostname>
```

### Accessing Internal Services
If you need to access services running locally on the VPS (e.g., a dev database, caching layers, or monitoring dashboards) that are not exposed via Cloudflare, you can bind them to the Tailscale IP or `0.0.0.0` and access them directly from your local browser at `http://<tailscale-ip>:<port>`.

### SCP File Transfers
Transferring large files, such as raster tiles (`.tif`), can be done securely over Tailscale:
```bash
scp -r ./raster/out/* gregor@<tailscale-ip>:/home/gregor/alone/raster/out/
```


# Secure VPS Management with Tailscale VPN

This document explains how to set up, configure, and use a **Tailscale** overlay network to interact securely with the Hetzner VPS backend without exposing administrative services (like SSH and raw Uvicorn ports) to the public internet.

---

## 1. Why Tailscale?

Tailscale is a zero-configuration mesh VPN built on top of the WireGuard protocol.
By connecting both your local machine and your VPS to your private Tailscale network (Tailnet):
- Your machines are assigned private, static IP addresses in the `100.x.y.z` range.
- You can restrict access to VPS administration ports (e.g., SSH port `22`, Uvicorn port `8000`) exclusively to the Tailscale interface (`tailscale0`).
- Administrative traffic is fully encrypted end-to-end.

---

## 2. Setup Guide

### Step 1: Install Tailscale on the Hetzner VPS
Log into your VPS and run the official Tailscale installation script:
```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

Authenticate and connect the VPS to your Tailnet:
```bash
sudo tailscale up
```
*Follow the terminal prompt's URL to authorize the machine in your Tailscale Admin Console.*

### Step 2: Install Tailscale on your Developer Machine
1. Download the Tailscale client for your local OS (Windows, macOS, Linux).
2. Install and launch the application.
3. Log in with the same credentials used for the VPS.

### Step 3: Find your Tailscale IPs
In the Tailscale dashboard or by running `tailscale status` on either machine, find the private IP addresses:
- **VPS Private IP**: `100.A.B.C` (e.g., `100.101.102.103`)
- **Local Dev PC IP**: `100.X.Y.Z`

---

## 3. VPS Firewall & Port Binding Hardening

To block unauthorized public traffic while allowing Tailscale connections:

### Hardening SSH Access
We can configure the Linux firewall (**UFW**) to drop all public SSH attempts and accept only connections arriving on the Tailscale interface.

1. **Allow all traffic through the Tailscale interface:**
   ```bash
   sudo ufw allow in on tailscale0
   ```
2. **Enable UFW:**
   ```bash
   sudo ufw default deny incoming
   sudo ufw default allow outgoing
   sudo ufw enable
   ```
3. **Verify status:**
   ```bash
   sudo ufw status verbose
   ```
   Now, ports are completely closed to the public internet, but fully open to other devices in your private Tailnet.

### Hardening Docker and FastAPI Ports
By default, Docker port mapping (e.g., `ports: ["8000:8000"]`) binds to `0.0.0.0:8000`, bypassing UFW rules in many Linux configurations. 

To ensure the FastAPI backend is only accessible locally and via Tailscale, bind Docker to the VPS's specific Tailscale IP:

#### Docker Compose Binding (`docker-compose.yaml`)
Modify the port directive to specify the VPS's Tailscale IP:
```yaml
ports:
  - "100.A.B.C:8000:8000" # Only binds to Tailscale IP
```

#### Raw Uvicorn Execution
If running without Docker, start the server bound to your Tailscale IP:
```bash
uv run uvicorn backend.main:app --host 100.A.B.C --port 8000
```

---

## 4. Secure VPS Interaction Workflow

### SSH Connection
Connect securely to your server from anywhere using the Tailscale IP:
```bash
ssh gregor@100.A.B.C
```

### Accessing Backend Documentation
View the Swagger UI documentation securely from your local browser:
```
http://100.A.B.C:8000/docs
```
*(Requires `APP_ENABLE_DOCS=true` in backend configurations)*
