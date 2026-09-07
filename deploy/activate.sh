#!/usr/bin/env bash
# Run as the deployment account. sudo rights limited to restarting this service.
set -euo pipefail
RELEASE_SHA="$1"
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid release SHA'; exit 1; }
RELEASE_DIR="/opt/injury-atlas/releases/$RELEASE_SHA"
cd "$RELEASE_DIR"
npm ci --omit=dev --no-audit --no-fund
node -e 'const fs=require("fs");if(JSON.parse(fs.readFileSync("dist/release.json")).commit!==process.argv[1])process.exit(1);if(!fs.existsSync(".atlas-build/models/atlas.json"))process.exit(1)' "$RELEASE_SHA"
PREVIOUS_RELEASE="$(readlink -f /opt/injury-atlas/current || true)"
ln -sfn "$RELEASE_DIR" /opt/injury-atlas/current.next
mv -Tf /opt/injury-atlas/current.next /opt/injury-atlas/current
sudo systemctl restart injury-atlas
for attempt in $(seq 1 15); do
  if HEALTH_BODY="$(curl -fsS http://127.0.0.1:3100/api/health)" && node -e 'const h=JSON.parse(process.argv[1]);if(!h.ok||!h.atlasReady||h.release!==process.argv[2])process.exit(1)' "$HEALTH_BODY" "$RELEASE_SHA"; then
    echo "Verified Injury Atlas release $RELEASE_SHA"
    exit 0
  fi
  sleep 2
done
if [ -n "$PREVIOUS_RELEASE" ] && [ "$PREVIOUS_RELEASE" != "$RELEASE_DIR" ]; then
  ln -sfn "$PREVIOUS_RELEASE" /opt/injury-atlas/current.next
  mv -Tf /opt/injury-atlas/current.next /opt/injury-atlas/current
  sudo systemctl restart injury-atlas
fi
echo 'Release failed verification; previous release restored when available.' >&2
exit 1
