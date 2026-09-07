# Injury Atlas

Tool-first, attorney-facing injury evidence and reconstruction workspace. Human Atlas is the primary tool. Law.bot is a workflow reference, not a dependency.

- AWS only for production infrastructure. Preserve EC2/systemd deployment and persistent EBS data.
- Pin the separate Human Atlas engine in atlas.lock.json. Do not replace it with generated anatomy or copy synthetic test findings into real cases.
- Source evidence, anatomical placement, visual rendering and attorney/expert approval are separate decisions.
- Keep clients restricted to assigned cases and their own submissions. Enforce permissions on every API and asset route.
- Never commit source medical files, real case evidence, tokens, passwords, AWS keys or private sessions.
- Do not send invitations or other emails in tests or while developing.
- Use new branches from current main. Prepare unmerged PRs unless the user authorizes merging.
- Test with npm test, npm run build, npm run build:atlas. Deployment tests must verify actual runtime state; a frontend build alone is not a deployment test.
