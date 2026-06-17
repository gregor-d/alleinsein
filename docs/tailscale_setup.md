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
