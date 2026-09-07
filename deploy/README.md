# AWS pilot deployment

The legacy injury-bot deployment is not used. No resources are changed until this application's AWS workflow is configured and manually run.

## One-time EC2 preparation

1. Use a Linux EC2 instance with Node **24** at `/usr/bin/node`, npm, Nginx, and a persistent encrypted EBS volume. Require IMDSv2. Open 443 to visitors and restrict SSH to approved deployment access. The app listens only on 127.0.0.1:3100.
2. Attach an IAM instance role permitting `ses:SendEmail` for your verified SES sender identity in the selected region. Verify the sender and obtain SES production access if sending to unverified recipients. The app uses the SDK credential chain; do not place long-lived AWS keys in GitHub or browser code.
3. Create a dedicated `injury-atlas` system user. Create `/var/lib/injury-atlas`, owned by that user, mode 0700. Create `/opt/injury-atlas/{releases,incoming}`, writable by your deployment account and readable by the service user. Grant that deployment account only the sudo command needed to restart `injury-atlas.service`.
4. Create `/etc/injury-atlas.env` readable only by root, with these values:

```ini
APP_URL=https://YOUR-CHOSEN-DOMAIN
PORT=3100
DATA_DIR=/var/lib/injury-atlas
AWS_REGION=us-east-2
SES_REGION=us-east-2
SES_FROM_EMAIL=YOUR-VERIFIED-SENDER
```

5. Install `deploy/injury-atlas.service` under `/etc/systemd/system/`, run `sudo systemctl daemon-reload`, and enable it. It can start after the first release exists.
6. Configure a Route 53 record for your chosen domain and an HTTPS Nginx virtual host. Include the proxy settings in `deploy/nginx.conf`. Provision the TLS certificate using your normal AWS/domain procedure. APP_URL must match the browser's exact HTTPS origin.
7. Create the GitHub **production** environment. Set secrets `AWS_HOST`, `AWS_DEPLOY_USER`, `AWS_DEPLOY_KEY`, `AWS_HOST_FINGERPRINT`. Set the environment variable `APP_URL` to the HTTPS origin. Verify the host fingerprint directly on the instance.

## Release

Merge the foundation PR, then manually run **Deploy AWS** on main. CI builds both the web app and pinned engine, stamps the commit, and uploads one release archive. On EC2, `activate.sh` installs locked runtime dependencies in that release, switches the `current` symlink, restarts systemd, and checks the API's release SHA and engine availability. An unsuccessful local health check restores the previous symlink when available. The workflow also checks the public HTTPS health endpoint to catch a proxy or DNS pointing at an older application.

The deployment account never edits Docker images, runtime volume mounts, legacy repositories or another application's services.

After the first successful release, bootstrap the owner from the instance:

```bash
cd /opt/injury-atlas/current
sudo -u injury-atlas env DATA_DIR=/var/lib/injury-atlas /usr/bin/node --import tsx server/bootstrap.ts YOUR-EMAIL "YOUR-NAME"
```

Then request your access link from the public sign-in page. Bootstrap does not send email. Application invitations send email only when an authenticated member submits the invitation form.

## Storage and recovery

Keep the database, its WAL/SHM files, and evidence on EBS at `/var/lib/injury-atlas`. Release activation never overwrites them. Use SQLite's backup API or `VACUUM INTO` to make consistent database backups; do not copy only the live `.sqlite` file. Snapshot/back up evidence with the database metadata and regularly test restoring both. This first release creates tables idempotently and has no destructive migrations. Future migrations need versioned backups and an explicit rollback strategy.

The former repo is left intact. Domain cutover and legacy data migration are separate operations.
