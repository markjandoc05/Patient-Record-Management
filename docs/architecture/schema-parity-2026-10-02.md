# Vine schema parity — factual read-only baseline

Observed 2026-10-02 17:59:16 Philippine time. Classification refined by user instruction:
**EXPECTED PENDING RELEASE GAP — local 004, production 002; no unexplained drift found**.
The catalog snapshots remain unchanged; this classification update is not a new inspection.

Local: `vine_development`, localhost loopback port 55439, PostgreSQL 17.11.
Production: `vine`, Vine System production PostgreSQL on the Hostinger/Dokploy VPS, PostgreSQL 17.11.
Both catalog snapshots reported `transaction_read_only=on`, used repeatable-read transactions and ended with ROLLBACK. No application rows were inspected.

## Applied history and checksums

| Committed migration | Local | Production | SHA-256 |
| --- | --- | --- | --- |
| 001_platform.sql | Applied; matches | Applied; matches | `67e8a46d4714a66514feee5f75152c1c884d37635766f687a9225be6c3a3af53` |
| 002_session_integrity.sql | Applied; matches | Applied; matches | `8eefa5f8bb13f1f83a6611b22ae380788ed2b12d8d58f74c75b721e12da628d2` |
| 003_services.sql | Applied; matches | Missing | `7c1f6534769aa22b6a7bb2a0db99c22acb0c77dafb210c83b24f237493aca77c` |
| 004_services_name_identity.sql | Applied; matches | Missing | `8d7c187555c848c0a615492ca58ed1e874f84ed17e57fec737dcc431ae3fc83c` |

All four source files match HEAD. Every stored checksum matches its committed file. No unexpected migration entry. Local records show 001 → 002 → 003 → 004 in increasing applied_at order. Production records contain 001 and 002 with identical applied_at timestamps, so their exact chronological application order cannot independently be resolved from the ledger. Sorting that tie by name is display order, not independent ordering evidence. Full ledger timestamps are in the sanitized evidence.

## Structural comparison

Compared every non-system schema (public is the only one) for tables/relation kind, columns/order/formatted PostgreSQL types/nullability/defaults/identity/generated/collation, primary/foreign/unique/check constraints and validation/deferral, and index definitions/uniqueness/validity/readiness. Also compared functions, triggers, RLS policies, views, sequences, enums and extensions. Database owners, login users, secrets, data rows and row counts were not compared. This is a structural audit, not a behavioral query/write test or an exhaustive privilege/configuration audit.

| Metadata | Local | Production | Difference |
| --- | ---: | ---: | --- |
| schemas | 1 | 1 | MATCH |
| tables | 8 | 5 | 3 local-only definitions |
| columns | 51 | 21 | 30 local-only definitions |
| constraints | 26 | 8 | 18 local-only definitions |
| indexes | 21 | 13 | 8 local-only definitions |
| functions | 1 | 0 | 1 local-only definitions |
| triggers | 0 | 0 | MATCH |
| policies | 0 | 0 | MATCH |
| views | 0 | 0 | MATCH |
| sequences | 0 | 0 | MATCH |
| enums | 0 | 0 | MATCH |
| extensions | 1 | 1 | MATCH |

The five shared tables are identical in all compared structural properties: `app_records`, `auth_identities`, `auth_sessions`, `oauth_attempts`, `schema_migrations`. There are no differing definitions or production-only objects within the inspected scope.

## Exact differences and classification

- **EXPECTED PENDING RELEASE GAP:** production has not deployed Services 1A or committed migrations 003 and 004. Local-only Services objects are accounted for by those migrations. This is acceptable version lag on one immutable chain, not unexplained schema drift.
- **EXPECTED ENVIRONMENT DIFFERENCE:** database identifiers and migration application timestamps differ. These are not structural drift. Different records/accounts/credentials were neither inspected nor compared.
- **UNKNOWN / REQUIRES REVIEW:** production ledger timestamps tie for 001/002; independent application order is unavailable. No unexplained structural object difference found. Production upgrade/workflow acceptance has not been performed by this audit.

Production is missing these three tables entirely, including their 30 columns, type/nullability/default definitions, 18 constraints and eight indexes:

- `public.service_categories`
- `public.services`
- `public.service_branch_settings`

