"""One-time setup. Run in AWS CloudShell as an AWS administrator, not on EC2.

Creates a dedicated deployment security group and GitHub OIDC role. Adds that
group to the primary network interface, preserving existing groups and SES role.
No AWS credentials, private SSH keys, or email are created or printed.
"""
import argparse
import json
import re
import subprocess
import sys

OWNER = "injury-atlas-github-setup"
REPO = "raygalvan/injury-atlas"
ROLE = "injury-atlas-github-deploy"
GROUP = "injury-atlas-github-deploy"


def aws(region, *args):
    result = subprocess.run(
        ["aws", "--region", region, "--no-cli-pager", *args, "--output", "json"],
        check=True, capture_output=True, text=True,
    )
    return json.loads(result.stdout or "{}")


def owned(resource):
    return any(t["Key"] == "ManagedBy" and t["Value"] == OWNER
               for t in resource.get("Tags", []))


def role_documents(account, region, group):
    provider = f"arn:aws:iam::{account}:oidc-provider/token.actions.githubusercontent.com"
    trust = {
        "Version": "2012-10-17",
        "Statement": [{"Effect": "Allow", "Principal": {"Federated": provider},
                       "Action": "sts:AssumeRoleWithWebIdentity",
                       "Condition": {"StringEquals": {
                           "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                           "token.actions.githubusercontent.com:sub":
                               f"repo:{REPO}:environment:production"}}}],
    }
    policy = {
        "Version": "2012-10-17",
        "Statement": [
            {"Sid": "ManageDedicatedDeploymentGroup", "Effect": "Allow",
             "Action": ["ec2:AuthorizeSecurityGroupIngress", "ec2:RevokeSecurityGroupIngress"],
             "Resource": f"arn:aws:ec2:{region}:{account}:security-group/{group}"},
            {"Sid": "ReadRulesForCleanup", "Effect": "Allow",
             "Action": "ec2:DescribeSecurityGroupRules", "Resource": "*",
             "Condition": {"StringEquals": {"aws:RequestedRegion": region}}},
        ],
    }
    return provider, trust, policy


def setup(account, region, instance_id):
    def call(*args):
        return aws(region, *args)

    if not re.fullmatch(r"\d{12}", account) or not re.fullmatch(r"i-[0-9a-f]+", instance_id):
        raise ValueError("Supply a 12-digit account ID and an EC2 instance ID")
    if call("sts", "get-caller-identity")["Account"] != account:
        raise ValueError("CloudShell is signed into a different AWS account")
    reservations = call("ec2", "describe-instances", "--instance-ids", instance_id)["Reservations"]
    instance = reservations[0]["Instances"][0]
    primary = next(n for n in instance["NetworkInterfaces"] if n["Attachment"]["DeviceIndex"] == 0)
    vpc = instance["VpcId"]
    groups = call("ec2", "describe-security-groups", "--filters",
                  f"Name=vpc-id,Values={vpc}", f"Name=group-name,Values={GROUP}")["SecurityGroups"]
    if groups:
        if len(groups) != 1 or not owned(groups[0]):
            raise ValueError("A security group with this name exists but is not owned by this setup")
        group = groups[0]["GroupId"]
    else:
        group = call("ec2", "create-security-group", "--group-name", GROUP,
                     "--description", "Temporary SSH rules for Injury Atlas GitHub deployments",
                     "--vpc-id", vpc, "--tag-specifications", json.dumps([{
                         "ResourceType": "security-group", "Tags": [
                             {"Key": "ManagedBy", "Value": OWNER},
                             {"Key": "Name", "Value": GROUP}]}]))["GroupId"]
    # This additive group must not widen the existing instance's outbound access.
    current = call("ec2", "describe-security-groups", "--group-ids", group)["SecurityGroups"][0]
    if current.get("IpPermissionsEgress"):
        call("ec2", "revoke-security-group-egress", "--group-id", group,
             "--ip-permissions", json.dumps(current["IpPermissionsEgress"]))

    provider, trust, policy = role_documents(account, region, group)
    providers = call("iam", "list-open-id-connect-providers")["OpenIDConnectProviderList"]
    if any(p["Arn"] == provider for p in providers):
        info = call("iam", "get-open-id-connect-provider", "--open-id-connect-provider-arn", provider)
        if "sts.amazonaws.com" not in info["ClientIDList"]:
            raise ValueError("Existing GitHub OIDC provider needs the sts.amazonaws.com audience")
    else:
        call("iam", "create-open-id-connect-provider", "--url",
             "https://token.actions.githubusercontent.com", "--client-id-list", "sts.amazonaws.com")
    try:
        existing_role = call("iam", "get-role", "--role-name", ROLE)["Role"]
    except subprocess.CalledProcessError as error:
        if "NoSuchEntity" not in error.stderr:
            raise
        call("iam", "create-role", "--role-name", ROLE,
             "--assume-role-policy-document", json.dumps(trust), "--tags",
             f"Key=ManagedBy,Value={OWNER}")
    else:
        if not owned(existing_role):
            raise ValueError("A role with this name exists but is not owned by this setup")
        call("iam", "update-assume-role-policy", "--role-name", ROLE,
             "--policy-document", json.dumps(trust))
    call("iam", "put-role-policy", "--role-name", ROLE, "--policy-name", "ManageRunnerSSH",
         "--policy-document", json.dumps(policy))
    group_ids = sorted({g["GroupId"] for g in primary["Groups"]} | {group})
    if group not in {g["GroupId"] for g in primary["Groups"]}:
        call("ec2", "modify-network-interface-attribute", "--network-interface-id",
             primary["NetworkInterfaceId"], "--groups", *group_ids)
    actual = call("ec2", "describe-network-interfaces", "--network-interface-ids",
                  primary["NetworkInterfaceId"])["NetworkInterfaces"][0]
    if not set(group_ids).issubset({g["GroupId"] for g in actual["Groups"]}):
        raise RuntimeError("Could not verify that all original groups and the new group are attached")
    print("AWS setup complete. Add these VARIABLES to GitHub's production environment:")
    print(f"AWS_DEPLOY_ROLE_ARN=arn:aws:iam::{account}:role/{ROLE}")
    print(f"AWS_DEPLOY_SECURITY_GROUP_ID={group}")
    print("Restrict that GitHub environment's deployment branches to main before merging the workflow.")
    print("Existing instance security groups and the EC2 SES instance role are preserved.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--account-id", required=True)
    parser.add_argument("--instance-id", required=True)
    parser.add_argument("--region", default="us-east-2")
    args = parser.parse_args()
    try:
        setup(args.account_id, args.region, args.instance_id)
    except subprocess.CalledProcessError as error:
        sys.exit(error.stderr)
