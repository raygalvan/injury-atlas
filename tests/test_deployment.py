"""Deployment access lifecycle checks. All AWS and network calls are simulated."""
import contextlib
import base64
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import MagicMock, patch


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).parents[1] / "deploy" / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


access = load("runner_access", "runner-access.py")
setup = load("github_setup", "setup-github-aws.py")
transport = load("release_ssh", "release-ssh.py")


def rule(description, **extra):
    return dict({"SecurityGroupRuleId": "sgr-owned", "IsEgress": False,
                 "IpProtocol": "tcp", "FromPort": 22, "ToPort": 22,
                 "CidrIpv4": "8.8.8.8/32", "Description": description}, **extra)


class DeploymentAccess(unittest.TestCase):
    def test_host_fingerprint_must_match_exact_ed25519_scan(self):
        key = b"synthetic host key for hash comparison only"
        scan = "3.21.82.108 ssh-ed25519 " + base64.b64encode(key).decode() + "\n"
        fingerprint = "SHA256:" + base64.b64encode(hashlib.sha256(key).digest()).decode().rstrip("=")
        self.assertEqual(transport.verify_host(scan, fingerprint), scan)
        with self.assertRaisesRegex(ValueError, "mismatch"):
            transport.verify_host(scan, "SHA256:" + "A" * 43)
        with self.assertRaisesRegex(ValueError, "ED25519"):
            transport.verify_host(scan.replace("ssh-ed25519", "ssh-rsa"), fingerprint)
        with self.assertRaises(ValueError):
            transport.verify_host(scan, "256 " + fingerprint + " root@server (ED25519)")

    def test_host_mismatch_stops_before_any_ssh_login_or_upload(self):
        scan = "3.21.82.108 ssh-ed25519 " + base64.b64encode(b"synthetic").decode() + "\n"
        env = {"AWS_HOST": "3.21.82.108", "AWS_DEPLOY_USER": "injury-deploy",
               "GITHUB_SHA": "a" * 40, "AWS_HOST_FINGERPRINT": "SHA256:" + "A" * 43}
        with patch.dict(os.environ, env), patch.object(transport.Path, "is_file", return_value=True), \
             patch.object(transport.subprocess, "run", return_value=MagicMock(stdout=scan)) as run:
            with self.assertRaisesRegex(ValueError, "mismatch"):
                transport.deploy()
        self.assertEqual(run.call_count, 1)
        self.assertEqual(run.call_args.args[0][0], "ssh-keyscan")

    def test_transport_pins_key_and_removes_private_file_after_upload_failure(self):
        key = b"synthetic"
        scan = "3.21.82.108 ssh-ed25519 " + base64.b64encode(key).decode() + "\n"
        fingerprint = "SHA256:" + base64.b64encode(hashlib.sha256(key).digest()).decode().rstrip("=")
        env = {"AWS_HOST": "3.21.82.108", "AWS_DEPLOY_USER": "injury-deploy", "GITHUB_SHA": "a" * 40,
               "AWS_HOST_FINGERPRINT": fingerprint, "AWS_DEPLOY_KEY": "synthetic-private-key"}
        private_paths = []
        def run(command, **kwargs):
            if command[0] == "ssh-keyscan":
                return MagicMock(stdout=scan)
            self.assertIn("StrictHostKeyChecking=yes", command)
            self.assertIn("HostKeyAlgorithms=ssh-ed25519", command)
            private = Path(command[command.index("-i") + 1])
            self.assertEqual(private.stat().st_mode & 0o777, 0o600)
            self.assertEqual(private.read_text(), "synthetic-private-key\n")
            private_paths.append(private)
            if command[0] == "scp":
                raise subprocess.CalledProcessError(1, command)
            return MagicMock()
        with patch.dict(os.environ, env), patch.object(transport.Path, "is_file", return_value=True), \
             patch.object(transport.subprocess, "run", side_effect=run), \
             contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(subprocess.CalledProcessError):
                transport.deploy()
        self.assertEqual(len(private_paths), 2)
        self.assertFalse(private_paths[0].exists())

    def test_only_owned_narrow_ingress_is_managed(self):
        description = "injury-atlas-actions:123:1:1000"
        self.assertTrue(access.managed_rule(rule(description)))
        for change in ({"IsEgress": True}, {"CidrIpv4": "0.0.0.0/0"},
                       {"FromPort": 80}, {"ToPort": 443}, {"IpProtocol": "-1"},
                       {"Description": "Browser SSH"}, {"CidrIpv4": ""}):
            self.assertFalse(access.managed_rule(rule(description, **change)))

    def test_cleanup_after_lost_authorization_response_does_not_remove_other_rules(self):
        with tempfile.TemporaryDirectory() as temp:
            state = Path(temp) / "state.json"
            env = {"AWS_DEPLOY_SECURITY_GROUP_ID": "sg-abc", "GITHUB_RUN_ID": "123",
                   "GITHUB_RUN_ATTEMPT": "1", "AWS_HOST": "example.test"}
            response = MagicMock()
            response.__enter__.return_value.read.return_value = b"8.8.8.8\n"
            with patch.dict(os.environ, env), patch.object(access, "rules", return_value=[]), \
                 patch.object(access.urllib.request, "urlopen", return_value=response), \
                 patch.object(access, "aws", side_effect=RuntimeError("response lost")):
                with self.assertRaisesRegex(RuntimeError, "response lost"):
                    access.open_access(state)
            description = json.loads(state.read_text())["description"]
            unrelated = [rule("Browser SSH"), rule("injury-atlas-actions:124:1:1000"),
                         rule(description, CidrIpv4="0.0.0.0/0")]
            with patch.object(access, "rules", return_value=[rule(description), *unrelated]), \
                 patch.object(access, "revoke") as revoke, contextlib.redirect_stdout(io.StringIO()):
                access.close_access(state)
            revoke.assert_called_once_with("sg-abc", rule(description))

    def test_opens_only_runner_and_recovers_only_old_owned_rules(self):
        with tempfile.TemporaryDirectory() as temp:
            env = {"AWS_DEPLOY_SECURITY_GROUP_ID": "sg-abc", "GITHUB_RUN_ID": "123",
                   "GITHUB_RUN_ATTEMPT": "1", "AWS_HOST": "example.test"}
            response = MagicMock()
            response.__enter__.return_value.read.return_value = b"8.8.8.8\n"
            stale = rule("injury-atlas-actions:100:1:1")
            recent = rule("injury-atlas-actions:122:1:9500")
            with patch.dict(os.environ, env), patch.object(access.time, "time", return_value=10000), \
                 patch.object(access.urllib.request, "urlopen", return_value=response), \
                 patch.object(access, "rules", return_value=[stale, recent, rule("Browser SSH")]), \
                 patch.object(access, "revoke") as revoke, patch.object(access, "aws") as aws, \
                 patch.object(access.socket, "create_connection", return_value=MagicMock()), \
                 contextlib.redirect_stdout(io.StringIO()):
                access.open_access(Path(temp) / "state.json")
            revoke.assert_called_once_with("sg-abc", stale)
            args = aws.call_args.args
            permission = json.loads(args[args.index("--ip-permissions") + 1])[0]
            self.assertEqual(permission["FromPort"], 22)
            self.assertEqual(permission["ToPort"], 22)
            self.assertEqual(permission["IpRanges"][0]["CidrIp"], "8.8.8.8/32")

    def test_absent_state_requires_no_aws_access(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(access, "aws") as aws, \
             contextlib.redirect_stdout(io.StringIO()):
            access.close_access(Path(temp) / "absent.json")
            aws.assert_not_called()

    def test_role_is_scoped_to_repo_environment_and_dedicated_group(self):
        _, trust, policy = setup.role_documents("123456789012", "us-east-2", "sg-abc")
        conditions = trust["Statement"][0]["Condition"]["StringEquals"]
        self.assertEqual(conditions["token.actions.githubusercontent.com:sub"],
                         "repo:raygalvan/injury-atlas:environment:production")
        self.assertEqual(conditions["token.actions.githubusercontent.com:aud"], "sts.amazonaws.com")
        write = policy["Statement"][0]
        self.assertEqual(write["Resource"], "arn:aws:ec2:us-east-2:123456789012:security-group/sg-abc")
        self.assertEqual(set(write["Action"]),
                         {"ec2:AuthorizeSecurityGroupIngress", "ec2:RevokeSecurityGroupIngress"})

    def test_setup_preserves_existing_groups_and_never_changes_instance_role(self):
        calls = []
        tags = [{"Key": "ManagedBy", "Value": setup.OWNER}]
        group = {"GroupId": "sg-dead", "Tags": tags, "IpPermissionsEgress": []}
        primary = {"NetworkInterfaceId": "eni-test", "Attachment": {"DeviceIndex": 0},
                   "Groups": [{"GroupId": "sg-web"}, {"GroupId": "sg-browser"}]}
        def aws(region, *args):
            calls.append(args)
            service, operation = args[:2]
            if operation == "get-caller-identity":
                return {"Account": "123456789012"}
            if operation == "describe-instances":
                return {"Reservations": [{"Instances": [{"VpcId": "vpc-a", "NetworkInterfaces": [primary]}]}]}
            if operation == "describe-security-groups":
                return {"SecurityGroups": [group]}
            if operation == "list-open-id-connect-providers":
                return {"OpenIDConnectProviderList": []}
            if operation == "get-role":
                return {"Role": {"Tags": tags}}
            if operation == "describe-network-interfaces":
                return {"NetworkInterfaces": [{"Groups": primary["Groups"] + [{"GroupId": "sg-dead"}]}]}
            return {}
        with patch.object(setup, "aws", side_effect=aws), contextlib.redirect_stdout(io.StringIO()):
            setup.setup("123456789012", "us-east-2", "i-abc")
        modifications = [c for c in calls if c[1] == "modify-network-interface-attribute"]
        self.assertEqual(len(modifications), 1)
        self.assertEqual(set(modifications[0][5:]), {"sg-web", "sg-browser", "sg-dead"})
        self.assertFalse(any("instance-profile" in c[1] for c in calls))


if __name__ == "__main__":
    unittest.main()
