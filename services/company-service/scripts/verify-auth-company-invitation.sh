#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

DEFAULT_PG_IMAGE='postgres@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685'
DEFAULT_REDIS_IMAGE='redis@sha256:ff02b58f971e7d7d156a1267e283fcbbeee91773b6aa36c49dac28ecfe28eadf'
DEFAULT_NODE_IMAGE='node@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293'
DEFAULT_MAVEN_IMAGE='maven@sha256:613124833fa6718ded9d655a2ebfab6425818c178f899116b93560b6f1c9ffe9'
DEFAULT_JRE_IMAGE='eclipse-temurin@sha256:974b08960c5d96694c780e65b2d5705268ab1e1ca1a0dd0caf4ba6c3fe34d699'
OPT_IN_VALUE='run-disposable-auth-company-integration'
LABEL_KEY='io.recruitment.company-auth-integration'
DB_SENTINEL_PREFIX='recruitment-company-auth-integration:'
DB_NAME='auth_company_integration'
INTEGRATION_JWT_ISSUER='https://auth.integration.recruitment.local'
INTEGRATION_JWT_AUDIENCE='recruitment-api'

OWNER_ID='10000000-0000-4000-8000-000000000001'
THIEF_ID='10000000-0000-4000-8000-000000000002'
INTENDED_ID='10000000-0000-4000-8000-000000000003'
LOCKED_ID='10000000-0000-4000-8000-000000000004'
DELETED_ID='10000000-0000-4000-8000-000000000005'
ROLE_ID='10000000-0000-4000-8000-000000000006'
EMAIL_ID='10000000-0000-4000-8000-000000000007'
OUTAGE_ID='10000000-0000-4000-8000-000000000008'
RACE_ID='10000000-0000-4000-8000-000000000009'

STEP='preflight'
RUN_ID=''
TASK_TMP=''
TASK_TMP_CREATED=false
STATE_DIR=''
NETWORK=''
NETWORK_ID=''
NETWORK_CREATED=false
PG_CONTAINER=''
PG_CONTAINER_ID=''
PG_CONTAINER_CREATED=false
PG_HOST=''
PG_IMAGE_ID=''
REDIS_CONTAINER=''
REDIS_CONTAINER_ID=''
REDIS_CONTAINER_CREATED=false
REDIS_HOST=''
REDIS_IMAGE_ID=''
AUTH_CONTAINER=''
AUTH_CONTAINER_ID=''
AUTH_CONTAINER_CREATED=false
AUTH_HOST=''
COMPANY_CONTAINER=''
COMPANY_CONTAINER_ID=''
COMPANY_CONTAINER_CREATED=false
COMPANY_HOST=''
RUNNER_CONTAINER=''
RUNNER_CONTAINER_ID=''
RUNNER_CONTAINER_CREATED=false
AUTH_IMAGE=''
AUTH_IMAGE_ID=''
AUTH_IMAGE_CREATED=false
COMPANY_IMAGE=''
COMPANY_IMAGE_ID=''
COMPANY_IMAGE_CREATED=false

say() { printf '[auth-company-integration] %s\n' "$1"; }
fail() { printf '[auth-company-integration] ERROR: %s\n' "$1" >&2; exit 1; }

