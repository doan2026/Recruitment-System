#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

PG_IMAGE='mirror.gcr.io/pgvector/pgvector@sha256:ccc6e83d6e35e931dc7c5def2022729d5a6c370318d099181995567ff1fb4d6b'
PYTHON_IMAGE='public.ecr.aws/docker/library/python@sha256:be1575ed968de893bd54f4c56315ff7c4736ce522c1bca08fd521731aafc0d76'
LABEL_KEY='io.recruitment.ai-candidate-benchmark'
DB_SENTINEL_PREFIX='recruitment-ai-candidate-benchmark:'
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
MIGRATION_CONTAINER=''
MIGRATION_CONTAINER_ID=''
MIGRATION_CONTAINER_CREATED=false
RUNNER_CONTAINER=''
RUNNER_CONTAINER_ID=''
RUNNER_CONTAINER_CREATED=false
APP_IMAGE=''
APP_IMAGE_ID=''
APP_IMAGE_CREATED=false

say() { printf '[candidate-recommendation-benchmark] %s\n' "$1"; }
fail() {
  printf '[candidate-recommendation-benchmark] ERROR: %s\n' "$1" >&2
  exit 1
}

(( $# == 0 )) || fail 'no URL, database target or positional argument is accepted'
OVERALL_TIMEOUT_SECONDS="${AI_CANDIDATE_BENCHMARK_OVERALL_TIMEOUT_SECONDS:-1800}"
[[ "$OVERALL_TIMEOUT_SECONDS" =~ ^[0-9]+$ \
  && "$OVERALL_TIMEOUT_SECONDS" -ge 600 \
  && "$OVERALL_TIMEOUT_SECONDS" -le 3600 ]] \
  || fail 'AI_CANDIDATE_BENCHMARK_OVERALL_TIMEOUT_SECONDS must be 600..3600'
command -v timeout >/dev/null 2>&1 || fail 'timeout is required'
if [[ ${AI_CANDIDATE_BENCHMARK_TIMEOUT_WRAPPED:-} != 1 ]]; then
  exec env AI_CANDIDATE_BENCHMARK_TIMEOUT_WRAPPED=1 \
    timeout --foreground --kill-after=30s "$OVERALL_TIMEOUT_SECONDS" "$0"
fi

exact_container() {
  local container_id=$1 container_name=$2 value
  [[ "$container_id" =~ ^[0-9a-f]{64}$ ]] || return 1
  value="$(docker inspect --format \
    '{{.Id}}|{{.Name}}|{{index .Config.Labels "io.recruitment.ai-candidate-benchmark"}}' \
    "$container_id" 2>/dev/null)"
  [[ "$value" == "$container_id|/$container_name|$RUN_ID" ]]
}

cleanup() {
  local code=$? descriptor container_id container_name created value
  set +e
  if (( code != 0 )) && exact_container "$RUNNER_CONTAINER_ID" "$RUNNER_CONTAINER"; then
    printf '[candidate-recommendation-benchmark] runner log tail follows\n' >&2
    docker logs --tail 80 "$RUNNER_CONTAINER_ID" >&2 2>/dev/null
  fi
  for descriptor in \
    "$RUNNER_CONTAINER_ID|$RUNNER_CONTAINER|$RUNNER_CONTAINER_CREATED" \
    "$MIGRATION_CONTAINER_ID|$MIGRATION_CONTAINER|$MIGRATION_CONTAINER_CREATED" \
    "$PG_CONTAINER_ID|$PG_CONTAINER|$PG_CONTAINER_CREATED"; do
    IFS='|' read -r container_id container_name created <<<"$descriptor"
    if [[ "$created" == true ]] && exact_container "$container_id" "$container_name"; then
      docker rm --force "$container_id" >/dev/null 2>&1
    fi
  done
  if [[ "$NETWORK_CREATED" == true && "$NETWORK_ID" =~ ^[0-9a-f]{64}$ ]]; then
    value="$(docker network inspect --format \
      '{{.Id}}|{{.Name}}|{{index .Labels "io.recruitment.ai-candidate-benchmark"}}' \
      "$NETWORK_ID" 2>/dev/null)"
    [[ "$value" == "$NETWORK_ID|$NETWORK|$RUN_ID" ]] \
      && docker network rm "$NETWORK_ID" >/dev/null 2>&1
  fi
  if [[ "$APP_IMAGE_CREATED" == true \
    && "$APP_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    value="$(docker image inspect --format \
      '{{.Id}}|{{index .Config.Labels "io.recruitment.ai-candidate-benchmark"}}' \
      "$APP_IMAGE_ID" 2>/dev/null)"
    [[ "$value" == "$APP_IMAGE_ID|$RUN_ID" ]] \
      && docker image rm "$APP_IMAGE_ID" >/dev/null 2>&1
  fi
  [[ "$TASK_TMP_CREATED" != true \
    || -z "$TASK_TMP" \
    || "$TASK_TMP" != /tmp/ai-candidate-benchmark.* ]] \
    || rm -rf -- "$TASK_TMP"
  (( code == 0 )) \
    || printf '[candidate-recommendation-benchmark] FAILED during: %s\n' \
      "$STEP" >&2
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

for variable in DATABASE_URL AI_TEST_DATABASE_URL PGHOST PGHOSTADDR PGPORT \
  PGDATABASE PGUSER PGPASSWORD PGPASSFILE PGSERVICE PGSERVICEFILE; do
  [[ -z ${!variable+x} ]] \
    || fail "unset $variable; external database targets are refused"
done
for variable in DOCKER_HOST DOCKER_CONTEXT DOCKER_TLS_VERIFY DOCKER_CERT_PATH; do
  [[ -z ${!variable+x} ]] \
    || fail "unset $variable; only the active local Unix Docker context is allowed"
done
for command_name in awk cat chmod cp date dirname docker env find grep mkdir \
  mktemp od rm sed sleep tail tr; do
  command -v "$command_name" >/dev/null 2>&1 \
    || fail "$command_name is required"
done
DOCKER_ENDPOINT="$(docker context inspect --format '{{.Endpoints.docker.Host}}' \
  2>/dev/null)"
[[ "$DOCKER_ENDPOINT" == unix://* ]] \
  || fail 'the active Docker context is not a local Unix socket'
docker info >/dev/null 2>&1 || fail 'the local Docker daemon is unavailable'

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
SERVICE_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
RUNNER_FILE="$SCRIPT_DIR/candidate-recommendation-benchmark.py"
for path in "$RUNNER_FILE" "$SERVICE_DIR/Dockerfile" \
  "$SERVICE_DIR/requirements.txt" "$SERVICE_DIR/alembic.ini"; do
  [[ -f "$path" ]] || fail "required input is missing: $path"
done
[[ -d "$SERVICE_DIR/app" && -d "$SERVICE_DIR/migrations" ]] \
  || fail 'AI app or migrations directory is missing'

RUN_ID="$(date -u +%Y%m%d%H%M%S)-$$-$(od -An -N4 -tx1 /dev/urandom \
  | tr -d ' \n')"
[[ "$RUN_ID" =~ ^[0-9a-f-]+$ ]] || fail 'could not generate a safe run identifier'
TASK_TMP="$(mktemp -d "/tmp/ai-candidate-benchmark.$RUN_ID.XXXXXX")"
TASK_TMP_CREATED=true
chmod 700 "$TASK_TMP"
NETWORK="ai-candidate-benchmark-network-$RUN_ID"
PG_CONTAINER="ai-candidate-benchmark-postgres-$RUN_ID"
PG_HOST="ai-candidate-benchmark-pg-$RUN_ID"
MIGRATION_CONTAINER="ai-candidate-benchmark-migrate-$RUN_ID"
RUNNER_CONTAINER="ai-candidate-benchmark-runner-$RUN_ID"
APP_IMAGE="ai-candidate-benchmark-app:$RUN_ID"
DB_NAME='ai_candidate_benchmark'

guard_network() {
  local value
  value="$(docker network inspect --format \
    '{{.Id}}|{{.Name}}|{{.Internal}}|{{index .Labels "io.recruitment.ai-candidate-benchmark"}}' \
    "$NETWORK_ID" 2>/dev/null)"
  [[ "$NETWORK_CREATED" == true \
    && "$value" == "$NETWORK_ID|$NETWORK|true|$RUN_ID" ]] \
    || fail 'Docker network sentinel mismatch'
}

guard_container() {
  local container_id=$1 container_name=$2 value
  value="$(docker inspect --format \
    '{{.Id}}|{{.Name}}|{{index .Config.Labels "io.recruitment.ai-candidate-benchmark"}}|{{.HostConfig.NetworkMode}}' \
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

STEP='create isolated internal Docker network'
NETWORK_ID="$(docker network create --internal \
  --label "$LABEL_KEY=$RUN_ID" "$NETWORK")"
[[ "$NETWORK_ID" =~ ^[0-9a-f]{64}$ ]] \
  || fail 'Docker did not return an exact network ID'
NETWORK_CREATED=true
guard_network

STEP='start pinned disposable PostgreSQL pgvector'
PG_CONTAINER_ID="$(docker create --name "$PG_CONTAINER" \
  --network "$NETWORK" --network-alias "$PG_HOST" \
  --tmpfs /var/lib/postgresql/data:rw,noexec,nosuid,size=4g \
  --memory 4g --cpus 4 --pids-limit 768 --shm-size 1g \
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
docker exec "$PG_CONTAINER_ID" psql -X --no-psqlrc -U postgres -d postgres \
  -q -v ON_ERROR_STOP=1 \
  -c "COMMENT ON DATABASE \"$DB_NAME\" IS '$DB_SENTINEL_PREFIX$RUN_ID';" \
  >"$TASK_TMP/database-sentinel.log" 2>&1
guard_db
PG_IMAGE_ID="$(docker inspect --format '{{.Image}}' "$PG_CONTAINER_ID")"
[[ "$PG_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]] \
  || fail 'PostgreSQL image ID is invalid'

STEP='build pinned AI base from allow-listed context'
BUILD_CONTEXT="$TASK_TMP/build-context"
mkdir -p "$BUILD_CONTEXT"
cp "$SERVICE_DIR/Dockerfile" "$SERVICE_DIR/requirements.txt" \
  "$SERVICE_DIR/alembic.ini" "$BUILD_CONTEXT/"
cp -R "$SERVICE_DIR/app" "$SERVICE_DIR/migrations" "$BUILD_CONTEXT/"
find "$BUILD_CONTEXT/app" "$BUILD_CONTEXT/migrations" -type f -name '*.pyc' \
  -delete
find "$BUILD_CONTEXT/app" "$BUILD_CONTEXT/migrations" -depth \
  -type d -name '__pycache__' -empty -delete
chmod -R a+rX "$BUILD_CONTEXT"
sed -i "s|FROM python:3.11-slim AS base|FROM $PYTHON_IMAGE AS base|" \
  "$BUILD_CONTEXT/Dockerfile"
grep -Fxq "FROM $PYTHON_IMAGE AS base" "$BUILD_CONTEXT/Dockerfile" \
  || fail 'temporary Dockerfile did not use the pinned Python image'
if find "$BUILD_CONTEXT" -type l -print -quit | grep -q .; then
  fail 'symlinks are refused in the temporary build context'
fi
if find "$BUILD_CONTEXT" -type f \
  \( -name '.env*' -o -name '*.pyc' -o -name '*.pem' -o -name '*.key' \) \
  -print -quit | grep -q .; then
  fail 'secret/cache-like files are refused in the temporary build context'
fi
if ! docker build --target base --label "$LABEL_KEY=$RUN_ID" \
  --tag "$APP_IMAGE" "$BUILD_CONTEXT" \
  >"$TASK_TMP/application-build.log" 2>&1; then
  tail -n 80 "$TASK_TMP/application-build.log" >&2
  fail 'AI benchmark base image build failed'
fi
APP_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$APP_IMAGE")"
[[ "$APP_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]] \
  || fail 'Docker did not return an exact application image ID'
APP_IMAGE_CREATED=true
[[ "$(docker image inspect --format \
  '{{.Id}}|{{index .Config.Labels "io.recruitment.ai-candidate-benchmark"}}' \
  "$APP_IMAGE_ID")" == "$APP_IMAGE_ID|$RUN_ID" ]] \
  || fail 'application image sentinel mismatch'
PYTHON_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$PYTHON_IMAGE")"
[[ "$PYTHON_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]] \
  || fail 'pinned Python image ID is invalid'

STEP='apply Alembic base revision before populated CV HNSW migration'
MIGRATION_CONTAINER_ID="$(docker create --name "$MIGRATION_CONTAINER" \
  --network "$NETWORK" --workdir /app --read-only \
  --user app \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --memory 512m --cpus 1 --pids-limit 256 \
  --cap-drop ALL --security-opt no-new-privileges \
  --label "$LABEL_KEY=$RUN_ID" \
  -e "DATABASE_URL=postgresql://postgres@$PG_HOST:5432/$DB_NAME" \
  "$APP_IMAGE_ID" /bin/sh -c \
  'test -r /app/alembic.ini && test -d /app/migrations && exec alembic -c /app/alembic.ini upgrade 20260828_05')"
[[ "$MIGRATION_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]] \
  || fail 'Docker did not return an exact migration container ID'
MIGRATION_CONTAINER_CREATED=true
guard_container "$MIGRATION_CONTAINER_ID" "$MIGRATION_CONTAINER"
MIGRATION_STATUS=0
docker start --attach "$MIGRATION_CONTAINER_ID" \
  >"$TASK_TMP/migration.log" 2>&1 || MIGRATION_STATUS=$?
if (( MIGRATION_STATUS != 0 )); then
  tail -n 80 "$TASK_TMP/migration.log" >&2
  fail 'Alembic base revision upgrade failed'
fi
guard_db
[[ "$(raw_scalar 'SELECT version_num FROM ai.alembic_version;')" == '20260828_05' ]] \
  || fail 'database is not at the expected pre-HNSW Alembic revision'
[[ -n "$(raw_scalar "SELECT extversion FROM pg_extension WHERE extname='vector';")" ]] \
  || fail 'pgvector extension is missing after migration'

STEP='run correctness, plan and load gates'
RUNNER_CONTAINER_ID="$(docker create --name "$RUNNER_CONTAINER" \
  --network "$NETWORK" --workdir /app --read-only \
  --user app \
  --tmpfs /tmp:rw,noexec,nosuid,size=128m \
  --memory 2g --cpus 4 --pids-limit 1024 \
  --cap-drop ALL --security-opt no-new-privileges \
  --label "$LABEL_KEY=$RUN_ID" \
  --mount "type=bind,src=$RUNNER_FILE,dst=/runner/candidate-recommendation-benchmark.py,readonly" \
  -e PYTHONPATH=/app \
  -e "DATABASE_URL=postgresql://postgres@$PG_HOST:5432/$DB_NAME" \
  -e BENCHMARK_RUN_ID="$RUN_ID" \
  -e BENCHMARK_POSTGRES_IMAGE_REF="$PG_IMAGE" \
  -e BENCHMARK_POSTGRES_IMAGE_ID="$PG_IMAGE_ID" \
  -e BENCHMARK_PYTHON_IMAGE_REF="$PYTHON_IMAGE" \
  -e BENCHMARK_PYTHON_IMAGE_ID="$PYTHON_IMAGE_ID" \
  -e BENCHMARK_APPLICATION_IMAGE_ID="$APP_IMAGE_ID" \
  "$APP_IMAGE_ID" python /runner/candidate-recommendation-benchmark.py)"
[[ "$RUNNER_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]] \
  || fail 'Docker did not return an exact runner container ID'
RUNNER_CONTAINER_CREATED=true
guard_container "$RUNNER_CONTAINER_ID" "$RUNNER_CONTAINER"
MOUNT_GUARD="$(docker inspect --format \
  '{{range .Mounts}}{{if eq .Destination "/runner/candidate-recommendation-benchmark.py"}}{{.Source}}|{{.RW}}{{end}}{{end}}' \
  "$RUNNER_CONTAINER_ID")"
[[ "$MOUNT_GUARD" == "$RUNNER_FILE|false" ]] \
  || fail 'runner bind mount is not the exact read-only script'
RUNNER_STATUS=0
docker start --attach "$RUNNER_CONTAINER_ID" \
  >"$TASK_TMP/runner.log" 2>"$TASK_TMP/runner-error.log" \
  || RUNNER_STATUS=$?
if (( RUNNER_STATUS != 0 )); then
  tail -n 80 "$TASK_TMP/runner-error.log" >&2
  tail -n 20 "$TASK_TMP/runner.log" >&2
  fail 'candidate recommendation benchmark failed'
fi
grep -Fq '"gate":"candidate-recommendation-benchmark-v1"' \
  "$TASK_TMP/runner.log" \
  && grep -Fq '"status":"PASS"' "$TASK_TMP/runner.log" \
  && grep -Fq '"errors":0' "$TASK_TMP/runner.log" \
  && grep -Fq '"sourceMismatches":0' "$TASK_TMP/runner.log" \
  && grep -Fq '"annEnabledForCandidateRecommendation":false' \
    "$TASK_TMP/runner.log" \
  && grep -Fq '[candidate-recommendation-benchmark] PASS:' \
    "$TASK_TMP/runner.log" \
  || fail 'runner did not emit complete machine-readable PASS evidence'

STEP='complete'
cat "$TASK_TMP/runner.log"
say 'PASS: exact dynamic scopes remain production-safe; global ANN is advisory only'
