#!/usr/bin/env bash
# Block until the service reports readiness on GET /health, or fail the job.
set -euo pipefail

URL="${BASE_URL:-http://localhost:3000}/health"

for _ in $(seq 1 120); do
  if curl -fsS --max-time 2 "$URL" > /dev/null 2>&1; then
    echo "service ready at $URL"
    exit 0
  fi
  sleep 0.5
done

echo "service did not become ready at $URL within 60s" >&2
cat server-*.log 2>/dev/null || true
exit 1
