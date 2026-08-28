#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

DEFAULT_PG_IMAGE='postgres@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685'
DEFAULT_REDIS_IMAGE='redis@sha256:ff02b58f971e7d7d156a1267e283fcbbeee91773b6aa36c49dac28ecfe28eadf'
DEFAULT_ES_IMAGE='docker.elastic.co/elasticsearch/elasticsearch@sha256:96ae58e574cb40b2caf8bdebc6dda7b789e1fae7d56346cc83c288374e18b1c2'
DEFAULT_NODE_IMAGE='node@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293'
LABEL_KEY='io.recruitment.job-search-load'
DB_SENTINEL_PREFIX='recruitment-job-search-load:'
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
REDIS_CONTAINER=''
REDIS_CONTAINER_ID=''
REDIS_CONTAINER_CREATED=false
ES_CONTAINER=''
ES_CONTAINER_ID=''
ES_CONTAINER_CREATED=false
API_CONTAINER=''
API_CONTAINER_ID=''
API_CONTAINER_CREATED=false
SEED_CONTAINER=''
SEED_CONTAINER_ID=''
SEED_CONTAINER_CREATED=false
RUNNER_CONTAINER=''
RUNNER_CONTAINER_ID=''
RUNNER_CONTAINER_CREATED=false
APP_IMAGE=''
APP_IMAGE_ID=''
APP_IMAGE_CREATED=false

say() { printf '[job-search-load] %s\n' "$1"; }
fail() { printf '[job-search-load] ERROR: %s\n' "$1" >&2; exit 1; }

