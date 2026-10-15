---
name: media-service
description: Implement or review file upload, confirmation, private delivery, references and cleanup in the Recruitment System NestJS Media Service.
---

# Media Service

Use this skill for changes under `services/media-service`. Media owns canonical file metadata and is the only service that may hold Cloudinary API credentials. Other services exchange `fileId` references; they do not own provider metadata or file URLs.

## Working rules

- Read the Media README, policy/configuration, Prisma schema/migrations, tests and `docs/architecture.md` before changing file behavior. The policy table and current API contract are the source of truth for permitted type, role, size, delivery mode and ownership.
- Keep provider credentials inside Media configuration. Never put real credentials in source, skill files, logs, command output, fixtures or committed environment files. A placeholder is not a live integration credential.
- Follow the existing NestJS module, validation, error and response patterns. Keep Media-specific changes in this service and its owned schema; coordinate contract changes in documentation for consuming services without editing their business code unless requested.

## File safety invariants

- Treat browser-supplied metadata and URLs as untrusted. Generate a short-lived signed upload intent, then confirm by reading canonical metadata from Cloudinary; validate owner, media type, folder, resource/delivery mode, format, size, timestamps and provider identity.
- Preserve per-type policy, role authorization, intent limits/idempotency and private-by-default delivery. Generate private download URLs only after authorization, with the established short TTL. Never persist a private delivery URL as the canonical file identity.
- Preserve reference binding/release checks and service-specific internal API keys. A valid `fileId` alone does not grant access to a file.
- Preserve aggregate version/fencing, cleanup leases, cycle election/heartbeat, bounded provider calls, retry cooldown/backoff, append-only cleanup audit and reconciliation behavior. Do not add an unbounded synchronous provider loop or bypass a fence during recovery.
- Do not store file contents, signed URLs, API secrets, or malformed provider payloads in events or audit rows.

## Verification

- Run `npm run test:unit` for policy, validation and lifecycle changes. Run `npm run test:integration` for PostgreSQL, migrations, concurrency, references and cleanup behavior when dependencies are available.
- `npm run test:cloudinary:live` requires a real configured Cloudinary account and its signed presets. Run it only when the user requests live verification and the required credentials are already intentionally configured; never substitute placeholders.
- Validate Prisma migrations and keep the Media README/API contracts aligned with policy changes.