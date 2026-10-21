#!/bin/sh
# Imports every No-Intro .dat catalog of dataset/dat/ not imported yet.
# Requires Docker running and the backend answering (`npm run docker:dev`).
# Usage: ./scripts/import-dat.sh (API_URL=http://host:port/api to override)
set -eu

ROOT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
DAT_DIR="$ROOT_DIR/dataset/dat"

# Prints a clear error message and stops the script
fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

# Reads PORT from .env, like docker-compose.yml does (defaults to 3000)
PORT=$(sed -n 's/^PORT=//p' "$ROOT_DIR/.env" 2>/dev/null | tr -d '\r"' | tail -n 1)
API_URL=${API_URL:-"http://localhost:${PORT:-3000}/api"}

# 1. Docker must be installed, running, and the stack started
command -v curl >/dev/null 2>&1 || fail 'curl is required but was not found.'
command -v docker >/dev/null 2>&1 ||
  fail 'Docker is not installed (https://docs.docker.com/get-docker/).'
docker info >/dev/null 2>&1 ||
  fail 'Docker is not running. Start Docker Desktop (or the Docker daemon), then run "npm run docker:dev".'
docker compose -f "$ROOT_DIR/docker-compose.yml" ps --status running --services 2>/dev/null |
  grep -qx backend ||
  fail 'The backend container is not running. Start the stack with "npm run docker:dev" first.'

# 2. The backend must answer, with PostgreSQL and Redis up
HEALTH_STATUS=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$API_URL/health" || true)
case "$HEALTH_STATUS" in
  200) ;;
  000) fail "The backend does not answer on $API_URL. Wait until it has started (npm run docker:dev:logs), then retry." ;;
  503) fail 'The backend answers but PostgreSQL or Redis is down. Check "npm run docker:dev:logs".' ;;
  *) fail "Unexpected answer from $API_URL/health (HTTP $HEALTH_STATUS)." ;;
esac

[ -d "$DAT_DIR" ] || fail "Directory not found: $DAT_DIR"

# 3. Catalogs already imported, to skip them without re-reading them
CATALOG=$(curl -sf --max-time 10 "$API_URL/dat") ||
  fail "Could not list the imported catalogs (GET $API_URL/dat)."

RESPONSE_FILE=$(mktemp)
trap 'rm -f "$RESPONSE_FILE"' EXIT

found=0
imported=0
skipped=0
failed=0

printf 'Importing .dat catalogs from %s\n\n' "$DAT_DIR"

for file in "$DAT_DIR"/*.dat; do
  [ -f "$file" ] || continue
  found=$((found + 1))
  name=$(basename "$file")
  # JSON-escapes backslashes and double quotes of the file name
  json_name=$(printf '%s' "$name" | sed 's/\\/\\\\/g; s/"/\\"/g')

  if printf '%s' "$CATALOG" | grep -Fq "\"fileName\":\"$json_name\""; then
    printf '  skipped   %s (already imported)\n' "$name"
    skipped=$((skipped + 1))
    continue
  fi

  printf '  importing %s... ' "$name"
  status=$(curl -s -o "$RESPONSE_FILE" -w '%{http_code}' --max-time 600 \
    -H 'Content-Type: application/json' \
    --data "{\"fileName\":\"$json_name\"}" \
    "$API_URL/dat/import" || true)

  case "$status" in
    201)
      entries=$(sed -n 's/.*"insertedEntries":\([0-9]*\).*/\1/p' "$RESPONSE_FILE")
      printf 'done (%s entries)\n' "${entries:-?}"
      imported=$((imported + 1))
      ;;
    409)
      # Same content already imported under another file name
      printf 'skipped (same content already imported)\n'
      skipped=$((skipped + 1))
      ;;
    000)
      printf 'failed\n'
      fail "The backend stopped answering while importing $name."
      ;;
    *)
      message=$(sed -n 's/.*"message":"\([^"]*\)".*/\1/p' "$RESPONSE_FILE")
      printf 'failed (HTTP %s: %s)\n' "$status" "${message:-no details}"
      failed=$((failed + 1))
      ;;
  esac
done

[ "$found" -gt 0 ] || fail "No .dat file found in $DAT_DIR"

printf '\n%s imported, %s skipped, %s failed.\n' "$imported" "$skipped" "$failed"
[ "$failed" -eq 0 ] || exit 1
