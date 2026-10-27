#!/bin/sh
# Imports every No-Intro .dat catalog of dataset/dat/ not imported yet.
# Requires the backend answering: by default the one of the Docker stack
# (`npm run docker:dev`), checked through Docker.
# Usage: ./scripts/import-dat.sh [-F | --force] [-h | --help]
#   -F, --force  replace the catalogs already imported under the same file name
#                (deleted, then imported again) instead of skipping them
# API_URL=http://host:port/api targets another backend, e.g. remote or
# `npm run dev`: the Docker checks are then skipped.
set -eu

ROOT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
DAT_DIR="$ROOT_DIR/dataset/dat"

# Prints a clear error message and stops the script
fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

# Prints the usage, which is the header comment above
usage() {
  sed -n '2,/^set -eu/p' "$0" | sed '$d; s/^# \{0,1\}//'
}

FORCE=0
for arg in "$@"; do
  case "$arg" in
    -F | --force) FORCE=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      fail "Unknown option: $arg"
      ;;
  esac
done

# Reads PORT from .env, like docker-compose.yml does (defaults to 3000)
PORT=$(sed -n 's/^PORT=//p' "$ROOT_DIR/.env" 2>/dev/null | tr -d '\r"' | tail -n 1)

command -v curl >/dev/null 2>&1 || fail 'curl is required but was not found.'

# 1. Without API_URL, Docker must be installed, running, and the stack started
if [ -z "${API_URL:-}" ]; then
  API_URL="http://localhost:${PORT:-3000}/api"
  command -v docker >/dev/null 2>&1 ||
    fail 'Docker is not installed (https://docs.docker.com/get-docker/). To target a backend running elsewhere, set API_URL.'
  docker info >/dev/null 2>&1 ||
    fail 'Docker is not running. Start Docker Desktop (or the Docker daemon), then run "npm run docker:dev".'
  docker compose version >/dev/null 2>&1 ||
    fail 'Docker Compose v2 is required ("docker compose", not "docker-compose"). To target a backend running elsewhere, set API_URL.'
  docker compose -f "$ROOT_DIR/docker-compose.yml" ps --status running --services 2>/dev/null |
    grep -qx backend ||
    fail 'The backend container is not running. Start the stack with "npm run docker:dev" first, or set API_URL to target another backend.'
fi

# 2. The backend must answer, with PostgreSQL and Redis up
HEALTH_STATUS=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$API_URL/health" || true)
case "$HEALTH_STATUS" in
  200) ;;
  000) fail "The backend does not answer on $API_URL. Wait until it has started (npm run docker:dev:logs), then retry." ;;
  503) fail 'The backend answers but PostgreSQL or Redis is down. Check "npm run docker:dev:logs".' ;;
  *) fail "Unexpected answer from $API_URL/health (HTTP $HEALTH_STATUS)." ;;
esac

[ -d "$DAT_DIR" ] || fail "Directory not found: $DAT_DIR"

# 3. Catalogs already imported, to skip (or replace) them
CATALOG=$(curl -sf --max-time 10 "$API_URL/dat") ||
  fail "Could not list the imported catalogs (GET $API_URL/dat)."

RESPONSE_FILE=$(mktemp)
trap 'rm -f "$RESPONSE_FILE"' EXIT

found=0
imported=0
replaced=0
skipped=0
failed=0

# Prints the counters, also before an abort so that finished imports are not lost
print_summary() {
  printf '\n%s imported, %s replaced, %s skipped, %s failed.\n' \
    "$imported" "$replaced" "$skipped" "$failed"
}

# Counts and prints the failure of the HTTP answer saved in $RESPONSE_FILE
print_http_failure() {
  message=$(sed -n 's/.*"message":"\([^"]*\)".*/\1/p' "$RESPONSE_FILE")
  printf 'failed (HTTP %s: %s)\n' "$1" "${message:-no details}"
  failed=$((failed + 1))
}

# After a replacement started, tells that the old catalog is gone
print_removed_note() {
  [ "$replacing" -eq 0 ] ||
    printf '    the previous version was removed: run the script again to import it.\n'
}

