#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

say() { printf '[auth-company-guard-tests] %s\n' "$1"; }
fail() { printf '[auth-company-guard-tests] ERROR: %s\n' "$1" >&2; exit 1; }

(( $# == 0 )) || fail 'no positional arguments are accepted'
for command_name in bash env grep mktemp node rm sed; do
  command -v "$command_name" >/dev/null 2>&1 \
    || fail "$command_name is required"
done

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
HARNESS="$SCRIPT_DIR/verify-auth-company-invitation.sh"
RUNNER="$SCRIPT_DIR/auth-company-invitation-runner.js"
COMPANY_DOCKERFILE="$SCRIPT_DIR/auth-company-integration.Company.Dockerfile"
AUTH_DOCKERFILE="$SCRIPT_DIR/auth-company-integration.Auth.Dockerfile"
for path in "$HARNESS" "$RUNNER" "$COMPANY_DOCKERFILE" "$AUTH_DOCKERFILE"; do
  [[ -f "$path" ]] || fail "required integration input is missing: $path"
done

TASK_TMP="$(mktemp -d /tmp/auth-company-guard-tests.XXXXXX)"
cleanup() {
  local code=$?
  [[ "$TASK_TMP" == /tmp/auth-company-guard-tests.* ]] \
    && rm -rf -- "$TASK_TMP"
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

run_rejection() {
  local name=$1 expected=$2
  shift 2
  if "$@" >"$TASK_TMP/$name.log" 2>&1; then
    fail "$name unexpectedly passed"
  fi
  grep -Fq "$expected" "$TASK_TMP/$name.log" \
    || { sed -n '1,20p' "$TASK_TMP/$name.log" >&2; fail "$name returned the wrong guard error"; }
}

bash -n "$HARNESS" || fail 'the shell harness does not parse'
node --check "$RUNNER" >/dev/null || fail 'the Node runner does not parse'

run_rejection positional \
  'no URL, database target or positional argument is accepted' \
  env -i PATH="$PATH" bash "$HARNESS" unexpected
run_rejection opt_in \
  'explicit opt-in is required' \
  env -i PATH="$PATH" bash "$HARNESS"
run_rejection database_target \
  'unset DATABASE_URL; external service and database targets are refused' \
  env -i PATH="$PATH" \
    COMPANY_AUTH_INTEGRATION_CONFIRM=run-disposable-auth-company-integration \
    DATABASE_URL=postgresql://outside.invalid/database bash "$HARNESS"
run_rejection docker_target \
  'unset DOCKER_HOST; only the active local Unix Docker context is allowed' \
  env -i PATH="$PATH" \
    COMPANY_AUTH_INTEGRATION_CONFIRM=run-disposable-auth-company-integration \
    DOCKER_HOST=tcp://outside.invalid:2375 bash "$HARNESS"
run_rejection mutable_image \
  'COMPANY_AUTH_INTEGRATION_REDIS_IMAGE must be an immutable image@sha256 reference' \
  env -i PATH="$PATH" \
    COMPANY_AUTH_INTEGRATION_CONFIRM=run-disposable-auth-company-integration \
    COMPANY_AUTH_INTEGRATION_REDIS_IMAGE=redis:7-alpine bash "$HARNESS"
run_rejection timeout_bound \
  'COMPANY_AUTH_INTEGRATION_OVERALL_TIMEOUT_SECONDS must be 600..3600' \
  env -i PATH="$PATH" \
    COMPANY_AUTH_INTEGRATION_CONFIRM=run-disposable-auth-company-integration \
    COMPANY_AUTH_INTEGRATION_OVERALL_TIMEOUT_SECONDS=599 bash "$HARNESS"

grep -Fq 'docker network create --internal' "$HARNESS" \
  || fail 'the integration network is not statically internal-only'
if grep -Eq '(^|[[:space:]])(-p|--publish)([=[:space:]]|$)' "$HARNESS"; then
  fail 'the harness contains a host-port publication option'
fi
[[ "$(grep -Ec "^DEFAULT_[A-Z_]+_IMAGE='[^']+@sha256:[0-9a-f]{64}'$" "$HARNESS")" == 5 ]] \
  || fail 'the harness does not define five digest-pinned default images'
grep -Fq 'DB_SENTINEL_PREFIX=' "$HARNESS" \
  || fail 'the database sentinel guard is missing'
grep -Fq 'io.recruitment.company-auth-integration' "$HARNESS" \
  || fail 'the Docker ownership label guard is missing'
grep -Fq "FROM \${NODE_IMAGE}" "$COMPANY_DOCKERFILE" \
  || fail 'the Company integration build does not consume its pinned base argument'
grep -Fq "FROM \${MAVEN_IMAGE}" "$AUTH_DOCKERFILE" \
  || fail 'the Auth integration build does not consume its pinned Maven argument'
grep -Fq "FROM \${JRE_IMAGE}" "$AUTH_DOCKERFILE" \
  || fail 'the Auth integration build does not consume its pinned JRE argument'

for evidence in INVITATION_EMAIL_MISMATCH AUTH_ACCOUNT_INACTIVE \
  AUTH_ACCOUNT_INVALID INVITATION_ACCEPTANCE_FORBIDDEN \
  AUTH_SERVICE_UNAVAILABLE COMPANY_MEMBER_CONFLICT; do
  grep -Fq "$evidence" "$RUNNER" \
    || fail "the API runner is missing evidence assertion: $evidence"
done

say 'PASS: syntax, opt-in, target refusal, digest pins, bounds, isolation and evidence guards'
