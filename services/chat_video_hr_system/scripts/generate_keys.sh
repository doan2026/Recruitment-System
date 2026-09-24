#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECRETS_DIR="$DIR/secrets"
mkdir -p "$SECRETS_DIR"

if [ -f "$SECRETS_DIR/jwt_private_key.pem" ] && [ -f "$SECRETS_DIR/jwt_public_key.pem" ]; then
    echo "Keys already exist in secrets/ directory."
    exit 0
fi

if command -v openssl >/dev/null 2>&1; then
    echo "Generating RSA key pair using openssl..."
    openssl genpkey -algorithm RSA -out "$SECRETS_DIR/jwt_private_key.pem" -pkeyopt rsa_keygen_bits:2048
    openssl rsa -pubout -in "$SECRETS_DIR/jwt_private_key.pem" -out "$SECRETS_DIR/jwt_public_key.pem"
elif command -v node >/dev/null 2>&1; then
    node "$DIR/scripts/generate_keys.js"
else
    echo "Neither openssl nor node found."
    exit 1
fi