(( $# == 0 )) || fail 'no URL, database target or positional argument is accepted'
OVERALL_TIMEOUT_SECONDS="${JOB_SEARCH_LOAD_OVERALL_TIMEOUT_SECONDS:-1800}"
[[ "$OVERALL_TIMEOUT_SECONDS" =~ ^[0-9]+$ \
  && "$OVERALL_TIMEOUT_SECONDS" -ge 600 \
  && "$OVERALL_TIMEOUT_SECONDS" -le 3600 ]] \
  || fail 'JOB_SEARCH_LOAD_OVERALL_TIMEOUT_SECONDS must be 600..3600'
command -v timeout >/dev/null 2>&1 || fail 'timeout is required'
if [[ ${JOB_SEARCH_LOAD_TIMEOUT_WRAPPED:-} != 1 ]]; then
  exec env JOB_SEARCH_LOAD_TIMEOUT_WRAPPED=1 \
    timeout --foreground --kill-after=30s "$OVERALL_TIMEOUT_SECONDS" "$0"
fi

exact_container() {
  local container_id=$1 container_name=$2 value
  [[ "$container_id" =~ ^[0-9a-f]{64}$ ]] || return 1
  value="$(docker inspect --format \
    '{{.Id}}|{{.Name}}|{{index .Config.Labels "io.recruitment.job-search-load"}}' \
    "$container_id" 2>/dev/null)"
  [[ "$value" == "$container_id|/$container_name|$RUN_ID" ]]
}

cleanup() {
  local code=$? descriptor container_id container_name created value
  set +e
  if (( code != 0 )) && exact_container "$API_CONTAINER_ID" "$API_CONTAINER"; then
    printf '[job-search-load] API log tail follows\n' >&2
    docker logs --tail 80 "$API_CONTAINER_ID" >&2 2>/dev/null
  fi
  for descriptor in \
    "$RUNNER_CONTAINER_ID|$RUNNER_CONTAINER|$RUNNER_CONTAINER_CREATED" \
    "$SEED_CONTAINER_ID|$SEED_CONTAINER|$SEED_CONTAINER_CREATED" \
    "$API_CONTAINER_ID|$API_CONTAINER|$API_CONTAINER_CREATED" \
    "$ES_CONTAINER_ID|$ES_CONTAINER|$ES_CONTAINER_CREATED" \
    "$REDIS_CONTAINER_ID|$REDIS_CONTAINER|$REDIS_CONTAINER_CREATED" \
    "$PG_CONTAINER_ID|$PG_CONTAINER|$PG_CONTAINER_CREATED"; do
    IFS='|' read -r container_id container_name created <<<"$descriptor"
    if [[ "$created" == true ]] && exact_container "$container_id" "$container_name"; then
      docker rm --force "$container_id" >/dev/null 2>&1
    fi
  done
  if [[ "$NETWORK_CREATED" == true && "$NETWORK_ID" =~ ^[0-9a-f]{64}$ ]]; then
    value="$(docker network inspect --format \
      '{{.Id}}|{{.Name}}|{{index .Labels "io.recruitment.job-search-load"}}' \
      "$NETWORK_ID" 2>/dev/null)"
    [[ "$value" == "$NETWORK_ID|$NETWORK|$RUN_ID" ]] \
      && docker network rm "$NETWORK_ID" >/dev/null 2>&1
  fi
  if [[ "$APP_IMAGE_CREATED" == true \
    && "$APP_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    value="$(docker image inspect --format \
      '{{.Id}}|{{index .Config.Labels "io.recruitment.job-search-load"}}' \
      "$APP_IMAGE_ID" 2>/dev/null)"
    [[ "$value" == "$APP_IMAGE_ID|$RUN_ID" ]] \
      && docker image rm "$APP_IMAGE_ID" >/dev/null 2>&1
  fi
  [[ "$TASK_TMP_CREATED" != true \
    || -z "$TASK_TMP" \
    || "$TASK_TMP" != /tmp/job-search-load.* ]] \
    || rm -rf -- "$TASK_TMP"
  (( code == 0 )) \
    || printf '[job-search-load] FAILED during: %s\n' "$STEP" >&2
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

for variable in DATABASE_URL PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER \
  PGPASSWORD PGPASSFILE PGSERVICE PGSERVICEFILE REDIS_URL ELASTICSEARCH_NODE \
  LOAD_BASE_URL; do
  [[ -z ${!variable+x} ]] \
    || fail "unset $variable; external service targets are refused"
done
for variable in DOCKER_HOST DOCKER_TLS_VERIFY DOCKER_CERT_PATH; do
  [[ -z ${!variable+x} ]] \
    || fail "unset $variable; only the active local Unix Docker context is allowed"
done
for command_name in awk chmod cp date dirname docker env find grep mkdir mktemp \
  od rm sed sleep tail tr; do
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

DATASET_SIZE="$(read_integer JOB_SEARCH_LOAD_DATASET_SIZE 100000 100000 100000)"
(( DATASET_SIZE % 20 == 0 )) \
  || fail 'JOB_SEARCH_LOAD_DATASET_SIZE must be divisible by 20'
WARMUP_REQUESTS="$(read_integer JOB_SEARCH_LOAD_WARMUP_REQUESTS 500 500 500)"
MEASURED_REQUESTS="$(read_integer JOB_SEARCH_LOAD_MEASURED_REQUESTS 10000 10000 10000)"
CONCURRENCY="$(read_integer JOB_SEARCH_LOAD_CONCURRENCY 32 32 32)"
REQUEST_TIMEOUT_MS="$(read_integer JOB_SEARCH_LOAD_REQUEST_TIMEOUT_MS 3000 100 10000)"
MAX_BODY_BYTES="$(read_integer JOB_SEARCH_LOAD_MAX_BODY_BYTES 262144 4096 1048576)"
MAX_P95_MS="$(read_integer JOB_SEARCH_LOAD_MAX_P95_MS 500 1 500)"
MAX_P99_MS="$(read_integer JOB_SEARCH_LOAD_MAX_P99_MS 1000 1 1000)"
MIN_RPS="$(read_integer JOB_SEARCH_LOAD_MIN_RPS 75 75 1000000)"
(( MAX_P95_MS <= MAX_P99_MS )) || fail 'p95 threshold must not exceed p99'

PG_IMAGE="${JOB_SEARCH_LOAD_POSTGRES_IMAGE:-$DEFAULT_PG_IMAGE}"
REDIS_IMAGE="${JOB_SEARCH_LOAD_REDIS_IMAGE:-$DEFAULT_REDIS_IMAGE}"
ES_IMAGE="${JOB_SEARCH_LOAD_ELASTICSEARCH_IMAGE:-$DEFAULT_ES_IMAGE}"
NODE_IMAGE="${JOB_SEARCH_LOAD_NODE_IMAGE:-$DEFAULT_NODE_IMAGE}"
for image in "$PG_IMAGE" "$REDIS_IMAGE" "$ES_IMAGE" "$NODE_IMAGE"; do
  [[ "$image" =~ ^[a-z0-9][a-z0-9._/:~-]*@sha256:[0-9a-f]{64}$ ]] \
    || fail "image override must be pinned by an exact sha256 digest: $image"
done

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
SERVICE_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
RUNNER_HEAD="$SCRIPT_DIR/job-search-load-runner.js"
RUNNER_TAIL="$SCRIPT_DIR/job-search-load-runner.tail.js"
SEED_FILE="$SCRIPT_DIR/job-search-load-seed.psql"
for path in "$RUNNER_HEAD" "$RUNNER_TAIL" "$SEED_FILE" \
  "$SERVICE_DIR/Dockerfile" "$SERVICE_DIR/package.json" \
  "$SERVICE_DIR/package-lock.json" "$SERVICE_DIR/jest.config.js" \
  "$SERVICE_DIR/nest-cli.json" "$SERVICE_DIR/tsconfig.json" \
  "$SERVICE_DIR/tsconfig.spec.json" "$SERVICE_DIR/prisma/schema.prisma"; do
  [[ -f "$path" ]] || fail "required input is missing: $path"
done
[[ -d "$SERVICE_DIR/src" && -d "$SERVICE_DIR/prisma/migrations" ]] \
  || fail 'Job Search source or migrations directory is missing'

RUN_ID="$(date -u +%Y%m%d%H%M%S)-$$-$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
[[ "$RUN_ID" =~ ^[0-9a-f-]+$ ]] || fail 'could not generate a safe run identifier'
TASK_TMP="$(mktemp -d "/tmp/job-search-load.$RUN_ID.XXXXXX")"
TASK_TMP_CREATED=true
chmod 700 "$TASK_TMP"
NETWORK="job-search-load-network-$RUN_ID"
PG_CONTAINER="job-search-load-postgres-$RUN_ID"
REDIS_CONTAINER="job-search-load-redis-$RUN_ID"
ES_CONTAINER="job-search-load-elasticsearch-$RUN_ID"
API_CONTAINER="job-search-load-api-$RUN_ID"
SEED_CONTAINER="job-search-load-seed-$RUN_ID"
RUNNER_CONTAINER="job-search-load-runner-$RUN_ID"
PG_HOST="job-load-pg-$RUN_ID"
REDIS_HOST="job-load-redis-$RUN_ID"
ES_HOST="job-load-es-$RUN_ID"
API_HOST="job-load-api-$RUN_ID"
APP_IMAGE="job-search-load-app:$RUN_ID"
DB_NAME='job_search_load'
REDIS_PASSWORD="job-load-redis-$RUN_ID"
ES_INDEX='job_index_v4'

guard_network() {
  local value
  value="$(docker network inspect --format \
    '{{.Id}}|{{.Name}}|{{.Internal}}|{{index .Labels "io.recruitment.job-search-load"}}' \
    "$NETWORK_ID" 2>/dev/null)"
  [[ "$NETWORK_CREATED" == true \
    && "$value" == "$NETWORK_ID|$NETWORK|true|$RUN_ID" ]] \
    || fail 'Docker network sentinel mismatch'
}

guard_container() {
  local container_id=$1 container_name=$2 value
  value="$(docker inspect --format \
    '{{.Id}}|{{.Name}}|{{index .Config.Labels "io.recruitment.job-search-load"}}|{{.HostConfig.NetworkMode}}' \
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

wait_for_api() {
  local state health
  for _attempt in $(awk 'BEGIN { for (i=1; i<=180; i++) print i }'); do
    state="$(docker inspect --format '{{.State.Status}}' "$API_CONTAINER_ID")"
    [[ "$state" == running ]] || fail "Job API exited before readiness (state: $state)"
    health="$(docker exec "$API_CONTAINER_ID" node -e \
      'fetch("http://127.0.0.1:3000/health").then(async response => { if (!response.ok) process.exit(1); process.stdout.write(await response.text()); }).catch(() => process.exit(1));' \
      2>/dev/null)" || health=''
    if grep -Fq '"searchIndexReady":true' <<<"$health"; then
      return 0
    fi
    sleep 1
  done
  return 1
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
  --tmpfs /var/lib/postgresql/data:rw,noexec,nosuid,size=2g \
  --memory 2g --cpus 2 --pids-limit 512 \
  --label "$LABEL_KEY=$RUN_ID" \
  -e POSTGRES_DB="$DB_NAME" -e POSTGRES_USER=postgres \
  -e POSTGRES_HOST_AUTH_METHOD=trust "$PG_IMAGE")"
[[ "$PG_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]] \
  || fail 'Docker did not return an exact PostgreSQL container ID'
PG_CONTAINER_CREATED=true
guard_container "$PG_CONTAINER_ID" "$PG_CONTAINER"
docker start "$PG_CONTAINER_ID" >/dev/null
for _attempt in $(awk 'BEGIN { for (i=1; i<=120; i++) print i }'); do
  docker exec "$PG_CONTAINER_ID" pg_isready -U postgres -d "$DB_NAME" \
    >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$PG_CONTAINER_ID" pg_isready -U postgres -d "$DB_NAME" \
  >/dev/null 2>&1 || fail 'PostgreSQL did not become ready'
docker exec -i "$PG_CONTAINER_ID" psql -X --no-psqlrc -U postgres \
  -d postgres -q -v ON_ERROR_STOP=1 >"$TASK_TMP/database-sentinel.log" 2>&1 <<SQL
COMMENT ON DATABASE "$DB_NAME" IS '$DB_SENTINEL_PREFIX$RUN_ID';
SQL
guard_db
PG_IMAGE_ID="$(docker inspect --format '{{.Image}}' "$PG_CONTAINER_ID")"

STEP='start authenticated Redis 7'
REDIS_CONTAINER_ID="$(docker create --name "$REDIS_CONTAINER" \
  --network "$NETWORK" --network-alias "$REDIS_HOST" \
  --tmpfs /data:rw,noexec,nosuid,size=512m \
  --memory 512m --cpus 1 --pids-limit 256 \
  --label "$LABEL_KEY=$RUN_ID" "$REDIS_IMAGE" \
  redis-server --appendonly no --requirepass "$REDIS_PASSWORD")"
[[ "$REDIS_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]] \
  || fail 'Docker did not return an exact Redis container ID'
REDIS_CONTAINER_CREATED=true
guard_container "$REDIS_CONTAINER_ID" "$REDIS_CONTAINER"
docker start "$REDIS_CONTAINER_ID" >/dev/null
for _attempt in $(awk 'BEGIN { for (i=1; i<=120; i++) print i }'); do
  docker exec "$REDIS_CONTAINER_ID" redis-cli -a "$REDIS_PASSWORD" ping \
    2>/dev/null | grep -Fxq PONG && break
  sleep 1
done
docker exec "$REDIS_CONTAINER_ID" redis-cli -a "$REDIS_PASSWORD" ping \
  2>/dev/null | grep -Fxq PONG || fail 'Redis did not become ready'
docker exec "$REDIS_CONTAINER_ID" redis-server --version | grep -Eq 'v=7\.' \
  || fail 'Redis runtime is not major version 7'
REDIS_IMAGE_ID="$(docker inspect --format '{{.Image}}' "$REDIS_CONTAINER_ID")"

STEP='start Elasticsearch 8.14.3'
ES_CONTAINER_ID="$(docker create --name "$ES_CONTAINER" \
  --network "$NETWORK" --network-alias "$ES_HOST" \
  --tmpfs /usr/share/elasticsearch/data:rw,noexec,nosuid,size=3g,uid=1000,gid=0,mode=0770 \
  --memory 2g --cpus 2 --pids-limit 2048 --ulimit nofile=65536:65536 \
  --label "$LABEL_KEY=$RUN_ID" \
  -e discovery.type=single-node -e xpack.security.enabled=false \
  -e action.auto_create_index=false -e 'ES_JAVA_OPTS=-Xms768m -Xmx768m' \
  "$ES_IMAGE")"
[[ "$ES_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]] \
  || fail 'Docker did not return an exact Elasticsearch container ID'
ES_CONTAINER_CREATED=true
guard_container "$ES_CONTAINER_ID" "$ES_CONTAINER"
docker start "$ES_CONTAINER_ID" >/dev/null
for _attempt in $(awk 'BEGIN { for (i=1; i<=180; i++) print i }'); do
  docker exec "$ES_CONTAINER_ID" curl --fail --silent \
    'http://127.0.0.1:9200/_cluster/health?wait_for_status=yellow&timeout=2s' \
    >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$ES_CONTAINER_ID" curl --fail --silent \
  'http://127.0.0.1:9200/_cluster/health?wait_for_status=yellow&timeout=2s' \
  >/dev/null 2>&1 || fail 'Elasticsearch did not become ready'
docker exec "$ES_CONTAINER_ID" curl --fail --silent http://127.0.0.1:9200/ \
  | grep -Eq '"number"[[:space:]]*:[[:space:]]*"8\.14\.3"' \
  || fail 'Elasticsearch runtime is not version 8.14.3'
ES_IMAGE_ID="$(docker inspect --format '{{.Image}}' "$ES_CONTAINER_ID")"

STEP='build pinned Job API image from allow-listed context'
BUILD_CONTEXT="$TASK_TMP/build-context"
mkdir -p "$BUILD_CONTEXT"
cp "$SERVICE_DIR/Dockerfile" "$SERVICE_DIR/package.json" \
  "$SERVICE_DIR/package-lock.json" "$SERVICE_DIR/jest.config.js" \
  "$SERVICE_DIR/nest-cli.json" "$SERVICE_DIR/tsconfig.json" \
  "$SERVICE_DIR/tsconfig.spec.json" "$BUILD_CONTEXT/"
cp -R "$SERVICE_DIR/prisma" "$SERVICE_DIR/src" "$BUILD_CONTEXT/"
sed -i "s|FROM node:20-alpine|FROM $NODE_IMAGE|g" "$BUILD_CONTEXT/Dockerfile"
grep -Fq "FROM $NODE_IMAGE" "$BUILD_CONTEXT/Dockerfile" \
  || fail 'temporary Dockerfile did not use the pinned Node image'
if find "$BUILD_CONTEXT" -type l -print -quit | grep -q .; then
  fail 'symlinks are refused in the temporary build context'
fi
if ! docker build --label "$LABEL_KEY=$RUN_ID" --tag "$APP_IMAGE" \
  "$BUILD_CONTEXT" >"$TASK_TMP/application-build.log" 2>&1; then
  tail -n 80 "$TASK_TMP/application-build.log" >&2
  fail 'Job API image build failed'
fi
APP_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$APP_IMAGE")"
[[ "$APP_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]] \
  || fail 'Docker did not return an exact application image ID'
APP_IMAGE_CREATED=true
[[ "$(docker image inspect --format \
  '{{.Id}}|{{index .Config.Labels "io.recruitment.job-search-load"}}' \
  "$APP_IMAGE_ID")" == "$APP_IMAGE_ID|$RUN_ID" ]] \
  || fail 'application image sentinel mismatch'

STEP='bootstrap real Job API mapping on an empty database'
API_CONTAINER_ID="$(docker create --name "$API_CONTAINER" \
  --network "$NETWORK" --network-alias "$API_HOST" \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=256m \
  --memory 1g --cpus 2 --pids-limit 512 \
  --cap-drop ALL --security-opt no-new-privileges \
  --label "$LABEL_KEY=$RUN_ID" \
  -e NODE_ENV=production -e PORT=3000 \
  -e "DATABASE_URL=postgresql://postgres@$PG_HOST:5432/$DB_NAME?schema=job" \
  -e "REDIS_URL=redis://:$REDIS_PASSWORD@$REDIS_HOST:6379/15" \
  -e "ELASTICSEARCH_NODE=http://$ES_HOST:9200" \
  -e ELASTICSEARCH_INDEX="$ES_INDEX" -e ELASTICSEARCH_REQUEST_TIMEOUT_MS=3000 \
  -e JOB_SEARCH_CURSOR_HMAC_KEY=job-search-load-cursor-key-6c4e07197d1d4d87a2014f77 \
  -e JOB_INDEX_QUEUE_NAME="job-search-load-$RUN_ID" \
  -e JOB_INDEX_ATTEMPTS=3 -e JOB_INDEX_BACKOFF_MS=100 \
  -e JOB_INDEX_CONCURRENCY=8 -e JOB_INDEX_POLL_INTERVAL_MS=300000 \
  -e JOB_INDEX_RECONCILE_MS=3600000 -e JOB_INDEX_LEASE_MS=30000 \
  -e JOB_INDEX_BATCH_SIZE=500 -e JOB_INDEX_REDIS_COMMAND_TIMEOUT_MS=2000 \
  -e JOB_EVENT_PUBLISHER_ENABLED=false -e KAFKA_BROKERS=kafka-load.invalid:9092 \
  -e COMPANY_SERVICE_URL=http://company-load.invalid:3000 \
  -e COMPANY_SERVICE_ALLOWED_HOSTS=company-load.invalid \
  -e COMPANY_REQUEST_TIMEOUT_MS=2000 \
  -e PROFILE_SERVICE_URL=http://profile-load.invalid:3000 \
  -e PROFILE_SERVICE_ALLOWED_HOSTS=profile-load.invalid \
  -e PROFILE_REQUEST_TIMEOUT_MS=2000 \
  -e PROFILE_INTERNAL_API_KEY=job-load-profile-key-df79dc4dbfa34b04a127063b \
  -e AI_SERVICE_URL=http://ai-load.invalid:8000 \
  -e AI_SERVICE_ALLOWED_HOSTS=ai-load.invalid -e AI_REQUEST_TIMEOUT_MS=2000 \
  -e AI_INTERNAL_API_KEY=job-load-ai-key-426524e371594ee784d33fe1 \
  -e AI_CANDIDATE_INTERNAL_API_KEY=job-load-ai-candidate-key-0fa7fe9494474f539e2c \
  -e INTERNAL_API_KEY=job-load-internal-key-6590490fc7e94377a6142c5a \
  -e JOB_EXPIRY_INTERVAL_MS=3600000 "$APP_IMAGE_ID")"
[[ "$API_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]] \
  || fail 'Docker did not return an exact API container ID'
API_CONTAINER_CREATED=true
guard_container "$API_CONTAINER_ID" "$API_CONTAINER"
docker start "$API_CONTAINER_ID" >/dev/null
wait_for_api || fail 'Job API did not create and validate its empty v4 baseline'
guard_db
docker stop --time 20 "$API_CONTAINER_ID" >/dev/null
guard_container "$API_CONTAINER_ID" "$API_CONTAINER"

STEP='seed deterministic PostgreSQL fixture'
guard_db
docker exec -i "$PG_CONTAINER_ID" psql -X --no-psqlrc -U postgres \
  -d "$DB_NAME" -q -v ON_ERROR_STOP=1 -v dataset_size="$DATASET_SIZE" \
  >"$TASK_TMP/postgres-seed.log" 2>&1 <"$SEED_FILE" \
  || { tail -n 80 "$TASK_TMP/postgres-seed.log" >&2; fail 'PostgreSQL fixture seed failed'; }
SEED_COUNTS="$(scalar \
  "SELECT count(*)::text || '|' || count(*) FILTER (WHERE status='PUBLISHED')::text || '|' || count(*) FILTER (WHERE status='DRAFT')::text || '|' || count(*) FILTER (WHERE status='PENDING_APPROVAL')::text || '|' || count(*) FILTER (WHERE status='CLOSED')::text || '|' || count(*) FILTER (WHERE status='EXPIRED')::text FROM job.jobs;")"
[[ "$SEED_COUNTS" == "$DATASET_SIZE|$((DATASET_SIZE * 4 / 5))|$((DATASET_SIZE / 20))|$((DATASET_SIZE / 20))|$((DATASET_SIZE / 20))|$((DATASET_SIZE / 20))" ]] \
  || fail "PostgreSQL seed count/status mismatch: $SEED_COUNTS"
[[ "$(scalar 'SELECT count(*)::text FROM job.job_index_sync WHERE completed_at IS NOT NULL AND failed_at IS NULL;')" == "$DATASET_SIZE" ]] \
  || fail 'completed index-sync fixture count mismatch'
SEED_FINGERPRINT="$(scalar \
  "SELECT md5(string_agg(id::text || '|' || status::text || '|' || title || '|' || location || '|' || coalesce(salary_max::bigint::text,'<null>') || '|' || coalesce(to_char(published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),'<null>'), E'\\n' ORDER BY id)) FROM job.jobs;")"
[[ "$SEED_FINGERPRINT" =~ ^[0-9a-f]{32}$ ]] \
  || fail 'could not calculate the PostgreSQL fixture fingerprint'

STEP='bulk seed matching Elasticsearch documents'
SEED_CONTAINER_ID="$(docker create --name "$SEED_CONTAINER" \
  --network "$NETWORK" --read-only --tmpfs /tmp:rw,noexec,nosuid,size=128m \
  --memory 1g --cpus 2 --pids-limit 512 \
  --cap-drop ALL --security-opt no-new-privileges \
  --label "$LABEL_KEY=$RUN_ID" \
  --mount "type=bind,src=$RUNNER_HEAD,dst=/runner/job-search-load-runner.js,readonly" \
  --mount "type=bind,src=$RUNNER_TAIL,dst=/runner/job-search-load-runner.tail.js,readonly" \
  -e LOAD_PHASE=seed -e LOAD_DATASET_SIZE="$DATASET_SIZE" \
  -e "LOAD_ELASTICSEARCH_NODE=http://$ES_HOST:9200" \
  -e LOAD_ELASTICSEARCH_INDEX="$ES_INDEX" "$APP_IMAGE_ID" \
  /bin/sh -c 'cat /runner/job-search-load-runner.js /runner/job-search-load-runner.tail.js | node')"
[[ "$SEED_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]] \
  || fail 'Docker did not return an exact seed container ID'
SEED_CONTAINER_CREATED=true
guard_container "$SEED_CONTAINER_ID" "$SEED_CONTAINER"
SEED_STATUS=0
docker start --attach "$SEED_CONTAINER_ID" \
  >"$TASK_TMP/elasticsearch-seed.log" 2>"$TASK_TMP/elasticsearch-seed-error.log" \
  || SEED_STATUS=$?
if (( SEED_STATUS != 0 )); then
  tail -n 80 "$TASK_TMP/elasticsearch-seed-error.log" >&2
  tail -n 10 "$TASK_TMP/elasticsearch-seed.log" >&2
  fail 'Elasticsearch bulk seed failed'
fi
grep -Fq '"phase":"seed"' "$TASK_TMP/elasticsearch-seed.log" \
  && grep -Fq '"status":"PASS"' "$TASK_TMP/elasticsearch-seed.log" \
  && grep -Fq '[job-search-load] SEED PASS' "$TASK_TMP/elasticsearch-seed.log" \
  || fail 'Elasticsearch seeder did not emit its PASS evidence'

STEP='restart real Job HTTP API against the complete fixture'
guard_container "$API_CONTAINER_ID" "$API_CONTAINER"
docker start "$API_CONTAINER_ID" >/dev/null
wait_for_api || fail 'Job API did not become search-ready after fixture load'
guard_db

STEP='run HTTP correctness, deep cursor and load gate'
RUNNER_CONTAINER_ID="$(docker create --name "$RUNNER_CONTAINER" \
  --network "$NETWORK" --read-only --tmpfs /tmp:rw,noexec,nosuid,size=128m \
  --memory 1g --cpus 2 --pids-limit 512 \
  --cap-drop ALL --security-opt no-new-privileges \
  --label "$LABEL_KEY=$RUN_ID" \
  --mount "type=bind,src=$RUNNER_HEAD,dst=/runner/job-search-load-runner.js,readonly" \
  --mount "type=bind,src=$RUNNER_TAIL,dst=/runner/job-search-load-runner.tail.js,readonly" \
  -e LOAD_PHASE=verify -e LOAD_DATASET_SIZE="$DATASET_SIZE" \
  -e LOAD_WARMUP_REQUESTS="$WARMUP_REQUESTS" \
  -e LOAD_MEASURED_REQUESTS="$MEASURED_REQUESTS" \
  -e LOAD_CONCURRENCY="$CONCURRENCY" \
  -e LOAD_REQUEST_TIMEOUT_MS="$REQUEST_TIMEOUT_MS" \
  -e LOAD_MAX_BODY_BYTES="$MAX_BODY_BYTES" \
  -e LOAD_MAX_P95_MS="$MAX_P95_MS" -e LOAD_MAX_P99_MS="$MAX_P99_MS" \
  -e LOAD_MIN_REQUESTS_PER_SECOND="$MIN_RPS" \
  -e "LOAD_BASE_URL=http://$API_HOST:3000/search" \
  -e "LOAD_ELASTICSEARCH_NODE=http://$ES_HOST:9200" \
  -e LOAD_ELASTICSEARCH_INDEX="$ES_INDEX" \
  -e LOAD_POSTGRES_FINGERPRINT="$SEED_FINGERPRINT" \
  -e LOAD_APPLICATION_IMAGE_ID="$APP_IMAGE_ID" \
  -e LOAD_POSTGRES_IMAGE_ID="$PG_IMAGE_ID" \
  -e LOAD_POSTGRES_IMAGE_REF="$PG_IMAGE" \
  -e LOAD_REDIS_IMAGE_ID="$REDIS_IMAGE_ID" \
  -e LOAD_REDIS_IMAGE_REF="$REDIS_IMAGE" \
  -e LOAD_ELASTICSEARCH_IMAGE_ID="$ES_IMAGE_ID" \
  -e LOAD_ELASTICSEARCH_IMAGE_REF="$ES_IMAGE" \
  -e LOAD_NODE_IMAGE="$NODE_IMAGE" "$APP_IMAGE_ID" \
  /bin/sh -c 'cat /runner/job-search-load-runner.js /runner/job-search-load-runner.tail.js | node')"
[[ "$RUNNER_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]] \
  || fail 'Docker did not return an exact runner container ID'
RUNNER_CONTAINER_CREATED=true
guard_container "$RUNNER_CONTAINER_ID" "$RUNNER_CONTAINER"
RUNNER_STATUS=0
docker start --attach "$RUNNER_CONTAINER_ID" \
  >"$TASK_TMP/runner.log" 2>"$TASK_TMP/runner-error.log" \
  || RUNNER_STATUS=$?
if (( RUNNER_STATUS != 0 )); then
  tail -n 80 "$TASK_TMP/runner-error.log" >&2
  tail -n 10 "$TASK_TMP/runner.log" >&2
  fail 'HTTP correctness/load runner failed'
fi
grep -Fq '"gate":"job-search-load-v1"' "$TASK_TMP/runner.log" \
  && grep -Fq '"status":"PASS"' "$TASK_TMP/runner.log" \
  && grep -Fq '"sourceMismatches":0' "$TASK_TMP/runner.log" \
  && grep -Fq '[job-search-load] PASS' "$TASK_TMP/runner.log" \
  || fail 'runner did not emit complete machine-readable PASS evidence'

STEP='complete'
cat "$TASK_TMP/runner.log"
say 'PASS: 100k fixture, Vietnamese mapping/quality, >10k cursor traversal and HTTP thresholds'
