#!/usr/bin/env bash
# Full-stack abuse check through the real edge: one address floods while another must stay served.
set -euo pipefail
cd "$(dirname "$0")/../.."
C="docker compose -f docker-compose.yml -f docker-compose.attack.yml"
$C --profile attack up -d --no-deps attacker
set +e
$C --profile attack run --rm --no-deps legit
legit=$?
attacker=$(docker wait "$($C --profile attack ps -aq attacker)" 2>/dev/null || echo 1)
$C --profile attack logs attacker | tail -3
$C --profile attack rm -sf attacker >/dev/null 2>&1
echo "legit exit=$legit attacker exit=$attacker"
[ "$legit" = 0 ] && [ "$attacker" = 0 ]
