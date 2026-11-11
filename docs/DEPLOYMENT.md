# Deployment Guide (Supabase & Vercel)

This document explains how to deploy **UjianKita** with **Supabase** (PostgreSQL + Auth) and **Vercel** (Next.js App Router).

---

## 1. Hosting & Plan Eligibility Warning

> **Important — Vercel Plan Notice:**
> Vercel Hobby may be used only for eligible development, personal testing, and non-commercial evaluation. **Do not assume Vercel Hobby is authorized or sized for operating an official production school examination service.** Prior to operating real school examinations (~100 simultaneous students), evaluate Vercel Pro (or equivalent commercial hosting) alongside Supabase Pro (for automated Point-in-Time Recovery, daily backups, and compute sizing).

> **Phase 1 Readiness Notice:**
> A publicly deployed Phase 1 instance provides foundation authentication and academic administration only. **Do not represent a Phase 1 deployment as ready for official school examinations.**

---

## 2. Supabase Setup

1. **Create or select a dedicated Supabase project** (separate projects are recommended for staging/preview vs. production).
2. **Apply Phase 1 SQL migrations** in order:
   - Using Supabase CLI:
     ```bash
     npx supabase link --project-ref <your-project-ref>
     npx supabase db push
     ```
   - Or via the Supabase SQL Editor, execute:
     1. `supabase/migrations/20261112000001_phase1_foundation_schema.sql`
     2. `supabase/migrations/20261112000002_phase1_rls_and_functions.sql`
     3. `supabase/migrations/20261112000003_phase1_5_hardening.sql`
3. **Configure Authentication settings** in Supabase Dashboard (`Authentication -> URL Configuration` and `Providers -> Email`):
   - Disable open self-signups (`Enable Sign-ups = OFF`).
   - Add your Vercel preview/production URLs and `http://localhost:3000/auth/callback` to **Redirect URLs**.
   - Set **Site URL** to your primary deployment URL (e.g., `https://ujian-kita.vercel.app`).
4. **Provision Initial Synthetic/Seed School & First Admin** (for staging/dev):
   - Run `supabase/seed.sql` only in non-production environments to seed `SMAN1-SIMULASI`, academic year `2026/2027`, and sample subjects.
   - Create the first Administrator user in Supabase Authentication (`Users -> Add User`), then link their `user_profiles` row and `user_roles` (`admin`) row to the school ID.
   - Never use real student personal records in development or preview environments.

---

## 3. Vercel Setup

1. **Create / link project `UjianKita`** connected to GitHub repository `GabrielBatavia/UjianKita`:
   - Framework Preset: `Next.js`
   - Root Directory: `.` (repository root)
   - Production Branch: `main`
   - Automatic Preview Deployments on pull requests enabled.
2. **Configure Environment Variables** per environment (`Preview` and `Production` separated):

| Variable | Environment Scope | Notes |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | Production / Preview | Canonical HTTPS origin (e.g. `https://ujian-kita.vercel.app`) |
| `NEXT_PUBLIC_SUPABASE_URL` | Production / Preview | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production / Preview | Supabase public anon/publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Production / Preview (**Encrypted, Server-Only**) | Required for Admin creation of teacher/student accounts; never expose to browser |

3. **Verify Deployment**:
   - Visit `GET /api/health` on the deployed URL and verify:
     - `status: "healthy"` (when Supabase env vars and migrations are applied)
     - `supabase.configured: true`
     - `supabase.reachable: true`
   - Visit `/login` and confirm unauthenticated requests to `/admin`, `/teacher`, and `/student` redirect cleanly to `/login`.

---

## 4. Portability Note

UjianKita avoids Vercel-only proprietary runtime APIs (`next/server` standard APIs and `src/proxy.ts` run on standard Node.js runtime). The application can be deployed to any Node.js container host (e.g., Docker, Fly.io, Railway, self-hosted school VM) by running `npm run build && npm run start` with the same environment variables.