# Counts the file as failed, prints the counters, then stops the script. A curl
# exit code of 28 is a timeout: the server may still be working, so do not replay yet
abort_unreachable() {
  printf 'failed\n'
  failed=$((failed + 1))
  print_summary
  if [ "$2" -eq 28 ]; then
    fail "Timed out waiting for the $3 of $1. The backend may still be working on it: check \"npm run docker:dev:logs\" and wait for it to end before running the script again."
  fi
  fail "The backend stopped answering during the $3 of $1."
}

printf 'Importing .dat catalogs from %s\n\n' "$DAT_DIR"

for file in "$DAT_DIR"/*.dat; do
  [ -f "$file" ] || continue
  found=$((found + 1))
  name=$(basename "$file")
  # JSON-escapes backslashes and double quotes of the file name
  json_name=$(printf '%s' "$name" | sed 's/\\/\\\\/g; s/"/\\"/g')

  replacing=0
  if printf '%s' "$CATALOG" | grep -Fq "\"fileName\":\"$json_name\""; then
    if [ "$FORCE" -eq 0 ]; then
      printf '  skipped   %s (already imported, use --force to replace it)\n' "$name"
      skipped=$((skipped + 1))
      continue
    fi
    replacing=1
  fi

  # 4. Replacing: the catalogs of the same file name are deleted first, with their entries
  if [ "$replacing" -eq 1 ]; then
    printf '  replacing %s... ' "$name"
    # The id is the first field of each catalog, the file name is in the same object
    ids=$(printf '%s' "$CATALOG" | tr '{' '\n' | grep -F "\"fileName\":\"$json_name\"" |
      sed -n 's/^"id":"\([^"]*\)".*/\1/p')
    if [ -z "$ids" ]; then
      printf 'failed (could not find its id in the catalog list)\n'
      failed=$((failed + 1))
      continue
    fi

    delete_failed=0
    for id in $ids; do
      curl_exit=0
      status=$(curl -s -o "$RESPONSE_FILE" -w '%{http_code}' --max-time 30 \
        -X DELETE "$API_URL/dat/$id") || curl_exit=$?
      case "$status" in
        204) ;;
        000) abort_unreachable "$name" "$curl_exit" deletion ;;
        *)
          # ROMs matched against this catalog still reference its entries
          if grep -Fq '"code":"FOREIGN_KEY_CONSTRAINT"' "$RESPONSE_FILE"; then
            printf 'failed (HTTP %s: ROMs still reference this catalog, it cannot be replaced)\n' "$status"
            failed=$((failed + 1))
          else
            print_http_failure "$status"
          fi
          delete_failed=1
          break
          ;;
      esac
    done
    [ "$delete_failed" -eq 0 ] || continue
  else
    printf '  importing %s... ' "$name"
  fi

  curl_exit=0
  status=$(curl -s -o "$RESPONSE_FILE" -w '%{http_code}' --max-time 600 \
    -H 'Content-Type: application/json' \
    --data "{\"fileName\":\"$json_name\"}" \
    "$API_URL/dat/import") || curl_exit=$?

  case "$status" in
    201)
      entries=$(sed -n 's/.*"insertedEntries":\([0-9]*\).*/\1/p' "$RESPONSE_FILE")
      printf 'done (%s entries)\n' "${entries:-?}"
      if [ "$replacing" -eq 1 ]; then
        replaced=$((replaced + 1))
      else
        imported=$((imported + 1))
      fi
      ;;
    409)
      # Only this code means the same content is already imported (e.g. under
      # another file name), any other conflict is a real failure
      if grep -Fq '"code":"DAT_ALREADY_IMPORTED"' "$RESPONSE_FILE"; then
        if [ "$replacing" -eq 1 ]; then
          printf 'skipped (same content already imported under another file name, the previous version was removed)\n'
        else
          printf 'skipped (same content already imported)\n'
        fi
        skipped=$((skipped + 1))
      else
        print_http_failure "$status"
        print_removed_note
      fi
      ;;
    000) abort_unreachable "$name" "$curl_exit" import ;;
    *)
      print_http_failure "$status"
      print_removed_note
      ;;
  esac
done

[ "$found" -gt 0 ] || fail "No .dat file found in $DAT_DIR"

print_summary
[ "$failed" -eq 0 ] || exit 1
