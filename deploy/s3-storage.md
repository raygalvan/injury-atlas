# Private S3 evidence storage

New uploads use S3 when `S3_BUCKET` is configured. Without it, new uploads continue using EBS. Existing local files remain readable in either mode. Case records, users, evidence metadata, source hashes and S3 object version references remain in `/var/lib/injury-atlas/atlas.sqlite` on EC2. Continue backing up that database and legacy local evidence.

## 1. Create the bucket

In S3, create a **General purpose** bucket in **US East (Ohio), us-east-2**:

- Suggested name: `injury-bot-evidence-585534523139-us-east-2`. If unavailable, use another unique name and substitute it in the policy and environment below.
- Object Ownership: **Bucket owner enforced / ACLs disabled**.
- **Block all public access** enabled.
- **Bucket Versioning** enabled. The app rejects an upload if S3 returns no version ID.
- Default encryption: **SSE-S3**. The adapter explicitly requests AES256 encryption.
- No website hosting or CORS configuration is needed; only the server accesses S3.
- Do not configure noncurrent-version expiration for evidence: the database references exact versions.

Optionally enforce HTTPS with a bucket policy denying `s3:*` on this bucket and its objects when `aws:SecureTransport` is `false`. All application requests already use the AWS SDK's HTTPS endpoint.

## 2. Add the instance role policy

IAM → Roles → **injury-atlas-ec2** → Add permissions → Create inline policy → JSON.

Paste `deploy/s3-evidence-policy.json` and name it **InjuryBotEvidenceStorage**. Keep the existing SES policy. This goes on the EC2 instance role, not `injury-atlas-github-deploy`.

The app needs only PutObject and GetObjectVersion under this bucket's `evidence/` prefix. It does not need ListAllMyBuckets, ListBucket, DeleteObject, public ACLs, bucket administration or static access keys.

## 3. Deploy and configure

Merge the S3 PR and wait for **Deploy AWS** to succeed. Then append these settings on EC2 (if changing existing settings, edit them instead of creating duplicates):

```bash
sudo tee -a /etc/injury-atlas.env >/dev/null <<'ENV'
S3_BUCKET=injury-bot-evidence-585534523139-us-east-2
S3_REGION=us-east-2
S3_EXPECTED_BUCKET_OWNER=585534523139
ENV
sudo chown root:root /etc/injury-atlas.env
sudo chmod 0600 /etc/injury-atlas.env
```

Verify real write/read access as the application user with the same environment file:

```bash
sudo systemd-run --unit=injury-bot-storage-check --wait --pipe --collect \
  --property=User=injury-atlas \
  --property=WorkingDirectory=/opt/injury-atlas/current \
  --property=EnvironmentFile=/etc/injury-atlas.env \
  /usr/bin/node --import tsx server/check-storage.ts
```

This writes and reads a tiny synthetic object, verifies its bytes, and retains its version under `evidence/_checks/`. It sends no emails and uploads no case data. Repeated checks create separate tiny objects; an administrator may remove these check objects later. The runtime intentionally has no delete permission.

Only after the check reports success:

```bash
sudo systemctl restart injury-atlas
sudo systemctl status injury-atlas --no-pager -l
```

Upload a synthetic file through the signed-in Evidence workspace and download it again. Confirm the object appears under `evidence/<firm-id>/<case-id>/` in S3. Verify clients still see only their assigned cases and own submissions. Deployment health alone does not prove the bucket's IAM settings; the explicit storage check tests actual S3 access.

## Behavior and recovery

- Original filenames stay in the database and download headers, not the S3 object key. Keys contain application-generated IDs.
- Downloads require the same authenticated case and uploader checks as local storage. No public or presigned URLs are returned.
- Uploads send a SHA-256 checksum, use conditional creation, and store the returned VersionId. Downloads request that exact version and verify its byte length and source hash before sending it to the user.
- The existing 25 MB file limit remains. This is a server-mediated pilot upload path, not multipart video ingestion.
- A failed S3 write creates no evidence row and never silently falls back to disk. If the write succeeds but database insertion fails, an unreferenced object can remain. Preserve it for reconciliation; do not delete source versions automatically.
- Enabling S3 does not migrate old files. Preserve EBS files for legacy evidence. Existing S3 references require the same configured bucket and region. Moving buckets requires a deliberate reference/data migration.
- Keep S3 configuration when rolling back to any S3-aware release. Releases before this PR cannot read S3 references. Do not roll back to an older local-only release after uploading evidence to S3.
- IAM role credentials are supplied by EC2. No AWS keys belong in the frontend or repository.

References: [AWS S3 security practices](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html), [AWS SDK v3 S3 examples](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/javascript_s3_code_examples.html).