It also lacks `public.services_normalized_name(value text)`, the immutable/strict/parallel-safe function introduced by 004. Exact column/default/constraint/index/function definitions are included in [sanitized machine-readable evidence](schema-parity-2026-10-02.evidence.json).

Important behavior structures:

| Structure | Local | Production |
| --- | --- | --- |
| Category/service normalized-name unique indexes using services_normalized_name(name) | Present; valid and ready | Absent |
| Category/service normalized nonblank checks | Present; validated | Absent |
| Composite branch FK (branch_collection_path, branch_id) → app_records(collection_path, id), ON DELETE RESTRICT | Present; validated | Absent |
| UNIQUE(service_id, branch_id) | Present; validated | Absent |
| Service/category FKs and checks | Present; validated | Absent |
| auth_sessions_identity_fk → auth_identities(user_id), ON DELETE CASCADE | MATCH | MATCH |
| Session/OAuth expiry indexes, identity/session PKs and identity user uniqueness | MATCH | MATCH |
| schema_migrations columns, defaults and primary key | MATCH | MATCH |

Local reproduces the deployed platform/auth baseline and represents the target schema
of the application under development. Production represents the deployed version's
schema. Their applied versions differ acceptably by the pending Services release;
one common immutable chain exists and no unexplained structural divergence was found.

## Existing validation evidence (not rerun)

The [Services release evidence](../releases/2026-10-02-services-1a.md) documents Node 22/PostgreSQL 17 disposable validation, including the 143-check forward-migration/checksum/preflight/rollback suite. Its current test implementation covers fresh 001–004 initialization, checksummed rerun, synthetic 003→004 upgrade with display values and legacy JSONB preserved, and collision/blank-name rejection with transactional rollback. This is historical synthetic evidence, not a new run or production-record compatibility proof. No fresh database or upgrade was executed in this audit. A fresh read-only comparison alone cannot prove every historical record works with a new application.

## Recommended correction and recovery

No new migration is necessary to resolve the observed version gap. In a separately authorized Services release, review backup/recovery and current deployed application compatibility, verify production still matches this baseline, apply the exact missing committed 003 and 004 files in order, deploy compatible reviewed code, then verify health/workflow and repeat parity inspection. Do not copy local schema or data, alter old migrations or manufacture a new migration to duplicate the missing ones.

For future unexplained manual drift, audit its origin and use a reviewed numbered forward correction with preserved records. Existing migration checksum mismatches must not be papered over by editing migration files or ledger entries.

This audit requires no rollback because neither database was modified. For the future Services deployment, retain new tables/records during code rollback; assess recovery separately if 004 preflight finds name collisions. Do not drop tables or restore old database contents automatically.

## Standing 11-item report (refined rule)

1. Schema change required: **NO for this audit**.
2. Committed migration chain: **001 → 002 → 003 → 004**.
3. Local applied migration: **004**, directly observed; Services objects present/valid.
4. Production applied migration: **002**, directly observed; Services 1A not yet deployed.
5. New migrations: **NONE**.
6. Fresh-database validation: existing documented synthetic 001–004 checks passed; not rerun here.
7. Upgrade-path validation: existing documented synthetic 003→004 checks passed; production catch-up not tested here.
8. Existing-record compatibility: shared platform/auth structures match; prior synthetic legacy-JSONB preservation passed. Production record contents were not inspected.
9. Production catch-up migrations required: **003 → 004**, only in an authorized compatible Services release.
10. Recovery/rollback: none for this documentation update; future release needs reviewed backup/code compatibility and data-preserving recovery.
11. Unexplained schema divergence: **NONE FOUND** in the inspected structures. Different applied versions are an **expected pending release gap** on one immutable history.

## Development decision and limits

The factual baseline is established and can guide continued local feature development, provided the pending production migration gap remains explicit. It is not a verified-parity or production deployment approval. New schema-changing work must use the next reviewed forward migration after 004, validate fresh/upgrade paths and account for production catch-up; do not depend on Services tables being deployed today. Unrelated low-risk work need not be blocked by this version gap.

Changed documentation only: this report, its sanitized JSON evidence, the standing architecture document verification note and DEVELOPMENT.md parity note. No source/configuration/production data changes; no migrations, commit, push or deployment.
