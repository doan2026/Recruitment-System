#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

DEFAULT_PG_IMAGE='postgres@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685'
LABEL_KEY='io.recruitment.company-public-search-load'
DB_SENTINEL_PREFIX='recruitment-company-public-search-load:'
STEP='preflight'
TASK_TMP=''
TASK_TMP_CREATED=false
RUN_ID=''
NETWORK=''
NETWORK_ID=''
NETWORK_CREATED=false
PG_CONTAINER=''
PG_CONTAINER_ID=''
PG_CONTAINER_CREATED=false
PG_HOST=''
API_CONTAINER=''
API_CONTAINER_ID=''
API_CONTAINER_CREATED=false
API_HOST=''
RUNNER_CONTAINER=''
RUNNER_CONTAINER_ID=''
RUNNER_CONTAINER_CREATED=false
APP_IMAGE=''
APP_IMAGE_ID=''
APP_IMAGE_CREATED=false

say() { printf '[company-public-search] %s\n' "$1"; }
fail() { printf '[company-public-search] ERROR: %s\n' "$1" >&2; exit 1; }

(( $# == 0 )) || fail 'no URL, database target or positional argument is accepted'
OVERALL_TIMEOUT_SECONDS="${COMPANY_PUBLIC_SEARCH_LOAD_OVERALL_TIMEOUT_SECONDS:-900}"
[[ "$OVERALL_TIMEOUT_SECONDS" =~ ^[0-9]+$ \
  && "$OVERALL_TIMEOUT_SECONDS" -ge 300 \
  && "$OVERALL_TIMEOUT_SECONDS" -le 3600 ]] \
  || fail 'COMPANY_PUBLIC_SEARCH_LOAD_OVERALL_TIMEOUT_SECONDS must be 300..3600'
command -v timeout >/dev/null 2>&1 || fail 'timeout is required'
if [[ ${COMPANY_PUBLIC_SEARCH_LOAD_TIMEOUT_WRAPPED:-} != 1 ]]; then
  exec env COMPANY_PUBLIC_SEARCH_LOAD_TIMEOUT_WRAPPED=1 \
    timeout --foreground --kill-after=30s "$OVERALL_TIMEOUT_SECONDS" "$0"
fi

cleanup() {
  local code=$? value=''
  set +e
  if (( code != 0 )) && [[ "$API_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]]; then
    value="$(docker inspect --format \
      '{{.Id}}|{{.Name}}|{{index .Config.Labels "io.recruitment.company-public-search-load"}}' \
      "$API_CONTAINER_ID" 2>/dev/null)"
    if [[ "$value" == "$API_CONTAINER_ID|/$API_CONTAINER|$RUN_ID" ]]; then
      printf '[company-public-search] API log tail follows\n' >&2
      docker logs --tail 40 "$API_CONTAINER_ID" >&2 2>/dev/null
    fi
  fi
  if [[ "$RUNNER_CONTAINER_CREATED" == true \
    && "$RUNNER_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]]; then
    value="$(docker inspect --format \
      '{{.Id}}|{{.Name}}|{{index .Config.Labels "io.recruitment.company-public-search-load"}}' \
      "$RUNNER_CONTAINER_ID" 2>/dev/null)"
    [[ "$value" == "$RUNNER_CONTAINER_ID|/$RUNNER_CONTAINER|$RUN_ID" ]] \
      && docker rm --force "$RUNNER_CONTAINER_ID" >/dev/null 2>&1
  fi
  if [[ "$API_CONTAINER_CREATED" == true \
    && "$API_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]]; then
    value="$(docker inspect --format \
      '{{.Id}}|{{.Name}}|{{index .Config.Labels "io.recruitment.company-public-search-load"}}' \
      "$API_CONTAINER_ID" 2>/dev/null)"
    [[ "$value" == "$API_CONTAINER_ID|/$API_CONTAINER|$RUN_ID" ]] \
      && docker rm --force "$API_CONTAINER_ID" >/dev/null 2>&1
  fi
  if [[ "$PG_CONTAINER_CREATED" == true \
    && "$PG_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]]; then
    value="$(docker inspect --format \
      '{{.Id}}|{{.Name}}|{{index .Config.Labels "io.recruitment.company-public-search-load"}}' \
      "$PG_CONTAINER_ID" 2>/dev/null)"
    [[ "$value" == "$PG_CONTAINER_ID|/$PG_CONTAINER|$RUN_ID" ]] \
      && docker rm --force "$PG_CONTAINER_ID" >/dev/null 2>&1
  fi
  if [[ "$NETWORK_CREATED" == true && "$NETWORK_ID" =~ ^[0-9a-f]{64}$ ]]; then
    value="$(docker network inspect --format \
      '{{.Id}}|{{.Name}}|{{index .Labels "io.recruitment.company-public-search-load"}}' \
      "$NETWORK_ID" 2>/dev/null)"
    [[ "$value" == "$NETWORK_ID|$NETWORK|$RUN_ID" ]] \
      && docker network rm "$NETWORK_ID" >/dev/null 2>&1
  fi
  if [[ "$APP_IMAGE_CREATED" == true \
    && "$APP_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    value="$(docker image inspect --format \
      '{{.Id}}|{{index .Config.Labels "io.recruitment.company-public-search-load"}}' \
      "$APP_IMAGE_ID" 2>/dev/null)"
    [[ "$value" == "$APP_IMAGE_ID|$RUN_ID" ]] \
      && docker image rm "$APP_IMAGE_ID" >/dev/null 2>&1
  fi
  [[ "$TASK_TMP_CREATED" != true \
    || -z "$TASK_TMP" \
    || "$TASK_TMP" != /tmp/company-public-search-load.* ]] \
    || rm -rf -- "$TASK_TMP"
  (( code == 0 )) \
    || printf '[company-public-search] FAILED during: %s\n' "$STEP" >&2
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

for variable in DATABASE_URL PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGPASSWORD \
  PGPASSFILE PGSERVICE PGSERVICEFILE; do
  [[ -z ${!variable+x} ]] \
    || fail "unset $variable; external database targets are refused"
done
for variable in DOCKER_HOST DOCKER_TLS_VERIFY DOCKER_CERT_PATH; do
  [[ -z ${!variable+x} ]] \
    || fail "unset $variable; only the active local Unix Docker context is allowed"
done
for command_name in awk cat chmod cp date dirname docker env find grep mkdir \
  mktemp od rm sed sleep tail tr; do
  command -v "$command_name" >/dev/null 2>&1 \
    || fail "$command_name is required"
done
DOCKER_ENDPOINT="$(docker context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null)"
[[ "$DOCKER_ENDPOINT" == unix://* ]] \
  || fail 'the active Docker context is not a local Unix socket'
docker info >/dev/null 2>&1 || fail 'the local Docker daemon is unavailable'

read_integer() {
  local name=$1 fallback=$2 minimum=$3 maximum=$4 value
  value="${!name:-$fallback}"
  [[ "$value" =~ ^[0-9]+$ \
    && "$value" -ge "$minimum" \
    && "$value" -le "$maximum" ]] \
    || fail "$name must be an integer in $minimum..$maximum"
  printf '%s' "$value"
}

DATASET_SIZE="$(read_integer COMPANY_PUBLIC_SEARCH_LOAD_DATASET_SIZE 100000 100000 500000)"
(( DATASET_SIZE % 10 == 0 )) \
  || fail 'COMPANY_PUBLIC_SEARCH_LOAD_DATASET_SIZE must be divisible by ten'
WARMUP_REQUESTS="$(read_integer COMPANY_PUBLIC_SEARCH_LOAD_WARMUP_REQUESTS 500 0 100000)"
MEASURED_REQUESTS="$(read_integer COMPANY_PUBLIC_SEARCH_LOAD_MEASURED_REQUESTS 10000 10000 1000000)"
CONCURRENCY="$(read_integer COMPANY_PUBLIC_SEARCH_LOAD_CONCURRENCY 32 1 128)"
REQUEST_TIMEOUT_MS="$(read_integer COMPANY_PUBLIC_SEARCH_LOAD_REQUEST_TIMEOUT_MS 3000 100 10000)"
MAX_BODY_BYTES="$(read_integer COMPANY_PUBLIC_SEARCH_LOAD_MAX_BODY_BYTES 65536 1024 1048576)"
MAX_P95_MS="$(read_integer COMPANY_PUBLIC_SEARCH_LOAD_MAX_P95_MS 500 1 60000)"
MAX_P99_MS="$(read_integer COMPANY_PUBLIC_SEARCH_LOAD_MAX_P99_MS 1000 1 60000)"
MIN_RPS="$(read_integer COMPANY_PUBLIC_SEARCH_LOAD_MIN_RPS 75 1 1000000)"
(( MAX_P95_MS <= MAX_P99_MS )) || fail 'p95 threshold must not exceed p99'

PG_IMAGE="${COMPANY_PUBLIC_SEARCH_LOAD_POSTGRES_IMAGE:-$DEFAULT_PG_IMAGE}"
[[ "$PG_IMAGE" =~ ^[A-Za-z0-9][A-Za-z0-9._/@:-]*$ ]] \
  || fail 'invalid PostgreSQL image reference'
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
SERVICE_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
RUNNER_FILE="$SCRIPT_DIR/public-search-load-runner.js"
SEED_FILE="$SCRIPT_DIR/public-search-load-seed.psql"
for path in "$RUNNER_FILE" "$SEED_FILE" "$SERVICE_DIR/Dockerfile" \
  "$SERVICE_DIR/package.json" "$SERVICE_DIR/nest-cli.json" \
  "$SERVICE_DIR/tsconfig.json" "$SERVICE_DIR/prisma/schema.prisma" \
  "$SERVICE_DIR/prisma/migrations/20260829100000_company_public_search/migration.sql"; do
  [[ -f "$path" ]] || fail "required input is missing: $path"
done
[[ -d "$SERVICE_DIR/src" && -d "$SERVICE_DIR/prisma/migrations" ]] \
  || fail 'Company source or migrations directory is missing'

RUN_ID="$(date -u +%Y%m%d%H%M%S)-$$-$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
[[ "$RUN_ID" =~ ^[0-9a-f-]+$ ]] || fail 'could not generate a safe run identifier'
TASK_TMP="$(mktemp -d "/tmp/company-public-search-load.$RUN_ID.XXXXXX")"
TASK_TMP_CREATED=true
chmod 700 "$TASK_TMP"
NETWORK="company-public-search-load-network-$RUN_ID"
PG_CONTAINER="company-public-search-load-postgres-$RUN_ID"
PG_HOST="company-load-pg-$RUN_ID"
API_CONTAINER="company-public-search-load-api-$RUN_ID"
API_HOST="company-load-api-$RUN_ID"
RUNNER_CONTAINER="company-public-search-load-runner-$RUN_ID"
APP_IMAGE="company-public-search-load-app:$RUN_ID"
DB_NAME='company_public_search_load'

guard_network() {
  local value
  value="$(docker network inspect --format \
    '{{.Id}}|{{.Name}}|{{.Internal}}|{{index .Labels "io.recruitment.company-public-search-load"}}' \
    "$NETWORK_ID" 2>/dev/null)"
  [[ "$NETWORK_CREATED" == true \
    && "$value" == "$NETWORK_ID|$NETWORK|true|$RUN_ID" ]] \
    || fail 'Docker network sentinel mismatch'
}

guard_container() {
  local container_id=$1 container_name=$2 value
  value="$(docker inspect --format \
    '{{.Id}}|{{.Name}}|{{index .Config.Labels "io.recruitment.company-public-search-load"}}|{{.HostConfig.NetworkMode}}' \
    "$container_id" 2>/dev/null)"
  [[ "$container_id" =~ ^[0-9a-f]{64}$ \
    && "$value" == "$container_id|/$container_name|$RUN_ID|$NETWORK" ]] \
    || fail 'Docker container sentinel mismatch'
  [[ -z "$(docker port "$container_id" 2>/dev/null)" ]] \
    || fail 'a disposable container published a host port'
  guard_network
}

raw_scalar() {
  docker exec "$PG_CONTAINER_ID" psql -X --no-psqlrc -U postgres \
    -d "$DB_NAME" -qAt -v ON_ERROR_STOP=1 -c "$1"
}

guard_db() {
  local value
  guard_container "$PG_CONTAINER_ID" "$PG_CONTAINER"
  value="$(raw_scalar \
    "SELECT current_database() || '|' || (current_setting('server_version_num')::integer / 10000)::text || '|' || coalesce(shobj_description(oid, 'pg_database'), '') FROM pg_database WHERE datname=current_database();")"
  [[ "$value" == "$DB_NAME|16|$DB_SENTINEL_PREFIX$RUN_ID" ]] \
    || fail 'database name/version/sentinel guard mismatch'
}

scalar() {
  guard_db
  raw_scalar "$1"
}

STEP='create isolated Docker network'
NETWORK_ID="$(docker network create --internal \
  --label "$LABEL_KEY=$RUN_ID" "$NETWORK")"
[[ "$NETWORK_ID" =~ ^[0-9a-f]{64}$ ]] \
  || fail 'Docker did not return an exact network ID'
NETWORK_CREATED=true
guard_network

STEP='start disposable PostgreSQL 16'
PG_CONTAINER_ID="$(docker create --name "$PG_CONTAINER" \
  --network "$NETWORK" --network-alias "$PG_HOST" \
  --tmpfs /var/lib/postgresql/data:rw,noexec,nosuid,size=1g \
  --label "$LABEL_KEY=$RUN_ID" \
  -e POSTGRES_DB="$DB_NAME" \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  "$PG_IMAGE")"
[[ "$PG_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]] \
  || fail 'Docker did not return an exact PostgreSQL container ID'
PG_CONTAINER_CREATED=true
guard_container "$PG_CONTAINER_ID" "$PG_CONTAINER"
docker start "$PG_CONTAINER_ID" >/dev/null
for _attempt in $(awk 'BEGIN { for (i=1; i<=120; i++) print i }'); do
  if docker exec "$PG_CONTAINER_ID" pg_isready -U postgres -d "$DB_NAME" \
    >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$PG_CONTAINER_ID" pg_isready -U postgres -d "$DB_NAME" \
  >/dev/null 2>&1 || fail 'PostgreSQL did not become ready'
docker exec -i "$PG_CONTAINER_ID" psql -X --no-psqlrc -U postgres \
  -d postgres -q -v ON_ERROR_STOP=1 >"$TASK_TMP/database-sentinel.log" 2>&1 <<SQL
COMMENT ON DATABASE "$DB_NAME" IS '$DB_SENTINEL_PREFIX$RUN_ID';
SQL
guard_db

STEP='build allow-listed Company API image'
BUILD_CONTEXT="$TASK_TMP/build-context"
mkdir -p "$BUILD_CONTEXT"
cp "$SERVICE_DIR/Dockerfile" "$SERVICE_DIR/package.json" \
  "$SERVICE_DIR/nest-cli.json" "$SERVICE_DIR/tsconfig.json" \
  "$BUILD_CONTEXT/"
cp -R "$SERVICE_DIR/prisma" "$SERVICE_DIR/src" "$BUILD_CONTEXT/"
if find "$BUILD_CONTEXT" -type l -print -quit | grep -q .; then
  fail 'symlinks are refused in the temporary build context'
fi
if ! docker build --label "$LABEL_KEY=$RUN_ID" --tag "$APP_IMAGE" \
  "$BUILD_CONTEXT" >"$TASK_TMP/application-build.log" 2>&1; then
  tail -n 60 "$TASK_TMP/application-build.log" >&2
  fail 'Company API image build failed'
fi
APP_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$APP_IMAGE")"
[[ "$APP_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]] \
  || fail 'Docker did not return an exact application image ID'
APP_IMAGE_CREATED=true
[[ "$(docker image inspect --format \
  '{{.Id}}|{{index .Config.Labels "io.recruitment.company-public-search-load"}}' \
  "$APP_IMAGE_ID")" == "$APP_IMAGE_ID|$RUN_ID" ]] \
  || fail 'application image sentinel mismatch'

STEP='start migrated Company API'
API_CONTAINER_ID="$(docker create --name "$API_CONTAINER" \
  --network "$NETWORK" --network-alias "$API_HOST" \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=128m \
  --cap-drop ALL --security-opt no-new-privileges \
  --label "$LABEL_KEY=$RUN_ID" \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e "DATABASE_URL=postgresql://postgres@$PG_HOST:5432/$DB_NAME?schema=company" \
  -e JWT_ISSUER=https://auth.recruitment.load \
  -e JWT_AUDIENCE=recruitment-api \
  -e MEDIA_SERVICE_URL=http://media-load.invalid:3000 \
  -e MEDIA_INTERNAL_API_KEY=load-harness-media-boundary-key-7f4f92e70a954b70 \
  -e MEDIA_REQUEST_TIMEOUT_MS=3000 \
  -e COMPANY_MEDIA_OPERATION_ENABLED=false \
  -e COMPANY_PUBLIC_CURSOR_HMAC_KEY=load-harness-public-cursor-key-71b579544be74a269c3c \
  -e NPM_CONFIG_CACHE=/tmp/npm-cache \
  "$APP_IMAGE_ID")"
[[ "$API_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]] \
  || fail 'Docker did not return an exact API container ID'
API_CONTAINER_CREATED=true
guard_container "$API_CONTAINER_ID" "$API_CONTAINER"
docker start "$API_CONTAINER_ID" >/dev/null
for _attempt in $(awk 'BEGIN { for (i=1; i<=180; i++) print i }'); do
  API_STATE="$(docker inspect --format '{{.State.Status}}' "$API_CONTAINER_ID")"
  [[ "$API_STATE" == running ]] \
    || fail "Company API exited before readiness (state: $API_STATE)"
  if docker exec "$API_CONTAINER_ID" wget -q -O - \
    http://127.0.0.1:3000/health >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$API_CONTAINER_ID" wget -q -O - \
  http://127.0.0.1:3000/health >/dev/null 2>&1 \
  || fail 'Company API did not become healthy'
guard_db
[[ "$(scalar \
  "SELECT (to_regprocedure('company.fold_public_company_search(text)') IS NOT NULL)::integer::text || '|' || (to_regclass('company.companies') IS NOT NULL)::integer::text || '|' || (SELECT count(*)::text FROM pg_indexes WHERE schemaname='company' AND indexname IN ('companies_public_verified_normalized_name_id_idx','companies_public_verified_search_tsv_idx'));")" \
  == '1|1|2' ]] || fail 'public search migration objects are missing'

STEP='load deterministic 100k Company fixture'
guard_db
docker exec -i "$PG_CONTAINER_ID" psql -X --no-psqlrc -U postgres \
  -d "$DB_NAME" -q -v ON_ERROR_STOP=1 -v company_count="$DATASET_SIZE" \
  >"$TASK_TMP/seed.log" 2>&1 <"$SEED_FILE" \
  || { tail -n 60 "$TASK_TMP/seed.log" >&2; fail 'fixture seed failed'; }
SEED_COUNTS="$(scalar \
  "SELECT count(*)::text || '|' || count(*) FILTER (WHERE verified_status='VERIFIED')::text || '|' || count(*) FILTER (WHERE verified_status='PENDING')::text || '|' || count(*) FILTER (WHERE verified_status='REJECTED')::text FROM company.companies;")"
[[ "$SEED_COUNTS" == "$DATASET_SIZE|$((DATASET_SIZE * 8 / 10))|$((DATASET_SIZE / 10))|$((DATASET_SIZE / 10))" ]] \
  || fail 'seed count/status ratio mismatch'
SEED_FINGERPRINT="$(scalar \
  "SELECT md5(string_agg(id::text || '|' || normalized_name || '|' || verified_status::text || '|' || coalesce(logo_media_reference_id::text,'<null>'), E'\\n' ORDER BY normalized_name,id)) FROM company.companies;")"
[[ "$SEED_FINGERPRINT" =~ ^[0-9a-f]{32}$ ]] \
  || fail 'could not calculate the deterministic seed fingerprint'

STEP='verify PostgreSQL index plans'
guard_db
docker exec -i "$PG_CONTAINER_ID" psql -X --no-psqlrc -U postgres \
  -d "$DB_NAME" -qAt -v ON_ERROR_STOP=1 \
  >"$TASK_TMP/plan-unfiltered.json" 2>&1 <<'SQL'
SET statement_timeout = '3s';
SET enable_seqscan = on;
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON, TIMING OFF)
SELECT c.id, c.name, c.normalized_name, c.slug, c.industry, c.size, c.address,
       CASE WHEN c.logo_media_reference_id IS NULL THEN NULL ELSE c.logo_url END
FROM company.companies c
WHERE c.verified_status = 'VERIFIED'::company."CompanyVerificationStatus"
ORDER BY c.normalized_name ASC, c.id ASC
LIMIT 51;
SQL
grep -Fq '"Node Type": "Seq Scan"' "$TASK_TMP/plan-unfiltered.json" \
  && fail 'unfiltered public search used a sequential scan'
grep -Fq '"Index Name"' "$TASK_TMP/plan-unfiltered.json" \
  || fail 'unfiltered public search did not use an index plan'
UNFILTERED_INDEX_NAME="$(awk -F'"' '/"Index Name"/ { print $4; exit }' \
  "$TASK_TMP/plan-unfiltered.json")"
[[ "$UNFILTERED_INDEX_NAME" =~ ^[a-z0-9_]+$ ]] \
  || fail 'could not identify the unfiltered index plan'

guard_db
docker exec -i "$PG_CONTAINER_ID" psql -X --no-psqlrc -U postgres \
  -d "$DB_NAME" -qAt -v ON_ERROR_STOP=1 \
  >"$TASK_TMP/plan-deep-continuation.json" 2>&1 <<'SQL'
SET statement_timeout = '3s';
SET enable_seqscan = on;
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON, TIMING OFF)
SELECT c.id, c.name, c.normalized_name, c.slug, c.industry, c.size, c.address,
       CASE WHEN c.logo_media_reference_id IS NULL THEN NULL ELSE c.logo_url END
FROM company.companies c
WHERE c.verified_status = 'VERIFIED'::company."CompanyVerificationStatus"
  AND (c.normalized_name, c.id) > (
    'company 090000 du lịch phú quốc',
    '00000000-0000-4000-8000-000000000000'::uuid
  )
ORDER BY c.normalized_name ASC, c.id ASC
LIMIT 51;
SQL
grep -Fq '"Node Type": "Seq Scan"' "$TASK_TMP/plan-deep-continuation.json" \
  && fail 'deep public-search continuation used a sequential scan'
if grep -Fq 'companies_public_verified_normalized_name_id_idx' \
  "$TASK_TMP/plan-deep-continuation.json"; then
  DEEP_INDEX_NAME='companies_public_verified_normalized_name_id_idx'
elif grep -Fq 'companies_normalized_name_key' \
  "$TASK_TMP/plan-deep-continuation.json"; then
  DEEP_INDEX_NAME='companies_normalized_name_key'
else
  cat "$TASK_TMP/plan-deep-continuation.json" >&2
  fail 'deep continuation did not use an allowed normalized-name B-tree index'
fi

guard_db
docker exec -i "$PG_CONTAINER_ID" psql -X --no-psqlrc -U postgres \
  -d "$DB_NAME" -qAt -v ON_ERROR_STOP=1 \
  >"$TASK_TMP/plan-search.json" 2>&1 <<'SQL'
SET statement_timeout = '3s';
SET enable_seqscan = on;
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON, TIMING OFF)
SELECT c.id, c.name, c.normalized_name, c.slug, c.industry, c.size, c.address,
       CASE WHEN c.logo_media_reference_id IS NULL THEN NULL ELSE c.logo_url END
FROM company.companies c
WHERE c.verified_status = 'VERIFIED'::company."CompanyVerificationStatus"
  AND to_tsvector('simple'::regconfig, company.fold_public_company_search(c.name))
      @@ to_tsquery('simple'::regconfig, 'company:* & 090011:* & cong:* & nghe:* & da:* & nang:*')
ORDER BY c.normalized_name ASC, c.id ASC
LIMIT 51;
SQL
grep -Fq '"Node Type": "Seq Scan"' "$TASK_TMP/plan-search.json" \
  && fail 'selective Vietnamese FTS used a sequential scan'
if ! grep -Fq 'companies_public_verified_search_tsv_idx' \
  "$TASK_TMP/plan-search.json"; then
  cat "$TASK_TMP/plan-search.json" >&2
  fail 'selective Vietnamese FTS did not use its GIN index'
fi

STEP='run HTTP correctness traversal and load benchmark'
RUNNER_CONTAINER_ID="$(docker create --name "$RUNNER_CONTAINER" \
  --network "$NETWORK" --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --cap-drop ALL --security-opt no-new-privileges \
  --label "$LABEL_KEY=$RUN_ID" \
  --mount "type=bind,src=$RUNNER_FILE,dst=/runner/public-search-load-runner.js,readonly" \
  -e "LOAD_BASE_URL=http://$API_HOST:3000/search" \
  -e LOAD_DATASET_SIZE="$DATASET_SIZE" \
  -e LOAD_WARMUP_REQUESTS="$WARMUP_REQUESTS" \
  -e LOAD_MEASURED_REQUESTS="$MEASURED_REQUESTS" \
  -e LOAD_CONCURRENCY="$CONCURRENCY" \
  -e LOAD_REQUEST_TIMEOUT_MS="$REQUEST_TIMEOUT_MS" \
  -e LOAD_MAX_BODY_BYTES="$MAX_BODY_BYTES" \
  -e LOAD_MAX_P95_MS="$MAX_P95_MS" \
  -e LOAD_MAX_P99_MS="$MAX_P99_MS" \
  -e LOAD_MIN_REQUESTS_PER_SECOND="$MIN_RPS" \
  -e LOAD_SEED_FINGERPRINT="$SEED_FINGERPRINT" \
  -e LOAD_POSTGRES_IMAGE="$PG_IMAGE" \
  -e LOAD_APPLICATION_IMAGE_ID="$APP_IMAGE_ID" \
  -e LOAD_UNFILTERED_INDEX_NAME="$UNFILTERED_INDEX_NAME" \
  -e LOAD_DEEP_INDEX_NAME="$DEEP_INDEX_NAME" \
  -e LOAD_SEARCH_INDEX_NAME=companies_public_verified_search_tsv_idx \
  "$APP_IMAGE_ID" node /runner/public-search-load-runner.js)"
[[ "$RUNNER_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]] \
  || fail 'Docker did not return an exact runner container ID'
RUNNER_CONTAINER_CREATED=true
guard_container "$RUNNER_CONTAINER_ID" "$RUNNER_CONTAINER"
RUNNER_STATUS=0
docker start --attach "$RUNNER_CONTAINER_ID" \
  >"$TASK_TMP/runner.log" 2>"$TASK_TMP/runner-error.log" \
  || RUNNER_STATUS=$?
guard_container "$RUNNER_CONTAINER_ID" "$RUNNER_CONTAINER"
if (( RUNNER_STATUS != 0 )); then
  tail -n 30 "$TASK_TMP/runner-error.log" >&2
  tail -n 5 "$TASK_TMP/runner.log" >&2
  fail 'HTTP correctness/load runner failed'
fi
grep -Fq '"status":"PASS"' "$TASK_TMP/runner.log" \
  || fail 'runner did not emit a machine-readable PASS report'
grep -Fq '[company-public-search] PASS' "$TASK_TMP/runner.log" \
  || fail 'runner did not emit its concise PASS summary'

STEP='complete'
cat "$TASK_TMP/runner.log"
say 'PASS: PostgreSQL plans, full cursor traversal, Vietnamese/privacy negatives and HTTP load thresholds'
