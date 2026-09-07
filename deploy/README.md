# AWS pilot deployment

The legacy injury-bot deployment is not used. After one-time setup, pushes to main (including merged PRs) automatically deploy this application. Manual Deploy AWS runs remain available. PR branches run verification only.

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
6. Configure a DNS record at your authoritative DNS provider for your chosen domain and an HTTPS Nginx virtual host. Include the proxy settings in `deploy/nginx.conf`. Provision the TLS certificate using your normal AWS/domain procedure. APP_URL must match the browser's exact HTTPS origin.
7. Create the GitHub **production** environment. Set secrets `AWS_HOST` (the EC2 Elastic IPv4 address), `AWS_DEPLOY_USER`, `AWS_DEPLOY_KEY`, `AWS_HOST_FINGERPRINT` (only the SHA256 token from `sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub -E sha256`). Set the environment variable `APP_URL` to the HTTPS origin. Verify the host fingerprint directly on the instance. Keep the existing EC2 Instance Connect SSH rule for browser terminal access.

## One-time automatic deployment access

Do this **before merging the automatic-deployment workflow**. The EC2 SES instance role is not the GitHub deployment role. The setup below does not change that instance role, the current release, or evidence data.

1. Download `deploy/setup-github-aws.py` from this branch. Open AWS **CloudShell** signed into the intended AWS account as an administrator. Use CloudShell **Actions → Upload file** to upload the script. Run it in CloudShell, not the EC2 terminal (the EC2 role intentionally has only SES permission):

   ```bash
   python3 setup-github-aws.py --account-id 585534523139 --region us-east-2 --instance-id i-0830ae4cc020763da
   ```

   The script validates the account, creates an empty dedicated deployment security group, and adds it to the instance's primary network interface while preserving existing groups. It removes the new group's default outbound rule so that it does not broaden the instance's outbound access. It creates or reuses the GitHub OIDC provider and creates a separate `injury-atlas-github-deploy` role. Existing resources with these names are reused only when tagged as owned by this setup. Re-running the script is supported after a partial failure. The script verifies the final security group attachment before reporting success.

2. In GitHub **Settings → Environments → production**, add the two **environment variables** printed by the script:

   - `AWS_DEPLOY_ROLE_ARN`
   - `AWS_DEPLOY_SECURITY_GROUP_ID`

   Retain the existing `APP_URL` variable and all four SSH secrets (`AWS_HOST`, `AWS_DEPLOY_USER`, `AWS_DEPLOY_KEY`, `AWS_HOST_FINGERPRINT`). No long-lived AWS access key is needed.

3. In that environment, set **Deployment branches and tags → Selected branches and tags** and add a **branch** rule for exactly `main` (no tag rule). The role's trust is limited to `repo:raygalvan/injury-atlas:environment:production`; the environment restriction prevents another branch or tag from using that trust. Leave required reviewers/wait timers disabled if fully unattended deployment is desired. Repository administrators should restrict direct pushes to main using the repository's branch rules when merges must be the only deployment source.

4. Merge the workflow PR. That merge starts the first automatic run. Existing manual runs can finish; all Deploy AWS runs use the same concurrency group and do not cancel an active deployment. Each run checks settings, tests and builds the complete release, obtains short-lived AWS credentials, authorizes only its public IPv4 `/32` on TCP 22 in the dedicated group, deploys, and verifies the running release. It removes its exact rule in an `always()` cleanup step on success, failure, or ordinary cancellation. Native OpenSSH explicitly selects the server ED25519 host key. Its fingerprint must match the saved SHA256 token before the release is uploaded; strict host checking stays enabled during both upload and activation. This avoids the prior SSH action negotiating another host-key type while comparing an ED25519 fingerprint. A genuine fingerprint mismatch still fails closed. The deployment private key exists only in a temporary mode-0600 file removed at the end of the transport step.

A hard runner shutdown can prevent cleanup. The next run removes only this workflow's narrowly identified `/32` SSH rules older than two hours. Browser SSH, other rules, and recent deployments' rules are not touched. A cleanup error fails the workflow even if the application was already deployed; inspect that step before interpreting a red run as an application rollback. Remove any manually added temporary runner rule from the original security group after the current manual deployment ends; future runs manage the dedicated group themselves.

The GitHub role can authorize/revoke ingress only on the dedicated deployment group and read security group rules in Ohio. It cannot change other security groups, attach roles, change instance settings, access SES, or read application evidence through AWS APIs. Deployment still uses the restricted `injury-deploy` SSH account.

References: [GitHub OIDC with AWS](https://docs.github.com/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services), [EC2 ingress rule authorization](https://docs.aws.amazon.com/cli/latest/reference/ec2/authorize-security-group-ingress.html), [rule removal](https://docs.aws.amazon.com/cli/latest/reference/ec2/revoke-security-group-ingress.html).

## Release

Merge a PR into main to deploy automatically, or manually run **Deploy AWS** on main to redeploy the current version. CI builds both the web app and pinned engine, stamps the commit, and uploads one release archive. On EC2, `activate.sh` installs locked runtime dependencies in that release, switches the `current` symlink, restarts systemd, and checks the API's release SHA and engine availability. An unsuccessful local health check restores the previous symlink when available. The workflow also checks the public HTTPS health endpoint to catch a proxy or DNS pointing at an older application.

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
