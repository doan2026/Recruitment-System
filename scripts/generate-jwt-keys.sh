#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_root=$(dirname -- "$script_dir")
secrets_dir=${1:-"$project_root/secrets"}
private_key="$secrets_dir/jwt-private.pem"
public_key="$secrets_dir/jwt-public.pem"

if [ -e "$private_key" ] || [ -e "$public_key" ]; then
  printf '%s\n' "Refusing to overwrite an existing JWT key in $secrets_dir" >&2
  exit 1
fi

command -v openssl >/dev/null 2>&1 || {
  printf '%s\n' 'OpenSSL is required to generate JWT keys.' >&2
  exit 1
}

umask 077
mkdir -p "$secrets_dir"
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out "$private_key"
openssl pkey -in "$private_key" -pubout -out "$public_key"
chmod 600 "$private_key" "$public_key"

printf '%s\n' "Generated $private_key"
printf '%s\n' "Generated $public_key"
