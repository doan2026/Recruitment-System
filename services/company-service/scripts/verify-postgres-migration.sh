#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

DEFAULT_PG_IMAGE='postgres@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685'
BASELINE_ONE='20260822000000_company_profile'
BASELINE_TWO='20260824000000_company_members'
MEDIA_MIGRATION='20260828000000_company_media_ownership'
AUDIT_MIGRATION='20260829000000_company_audit_log'
PUBLIC_SEARCH_MIGRATION='20260829100000_company_public_search'
SENTINEL_PREFIX='recruitment-company-migration-harness:'
STEP='preflight'
TASK_TMP=''
RUN_ID=''
NETWORK=''
NETWORK_ID=''
NETWORK_CREATED=false
PG_CONTAINER=''
PG_CONTAINER_ID=''
PG_CONTAINER_CREATED=false
PG_HOST=''
VERIFY_IMAGE=''
VERIFY_IMAGE_ID=''
VERIFY_IMAGE_CREATED=false
VERIFY_CONTAINER=''
VERIFY_CONTAINER_ID=''
VERIFY_CONTAINER_CREATED=false
TASK_TMP_CREATED=false

say() { printf '[company-migration] %s\n' "$1"; }
fail() { printf '[company-migration] ERROR: %s\n' "$1" >&2; exit 1; }