(( $# == 0 )) || fail 'no URL, database target or positional argument is accepted'
[[ ${COMPANY_AUTH_INTEGRATION_CONFIRM:-} == "$OPT_IN_VALUE" ]] \
  || fail "explicit opt-in is required: COMPANY_AUTH_INTEGRATION_CONFIRM=$OPT_IN_VALUE"

for variable in DATABASE_URL PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER \
  PGPASSWORD PGPASSFILE PGSERVICE PGSERVICEFILE POSTGRES_DB POSTGRES_USER \
  POSTGRES_PASSWORD REDIS_URL AUTH_SERVICE_URL AUTH_SERVICE_ALLOWED_HOSTS \
  AUTH_REQUEST_TIMEOUT_MS JWT_JWKS_URI JWT_PUBLIC_KEY JWT_PUBLIC_KEY_PATH \
  JWT_PRIVATE_KEY_PATH JWT_ISSUER JWT_AUDIENCE; do
  [[ -z ${!variable+x} ]] \
    || fail "unset $variable; external service and database targets are refused"
done
for variable in DOCKER_HOST DOCKER_TLS_VERIFY DOCKER_CERT_PATH; do
  [[ -z ${!variable+x} ]] \
    || fail "unset $variable; only the active local Unix Docker context is allowed"
done

PG_IMAGE="${COMPANY_AUTH_INTEGRATION_POSTGRES_IMAGE:-$DEFAULT_PG_IMAGE}"
REDIS_IMAGE="${COMPANY_AUTH_INTEGRATION_REDIS_IMAGE:-$DEFAULT_REDIS_IMAGE}"
NODE_IMAGE="${COMPANY_AUTH_INTEGRATION_NODE_IMAGE:-$DEFAULT_NODE_IMAGE}"
MAVEN_IMAGE="${COMPANY_AUTH_INTEGRATION_MAVEN_IMAGE:-$DEFAULT_MAVEN_IMAGE}"
JRE_IMAGE="${COMPANY_AUTH_INTEGRATION_JRE_IMAGE:-$DEFAULT_JRE_IMAGE}"

validate_pinned_image() {
  local name=$1 value=$2
  [[ "$value" =~ ^[A-Za-z0-9][A-Za-z0-9._/:@-]*@sha256:[0-9a-f]{64}$ \
    && "$value" != *@sha256:*@* ]] \
    || fail "$name must be an immutable image@sha256 reference"
}
validate_pinned_image COMPANY_AUTH_INTEGRATION_POSTGRES_IMAGE "$PG_IMAGE"
validate_pinned_image COMPANY_AUTH_INTEGRATION_REDIS_IMAGE "$REDIS_IMAGE"
validate_pinned_image COMPANY_AUTH_INTEGRATION_NODE_IMAGE "$NODE_IMAGE"
validate_pinned_image COMPANY_AUTH_INTEGRATION_MAVEN_IMAGE "$MAVEN_IMAGE"
validate_pinned_image COMPANY_AUTH_INTEGRATION_JRE_IMAGE "$JRE_IMAGE"

OVERALL_TIMEOUT_SECONDS="${COMPANY_AUTH_INTEGRATION_OVERALL_TIMEOUT_SECONDS:-1800}"
[[ "$OVERALL_TIMEOUT_SECONDS" =~ ^[0-9]+$ \
  && "$OVERALL_TIMEOUT_SECONDS" -ge 600 \
  && "$OVERALL_TIMEOUT_SECONDS" -le 3600 ]] \
  || fail 'COMPANY_AUTH_INTEGRATION_OVERALL_TIMEOUT_SECONDS must be 600..3600'
command -v timeout >/dev/null 2>&1 || fail 'timeout is required'
if [[ ${COMPANY_AUTH_INTEGRATION_TIMEOUT_WRAPPED:-} != 1 ]]; then
  exec env COMPANY_AUTH_INTEGRATION_TIMEOUT_WRAPPED=1 \
    timeout --foreground --kill-after=30s "$OVERALL_TIMEOUT_SECONDS" "$0"
fi

cleanup() {
  local code=$? value=''
  set +e
  if (( code != 0 )); then
    if [[ "$COMPANY_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]]; then
      value="$(docker inspect --format \
        '{{.Id}}|{{.Name}}|{{index .Config.Labels "io.recruitment.company-auth-integration"}}' \
        "$COMPANY_CONTAINER_ID" 2>/dev/null)"
      if [[ "$value" == "$COMPANY_CONTAINER_ID|/$COMPANY_CONTAINER|$RUN_ID" ]]; then
        printf '[auth-company-integration] Company log tail follows\n' >&2
        docker logs --tail 50 "$COMPANY_CONTAINER_ID" >&2 2>/dev/null
      fi
    fi
    if [[ "$AUTH_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]]; then
      value="$(docker inspect --format \
        '{{.Id}}|{{.Name}}|{{index .Config.Labels "io.recruitment.company-auth-integration"}}' \
        "$AUTH_CONTAINER_ID" 2>/dev/null)"
      if [[ "$value" == "$AUTH_CONTAINER_ID|/$AUTH_CONTAINER|$RUN_ID" ]]; then
        printf '[auth-company-integration] Auth log tail follows\n' >&2
        docker logs --tail 50 "$AUTH_CONTAINER_ID" >&2 2>/dev/null
      fi
    fi
  fi
  if [[ "$RUNNER_CONTAINER_CREATED" == true \
    && "$RUNNER_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]]; then
    value="$(docker inspect --format \
      '{{.Id}}|{{.Name}}|{{index .Config.Labels "io.recruitment.company-auth-integration"}}' \
      "$RUNNER_CONTAINER_ID" 2>/dev/null)"
    [[ "$value" == "$RUNNER_CONTAINER_ID|/$RUNNER_CONTAINER|$RUN_ID" ]] \
      && docker rm --force "$RUNNER_CONTAINER_ID" >/dev/null 2>&1
  fi
  if [[ "$COMPANY_CONTAINER_CREATED" == true \
    && "$COMPANY_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]]; then
    value="$(docker inspect --format \
      '{{.Id}}|{{.Name}}|{{index .Config.Labels "io.recruitment.company-auth-integration"}}' \
      "$COMPANY_CONTAINER_ID" 2>/dev/null)"
    [[ "$value" == "$COMPANY_CONTAINER_ID|/$COMPANY_CONTAINER|$RUN_ID" ]] \
      && docker rm --force "$COMPANY_CONTAINER_ID" >/dev/null 2>&1
  fi
  if [[ "$AUTH_CONTAINER_CREATED" == true \
    && "$AUTH_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]]; then
    value="$(docker inspect --format \
      '{{.Id}}|{{.Name}}|{{index .Config.Labels "io.recruitment.company-auth-integration"}}' \
      "$AUTH_CONTAINER_ID" 2>/dev/null)"
    [[ "$value" == "$AUTH_CONTAINER_ID|/$AUTH_CONTAINER|$RUN_ID" ]] \
      && docker rm --force "$AUTH_CONTAINER_ID" >/dev/null 2>&1
  fi
  if [[ "$REDIS_CONTAINER_CREATED" == true \
    && "$REDIS_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]]; then
    value="$(docker inspect --format \
      '{{.Id}}|{{.Name}}|{{index .Config.Labels "io.recruitment.company-auth-integration"}}' \
      "$REDIS_CONTAINER_ID" 2>/dev/null)"
    [[ "$value" == "$REDIS_CONTAINER_ID|/$REDIS_CONTAINER|$RUN_ID" ]] \
      && docker rm --force "$REDIS_CONTAINER_ID" >/dev/null 2>&1
  fi
  if [[ "$PG_CONTAINER_CREATED" == true \
    && "$PG_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]]; then
    value="$(docker inspect --format \
      '{{.Id}}|{{.Name}}|{{index .Config.Labels "io.recruitment.company-auth-integration"}}' \
      "$PG_CONTAINER_ID" 2>/dev/null)"
    [[ "$value" == "$PG_CONTAINER_ID|/$PG_CONTAINER|$RUN_ID" ]] \
      && docker rm --force "$PG_CONTAINER_ID" >/dev/null 2>&1
  fi
  if [[ "$NETWORK_CREATED" == true && "$NETWORK_ID" =~ ^[0-9a-f]{64}$ ]]; then
    value="$(docker network inspect --format \
      '{{.Id}}|{{.Name}}|{{index .Labels "io.recruitment.company-auth-integration"}}' \
      "$NETWORK_ID" 2>/dev/null)"
    [[ "$value" == "$NETWORK_ID|$NETWORK|$RUN_ID" ]] \
      && docker network rm "$NETWORK_ID" >/dev/null 2>&1
  fi
  if [[ "$COMPANY_IMAGE_CREATED" == true \
    && "$COMPANY_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    value="$(docker image inspect --format \
      '{{.Id}}|{{index .Config.Labels "io.recruitment.company-auth-integration"}}' \
      "$COMPANY_IMAGE_ID" 2>/dev/null)"
    [[ "$value" == "$COMPANY_IMAGE_ID|$RUN_ID" ]] \
      && docker image rm "$COMPANY_IMAGE_ID" >/dev/null 2>&1
  fi
  if [[ "$AUTH_IMAGE_CREATED" == true \
    && "$AUTH_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    value="$(docker image inspect --format \
      '{{.Id}}|{{index .Config.Labels "io.recruitment.company-auth-integration"}}' \
      "$AUTH_IMAGE_ID" 2>/dev/null)"
    [[ "$value" == "$AUTH_IMAGE_ID|$RUN_ID" ]] \
      && docker image rm "$AUTH_IMAGE_ID" >/dev/null 2>&1
  fi
  [[ "$TASK_TMP_CREATED" != true \
    || -z "$TASK_TMP" \
    || "$TASK_TMP" != /tmp/company-auth-integration.* ]] \
    || rm -rf -- "$TASK_TMP"
  (( code == 0 )) \
    || printf '[auth-company-integration] FAILED during: %s\n' "$STEP" >&2
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

for command_name in awk bash chmod cp date dirname docker env find grep id mkdir \
  mktemp node od openssl rm sha256sum sleep stat tail timeout tr; do
  command -v "$command_name" >/dev/null 2>&1 \
    || fail "$command_name is required"
done
DOCKER_ENDPOINT="$(docker context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null)"
[[ "$DOCKER_ENDPOINT" == unix://* ]] \
  || fail 'the active Docker context is not a local Unix socket'
docker info >/dev/null 2>&1 || fail 'the local Docker daemon is unavailable'
HOST_UID="$(id -u)"
HOST_GID="$(id -g)"
[[ "$HOST_UID" =~ ^[0-9]+$ && "$HOST_GID" =~ ^[0-9]+$ ]] \
  || fail 'could not resolve the local numeric user identity'

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
SERVICE_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
AUTH_DIR="$(cd -- "$SERVICE_DIR/../auth-service" && pwd -P)"
RUNNER_FILE="$SCRIPT_DIR/auth-company-invitation-runner.js"
COMPANY_DOCKERFILE="$SCRIPT_DIR/auth-company-integration.Company.Dockerfile"
AUTH_DOCKERFILE="$SCRIPT_DIR/auth-company-integration.Auth.Dockerfile"
for path in "$RUNNER_FILE" "$COMPANY_DOCKERFILE" "$AUTH_DOCKERFILE" \
  "$SERVICE_DIR/package.json" "$SERVICE_DIR/nest-cli.json" \
  "$SERVICE_DIR/tsconfig.json" "$SERVICE_DIR/prisma/schema.prisma" \
  "$AUTH_DIR/pom.xml" "$AUTH_DIR/src/main/resources/application.yml"; do
  [[ -f "$path" ]] || fail "required input is missing: $path"
done
[[ -d "$SERVICE_DIR/src" && -d "$SERVICE_DIR/prisma/migrations" \
  && -d "$AUTH_DIR/src" ]] || fail 'Company or Auth source tree is missing'
node --check "$RUNNER_FILE" >/dev/null \
  || fail 'the HTTP integration runner does not parse'

RUN_ID="$(date -u +%Y%m%d%H%M%S)-$$-$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
[[ "$RUN_ID" =~ ^[0-9a-f-]+$ ]] || fail 'could not generate a safe run identifier'
TASK_TMP="$(mktemp -d "/tmp/company-auth-integration.$RUN_ID.XXXXXX")"
TASK_TMP_CREATED=true
chmod 700 "$TASK_TMP"
STATE_DIR="$TASK_TMP/state"
mkdir "$STATE_DIR"
chmod 700 "$STATE_DIR"

NETWORK="company-auth-it-network-$RUN_ID"
PG_CONTAINER="company-auth-it-postgres-$RUN_ID"
PG_HOST="company-auth-pg-$RUN_ID"
REDIS_CONTAINER="company-auth-it-redis-$RUN_ID"
REDIS_HOST="company-auth-redis-$RUN_ID"
AUTH_CONTAINER="company-auth-it-auth-$RUN_ID"
AUTH_HOST="company-auth-api-$RUN_ID"
COMPANY_CONTAINER="company-auth-it-company-$RUN_ID"
COMPANY_HOST="company-auth-company-$RUN_ID"
RUNNER_CONTAINER="company-auth-it-runner-$RUN_ID"
AUTH_IMAGE="company-auth-integration-auth:$RUN_ID"
COMPANY_IMAGE="company-auth-integration-company:$RUN_ID"

guard_network() {
  local value
  value="$(docker network inspect --format \
    '{{.Id}}|{{.Name}}|{{.Internal}}|{{index .Labels "io.recruitment.company-auth-integration"}}' \
    "$NETWORK_ID" 2>/dev/null)"
  [[ "$NETWORK_CREATED" == true \
    && "$value" == "$NETWORK_ID|$NETWORK|true|$RUN_ID" ]] \
    || fail 'Docker network sentinel mismatch'
}

guard_container() {
  local container_id=$1 container_name=$2 value
  value="$(docker inspect --format \
    '{{.Id}}|{{.Name}}|{{index .Config.Labels "io.recruitment.company-auth-integration"}}|{{.HostConfig.NetworkMode}}' \
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

guard_image() {
  local image_id=$1 value
  value="$(docker image inspect --format \
    '{{.Id}}|{{index .Config.Labels "io.recruitment.company-auth-integration"}}' \
    "$image_id" 2>/dev/null)"
  [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ \
    && "$value" == "$image_id|$RUN_ID" ]] \
    || fail 'application image sentinel mismatch'
}

run_phase() {
  local phase=$1 status=0 state_mount
  case "$phase" in
    ready|setup|stolen|intended|durable|concurrency|outage) ;;
    *) fail 'runner phase is outside the allow-list' ;;
  esac
  guard_container "$COMPANY_CONTAINER_ID" "$COMPANY_CONTAINER"
  if [[ "$phase" != outage ]]; then
    guard_container "$AUTH_CONTAINER_ID" "$AUTH_CONTAINER"
  fi
  state_mount="type=bind,src=$STATE_DIR,dst=/state"
  [[ "$phase" == setup ]] || state_mount="$state_mount,readonly"
  RUNNER_CONTAINER_ID="$(docker create --name "$RUNNER_CONTAINER" \
    --network "$NETWORK" \
    --user "$HOST_UID:$HOST_GID" \
    --read-only \
    --tmpfs /tmp:rw,noexec,nosuid,uid=$HOST_UID,gid=$HOST_GID,mode=700,size=64m \
    --memory 512m --cpus 1 --pids-limit 128 \
    --cap-drop ALL --security-opt no-new-privileges \
    --label "$LABEL_KEY=$RUN_ID" \
    --mount "type=bind,src=$RUNNER_FILE,dst=/runner/auth-company-invitation-runner.js,readonly" \
    --mount "$state_mount" \
    -e "INTEGRATION_RUN_ID=$RUN_ID" \
    -e "INTEGRATION_PHASE=$phase" \
    -e "STATE_PATH=/state/auth-company-state.json" \
    -e "AUTH_BASE_URL=http://$AUTH_HOST:8080" \
    -e "EXPECTED_AUTH_HOST=$AUTH_HOST" \
    -e "COMPANY_BASE_URL=http://$COMPANY_HOST:3000" \
    -e "EXPECTED_COMPANY_HOST=$COMPANY_HOST" \
    -e "EXPECTED_JWT_ISSUER=$INTEGRATION_JWT_ISSUER" \
    -e "EXPECTED_JWT_AUDIENCE=$INTEGRATION_JWT_AUDIENCE" \
    "$COMPANY_IMAGE_ID" node /runner/auth-company-invitation-runner.js)"
  [[ "$RUNNER_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]] \
    || fail 'Docker did not return an exact runner container ID'
  RUNNER_CONTAINER_CREATED=true
  guard_container "$RUNNER_CONTAINER_ID" "$RUNNER_CONTAINER"
  docker start --attach "$RUNNER_CONTAINER_ID" \
    >"$TASK_TMP/runner-$phase.log" 2>"$TASK_TMP/runner-$phase-error.log" \
    || status=$?
  guard_container "$RUNNER_CONTAINER_ID" "$RUNNER_CONTAINER"
  if (( status != 0 )); then
    tail -n 20 "$TASK_TMP/runner-$phase-error.log" >&2
    tail -n 5 "$TASK_TMP/runner-$phase.log" >&2
    fail "HTTP integration runner phase failed: $phase"
  fi
  grep -Fq '"status":"PASS"' "$TASK_TMP/runner-$phase.log" \
    || fail "runner phase did not emit a machine-readable PASS: $phase"
  grep -Fq "[auth-company-integration] PASS: $phase" \
    "$TASK_TMP/runner-$phase.log" \
    || fail "runner phase did not emit its concise PASS: $phase"
  docker rm "$RUNNER_CONTAINER_ID" >/dev/null
  RUNNER_CONTAINER_CREATED=false
  RUNNER_CONTAINER_ID=''
  cat "$TASK_TMP/runner-$phase.log"
}

invitation_fingerprint() {
  local email=$1 target_id=$2
  case "$email|$target_id" in
    intended.integration@example.test\|"$INTENDED_ID" \
      |outage.integration@example.test\|"$OUTAGE_ID") ;;
    *) fail 'invitation fingerprint target is outside the allow-list' ;;
  esac
  scalar "SELECT md5(coalesce((SELECT concat_ws('|', id::text, company_id::text, normalized_email, coalesce(email_normalization_version::text,''), status::text, token_hash, invited_by::text, coalesce(accepted_by::text,''), expires_at::text, coalesce(accepted_at::text,''), created_at::text, updated_at::text) FROM company.company_invitations WHERE normalized_email='$email'),'missing') || '|' || (SELECT count(*)::text FROM company.company_members WHERE user_id IN ('$THIEF_ID'::uuid,'$target_id'::uuid)));"
}

durable_fingerprint() {
  scalar "SELECT md5(coalesce(string_agg(concat_ws('|', id::text, company_id::text, normalized_email, coalesce(email_normalization_version::text,''), status::text, token_hash, invited_by::text, coalesce(accepted_by::text,''), expires_at::text, coalesce(accepted_at::text,''), created_at::text, updated_at::text), E'\\n' ORDER BY normalized_email),'') || '|' || (SELECT count(*)::text FROM company.company_members WHERE user_id IN ('$LOCKED_ID'::uuid,'$DELETED_ID'::uuid,'$ROLE_ID'::uuid,'$EMAIL_ID'::uuid))) FROM company.company_invitations WHERE normalized_email IN ('locked.integration@example.test','deleted.integration@example.test','role.integration@example.test','email.integration@example.test');"
}

STEP='generate disposable credentials and RSA signing key'
PG_PASSWORD="$(openssl rand -hex 24)"
REDIS_PASSWORD="$(openssl rand -hex 24)"
OTP_SECRET="$(openssl rand -hex 32)"
LOGIN_SECRET="$(openssl rand -hex 32)"
RESET_SECRET="$(openssl rand -hex 32)"
CURSOR_SECRET="$(openssl rand -hex 32)"
KEY_DIR="$TASK_TMP/keys"
mkdir "$KEY_DIR"
chmod 700 "$KEY_DIR"
PRIVATE_KEY="$KEY_DIR/jwt-private.pem"
PUBLIC_KEY="$KEY_DIR/jwt-public.pem"
openssl genpkey -quiet -algorithm RSA -pkeyopt rsa_keygen_bits:2048 \
  -out "$PRIVATE_KEY"
openssl pkey -in "$PRIVATE_KEY" -pubout -out "$PUBLIC_KEY"
chmod 600 "$PRIVATE_KEY" "$PUBLIC_KEY"
PUBLIC_KEY_SHA256="$(openssl pkey -pubin -in "$PUBLIC_KEY" -outform DER \
  | sha256sum | awk '{print $1}')"
[[ "$PUBLIC_KEY_SHA256" =~ ^[0-9a-f]{64}$ ]] \
  || fail 'could not fingerprint the generated RSA public key'

STEP='create isolated internal Docker network'
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
  --shm-size 128m --memory 1g --cpus 2 --pids-limit 256 \
  --label "$LABEL_KEY=$RUN_ID" \
  -e POSTGRES_DB="$DB_NAME" -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD="$PG_PASSWORD" "$PG_IMAGE")"
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
[[ "$PG_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]] \
  || fail 'PostgreSQL runtime image ID is invalid'

STEP='start disposable authenticated Redis 7'
REDIS_CONTAINER_ID="$(docker create --name "$REDIS_CONTAINER" \
  --network "$NETWORK" --network-alias "$REDIS_HOST" \
  --user 999:1000 \
  --tmpfs /data:rw,noexec,nosuid,uid=999,gid=1000,mode=700,size=128m \
  --memory 256m --cpus 1 --pids-limit 128 \
  --cap-drop ALL --security-opt no-new-privileges \
  --label "$LABEL_KEY=$RUN_ID" "$REDIS_IMAGE" \
  redis-server --save '' --appendonly no --requirepass "$REDIS_PASSWORD")"
[[ "$REDIS_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]] \
  || fail 'Docker did not return an exact Redis container ID'
REDIS_CONTAINER_CREATED=true
guard_container "$REDIS_CONTAINER_ID" "$REDIS_CONTAINER"
docker start "$REDIS_CONTAINER_ID" >/dev/null
for _attempt in $(awk 'BEGIN { for (i=1; i<=120; i++) print i }'); do
  docker exec -e REDISCLI_AUTH="$REDIS_PASSWORD" "$REDIS_CONTAINER_ID" \
    redis-cli ping 2>/dev/null | grep -Fxq PONG && break
  sleep 1
done
docker exec -e REDISCLI_AUTH="$REDIS_PASSWORD" "$REDIS_CONTAINER_ID" \
  redis-cli ping 2>/dev/null | grep -Fxq PONG \
  || fail 'Redis did not become ready'
docker exec "$REDIS_CONTAINER_ID" redis-server --version | grep -Eq 'v=7\.' \
  || fail 'Redis runtime is not major version 7'
REDIS_IMAGE_ID="$(docker inspect --format '{{.Image}}' "$REDIS_CONTAINER_ID")"
[[ "$REDIS_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]] \
  || fail 'Redis runtime image ID is invalid'

STEP='build digest-pinned Auth image from allow-listed source'
AUTH_CONTEXT="$TASK_TMP/auth-context"
mkdir "$AUTH_CONTEXT"
cp "$AUTH_DOCKERFILE" "$AUTH_CONTEXT/Dockerfile"
cp "$AUTH_DIR/pom.xml" "$AUTH_CONTEXT/"
cp -R "$AUTH_DIR/src" "$AUTH_CONTEXT/"
if find "$AUTH_CONTEXT" -type l -print -quit | grep -q .; then
  fail 'symlinks are refused in the temporary Auth build context'
fi
find "$AUTH_CONTEXT" -type d -exec chmod 755 {} +
find "$AUTH_CONTEXT" -type f -exec chmod 644 {} +
if ! docker build --label "$LABEL_KEY=$RUN_ID" --tag "$AUTH_IMAGE" \
  --build-arg "MAVEN_IMAGE=$MAVEN_IMAGE" \
  --build-arg "JRE_IMAGE=$JRE_IMAGE" "$AUTH_CONTEXT" \
  >"$TASK_TMP/auth-build.log" 2>&1; then
  tail -n 60 "$TASK_TMP/auth-build.log" >&2
  fail 'Auth image build failed'
fi
AUTH_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$AUTH_IMAGE")"
AUTH_IMAGE_CREATED=true
guard_image "$AUTH_IMAGE_ID"

STEP='build digest-pinned Company image from allow-listed source'
COMPANY_CONTEXT="$TASK_TMP/company-context"
mkdir "$COMPANY_CONTEXT"
cp "$COMPANY_DOCKERFILE" "$COMPANY_CONTEXT/Dockerfile"
cp "$SERVICE_DIR/package.json" "$SERVICE_DIR/nest-cli.json" \
  "$SERVICE_DIR/tsconfig.json" "$COMPANY_CONTEXT/"
cp -R "$SERVICE_DIR/prisma" "$SERVICE_DIR/src" "$COMPANY_CONTEXT/"
if find "$COMPANY_CONTEXT" -type l -print -quit | grep -q .; then
  fail 'symlinks are refused in the temporary Company build context'
fi
find "$COMPANY_CONTEXT" -type d -exec chmod 755 {} +
find "$COMPANY_CONTEXT" -type f -exec chmod 644 {} +
if ! docker build --label "$LABEL_KEY=$RUN_ID" --tag "$COMPANY_IMAGE" \
  --build-arg "NODE_IMAGE=$NODE_IMAGE" "$COMPANY_CONTEXT" \
  >"$TASK_TMP/company-build.log" 2>&1; then
  tail -n 60 "$TASK_TMP/company-build.log" >&2
  fail 'Company image build failed'
fi
COMPANY_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$COMPANY_IMAGE")"
COMPANY_IMAGE_CREATED=true
guard_image "$COMPANY_IMAGE_ID"

STEP='start real Auth with generated RSA, PostgreSQL and Redis'
AUTH_CONTAINER_ID="$(docker create --name "$AUTH_CONTAINER" \
  --network "$NETWORK" --network-alias "$AUTH_HOST" \
  --user "$HOST_UID:$HOST_GID" \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,uid=$HOST_UID,gid=$HOST_GID,mode=700,size=128m \
  --memory 1g --cpus 2 --pids-limit 512 \
  --cap-drop ALL --security-opt no-new-privileges \
  --label "$LABEL_KEY=$RUN_ID" \
  --mount "type=bind,src=$PRIVATE_KEY,dst=/run/keys/jwt-private.pem,readonly" \
  --mount "type=bind,src=$PUBLIC_KEY,dst=/run/keys/jwt-public.pem,readonly" \
  -e "DATABASE_URL=jdbc:postgresql://$PG_HOST:5432/$DB_NAME" \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD="$PG_PASSWORD" \
  -e "REDIS_URL=redis://:$REDIS_PASSWORD@$REDIS_HOST:6379/0" \
  -e "JWT_PRIVATE_KEY_PATH=/run/keys/jwt-private.pem" \
  -e "JWT_PUBLIC_KEY_PATH=/run/keys/jwt-public.pem" \
  -e "JWT_ISSUER=$INTEGRATION_JWT_ISSUER" -e "JWT_AUDIENCE=$INTEGRATION_JWT_AUDIENCE" \
  -e "OTP_HMAC_SECRET=$OTP_SECRET" -e "LOGIN_HMAC_SECRET=$LOGIN_SECRET" \
  -e "PASSWORD_RESET_HMAC_SECRET=$RESET_SECRET" \
  -e GOOGLE_OAUTH_ENABLED=false \
  -e MANAGEMENT_HEALTH_MAIL_ENABLED=false -e SERVER_PORT=8080 \
  "$AUTH_IMAGE_ID")"
[[ "$AUTH_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]] \
  || fail 'Docker did not return an exact Auth container ID'
AUTH_CONTAINER_CREATED=true
guard_container "$AUTH_CONTAINER_ID" "$AUTH_CONTAINER"
docker start "$AUTH_CONTAINER_ID" >/dev/null

STEP='start real migrated Company API bound to Auth'
COMPANY_CONTAINER_ID="$(docker create --name "$COMPANY_CONTAINER" \
  --network "$NETWORK" --network-alias "$COMPANY_HOST" \
  --user "$HOST_UID:$HOST_GID" \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,uid=$HOST_UID,gid=$HOST_GID,mode=700,size=128m \
  --memory 768m --cpus 2 --pids-limit 256 \
  --cap-drop ALL --security-opt no-new-privileges \
  --label "$LABEL_KEY=$RUN_ID" \
  -e NODE_ENV=production -e PORT=3000 \
  -e "DATABASE_URL=postgresql://postgres:$PG_PASSWORD@$PG_HOST:5432/$DB_NAME?schema=company" \
  -e "JWT_JWKS_URI=http://$AUTH_HOST:8080/auth/.well-known/jwks.json" \
  -e JWT_JWKS_CACHE_TTL_MS=3600000 \
  -e "JWT_ISSUER=$INTEGRATION_JWT_ISSUER" -e "JWT_AUDIENCE=$INTEGRATION_JWT_AUDIENCE" \
  -e "AUTH_SERVICE_URL=http://$AUTH_HOST:8080" \
  -e "AUTH_SERVICE_ALLOWED_HOSTS=$AUTH_HOST" \
  -e AUTH_REQUEST_TIMEOUT_MS=500 \
  -e MEDIA_SERVICE_URL=http://media-auth-integration.invalid:3000 \
  -e MEDIA_INTERNAL_API_KEY=auth-company-integration-media-key-20260829 \
  -e MEDIA_REQUEST_TIMEOUT_MS=500 \
  -e COMPANY_MEDIA_OPERATION_ENABLED=false \
  -e "COMPANY_PUBLIC_CURSOR_HMAC_KEY=$CURSOR_SECRET" \
  -e NPM_CONFIG_CACHE=/tmp/npm-cache "$COMPANY_IMAGE_ID")"
[[ "$COMPANY_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]] \
  || fail 'Docker did not return an exact Company container ID'
COMPANY_CONTAINER_CREATED=true
guard_container "$COMPANY_CONTAINER_ID" "$COMPANY_CONTAINER"
docker start "$COMPANY_CONTAINER_ID" >/dev/null

STEP='wait for real Auth and Company readiness without host ports'
run_phase ready
guard_db
[[ "$(scalar "SELECT (to_regclass('auth.users') IS NOT NULL)::integer::text || '|' || (to_regclass('auth.flyway_schema_history') IS NOT NULL)::integer::text || '|' || (to_regclass('company.companies') IS NOT NULL)::integer::text || '|' || (to_regclass('company.company_invitations') IS NOT NULL)::integer::text;")" == '1|1|1|1' ]] \
  || fail 'Auth Flyway or Company Prisma migrations are incomplete'

STEP='seed verified Auth recruiters after Flyway migration'
guard_db
docker exec -i "$PG_CONTAINER_ID" psql -X --no-psqlrc -U postgres \
  -d "$DB_NAME" -q -v ON_ERROR_STOP=1 >"$TASK_TMP/auth-seed.log" 2>&1 <<'SQL'
INSERT INTO auth.users
  (id, email, normalized_email, password_hash, role, is_verified,
   verified_at, is_locked, version, registration_id, registration_fence)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'owner.integration@example.test', 'owner.integration@example.test', '$2y$10$RHb50hS0gVrCXmfCJYbHZeCMbpDdbUbqvW1tFvLEmSocMLLmaj29C', 'RECRUITER', TRUE, CURRENT_TIMESTAMP - INTERVAL '1 minute', FALSE, 0, NULL, 0),
  ('10000000-0000-4000-8000-000000000002', 'thief.integration@example.test', 'thief.integration@example.test', '$2y$10$RHb50hS0gVrCXmfCJYbHZeCMbpDdbUbqvW1tFvLEmSocMLLmaj29C', 'RECRUITER', TRUE, CURRENT_TIMESTAMP - INTERVAL '1 minute', FALSE, 0, NULL, 0),
  ('10000000-0000-4000-8000-000000000003', 'intended.integration@example.test', 'intended.integration@example.test', '$2y$10$RHb50hS0gVrCXmfCJYbHZeCMbpDdbUbqvW1tFvLEmSocMLLmaj29C', 'RECRUITER', TRUE, CURRENT_TIMESTAMP - INTERVAL '1 minute', FALSE, 0, NULL, 0),
  ('10000000-0000-4000-8000-000000000004', 'locked.integration@example.test', 'locked.integration@example.test', '$2y$10$RHb50hS0gVrCXmfCJYbHZeCMbpDdbUbqvW1tFvLEmSocMLLmaj29C', 'RECRUITER', TRUE, CURRENT_TIMESTAMP - INTERVAL '1 minute', FALSE, 0, NULL, 0),
  ('10000000-0000-4000-8000-000000000005', 'deleted.integration@example.test', 'deleted.integration@example.test', '$2y$10$RHb50hS0gVrCXmfCJYbHZeCMbpDdbUbqvW1tFvLEmSocMLLmaj29C', 'RECRUITER', TRUE, CURRENT_TIMESTAMP - INTERVAL '1 minute', FALSE, 0, NULL, 0),
  ('10000000-0000-4000-8000-000000000006', 'role.integration@example.test', 'role.integration@example.test', '$2y$10$RHb50hS0gVrCXmfCJYbHZeCMbpDdbUbqvW1tFvLEmSocMLLmaj29C', 'RECRUITER', TRUE, CURRENT_TIMESTAMP - INTERVAL '1 minute', FALSE, 0, NULL, 0),
  ('10000000-0000-4000-8000-000000000007', 'email.integration@example.test', 'email.integration@example.test', '$2y$10$RHb50hS0gVrCXmfCJYbHZeCMbpDdbUbqvW1tFvLEmSocMLLmaj29C', 'RECRUITER', TRUE, CURRENT_TIMESTAMP - INTERVAL '1 minute', FALSE, 0, NULL, 0),
  ('10000000-0000-4000-8000-000000000008', 'outage.integration@example.test', 'outage.integration@example.test', '$2y$10$RHb50hS0gVrCXmfCJYbHZeCMbpDdbUbqvW1tFvLEmSocMLLmaj29C', 'RECRUITER', TRUE, CURRENT_TIMESTAMP - INTERVAL '1 minute', FALSE, 0, NULL, 0),
  ('10000000-0000-4000-8000-000000000009', 'race.integration@example.test', 'race.integration@example.test', '$2y$10$RHb50hS0gVrCXmfCJYbHZeCMbpDdbUbqvW1tFvLEmSocMLLmaj29C', 'RECRUITER', TRUE, CURRENT_TIMESTAMP - INTERVAL '1 minute', FALSE, 0, NULL, 0);
SQL
[[ "$(scalar "SELECT count(*)::text || '|' || count(*) FILTER (WHERE is_verified AND NOT is_locked AND role='RECRUITER')::text FROM auth.users;")" == '9|9' ]] \
  || fail 'Auth recruiter fixture is incomplete'

STEP='obtain real login JWTs and create Company invitations through APIs'
run_phase setup
[[ -f "$STATE_DIR/auth-company-state.json" \
  && "$(stat -c '%a' "$STATE_DIR/auth-company-state.json")" == 600 ]] \
  || fail 'runner state file is missing or has unsafe permissions'
find "$STATE_DIR" -type l -print -quit | grep -q . \
  && fail 'symlinks are refused in runner state'
[[ "$(scalar "SELECT (SELECT count(*) FROM company.companies)::text || '|' || (SELECT count(*) FROM company.company_members WHERE role='OWNER')::text || '|' || (SELECT count(*) FROM company.company_invitations WHERE status='PENDING')::text;")" == '1|1|7' ]] \
  || fail 'Company create/invite API fixture is incomplete'

STEP='prove a stolen invitation token cannot mutate Company state'
STOLEN_BEFORE="$(invitation_fingerprint intended.integration@example.test "$INTENDED_ID")"
run_phase stolen
STOLEN_AFTER="$(invitation_fingerprint intended.integration@example.test "$INTENDED_ID")"
[[ "$STOLEN_BEFORE" =~ ^[0-9a-f]{32}$ && "$STOLEN_AFTER" == "$STOLEN_BEFORE" ]] \
  || fail 'stolen-token rejection mutated invitation or membership state'

STEP='prove intended account acceptance and replay idempotence'
run_phase intended
[[ "$(scalar "SELECT i.status::text || '|' || coalesce(i.accepted_by::text,'') || '|' || (SELECT count(*)::text FROM company.company_members m WHERE m.user_id='$INTENDED_ID'::uuid AND m.company_id=i.company_id AND m.role='MEMBER') FROM company.company_invitations i WHERE i.normalized_email='intended.integration@example.test';")" == "ACCEPTED|$INTENDED_ID|1" ]] \
  || fail 'intended invitation acceptance did not converge exactly once'

STEP='mutate durable Auth identity state behind still-valid JWTs'
guard_db
docker exec -i "$PG_CONTAINER_ID" psql -X --no-psqlrc -U postgres \
  -d "$DB_NAME" -q -v ON_ERROR_STOP=1 >"$TASK_TMP/auth-durable-mutations.log" 2>&1 <<'SQL'
BEGIN;
UPDATE auth.users
SET is_locked=TRUE, locked_at=CURRENT_TIMESTAMP,
    locked_reason='integration durable lock', version=version+1,
    updated_at=CURRENT_TIMESTAMP
WHERE id='10000000-0000-4000-8000-000000000004';
DELETE FROM auth.refresh_sessions
WHERE user_id='10000000-0000-4000-8000-000000000005';
DELETE FROM auth.users
WHERE id='10000000-0000-4000-8000-000000000005';
UPDATE auth.users
SET role='CANDIDATE', version=version+1, updated_at=CURRENT_TIMESTAMP
WHERE id='10000000-0000-4000-8000-000000000006';
UPDATE auth.users
SET email='email.changed.integration@example.test',
    normalized_email='email.changed.integration@example.test',
    version=version+1, updated_at=CURRENT_TIMESTAMP
WHERE id='10000000-0000-4000-8000-000000000007';
COMMIT;
SQL
[[ "$(scalar "SELECT count(*)::text || '|' || count(*) FILTER (WHERE is_locked)::text || '|' || count(*) FILTER (WHERE role='CANDIDATE')::text || '|' || count(*) FILTER (WHERE normalized_email='email.changed.integration@example.test')::text FROM auth.users;")" == '8|1|1|1' ]] \
  || fail 'durable Auth mutation fixture is incomplete'

STEP='prove lock, deletion, role and email changes fail closed without writes'
DURABLE_BEFORE="$(durable_fingerprint)"
run_phase durable
DURABLE_AFTER="$(durable_fingerprint)"
[[ "$DURABLE_BEFORE" =~ ^[0-9a-f]{32}$ \
  && "$DURABLE_AFTER" == "$DURABLE_BEFORE" ]] \
  || fail 'durable Auth rejection mutated invitation or membership state'

STEP='prove concurrent accepts converge to one membership'
run_phase concurrency
[[ "$(scalar "SELECT i.status::text || '|' || coalesce(i.accepted_by::text,'') || '|' || (SELECT count(*)::text FROM company.company_members m WHERE m.user_id='$RACE_ID'::uuid AND m.company_id=i.company_id AND m.role='MEMBER') FROM company.company_invitations i WHERE i.normalized_email='race.integration@example.test';")" == "ACCEPTED|$RACE_ID|1" ]] \
  || fail 'concurrent invitation acceptance did not converge exactly once'

STEP='stop only sentinel-verified Auth and prove fail-closed outage behavior'
OUTAGE_BEFORE="$(invitation_fingerprint outage.integration@example.test "$OUTAGE_ID")"
guard_container "$AUTH_CONTAINER_ID" "$AUTH_CONTAINER"
docker stop --time 10 "$AUTH_CONTAINER_ID" >/dev/null
[[ "$(docker inspect --format '{{.State.Status}}' "$AUTH_CONTAINER_ID")" == exited ]] \
  || fail 'sentinel-verified Auth container did not stop'
run_phase outage
OUTAGE_AFTER="$(invitation_fingerprint outage.integration@example.test "$OUTAGE_ID")"
[[ "$OUTAGE_BEFORE" =~ ^[0-9a-f]{32}$ && "$OUTAGE_AFTER" == "$OUTAGE_BEFORE" ]] \
  || fail 'Auth outage rejection mutated invitation or membership state'

STEP='verify final cross-service persistence invariants'
FINAL_COUNTS="$(scalar "SELECT (SELECT count(*) FROM company.companies)::text || '|' || (SELECT count(*) FROM company.company_members)::text || '|' || (SELECT count(*) FROM company.company_invitations WHERE status='ACCEPTED')::text || '|' || (SELECT count(*) FROM company.company_invitations WHERE status='PENDING')::text;")"
[[ "$FINAL_COUNTS" == '1|3|2|5' ]] \
  || fail 'final Company counts violate the invitation binding invariants'
[[ "$(scalar "SELECT count(*)::text FROM company.company_members WHERE user_id IN ('$THIEF_ID'::uuid,'$LOCKED_ID'::uuid,'$DELETED_ID'::uuid,'$ROLE_ID'::uuid,'$EMAIL_ID'::uuid,'$OUTAGE_ID'::uuid);")" == 0 ]] \
  || fail 'a rejected Auth identity acquired a Company membership'

STEP='complete'
printf '{"harness":"auth-company-invitation","status":"PASS","images":{"postgresRef":"%s","postgresId":"%s","redisRef":"%s","redisId":"%s","authId":"%s","companyId":"%s"},"rsaPublicKeySha256":"%s","evidence":{"actualAuthLogins":9,"invitations":7,"stolenTokenNoMutation":true,"intendedIdempotent":true,"durableIdentityFailures":4,"concurrencyAttempts":8,"authOutageNoMutation":true,"finalCounts":"%s"}}\n' \
  "$PG_IMAGE" "$PG_IMAGE_ID" "$REDIS_IMAGE" "$REDIS_IMAGE_ID" \
  "$AUTH_IMAGE_ID" "$COMPANY_IMAGE_ID" "$PUBLIC_KEY_SHA256" "$FINAL_COUNTS"
say 'PASS: real login JWTs, email binding, durable Auth state, idempotence, concurrency and Auth outage'
