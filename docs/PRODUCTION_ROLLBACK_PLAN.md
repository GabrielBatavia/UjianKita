# Production Rollback & Emergency Incident Plan

This document outlines the standard operating procedures (SOP) for rolling back the **UjianKita** production environment in the event of an unforeseen outage or application defect.

---

## 1. Rollback Matrix & Decision Principles

| Problem Scenario | Scope of Action | Rollback Action | Estimated Time |
|---|---|---|---|
| **Defective Frontend/API Code** (runtime JS exception, routing bug, UI break) | Application only | Promote previous verified Vercel deployment ID via Vercel CLI / Dashboard. **Do not modify database.** | < 2 minutes |
| **Faulty Environment Variables** (incorrect URL or expired keys) | Configuration | Update or delete affected environment variables via `vercel env` and trigger a redeployment. | < 3 minutes |
| **Database Connection Failure** (Supabase pause or network partition) | Infrastructure | Check Supabase status on `hqoxqmmkysnnneqlepuj`, ensure project is not paused. **Never roll back to `amgfceevbpcyyphnpaeh`.** | 5–10 minutes |
| **Critical Data Integrity Issue** | Database / App | Freeze exam windows immediately via Admin panel or set school `is_active = false`. Assess transaction logs. | Immediate freeze |

> **Critical Safety Rule:** Never revert to the previous Supabase project (`amgfceevbpcyyphnpaeh`). That project was an unmigrated, Tokyo-based legacy database that cannot serve UjianKita schema migrations `000001`–`000011`.

---

## 2. Instant Application Rollback (Fast-Path)

If an application regression is introduced on `main`:

### Option A: Promote Verified Stable Deployment via CLI
The deployment ID immediately prior to Phase 6.5 was `dpl_FFzFqNHAjbfBri29whryeXc4GFes` (note that it lacks Phase 6 rate limiting and requires the Tokyo project).
To roll back to the Phase 6 Preview candidate instead:
```bash
vercel alias set dpl_6UNZ7dJ6a72QrHuVqjn2gb85Rnhw ujiankita-three.vercel.app
```
`dpl_6UNZ7dJ6a72QrHuVqjn2gb85Rnhw` is the verified Phase 6 release commit (`cc5a8e6`) running against `hqoxqmmkysnnneqlepuj`.

### Option B: Git Revert and Redepoy
```bash
git checkout main
git revert -m 1 7be77ff
git push origin main
```
This triggers an automated Vercel Production build.

---

## 3. Database Schema Safeguards

1. **Applied Migrations Are Forward-Compatible:** All 11 migrations (`20261112000001`–`20261112000011`) maintain backwards compatibility with existing application routes.
2. **Never Run `supabase db reset --remote`:** Remote database resets will wipe all school configurations and active student exam sessions.
3. **Trigger Immutability:** Triggers `prevent_audit_event_mutation()` and `prevent_immutable_snapshot_mutation()` prevent manual tampering with audit logs or published examination versions.

---

## 4. Emergency Secret Compromise SOP

If `SUPABASE_SERVICE_ROLE_KEY` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` is suspected exposed:
1. Log in to Supabase Dashboard for `hqoxqmmkysnnneqlepuj` (`Project Settings -> API`).
2. Roll the `service_role` and `anon` keys.
3. Update Vercel Production environment variables immediately:
   ```bash
   vercel env rm SUPABASE_SERVICE_ROLE_KEY production --yes
   echo "<NEW_SERVICE_ROLE_KEY>" | vercel env add SUPABASE_SERVICE_ROLE_KEY production --sensitive --yes
   ```
4. Trigger a new production deployment to refresh serverless lambda container environments:
   ```bash
   vercel deploy --prod
   ```
5. Confirm `GET /api/health` returns `HTTP 200` and `supabase.reachable: true`.
