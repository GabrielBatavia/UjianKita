# Deployment Guide (Supabase & Vercel)

This document explains how to deploy **UjianKita** with **Supabase** (PostgreSQL + Auth) and **Vercel** (Next.js App Router).

---

## 1. Hosting & Plan Eligibility Warning

> **Important — Vercel Plan Notice:**
> Vercel Hobby may be used only for eligible development, personal testing, and non-commercial evaluation. **Do not assume Vercel Hobby is authorized or sized for operating an official production school examination service.** Prior to operating real school examinations (~100 simultaneous students), evaluate Vercel Pro (or equivalent commercial hosting) alongside Supabase Pro (for automated Point-in-Time Recovery, daily backups, and compute sizing).

> **Preview vs Production Environment Isolation:**
> Never configure `SUPABASE_SERVICE_ROLE_KEY` in untrusted wildcard preview branches. Restrict sensitive Preview environment variables to trusted integration branches (e.g., `--git-branch feat/phase-6-cloud-integration`), and configure Production environment variables explicitly for `https://ujiankita-three.vercel.app` (or your school's custom domain).

---

## 2. Supabase Setup

1. **Create or select a dedicated Supabase project** (separate projects are recommended for staging/preview vs. production).
2. **Apply all SQL migrations (`000001`–`000011`)** in order (for local Docker workflows see [`docs/LOCAL_SUPABASE_SETUP.md`](LOCAL_SUPABASE_SETUP.md)):
   - Using Supabase CLI:
     ```bash
     supabase link --project-ref <your-project-ref>
     supabase db push --remote
     ```
   - Or via the Supabase SQL Editor, execute `supabase/migrations/20261112000001_phase1_foundation_schema.sql` through `supabase/migrations/20261112000011_phase6_distributed_rate_limiting.sql` sequentially.
   - **Important:** Never run `supabase db reset --linked` or push `supabase/seed.sql` to a live production project. Also avoid pushing the full local `supabase/config.toml` blindly if remote PostgreSQL major versions differ (local `15` vs hosted `17`); apply targeted Auth settings instead.
3. **Configure Authentication settings** in Supabase Dashboard (`Authentication -> URL Configuration` and `Providers -> Email`):
   - Disable open self-signups (`Enable Sign-ups = OFF` / `enable_signup = false`) so accounts are created strictly by school administrators.
   - Add your canonical production URL (`https://ujiankita-three.vercel.app/auth/callback`, `/reset-password`), trusted preview callback URLs, and optional local dev callback URLs to **Redirect URLs**.
   - Set **Site URL** to your primary deployment URL (e.g., `https://ujiankita-three.vercel.app`).
4. **Provision Initial School & First Admin**:
   - Use `supabase/seed.sql` only in non-production local/staging environments to seed `SMAN1-SIMULASI`, academic year `2026/2027`, and sample subjects.
   - In Production, create the school record + first Administrator user cleanly, link `user_profiles` and `user_roles` (`admin`), and immediately verify `/api/health` returns `status: "healthy"` with HTTP `200`.

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
