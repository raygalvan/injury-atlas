"""Upload and activate a release using the server's explicitly pinned ED25519 key."""
import base64
import hashlib
import hmac
import ipaddress
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile


def verify_host(scan, expected):
    if not re.fullmatch(r"SHA256:[A-Za-z0-9+/]{43}", expected):
        raise ValueError("AWS_HOST_FINGERPRINT must contain only the server ED25519 SHA256: token")
    entries = [line.split() for line in scan.splitlines() if line and not line.startswith("#")]
    if len(entries) != 1 or len(entries[0]) != 3 or entries[0][1] != "ssh-ed25519":
        raise ValueError("Expected exactly one ED25519 server host key")
    key = base64.b64decode(entries[0][2], validate=True)
    observed = "SHA256:" + base64.b64encode(hashlib.sha256(key).digest()).decode().rstrip("=")
    if not hmac.compare_digest(observed, expected):
        raise ValueError(
            f"Server ED25519 fingerprint mismatch (observed {observed}). "
            "Verify /etc/ssh/ssh_host_ed25519_key.pub through EC2 Instance Connect "
            "before correcting AWS_HOST_FINGERPRINT."
        )
    return " ".join(entries[0]) + "\n"


def deploy():
    host = str(ipaddress.IPv4Address(os.environ["AWS_HOST"].strip()))
    user = os.environ["AWS_DEPLOY_USER"].strip()
    sha = os.environ["GITHUB_SHA"]
    if not re.fullmatch(r"[a-z_][a-z0-9_-]*", user) or not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("Invalid deployment user or release SHA")
    if not Path("release.tgz").is_file():
        raise ValueError("Built release.tgz is missing")
    scan = subprocess.run(["ssh-keyscan", "-T", "15", "-t", "ed25519", host],
                          check=True, capture_output=True, text=True, timeout=25)
    trusted = verify_host(scan.stdout, os.environ["AWS_HOST_FINGERPRINT"].strip())
    print("Server ED25519 fingerprint verified.", flush=True)
    with tempfile.TemporaryDirectory(prefix="injury-atlas-ssh-") as temp:
        private = Path(temp) / "deploy-key"
        known = Path(temp) / "known_hosts"
        private.touch(mode=0o600)
        private.write_text(os.environ["AWS_DEPLOY_KEY"].strip() + "\n")
        known.write_text(trusted)
        options = ["-F", "/dev/null", "-i", str(private)]
        for option in (
            "BatchMode=yes", "IdentitiesOnly=yes", "StrictHostKeyChecking=yes",
            "HostKeyAlgorithms=ssh-ed25519", "UpdateHostKeys=no",
            f"UserKnownHostsFile={known}", "GlobalKnownHostsFile=/dev/null",
            "ConnectTimeout=15", "ConnectionAttempts=3", "ServerAliveInterval=15",
            "ServerAliveCountMax=4", "ClearAllForwardings=yes",
        ):
            options.extend(["-o", option])
        destination = f"{user}@{host}"
        incoming = f"/opt/injury-atlas/incoming/{sha}"
        release = f"/opt/injury-atlas/releases/{sha}"
        subprocess.run(["ssh", *options, destination, f"mkdir -p {incoming}"],
                       check=True, timeout=120)
        subprocess.run(["scp", *options, "release.tgz", f"{destination}:{incoming}/release.tgz"],
                       check=True, timeout=600)
        subprocess.run([
            "ssh", *options, destination,
            f"set -eu; mkdir -p {release}; tar -xzf {incoming}/release.tgz -C {release}; "
            f"bash {release}/deploy/activate.sh {sha}",
        ], check=True, timeout=600)


if __name__ == "__main__":
    try:
        deploy()
    except (ValueError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        sys.exit(str(error))
