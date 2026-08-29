#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

PG_IMAGE='mirror.gcr.io/pgvector/pgvector@sha256:ccc6e83d6e35e931dc7c5def2022729d5a6c370318d099181995567ff1fb4d6b'
PYTHON_IMAGE='public.ecr.aws/docker/library/python@sha256:be1575ed968de893bd54f4c56315ff7c4736ce522c1bca08fd521731aafc0d76'
LABEL_KEY='io.recruitment.ai-job-benchmark'
DB_SENTINEL_PREFIX='recruitment-ai-job-benchmark:'
EXPECTED_HEAD='20260829_06'
GATE_WARMUP_CALLS=100
GATE_MEASURED_CALLS=1000
GATE_CONCURRENCY=8
GATE_HTTP_TIMEOUT_SECONDS=12
GATE_MAX_P95_MS=5000
GATE_MAX_P99_MS=7500
GATE_MAX_CALL_MS=10000
GATE_MIN_RPS=1.0
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

say() { printf '[job-recommendation-benchmark] %s\n' "$1"; }
fail() {
  printf '[job-recommendation-benchmark] ERROR: %s\n' "$1" >&2
  exit 1
}

(( $# == 0 )) || fail 'no URL, database target or positional argument is accepted'
OVERALL_TIMEOUT_SECONDS="${AI_JOB_BENCHMARK_OVERALL_TIMEOUT_SECONDS:-1800}"
[[ "$OVERALL_TIMEOUT_SECONDS" =~ ^[0-9]+$ \
  && "$OVERALL_TIMEOUT_SECONDS" -ge 600 \
  && "$OVERALL_TIMEOUT_SECONDS" -le 3600 ]] \
  || fail 'AI_JOB_BENCHMARK_OVERALL_TIMEOUT_SECONDS must be 600..3600'
command -v timeout >/dev/null 2>&1 || fail 'timeout is required'
if [[ -z ${AI_JOB_BENCHMARK_TIMEOUT_WRAPPED+x} ]]; then
  exec env AI_JOB_BENCHMARK_TIMEOUT_WRAPPED=1 \
    timeout --foreground --kill-after=30s "$OVERALL_TIMEOUT_SECONDS" "$0"
fi
[[ ${AI_JOB_BENCHMARK_TIMEOUT_WRAPPED:-} == 1 ]] \
  || fail 'invalid internal timeout marker'
[[ -r /proc/"$PPID"/comm ]] || fail 'timeout parent process is not inspectable'
IFS= read -r TIMEOUT_PARENT_COMMAND <"/proc/$PPID/comm"
[[ "$TIMEOUT_PARENT_COMMAND" == timeout ]] \
  || fail 'internal timeout marker is accepted only from coreutils timeout'

exact_container() {
  local container_id=$1 container_name=$2 value
  [[ "$container_id" =~ ^[0-9a-f]{64}$ ]] || return 1
  value="$(docker inspect --format \
    '{{.Id}}|{{.Name}}|{{index .Config.Labels "io.recruitment.ai-job-benchmark"}}' \
    "$container_id" 2>/dev/null)"
  [[ "$value" == "$container_id|/$container_name|$RUN_ID" ]]
}

cleanup() {
  local code=$? descriptor container_id container_name created value
  set +e
  if (( code != 0 )) && exact_container "$RUNNER_CONTAINER_ID" "$RUNNER_CONTAINER"; then
    printf '[job-recommendation-benchmark] runner log tail follows\n' >&2
    docker logs --tail 80 "$RUNNER_CONTAINER_ID" >&2 2>/dev/null
  fi
  if (( code != 0 )) && exact_container "$API_CONTAINER_ID" "$API_CONTAINER"; then
    printf '[job-recommendation-benchmark] API log tail follows\n' >&2
    docker logs --tail 80 "$API_CONTAINER_ID" >&2 2>/dev/null
  fi
  for descriptor in \
    "$RUNNER_CONTAINER_ID|$RUNNER_CONTAINER|$RUNNER_CONTAINER_CREATED" \
    "$API_CONTAINER_ID|$API_CONTAINER|$API_CONTAINER_CREATED" \
    "$MIGRATION_CONTAINER_ID|$MIGRATION_CONTAINER|$MIGRATION_CONTAINER_CREATED" \
    "$PG_CONTAINER_ID|$PG_CONTAINER|$PG_CONTAINER_CREATED"; do
    IFS='|' read -r container_id container_name created <<<"$descriptor"
    if [[ "$created" == true ]] && exact_container "$container_id" "$container_name"; then
      docker rm --force "$container_id" >/dev/null 2>&1
    fi
  done
  if [[ "$NETWORK_CREATED" == true && "$NETWORK_ID" =~ ^[0-9a-f]{64}$ ]]; then
    value="$(docker network inspect --format \
      '{{.Id}}|{{.Name}}|{{.Internal}}|{{index .Labels "io.recruitment.ai-job-benchmark"}}' \
      "$NETWORK_ID" 2>/dev/null)"
    [[ "$value" == "$NETWORK_ID|$NETWORK|true|$RUN_ID" ]] \
      && docker network rm "$NETWORK_ID" >/dev/null 2>&1
  fi
  if [[ "$APP_IMAGE_CREATED" == true \
    && "$APP_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    value="$(docker image inspect --format \
      '{{.Id}}|{{index .Config.Labels "io.recruitment.ai-job-benchmark"}}' \
      "$APP_IMAGE_ID" 2>/dev/null)"
    [[ "$value" == "$APP_IMAGE_ID|$RUN_ID" ]] \
      && docker image rm "$APP_IMAGE_ID" >/dev/null 2>&1
  fi
  [[ "$TASK_TMP_CREATED" != true \
    || -z "$TASK_TMP" \
    || "$TASK_TMP" != /tmp/ai-job-benchmark.* ]] \
    || rm -rf -- "$TASK_TMP"
  (( code == 0 )) \
    || printf '[job-recommendation-benchmark] FAILED during: %s\n' \
      "$STEP" >&2
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

for variable in DATABASE_URL AI_TEST_DATABASE_URL BENCHMARK_API_URL \
  BENCHMARK_INTERNAL_API_KEY BENCHMARK_RUN_ID BENCHMARK_POSTGRES_IMAGE_REF \
  BENCHMARK_POSTGRES_IMAGE_ID BENCHMARK_PYTHON_IMAGE_REF \
  BENCHMARK_PYTHON_IMAGE_ID BENCHMARK_APPLICATION_IMAGE_ID \
  BENCHMARK_WARMUP_CALLS BENCHMARK_MEASURED_CALLS BENCHMARK_CONCURRENCY \
  BENCHMARK_HTTP_TIMEOUT_SECONDS BENCHMARK_MAX_P95_MS BENCHMARK_MAX_P99_MS \
  BENCHMARK_MAX_CALL_MS BENCHMARK_MIN_RPS PGHOST PGHOSTADDR PGPORT \
  PGDATABASE PGUSER PGPASSWORD PGPASSFILE PGSERVICE PGSERVICEFILE; do
  [[ -z ${!variable+x} ]] \
    || fail "unset $variable; external benchmark targets are refused"
done
for variable in DOCKER_HOST DOCKER_CONTEXT DOCKER_TLS_VERIFY DOCKER_CERT_PATH; do
  [[ -z ${!variable+x} ]] \
    || fail "unset $variable; only the active local Unix Docker context is allowed"
done
for command_name in awk cat chmod cp date dirname docker env find grep mkdir \
  mktemp od python3 rm sed sleep tail tr; do
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
RUNNER_FILE="$SCRIPT_DIR/job-recommendation-benchmark.py"
for path in "$RUNNER_FILE" "$SERVICE_DIR/Dockerfile" \
  "$SERVICE_DIR/requirements.txt" "$SERVICE_DIR/requirements-chat.txt" \
  "$SERVICE_DIR/alembic.ini"; do
  [[ -f "$path" && ! -L "$path" ]] \
    || fail "required regular input is missing: $path"
done
[[ -d "$SERVICE_DIR/app" && ! -L "$SERVICE_DIR/app" \
  && -d "$SERVICE_DIR/migrations" && ! -L "$SERVICE_DIR/migrations" ]] \
  || fail 'AI app or migrations directory is missing'

RUN_ID="$(date -u +%Y%m%d%H%M%S)-$$-$(od -An -N4 -tx1 /dev/urandom \
  | tr -d ' \n')"
[[ "$RUN_ID" =~ ^[0-9]{14}-[0-9]+-[0-9a-f]{8}$ ]] \
  || fail 'could not generate an exact safe run identifier'
TASK_TMP="$(mktemp -d "/tmp/ai-job-benchmark.$RUN_ID.XXXXXX")"
TASK_TMP_CREATED=true
chmod 700 "$TASK_TMP"
NETWORK="ai-job-benchmark-network-$RUN_ID"
PG_CONTAINER="ai-job-benchmark-postgres-$RUN_ID"
PG_HOST="ai-job-benchmark-pg-$RUN_ID"
MIGRATION_CONTAINER="ai-job-benchmark-migrate-$RUN_ID"
API_CONTAINER="ai-job-benchmark-api-$RUN_ID"
API_HOST="ai-job-benchmark-api-$RUN_ID"
RUNNER_CONTAINER="ai-job-benchmark-runner-$RUN_ID"
APP_IMAGE="ai-job-benchmark-app:$RUN_ID"
DB_NAME='ai_job_benchmark'
DATABASE_URL_LOCAL="postgresql://postgres@$PG_HOST:5432/$DB_NAME"
BENCHMARK_API_URL_LOCAL="http://$API_HOST:8000/recommend/jobs"
MATCH_KEY="job-benchmark-match-key-$RUN_ID-00000000"
JOB_RECOMMENDATION_KEY="job-benchmark-recommend-key-$RUN_ID-00000000"
CANDIDATE_RECOMMENDATION_KEY="job-benchmark-candidate-key-$RUN_ID-00000000"

guard_network() {
  local value
  value="$(docker network inspect --format \
    '{{.Id}}|{{.Name}}|{{.Internal}}|{{index .Labels "io.recruitment.ai-job-benchmark"}}' \
    "$NETWORK_ID" 2>/dev/null)"
  [[ "$NETWORK_CREATED" == true \
    && "$value" == "$NETWORK_ID|$NETWORK|true|$RUN_ID" ]] \
    || fail 'Docker network sentinel mismatch'
}

guard_container() {
  local container_id=$1 container_name=$2 value
  value="$(docker inspect --format \
    '{{.Id}}|{{.Name}}|{{index .Config.Labels "io.recruitment.ai-job-benchmark"}}|{{.HostConfig.NetworkMode}}' \
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

guard_api_ready() {
  guard_container "$API_CONTAINER_ID" "$API_CONTAINER"
  [[ "$(docker inspect --format '{{.State.Running}}' "$API_CONTAINER_ID" \
    2>/dev/null)" == true ]] \
    || fail 'AI API is not running'
  docker exec "$API_CONTAINER_ID" python -c \
    'import json, urllib.request; h=json.load(urllib.request.urlopen("http://127.0.0.1:8000/health", timeout=2)); r=json.load(urllib.request.urlopen("http://127.0.0.1:8000/ready", timeout=2)); assert h == {"service":"ai-service","status":"UP"}; assert r == {"service":"ai-service","status":"READY"}' \
    >/dev/null 2>&1 || fail 'AI API is not internally healthy and ready'
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

STEP='build pinned AI runtime from allow-listed context'
BUILD_CONTEXT="$TASK_TMP/build-context"
mkdir -p "$BUILD_CONTEXT"
cp "$SERVICE_DIR/Dockerfile" "$SERVICE_DIR/requirements.txt" \
  "$SERVICE_DIR/requirements-chat.txt" "$SERVICE_DIR/alembic.ini" \
  "$BUILD_CONTEXT/"
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
if ! docker build --target runtime --label "$LABEL_KEY=$RUN_ID" \
  --tag "$APP_IMAGE" "$BUILD_CONTEXT" \
  >"$TASK_TMP/application-build.log" 2>&1; then
  tail -n 80 "$TASK_TMP/application-build.log" >&2
  fail 'AI benchmark runtime image build failed'
fi
APP_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$APP_IMAGE")"
[[ "$APP_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]] \
  || fail 'Docker did not return an exact application image ID'
APP_IMAGE_CREATED=true
[[ "$(docker image inspect --format \
  '{{.Id}}|{{index .Config.Labels "io.recruitment.ai-job-benchmark"}}' \
  "$APP_IMAGE_ID")" == "$APP_IMAGE_ID|$RUN_ID" ]] \
  || fail 'application image sentinel mismatch'
PYTHON_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$PYTHON_IMAGE")"
[[ "$PYTHON_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]] \
  || fail 'pinned Python image ID is invalid'

STEP='apply Alembic head migration'
MIGRATION_CONTAINER_ID="$(docker create --name "$MIGRATION_CONTAINER" \
  --network "$NETWORK" --workdir /app --read-only \
  --user app \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --memory 512m --cpus 1 --pids-limit 256 \
  --cap-drop ALL --security-opt no-new-privileges \
  --label "$LABEL_KEY=$RUN_ID" \
  -e "DATABASE_URL=$DATABASE_URL_LOCAL" \
  "$APP_IMAGE_ID" /bin/sh -c \
  'test -r /app/alembic.ini && test -d /app/migrations && exec alembic -c /app/alembic.ini upgrade head')"
[[ "$MIGRATION_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]] \
  || fail 'Docker did not return an exact migration container ID'
MIGRATION_CONTAINER_CREATED=true
guard_container "$MIGRATION_CONTAINER_ID" "$MIGRATION_CONTAINER"
MIGRATION_STATUS=0
docker start --attach "$MIGRATION_CONTAINER_ID" \
  >"$TASK_TMP/migration.log" 2>&1 || MIGRATION_STATUS=$?
if (( MIGRATION_STATUS != 0 )); then
  tail -n 80 "$TASK_TMP/migration.log" >&2
  fail 'Alembic head migration failed'
fi
guard_db
[[ "$(raw_scalar 'SELECT version_num FROM ai.alembic_version;')" == "$EXPECTED_HEAD" ]] \
  || fail 'database is not at the expected Alembic head'
[[ -n "$(raw_scalar "SELECT extversion FROM pg_extension WHERE extname='vector';")" ]] \
  || fail 'pgvector extension is missing after migration'

STEP='start non-root read-only AI API'
API_CONTAINER_ID="$(docker create --name "$API_CONTAINER" \
  --network "$NETWORK" --network-alias "$API_HOST" \
  --workdir /app --read-only --user app \
  --tmpfs /tmp:rw,noexec,nosuid,size=128m \
  --memory 1g --cpus 4 --pids-limit 512 \
  --cap-drop ALL --security-opt no-new-privileges \
  --label "$LABEL_KEY=$RUN_ID" \
  -e "DATABASE_URL=$DATABASE_URL_LOCAL" \
  -e DATABASE_CONNECT_TIMEOUT_SECONDS=2 \
  -e DATABASE_STATEMENT_TIMEOUT_MS=2000 \
  -e "INTERNAL_API_KEY=$MATCH_KEY" \
  -e "INTERNAL_API_KEY_JOB_SEARCH=$JOB_RECOMMENDATION_KEY" \
  -e "INTERNAL_API_KEY_JOB_SEARCH_CANDIDATES=$CANDIDATE_RECOMMENDATION_KEY" \
  -e CHAT_ENABLED=false \
  "$APP_IMAGE_ID" uvicorn app.main:app --host 0.0.0.0 --port 8000 \
    --no-access-log)"
[[ "$API_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]] \
  || fail 'Docker did not return an exact API container ID'
API_CONTAINER_CREATED=true
guard_container "$API_CONTAINER_ID" "$API_CONTAINER"
docker start "$API_CONTAINER_ID" >/dev/null
for _attempt in $(awk 'BEGIN { for (i=1; i<=120; i++) print i }'); do
  if docker exec "$API_CONTAINER_ID" python -c \
    'import json, urllib.request; h=json.load(urllib.request.urlopen("http://127.0.0.1:8000/health", timeout=2)); r=json.load(urllib.request.urlopen("http://127.0.0.1:8000/ready", timeout=2)); assert h == {"service":"ai-service","status":"UP"}; assert r == {"service":"ai-service","status":"READY"}' \
    >/dev/null 2>&1; then
    break
  fi
  [[ "$(docker inspect --format '{{.State.Running}}' "$API_CONTAINER_ID" 2>/dev/null)" == true ]] \
    || fail 'AI API stopped before becoming healthy'
  sleep 1
done
docker exec "$API_CONTAINER_ID" python -c \
  'import json, urllib.request; h=json.load(urllib.request.urlopen("http://127.0.0.1:8000/health", timeout=2)); r=json.load(urllib.request.urlopen("http://127.0.0.1:8000/ready", timeout=2)); assert h == {"service":"ai-service","status":"UP"}; assert r == {"service":"ai-service","status":"READY"}' \
  >/dev/null 2>&1 || fail 'AI API did not become internally healthy'
guard_api_ready
guard_db

STEP='run full-target HTTP correctness, concurrency and load gates'
RUNNER_CONTAINER_ID="$(docker create --name "$RUNNER_CONTAINER" \
  --network "$NETWORK" --workdir /app --read-only \
  --user app \
  --tmpfs /tmp:rw,noexec,nosuid,size=128m \
  --memory 2g --cpus 4 --pids-limit 1024 \
  --cap-drop ALL --security-opt no-new-privileges \
  --label "$LABEL_KEY=$RUN_ID" \
  --mount "type=bind,src=$RUNNER_FILE,dst=/runner/job-recommendation-benchmark.py,readonly" \
  -e PYTHONPATH=/app \
  -e "DATABASE_URL=$DATABASE_URL_LOCAL" \
  -e "BENCHMARK_API_URL=$BENCHMARK_API_URL_LOCAL" \
  -e "BENCHMARK_INTERNAL_API_KEY=$JOB_RECOMMENDATION_KEY" \
  -e BENCHMARK_RUN_ID="$RUN_ID" \
  -e BENCHMARK_POSTGRES_IMAGE_REF="$PG_IMAGE" \
  -e BENCHMARK_POSTGRES_IMAGE_ID="$PG_IMAGE_ID" \
  -e BENCHMARK_PYTHON_IMAGE_REF="$PYTHON_IMAGE" \
  -e BENCHMARK_PYTHON_IMAGE_ID="$PYTHON_IMAGE_ID" \
  -e BENCHMARK_APPLICATION_IMAGE_ID="$APP_IMAGE_ID" \
  -e BENCHMARK_WARMUP_CALLS="$GATE_WARMUP_CALLS" \
  -e BENCHMARK_MEASURED_CALLS="$GATE_MEASURED_CALLS" \
  -e BENCHMARK_CONCURRENCY="$GATE_CONCURRENCY" \
  -e BENCHMARK_HTTP_TIMEOUT_SECONDS="$GATE_HTTP_TIMEOUT_SECONDS" \
  -e BENCHMARK_MAX_P95_MS="$GATE_MAX_P95_MS" \
  -e BENCHMARK_MAX_P99_MS="$GATE_MAX_P99_MS" \
  -e BENCHMARK_MAX_CALL_MS="$GATE_MAX_CALL_MS" \
  -e BENCHMARK_MIN_RPS="$GATE_MIN_RPS" \
  "$APP_IMAGE_ID" python /runner/job-recommendation-benchmark.py)"
[[ "$RUNNER_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]] \
  || fail 'Docker did not return an exact runner container ID'
RUNNER_CONTAINER_CREATED=true
guard_container "$RUNNER_CONTAINER_ID" "$RUNNER_CONTAINER"
MOUNT_GUARD="$(docker inspect --format \
  '{{range .Mounts}}{{if eq .Destination "/runner/job-recommendation-benchmark.py"}}{{.Source}}|{{.RW}}{{end}}{{end}}' \
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
  fail 'job recommendation benchmark failed'
fi
guard_api_ready
guard_db
python3 - "$TASK_TMP/runner.log" "$PG_IMAGE_ID" "$PYTHON_IMAGE_ID" \
  "$APP_IMAGE_ID" "$GATE_WARMUP_CALLS" "$GATE_MEASURED_CALLS" \
  "$GATE_CONCURRENCY" "$GATE_HTTP_TIMEOUT_SECONDS" \
  "$GATE_MAX_P95_MS" "$GATE_MAX_P99_MS" \
  "$GATE_MAX_CALL_MS" "$GATE_MIN_RPS" <<'PY'
import json
import sys
from pathlib import Path

(
    log_path,
    postgres_image_id,
    python_image_id,
    application_image_id,
    warmup_calls,
    measured_calls,
    concurrency,
    http_timeout_seconds,
    max_p95_ms,
    max_p99_ms,
    max_call_ms,
    min_rps,
) = sys.argv[1:]
lines = Path(log_path).read_text(encoding="utf-8").splitlines()
if len(lines) != 2:
    raise SystemExit("runner output must contain exactly one JSON and one human line")
try:
    report = json.loads(lines[0])
except json.JSONDecodeError as error:
    raise SystemExit("runner machine report is not strict JSON") from error
expected_human = (
    "[job-recommendation-benchmark] PASS: "
    "100k full-target fixture, strict HTTP correctness and bounded load"
)
if lines[1] != expected_human:
    raise SystemExit("runner human PASS evidence differs")
expected_scalars = {
    "gate": "job-recommendation-full-target-benchmark-v1",
    "status": "PASS",
    "errors": 0,
    "mismatches": 0,
    "timeouts": 0,
    "securityLeaks": 0,
}
for key, expected in expected_scalars.items():
    if report.get(key) != expected:
        raise SystemExit(f"runner report {key} differs")
dataset = report.get("dataset", {})
if {
    "total": dataset.get("total"),
    "activeCorrectModel": dataset.get("activeCorrectModel"),
    "inactiveCorrectModel": dataset.get("inactiveCorrectModel"),
    "activeWrongModel": dataset.get("activeWrongModel"),
    "sourceCvRows": dataset.get("sourceCvRows"),
} != {
    "total": 100000,
    "activeCorrectModel": 80000,
    "inactiveCorrectModel": 10000,
    "activeWrongModel": 10000,
    "sourceCvRows": 1,
}:
    raise SystemExit("runner dataset evidence differs")
load = report.get("load", {})
expected_load = {
    "warmupCalls": int(warmup_calls),
    "measuredCalls": int(measured_calls),
    "concurrency": int(concurrency),
    "errors": 0,
    "oracleMismatches": 0,
    "timeouts": 0,
}
for key, expected in expected_load.items():
    if load.get(key) != expected:
        raise SystemExit(f"runner load {key} differs")
expected_thresholds = {
    "maxP95Ms": int(max_p95_ms),
    "maxP99Ms": int(max_p99_ms),
    "maxCallMs": int(max_call_ms),
    "minRequestsPerSecond": float(min_rps),
    "httpTimeoutSeconds": int(http_timeout_seconds),
    "databaseStatementTimeoutMs": 2000,
}
if load.get("thresholds") != expected_thresholds:
    raise SystemExit("runner load thresholds differ")
plans = report.get("plans")
if not isinstance(plans, list) or len(plans) != 2:
    raise SystemExit("runner plan evidence differs")
if not all(
    plan.get("usesFullTargetSeqScan") is True
    and plan.get("usesHnsw") is False
    and plan.get("queryOrigin") == "PsycopgRecommendationRepository.recommend_jobs"
    and plan.get("callPathSettingsValidated") is True
    for plan in plans
):
    raise SystemExit("runner production-query plan evidence differs")
writer = report.get("concurrentWriter", {})
if (
    writer.get("readers") != 6
    or writer.get("writerCommits") != 6
    or writer.get("unexpectedOutcomes") != 0
    or writer.get("http200ExactContinuations", 0)
    + writer.get("canonicalStale409", 0)
    != 6
):
    raise SystemExit("runner concurrent-writer evidence differs")
images = report.get("images", {})
if (
    images.get("postgresImageId") != postgres_image_id
    or images.get("pythonImageId") != python_image_id
    or images.get("applicationImageId") != application_image_id
):
    raise SystemExit("runner image identity evidence differs")
boundary = report.get("boundary", {})
if boundary != {
    "productionSloClaimed": False,
    "realVietnameseSemanticRelevanceClaimed": False,
    "distributedRateLimitAdded": False,
}:
    raise SystemExit("runner claim boundary differs")
PY

STEP='complete'
cat "$TASK_TMP/runner.log"
say 'PASS: full-target Job recommendation HTTP correctness and load evidence verified'