cleanup() {
  local code=$? value=''
  set +e
  if [[ "$VERIFY_CONTAINER_CREATED" == true \
    && "$VERIFY_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]]; then
    value="$(docker inspect --format \
      '{{.Id}}|{{.Name}}|{{index .Config.Labels "io.recruitment.company-migration-harness"}}' \
      "$VERIFY_CONTAINER_ID" 2>/dev/null)"
    [[ "$value" == "$VERIFY_CONTAINER_ID|/$VERIFY_CONTAINER|$RUN_ID" ]] \
      && docker rm --force "$VERIFY_CONTAINER_ID" >/dev/null 2>&1
  fi
  if [[ "$PG_CONTAINER_CREATED" == true \
    && "$PG_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]]; then
    value="$(docker inspect --format \
      '{{.Id}}|{{.Name}}|{{index .Config.Labels "io.recruitment.company-migration-harness"}}' \
      "$PG_CONTAINER_ID" 2>/dev/null)"
    [[ "$value" == "$PG_CONTAINER_ID|/$PG_CONTAINER|$RUN_ID" ]] \
      && docker rm --force "$PG_CONTAINER_ID" >/dev/null 2>&1
  fi
  if [[ "$NETWORK_CREATED" == true && "$NETWORK_ID" =~ ^[0-9a-f]{64}$ ]]; then
    value="$(docker network inspect --format \
      '{{.Id}}|{{.Name}}|{{index .Labels "io.recruitment.company-migration-harness"}}' \
      "$NETWORK_ID" 2>/dev/null)"
    [[ "$value" == "$NETWORK_ID|$NETWORK|$RUN_ID" ]] \
      && docker network rm "$NETWORK_ID" >/dev/null 2>&1
  fi
  if [[ "$VERIFY_IMAGE_CREATED" == true \
    && "$VERIFY_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    value="$(docker image inspect --format \
      '{{.Id}}|{{index .Config.Labels "io.recruitment.company-migration-harness"}}' \
      "$VERIFY_IMAGE_ID" 2>/dev/null)"
    [[ "$value" == "$VERIFY_IMAGE_ID|$RUN_ID" ]] \
      && docker image rm "$VERIFY_IMAGE_ID" >/dev/null 2>&1
  fi
  [[ "$TASK_TMP_CREATED" != true \
    || -z "$TASK_TMP" \
    || "$TASK_TMP" != /tmp/company-service-migration-verify.* ]] \
    || rm -rf -- "$TASK_TMP"
  (( code == 0 )) || printf '[company-migration] FAILED during: %s\n' "$STEP" >&2
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

(( $# == 0 )) || fail 'no database target arguments are accepted'
for variable in DATABASE_URL PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGPASSWORD \
  PGPASSFILE PGSERVICE PGSERVICEFILE; do
  [[ -z ${!variable+x} ]] || fail "unset $variable; external database targets are refused"
done
for variable in DOCKER_HOST DOCKER_TLS_VERIFY DOCKER_CERT_PATH; do
  [[ -z ${!variable+x} ]] || fail "unset $variable; only the active local Unix Docker context is allowed"
done
for command_name in awk chmod cp date docker find grep mkdir mktemp od rm \
  sha256sum sleep sort stat tail tr truncate; do
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is required"
done
DOCKER_ENDPOINT="$(docker context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null)"
[[ "$DOCKER_ENDPOINT" == unix://* ]] || fail 'the active Docker context is not a local Unix socket'
docker info >/dev/null 2>&1 || fail 'the local Docker daemon is unavailable'

PG_IMAGE="${COMPANY_MIGRATION_VERIFY_POSTGRES_IMAGE:-$DEFAULT_PG_IMAGE}"
[[ "$PG_IMAGE" =~ ^[A-Za-z0-9][A-Za-z0-9._/@:-]*$ ]] || fail 'invalid PostgreSQL image reference'
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
SERVICE_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
MIGRATIONS="$SERVICE_DIR/prisma/migrations"
for path in "$SCRIPT_DIR/migration-verify.Dockerfile" \
  "$SCRIPT_DIR/migration-verification-fixture.psql" \
  "$SCRIPT_DIR/migration-verification-assert-upgraded.psql" \
  "$SCRIPT_DIR/migration-verification-audit-log.psql" \
  "$SCRIPT_DIR/migration-verification-old-schema-smoke.psql" \
  "$SERVICE_DIR/prisma/schema.prisma" \
  "$MIGRATIONS/$BASELINE_ONE/migration.sql" \
  "$MIGRATIONS/$BASELINE_TWO/migration.sql" \
  "$MIGRATIONS/$MEDIA_MIGRATION/migration.sql" \
  "$MIGRATIONS/$AUDIT_MIGRATION/migration.sql" \
  "$MIGRATIONS/$PUBLIC_SEARCH_MIGRATION/migration.sql"; do
  [[ -f "$path" ]] || fail "required input is missing: $path"
done
mapfile -t ALL_MIGRATIONS < <(
  find "$MIGRATIONS" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | LC_ALL=C sort
)
(( ${#ALL_MIGRATIONS[@]} >= 5 )) || fail 'at least five Company migrations are required'
[[ ${ALL_MIGRATIONS[0]} == "$BASELINE_ONE" \
  && ${ALL_MIGRATIONS[1]} == "$BASELINE_TWO" \
  && ${ALL_MIGRATIONS[2]} == "$MEDIA_MIGRATION" \
  && ${ALL_MIGRATIONS[3]} == "$AUDIT_MIGRATION" \
  && ${ALL_MIGRATIONS[4]} == "$PUBLIC_SEARCH_MIGRATION" ]] \
  || fail 'the expected first-five migration order changed'
for migration in "${ALL_MIGRATIONS[@]}"; do
  [[ "$migration" =~ ^[0-9]{14}_[a-z0-9_]+$ \
    && -f "$MIGRATIONS/$migration/migration.sql" ]] \
    || fail 'unsafe or incomplete migration directory found'
done

RUN_ID="$(date -u +%Y%m%d%H%M%S)-$$-$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
[[ "$RUN_ID" =~ ^[0-9a-f-]+$ ]] || fail 'could not generate a safe run identifier'
TASK_TMP="$(mktemp -d "/tmp/company-service-migration-verify.$RUN_ID.XXXXXX")"
TASK_TMP_CREATED=true
chmod 700 "$TASK_TMP"
NETWORK="company-migration-network-$RUN_ID"
PG_CONTAINER="company-migration-postgres-$RUN_ID"
PG_HOST="company-pg-$RUN_ID"
VERIFY_IMAGE="company-migration-verifier:$RUN_ID"
VERIFY_CONTAINER="company-migration-verifier-run-$RUN_ID"
SOURCE_DB='company_upgrade_source'
PRE_RESTORE_DB='company_pre_restore'
UPGRADED_RESTORE_DB='company_upgraded_restore'
CORRUPT_RESTORE_DB='company_corrupt_restore'

valid_db() {
  case "$1" in
    postgres|"$SOURCE_DB"|"$PRE_RESTORE_DB"|"$UPGRADED_RESTORE_DB"|"$CORRUPT_RESTORE_DB") ;;
    *) fail 'database name is outside the disposable allow-list' ;;
  esac
}

valid_restore_db() {
  case "$1" in
    "$PRE_RESTORE_DB"|"$UPGRADED_RESTORE_DB") ;;
    *) fail 'database is outside the restore-target allow-list' ;;
  esac
}

guard_network() {
  local value
  value="$(docker network inspect --format \
    '{{.Id}}|{{.Name}}|{{.Internal}}|{{index .Labels "io.recruitment.company-migration-harness"}}' \
    "$NETWORK_ID" 2>/dev/null)"
  [[ "$NETWORK_CREATED" == true \
    && "$value" == "$NETWORK_ID|$NETWORK|true|$RUN_ID" ]] \
    || fail 'Docker network sentinel mismatch'
}

guard_container() {
  local value
  value="$(docker inspect --format \
    '{{.Id}}|{{.Name}}|{{index .Config.Labels "io.recruitment.company-migration-harness"}}|{{.HostConfig.NetworkMode}}' \
    "$PG_CONTAINER_ID" 2>/dev/null)"
  [[ "$PG_CONTAINER_CREATED" == true \
    && "$value" == "$PG_CONTAINER_ID|/$PG_CONTAINER|$RUN_ID|$NETWORK" ]] \
    || fail 'PostgreSQL container sentinel mismatch'
  [[ -z "$(docker port "$PG_CONTAINER_ID" 2>/dev/null)" ]] \
    || fail 'the disposable PostgreSQL container published a port'
  guard_network
}

raw_scalar() {
  valid_db "$1"
  docker exec "$PG_CONTAINER_ID" psql -X --no-psqlrc -U postgres -d "$1" \
    -qAt -v ON_ERROR_STOP=1 -c "$2"
}

guard_db() {
  local value name major sentinel
  valid_db "$1"
  guard_container
  value="$(raw_scalar "$1" \
    "SELECT current_database() || '|' || (current_setting('server_version_num')::integer / 10000)::text || '|' || coalesce(shobj_description(oid, 'pg_database'), '') FROM pg_database WHERE datname=current_database();")"
  IFS='|' read -r name major sentinel <<< "$value"
  [[ "$name" == "$1" && "$major" == 16 \
    && "$sentinel" == "$SENTINEL_PREFIX$RUN_ID" ]] \
    || fail 'database name/version/sentinel guard mismatch'
}

scalar() { guard_db "$1"; raw_scalar "$1" "$2"; }

sql_in() {
  local db=$1 log_file=$2
  guard_db "$db"
  docker exec -i "$PG_CONTAINER_ID" psql -X --no-psqlrc -U postgres -d "$db" \
    -q -v ON_ERROR_STOP=1 >"$log_file" 2>&1
}

sql_file() {
  local db=$1 input=$2 log_file=$3
  guard_db "$db"
  docker exec -i "$PG_CONTAINER_ID" psql -X --no-psqlrc -U postgres -d "$db" \
    -q -v ON_ERROR_STOP=1 >"$log_file" 2>&1 <"$input"
}

create_db() {
  local db=$1
  valid_db "$db"
  [[ "$db" != postgres ]] || fail 'refused to replace the maintenance database'
  guard_container
  docker exec "$PG_CONTAINER_ID" createdb -U postgres --maintenance-db=postgres \
    --template=template0 --encoding=UTF8 "$db" >"$TASK_TMP/create-$db.log" 2>&1
  docker exec -i "$PG_CONTAINER_ID" psql -X --no-psqlrc -U postgres -d postgres \
    -q -v ON_ERROR_STOP=1 >"$TASK_TMP/sentinel-$db.log" 2>&1 <<SQL
COMMENT ON DATABASE "$db" IS '$SENTINEL_PREFIX$RUN_ID';
SQL
  guard_db "$db"
}

db_url() {
  valid_db "$1"
  printf 'postgresql://postgres@%s:5432/%s?schema=company' "$PG_HOST" "$1"
}

prisma() {
  local db=$1 log_file=$2 status=0 value
  shift 2
  guard_db "$db"
  VERIFY_CONTAINER_ID="$(docker create --name "$VERIFY_CONTAINER" \
    --network "$NETWORK" --read-only \
    --tmpfs /tmp:rw,noexec,nosuid,size=64m --cap-drop ALL \
    --security-opt no-new-privileges \
    --label "io.recruitment.company-migration-harness=$RUN_ID" \
    -e "DATABASE_URL=$(db_url "$db")" "$VERIFY_IMAGE" \
    /verify/node_modules/.bin/prisma "$@" \
    2>"$TASK_TMP/create-verifier.log")"
  [[ "$VERIFY_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]] \
    || fail 'Docker did not return an exact verifier container ID'
  VERIFY_CONTAINER_CREATED=true
  docker start --attach "$VERIFY_CONTAINER_ID" >"$log_file" 2>&1 \
    || status=$?
  value="$(docker inspect --format \
    '{{.Id}}|{{.Name}}|{{index .Config.Labels "io.recruitment.company-migration-harness"}}' \
    "$VERIFY_CONTAINER_ID" 2>/dev/null)"
  [[ "$value" == "$VERIFY_CONTAINER_ID|/$VERIFY_CONTAINER|$RUN_ID" ]] \
    || fail 'verifier container sentinel mismatch'
  docker rm "$VERIFY_CONTAINER_ID" >/dev/null
  VERIFY_CONTAINER_CREATED=false
  VERIFY_CONTAINER_ID=''
  return "$status"
}

pending_status() {
  local log_file="$TASK_TMP/pending-$1.log"
  if prisma "$1" "$log_file" migrate status --schema /verify/prisma/schema.prisma; then
    fail 'pre-upgrade Prisma status unexpectedly reported current'
  fi
  grep -Fq "$MEDIA_MIGRATION" "$log_file" \
    || fail 'pending status did not name the media migration'
  grep -Fq "$AUDIT_MIGRATION" "$log_file" \
    || fail 'pending status did not name the audit migration'
  grep -Fq "$PUBLIC_SEARCH_MIGRATION" "$log_file" \
    || fail 'pending status did not name the public search migration'
}

current_status() {
  prisma "$1" "$TASK_TMP/current-$1.log" migrate status \
    --schema /verify/prisma/schema.prisma
}

no_drift() {
  prisma "$1" "$TASK_TMP/drift-$1.log" migrate diff \
    --from-url "$(db_url "$1")" \
    --to-schema-datamodel /verify/prisma/schema.prisma --exit-code
}

ledger() {
  local db=$1
  shift
  local expected=("$@") count=${#@} summary migration expected_hash actual_hash
  summary="$(scalar "$db" \
    "SELECT count(*)::text || '|' || (count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL))::text || '|' || (count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL))::text FROM company.\"_prisma_migrations\";")"
  [[ "$summary" == "$count|$count|0" ]] || fail 'migration ledger state/count mismatch'
  for migration in "${expected[@]}"; do
    expected_hash="$(sha256sum "$MIGRATIONS/$migration/migration.sql" | awk '{print $1}')"
    actual_hash="$(scalar "$db" \
      "SELECT checksum FROM company.\"_prisma_migrations\" WHERE migration_name='$migration' AND finished_at IS NOT NULL AND rolled_back_at IS NULL;")"
    [[ "$actual_hash" == "$expected_hash" ]] \
      || fail "migration checksum mismatch: $migration"
  done
}

ledger_fingerprint() {
  scalar "$1" \
    "SELECT md5(coalesce(string_agg(migration_name || '|' || checksum || '|' || started_at::text || '|' || coalesce(finished_at::text,'') || '|' || applied_steps_count::text, E'\\n' ORDER BY migration_name),'')) FROM company.\"_prisma_migrations\";"
}

counts() {
  scalar "$1" \
    "SELECT (SELECT count(*) FROM company.companies)::text || '|' || (SELECT count(*) FROM company.company_members)::text || '|' || (SELECT count(*) FROM company.company_media)::text || '|' || (SELECT count(*) FROM company.company_invitations)::text;"
}

data_fingerprint() {
  scalar "$1" "WITH r AS (
    SELECT 'c' k, concat_ws('|',id::text,name,normalized_name,slug,description,industry,size,address,coalesce(website,'<null>'),tax_code,coalesce(logo_file_id::text,'<null>'),coalesce(logo_url,'<null>'),verified_status::text,coalesce(reject_reason,'<null>'),created_at::text,updated_at::text) v FROM company.companies
    UNION ALL SELECT 'm',concat_ws('|',id::text,company_id::text,user_id::text,role::text,joined_at::text) FROM company.company_members
    UNION ALL SELECT 'a',concat_ws('|',id::text,company_id::text,file_id::text,url,type::text,sort_order::text,created_at::text) FROM company.company_media
    UNION ALL SELECT 'i',concat_ws('|',id::text,company_id::text,email,normalized_email,status::text,token_hash,invited_by::text,coalesce(accepted_by::text,'<null>'),expires_at::text,coalesce(accepted_at::text,'<null>'),created_at::text,updated_at::text) FROM company.company_invitations)
    SELECT md5(coalesce(string_agg(k || ':' || v,E'\\n' ORDER BY k,v),'')) FROM r;"
}

catalog_fingerprint() {
  scalar "$1" "WITH r AS (
    SELECT 'col' k,table_name||'|'||column_name||'|'||data_type||'|'||udt_name||'|'||is_nullable||'|'||coalesce(column_default,'') v FROM information_schema.columns WHERE table_schema='company'
    UNION ALL SELECT 'con',c.relname||'|'||con.conname||'|'||con.contype::text||'|'||pg_get_constraintdef(con.oid,true) FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='company'
    UNION ALL SELECT 'idx',tablename||'|'||indexname||'|'||indexdef FROM pg_indexes WHERE schemaname='company'
    UNION ALL SELECT 'enum',t.typname||'|'||e.enumsortorder::text||'|'||e.enumlabel FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname='company'
    UNION ALL SELECT 'trg',c.relname||'|'||tg.tgname||'|'||pg_get_triggerdef(tg.oid,true) FROM pg_trigger tg JOIN pg_class c ON c.oid=tg.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='company' AND NOT tg.tgisinternal
    UNION ALL SELECT 'fn',p.proname||'|'||pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='company')
    SELECT md5(coalesce(string_agg(k||':'||v,E'\\n' ORDER BY k,v),'')) FROM r;"
}

fixture_ok() {
  [[ "$(counts "$1")" == '2|3|2|1' ]] || fail 'fixture row counts changed'
  [[ "$(data_fingerprint "$1")" == "$2" ]] || fail 'fixture checksum changed'
}

pre_schema_ok() {
  local value
  value="$(scalar "$1" \
    "SELECT (EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='company' AND table_name='companies' AND column_name='aggregate_version'))::integer::text || '|' || (EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='company' AND table_name='company_media' AND column_name='media_reference_id'))::integer::text || '|' || (to_regclass('company.company_media_operations') IS NOT NULL)::integer::text || '|' || (to_regclass('company.company_media_upload_intents') IS NOT NULL)::integer::text || '|' || (to_regclass('company.company_audit_logs') IS NOT NULL)::integer::text || '|' || (to_regtype('company.\"CompanyAuditAction\"') IS NOT NULL)::integer::text || '|' || (to_regprocedure('company.reject_company_audit_log_mutation()') IS NOT NULL)::integer::text || '|' || (to_regprocedure('company.fold_public_company_search(text)') IS NOT NULL)::integer::text || '|' || (to_regclass('company.companies_public_verified_normalized_name_id_idx') IS NOT NULL)::integer::text || '|' || (to_regclass('company.companies_public_verified_search_tsv_idx') IS NOT NULL)::integer::text;")"
  [[ "$value" == '0|0|0|0|0|0|0|0|0|0' ]] || fail 'pre-upgrade schema contains upgraded objects'
}

constraint_failures_ok() {
  local db=$1 log_file="$TASK_TMP/constraint-negative-$1.log"
  if sql_in "$db" "$log_file" <<'SQL'
BEGIN;
UPDATE company.companies SET logo_media_reference_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' WHERE id='11111111-1111-4111-8111-111111111111';
UPDATE company.companies SET logo_media_reference_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' WHERE id='22222222-2222-4222-8222-222222222222';
COMMIT;
SQL
  then fail 'duplicate logo reference unexpectedly succeeded'; fi
  if sql_in "$db" "$log_file" <<'SQL'
BEGIN;
UPDATE company.company_media SET media_reference_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' WHERE id='44444444-4444-4444-8444-444444444441';
UPDATE company.company_media SET media_reference_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' WHERE id='44444444-4444-4444-8444-444444444442';
COMMIT;
SQL
  then fail 'duplicate gallery reference unexpectedly succeeded'; fi
  if sql_in "$db" "$log_file" <<'SQL'
INSERT INTO company.company_media_upload_intents (file_id,company_id,requested_by,asset_type,expires_at,cleanup_at,updated_at)
VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','dddddddd-dddd-4ddd-8ddd-dddddddddddd','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','COMPANY_IMAGE',now()+interval '1 hour',now()+interval '2 hours',now());
SQL
  then fail 'orphan upload intent unexpectedly succeeded'; fi
}

archive() {
  local db=$1 file=$2 size
  guard_db "$db"
  : >"$file"
  chmod 600 "$file"
  docker exec "$PG_CONTAINER_ID" pg_dump -U postgres -d "$db" --format=custom \
    --schema=company --no-owner --no-privileges \
    >"$file" 2>"$TASK_TMP/dump-$db.log"
  [[ "$(stat -c '%a' "$file")" == 600 ]] || fail 'archive mode is not 0600'
  size="$(stat -c '%s' "$file")"
  (( size >= 1024 && size <= 67108864 )) \
    || fail 'archive size is outside the verifier safety bounds'
  docker exec -i "$PG_CONTAINER_ID" pg_restore --list \
    >"$TASK_TMP/list-$db.log" 2>&1 <"$file"
}

verify_archive() {
  local file=$1 expected_sha=$2 label=$3 size actual_sha
  [[ -f "$file" && ! -L "$file" ]] || fail "$label archive is not a regular file"
  [[ "$(stat -c '%a' "$file")" == 600 ]] || fail "$label archive mode is not 0600"
  size="$(stat -c '%s' "$file")"
  (( size >= 1024 && size <= 67108864 )) \
    || fail "$label archive size is outside the verifier safety bounds"
  actual_sha="$(sha256sum "$file" | awk '{print $1}')"
  [[ "$actual_sha" == "$expected_sha" ]] || fail "$label archive SHA-256 mismatch"
  guard_container
  docker exec -i "$PG_CONTAINER_ID" pg_restore --list \
    >"$TASK_TMP/list-before-restore-$label.log" 2>&1 <"$file"
}

restore_archive() {
  local db=$1 file=$2 expected_sha=$3 log_file=$4 target_state
  valid_restore_db "$db"
  [[ "$db" != "$SOURCE_DB" ]] || fail 'source and restore target must differ'
  verify_archive "$file" "$expected_sha" "$db"
  guard_db "$db"
  target_state="$(scalar "$db" \
    "SELECT (to_regnamespace('company') IS NULL)::integer::text || '|' || count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast';")"
  [[ "$target_state" == '1|0' ]] || fail 'restore target is not a new empty database'
  docker exec -i "$PG_CONTAINER_ID" pg_restore -U postgres -d "$db" \
    --exit-on-error --single-transaction --no-owner --no-privileges \
    >"$log_file" 2>&1 <"$file"
}

STEP='build verifier image'
say 'Building isolated Prisma 5.22 verifier image'
if ! docker image inspect "$PG_IMAGE" >/dev/null 2>&1; then
  docker pull "$PG_IMAGE" >"$TASK_TMP/postgres-pull.log" 2>&1
fi
docker image inspect "$VERIFY_IMAGE" >/dev/null 2>&1 \
  && fail 'generated verifier tag already exists'
VERIFY_CONTEXT="$TASK_TMP/build-context"
mkdir -m 700 "$VERIFY_CONTEXT"
[[ -z "$(find "$SERVICE_DIR/prisma" -type l -print -quit)" ]] \
  || fail 'Prisma build inputs must not contain symbolic links'
cp -R "$SERVICE_DIR/prisma" "$VERIFY_CONTEXT/prisma"
chmod -R u=rwX,go=rX "$VERIFY_CONTEXT/prisma"
docker build --file "$SCRIPT_DIR/migration-verify.Dockerfile" \
  --label "io.recruitment.company-migration-harness=$RUN_ID" \
  --tag "$VERIFY_IMAGE" "$VERIFY_CONTEXT" >"$TASK_TMP/build.log" 2>&1
VERIFY_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$VERIFY_IMAGE")"
[[ "$VERIFY_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]] \
  || fail 'Docker did not return an exact verifier image ID'
VERIFY_IMAGE_CREATED=true

STEP='start disposable PostgreSQL 16'
say 'Starting internal disposable PostgreSQL 16 (no published port)'
NETWORK_ID="$(docker network create --internal \
  --label "io.recruitment.company-migration-harness=$RUN_ID" \
  "$NETWORK" 2>"$TASK_TMP/network.log")"
[[ "$NETWORK_ID" =~ ^[0-9a-f]{64}$ ]] \
  || fail 'Docker did not return an exact network ID'
NETWORK_CREATED=true
guard_network
PG_CONTAINER_ID="$(docker create --name "$PG_CONTAINER" --network "$NETWORK" \
  --network-alias "$PG_HOST" \
  --label "io.recruitment.company-migration-harness=$RUN_ID" \
  --tmpfs /var/lib/postgresql/data:rw,noexec,nosuid,size=512m \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  -e POSTGRES_INITDB_ARGS='--auth-host=trust --auth-local=trust' \
  "$PG_IMAGE" 2>"$TASK_TMP/postgres-create.log")"
[[ "$PG_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]] \
  || fail 'Docker did not return an exact PostgreSQL container ID'
PG_CONTAINER_CREATED=true
docker start "$PG_CONTAINER_ID" >"$TASK_TMP/postgres-start.log"
for attempt in {1..60}; do
  docker exec "$PG_CONTAINER_ID" pg_isready -U postgres -d postgres >/dev/null 2>&1 && break
  (( attempt < 60 )) || fail 'PostgreSQL did not become ready'
  sleep 1
done
guard_container
[[ "$(raw_scalar postgres \
  "SELECT current_setting('server_version_num')::integer/10000;")" == 16 ]] \
  || fail 'configured image is not PostgreSQL major 16'
docker exec -i "$PG_CONTAINER_ID" psql -X --no-psqlrc -U postgres -d postgres \
  -q -v ON_ERROR_STOP=1 >"$TASK_TMP/maintenance-sentinel.log" 2>&1 <<SQL
COMMENT ON DATABASE postgres IS '$SENTINEL_PREFIX$RUN_ID';
SQL
guard_db postgres

STEP='create first-two-migration baseline'
say 'Creating pre-media database from exactly the first two migrations'
create_db "$SOURCE_DB"
if ! prisma "$SOURCE_DB" "$TASK_TMP/deploy-baseline.log" migrate deploy \
  --schema /verify/baseline/schema.prisma; then
  tail -n 20 "$TASK_TMP/deploy-baseline.log" >&2
  fail 'baseline Prisma deployment failed'
fi
sql_file "$SOURCE_DB" "$SCRIPT_DIR/migration-verification-fixture.psql" "$TASK_TMP/fixture.log"
pre_schema_ok "$SOURCE_DB"
ledger "$SOURCE_DB" "$BASELINE_ONE" "$BASELINE_TWO"
pending_status "$SOURCE_DB"
BASELINE_HASH="$(data_fingerprint "$SOURCE_DB")"
PRE_LEDGER_HASH="$(ledger_fingerprint "$SOURCE_DB")"
[[ "$(counts "$SOURCE_DB")" == '2|3|2|1' ]] || fail 'baseline counts mismatch'
say "Baseline counts companies=2 members=3 media=2 invitations=1 checksum=$BASELINE_HASH"

STEP='pre-upgrade archive'
PRE_ARCHIVE="$TASK_TMP/company-pre-upgrade.backup"
archive "$SOURCE_DB" "$PRE_ARCHIVE"
PRE_SHA="$(sha256sum "$PRE_ARCHIVE" | awk '{print $1}')"
say "Pre-upgrade custom archive mode=0600 list=valid sha256=$PRE_SHA"

STEP='upgrade and second deploy'
say 'Deploying pending migrations, then verifying status and drift'
prisma "$SOURCE_DB" "$TASK_TMP/deploy-first.log" migrate deploy \
  --schema /verify/prisma/schema.prisma
current_status "$SOURCE_DB"
ledger "$SOURCE_DB" "${ALL_MIGRATIONS[@]}"
no_drift "$SOURCE_DB"
sql_file "$SOURCE_DB" "$SCRIPT_DIR/migration-verification-assert-upgraded.psql" \
  "$TASK_TMP/assert-upgraded.log"
sql_file "$SOURCE_DB" "$SCRIPT_DIR/migration-verification-audit-log.psql" \
  "$TASK_TMP/audit-log-invariants.log"
fixture_ok "$SOURCE_DB" "$BASELINE_HASH"
constraint_failures_ok "$SOURCE_DB"
CATALOG_HASH="$(catalog_fingerprint "$SOURCE_DB")"
LEDGER_HASH="$(ledger_fingerprint "$SOURCE_DB")"
say 'Deploying the same migrations a second time (idempotency)'
prisma "$SOURCE_DB" "$TASK_TMP/deploy-second.log" migrate deploy \
  --schema /verify/prisma/schema.prisma
current_status "$SOURCE_DB"
no_drift "$SOURCE_DB"
ledger "$SOURCE_DB" "${ALL_MIGRATIONS[@]}"
[[ "$(catalog_fingerprint "$SOURCE_DB")" == "$CATALOG_HASH" ]] \
  || fail 'second deploy changed catalog'
[[ "$(ledger_fingerprint "$SOURCE_DB")" == "$LEDGER_HASH" ]] \
  || fail 'second deploy changed migration ledger'
fixture_ok "$SOURCE_DB" "$BASELINE_HASH"
say "Upgrade current, drift=none, catalog=$CATALOG_HASH"

STEP='upgraded archive'
UPGRADED_ARCHIVE="$TASK_TMP/company-upgraded.backup"
archive "$SOURCE_DB" "$UPGRADED_ARCHIVE"
UPGRADED_SHA="$(sha256sum "$UPGRADED_ARCHIVE" | awk '{print $1}')"
say "Upgraded custom archive mode=0600 list=valid sha256=$UPGRADED_SHA"

STEP='restore pre-upgrade rollback candidate'
say 'Restoring pre-upgrade archive into a distinct rollback-candidate database'
create_db "$PRE_RESTORE_DB"
restore_archive "$PRE_RESTORE_DB" "$PRE_ARCHIVE" "$PRE_SHA" \
  "$TASK_TMP/pre-restore.log"
pre_schema_ok "$PRE_RESTORE_DB"
ledger "$PRE_RESTORE_DB" "$BASELINE_ONE" "$BASELINE_TWO"
[[ "$(ledger_fingerprint "$PRE_RESTORE_DB")" == "$PRE_LEDGER_HASH" ]] \
  || fail 'restored pre-upgrade migration ledger mismatch'
pending_status "$PRE_RESTORE_DB"
fixture_ok "$PRE_RESTORE_DB" "$BASELINE_HASH"
sql_file "$PRE_RESTORE_DB" \
  "$SCRIPT_DIR/migration-verification-old-schema-smoke.psql" \
  "$TASK_TMP/old-schema-smoke.log"
fixture_ok "$PRE_RESTORE_DB" "$BASELINE_HASH"
say 'Rollback candidate has two migrations and passes old-schema DB read/write'

STEP='restore upgraded archive'
say 'Restoring upgraded archive into another distinct database'
create_db "$UPGRADED_RESTORE_DB"
restore_archive "$UPGRADED_RESTORE_DB" "$UPGRADED_ARCHIVE" \
  "$UPGRADED_SHA" "$TASK_TMP/upgraded-restore.log"
current_status "$UPGRADED_RESTORE_DB"
no_drift "$UPGRADED_RESTORE_DB"
ledger "$UPGRADED_RESTORE_DB" "${ALL_MIGRATIONS[@]}"
sql_file "$UPGRADED_RESTORE_DB" \
  "$SCRIPT_DIR/migration-verification-assert-upgraded.psql" \
  "$TASK_TMP/assert-upgraded-restore.log"
sql_file "$UPGRADED_RESTORE_DB" \
  "$SCRIPT_DIR/migration-verification-audit-log.psql" \
  "$TASK_TMP/audit-log-invariants-restore.log"
fixture_ok "$UPGRADED_RESTORE_DB" "$BASELINE_HASH"
[[ "$(catalog_fingerprint "$UPGRADED_RESTORE_DB")" == "$CATALOG_HASH" ]] \
  || fail 'restored upgraded catalog mismatch'
[[ "$(ledger_fingerprint "$UPGRADED_RESTORE_DB")" == "$LEDGER_HASH" ]] \
  || fail 'restored upgraded migration ledger mismatch'
say 'Upgraded restore migration/data/audit/constraints/catalog/drift checks PASS'

STEP='corrupted archive negative test'
say 'Proving a corrupted custom archive is rejected before restore'
CORRUPT_ARCHIVE="$TASK_TMP/company-corrupt.backup"
cp --preserve=mode "$UPGRADED_ARCHIVE" "$CORRUPT_ARCHIVE"
truncate --size=64 "$CORRUPT_ARCHIVE"
[[ "$(stat -c '%a' "$CORRUPT_ARCHIVE")" == 600 ]] \
  || fail 'corrupt archive mode changed'
guard_container
if docker exec -i "$PG_CONTAINER_ID" pg_restore --list \
  >"$TASK_TMP/corrupt-list.log" 2>&1 <"$CORRUPT_ARCHIVE"; then
  fail 'pg_restore list accepted a corrupted archive'
fi
[[ "$(raw_scalar postgres "SELECT count(*) FROM pg_database WHERE datname='$CORRUPT_RESTORE_DB';")" == 0 ]] \
  || fail 'corrupt-archive target unexpectedly exists'
say 'Corrupted archive was rejected before any restore target was created'

STEP='complete'
say 'PASS: PostgreSQL 16 migration/audit/backup/restore/rollback gate completed'
