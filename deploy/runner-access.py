"""Permit this Actions runner only, then remove its rule even after deploy failure."""
import ipaddress
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import time
import urllib.request

PREFIX = "injury-atlas-actions:"


def aws(*args):
    result = subprocess.run(
        ["aws", "--region", os.environ["AWS_REGION"], "--no-cli-pager",
         "--cli-connect-timeout", "10", "--cli-read-timeout", "20", *args,
         "--output", "json"], check=True, capture_output=True, text=True,
    )
    return json.loads(result.stdout or "{}")


def managed_rule(rule):
    """Never remove other SSH rules, browser access, egress, or broad CIDRs."""
    try:
        return (
            not rule.get("IsEgress", True)
            and rule.get("IpProtocol") == "tcp"
            and rule.get("FromPort") == rule.get("ToPort") == 22
            and ipaddress.IPv4Network(rule.get("CidrIpv4", "")).prefixlen == 32
            and re.fullmatch(r"injury-atlas-actions:\d+:\d+:\d+",
                             rule.get("Description", "")) is not None
        )
    except ValueError:
        return False


def rules(group):
    return aws("ec2", "describe-security-group-rules", "--filters",
               f"Name=group-id,Values={group}")["SecurityGroupRules"]


def revoke(group, rule):
    aws("ec2", "revoke-security-group-ingress", "--group-id", group,
        "--security-group-rule-ids", rule["SecurityGroupRuleId"])


def close_access(state_path):
    if not state_path.exists():
        print("No runner rule was requested.")
        return
    state = json.loads(state_path.read_text())
    for rule in rules(state["group"]):
        if managed_rule(rule) and rule["Description"] == state["description"]:
            revoke(state["group"], rule)
    print("Temporary SSH access for this run removed.")


def open_access(state_path):
    group = os.environ["AWS_DEPLOY_SECURITY_GROUP_ID"]
    if not re.fullmatch(r"sg-[0-9a-f]+", group):
        raise ValueError("Invalid AWS_DEPLOY_SECURITY_GROUP_ID")
    run_id, attempt = os.environ["GITHUB_RUN_ID"], os.environ["GITHUB_RUN_ATTEMPT"]
    if not run_id.isdigit() or not attempt.isdigit():
        raise ValueError("Invalid Actions run identity")
    with urllib.request.urlopen("https://checkip.amazonaws.com", timeout=15) as response:
        address = ipaddress.IPv4Address(response.read(128).decode().strip())
    if not address.is_global:
        raise ValueError("Runner address must be a public IPv4 address")
    now = int(time.time())
    # Recover only our /32 rules older than two hours after a hard runner shutdown.
    # Normal runs are bounded to 45 minutes and serialized by workflow concurrency.
    for rule in rules(group):
        if managed_rule(rule) and now - int(rule["Description"].rsplit(":", 1)[1]) > 7200:
            revoke(group, rule)
    description = f"{PREFIX}{run_id}:{attempt}:{now}"
    # Write before the API call: cleanup can find the rule if authorization succeeds
    # but the client loses the response or the workflow is cancelled immediately.
    state_path.write_text(json.dumps({"group": group, "description": description}))
    permission = [{"IpProtocol": "tcp", "FromPort": 22, "ToPort": 22,
                   "IpRanges": [{"CidrIp": f"{address}/32", "Description": description}]}]
    aws("ec2", "authorize-security-group-ingress", "--group-id", group,
        "--ip-permissions", json.dumps(permission))
    print(f"Temporary SSH source authorized: {address}/32", flush=True)
    deadline = time.monotonic() + 90
    while True:
        try:
            with socket.create_connection((os.environ["AWS_HOST"], 22), timeout=3):
                pass
            print("SSH port reachable; deployment will verify key and host fingerprint.")
            return
        except OSError:
            if time.monotonic() >= deadline:
                raise TimeoutError("SSH remains unreachable after authorizing this runner")
            time.sleep(5)


if __name__ == "__main__":
    state = Path(os.environ["RUNNER_TEMP"]) / "injury-atlas-runner-access.json"
    try:
        if sys.argv[1:] == ["open"]:
            open_access(state)
        elif sys.argv[1:] == ["close"]:
            close_access(state)
        else:
            sys.exit("Usage: runner-access.py open|close")
    except subprocess.CalledProcessError as error:
        sys.exit(error.stderr)
