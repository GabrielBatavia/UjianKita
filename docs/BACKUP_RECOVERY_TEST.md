# Backup & Disaster Recovery Verification (`pg_dump` / `pg_restore`)

Phase 5 executed a real backup and isolated database restore drill inside the local Docker Supabase PostgreSQL container (`supabase_db_ujiankita`, `postgres:15.19.0.018`) to verify schema portability, extension restoration, RLS policy preservation, trigger/function continuity, and byte-level data integrity.

---

## 1. Execution Procedure

1. **Backup Creation (`pg_dump`):**
   ```bash
   pg_dump -Fc --schema=public --schema=auth --no-owner --no-privileges -U postgres -d postgres -f /tmp/ujiankita_p5_backup.dump
   ```
   - **Artifact Size:** `631,978 bytes`
   - **Duration:** `488 ms`

2. **Isolated Restore Target Preparation:**
   - Created fresh isolated database `ujiankita_restore_verify` from `TEMPLATE template0` (`ENCODING 'UTF8'`).
   - Pre-created the `extensions` schema with `pgcrypto` and `"uuid-ossp"` and dropped the default `public` schema inside `ujiankita_restore_verify` before restore so `pg_restore --exit-on-error` could recreate `public` cleanly without `schema "public" already exists` collisions.

3. **Full Restore (`pg_restore`):**
   ```bash
   pg_restore --no-owner --no-privileges --exit-on-error -U postgres -d ujiankita_restore_verify /tmp/ujiankita_p5_backup.dump
   ```
   - **Exit Code:** `0`
   - **Duration:** `3,251 ms`

---

## 2. Schema & Data Checksum Parity Results

Comparing live `postgres` against restored `ujiankita_restore_verify`:

| Verification Metric | Source (`postgres`) | Restored (`ujiankita_restore_verify`) | Parity Status |
|---|---|---|---|
| Public Tables | `48` | `48` | Exact Match |
| Public RLS Policies | `100` | `100` | Exact Match |
| Public Functions / RPCs | `52` | `52` | Exact Match |
| Public Foreign-Key Constraints | `158` | `158` | Exact Match |
| `student_answers` Row Count | `26` | `26` | Exact Match |
| `exam_grades` MD5 Digest | `2f7efe3553ab1711fea8856388e62649` | `2f7efe3553ab1711fea8856388e62649` | Exact Match |
| `submission_receipts` MD5 Digest | `68e29910f043289ca347dcf11fce7d46` | `68e29910f043289ca347dcf11fce7d46` | Exact Match |
| `attempt_events` MD5 Digest | `dea22faef74100e5bcce47decec25cef` | `dea22faef74100e5bcce47decec25cef` | Exact Match |
| `audit_events` MD5 Digest | `6667c236ed2c5ace17c3384a4e6489ae` | `6667c236ed2c5ace17c3384a4e6489ae` | Exact Match |

---

## 3. Cleanup & Operational Caveats

- Following verification, `ujiankita_restore_verify` was dropped and `/tmp/ujiankita_p5_backup.dump` was deleted from the container.
- This local drill validates logical dump/restore integrity of UjianKita's `public` and `auth` objects; before live school launch, managed Supabase Pro **Point-in-Time Recovery (PITR)** and automated off-host backups must be enabled and tested on the cloud Supabase project.
