# Phase 6.5 Production Cutover & Environment Switch Log

This document records the exact steps, environment mutations, and verification results executed during the controlled Phase 6.5 Production cutover of **UjianKita**.

---

## 1. Cutover Overview

| Parameter | State Prior to Phase 6.5 | Final Deployed State (Phase 6.5) |
|---|---|---|
| **Canonical Domain** | `https://ujiankita-three.vercel.app` (degraded `phase-1`) | `https://ujiankita-three.vercel.app` (**`HTTP 200 healthy`, `phase-6`**) |
| **Active Supabase Target** | `amgfceevbpcyyphnpaeh` (unmigrated, Tokyo) | **`hqoxqmmkysnnneqlepuj`** (PostgreSQL 17.11, Mumbai) |
| **Vercel Serverless Region** | `iad1` (Washington D.C., US East) | **`bom1` (Mumbai, India)** — co-located with DB |
| **GitHub Branch & Commit** | `main` at `dd1ba1d` | `main` at **`7be77ff`** (Merge commit of PR #7) |
| **Vercel Deployment ID** | `dpl_FFzFqNHAjbfBri29whryeXc4GFes` | **`dpl_52niSJDEXy7RVBJiJgyCVo2sQTKu`** (`READY`) |
| **Measured Warm Health Latency** | N/A (degraded `503` / `error`) | **`216–269 ms` (p50: `269 ms`, mean: `246–392 ms`)** |

---

## 2. Production Environment Variable Reconciliation

All 15 stale Marketplace integration variables pointing to `amgfceevbpcyyphnpaeh` (`POSTGRES_*`, `SUPABASE_JWT_SECRET`, stale `NEXT_PUBLIC_SUPABASE_*`) were deleted from Vercel Production.

The active Production configuration was replaced with the following 4 variables:

| Variable Name | Environment Scope | Sensitivity | Effective Value Target |
|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | Production | Plain (`--no-sensitive`) | `https://ujiankita-three.vercel.app` |
| `NEXT_PUBLIC_SUPABASE_URL` | Production | Plain (`--no-sensitive`) | `https://hqoxqmmkysnnneqlepuj.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production | Plain (`--no-sensitive`) | Valid JWT anon key for `hqoxqmmkysnnneqlepuj` |
| `SUPABASE_SERVICE_ROLE_KEY` | Production | **Sensitive (`--sensitive`)** | Privileged server-only key for `hqoxqmmkysnnneqlepuj` |

> Zero BOM (`\uFEFF`) or trailing whitespace: verified with `node` string inspect (`firstChar` = 104 `'h'` for URLs, 101 `'e'` for JWT tokens).

---

## 3. Serverless Execution Region Optimization (`bom1`)

1. Updated Vercel Project configuration via API: `PATCH /v9/projects/prj_4vtJMVrKdO0ggXelrEsUnPrMPP5R` with `{"resourceConfig":{"functionDefaultRegions":["bom1"]}}`.
2. Verified deployment builds:
   - Build output shows: `λ index (2.65MB) [bom1]`, `λ _global-error (2.65MB) [bom1]`.
   - Response header `x-vercel-id`: `hkg1::bom1::m7cd8-...`.
3. Latency comparison:
   - Preview in default `iad1`: `822–1194 ms` mean response time.
   - Production in `bom1`: **`246–392 ms`** mean response time (**~3.5x faster**).

---

## 4. Supabase Auth Configuration on `hqoxqmmkysnnneqlepuj`

Pushed targeted configuration via `supabase config push`:
- `auth.enable_signup = false` (Blocks open registration; accounts provisioned strictly by authorized staff).
- `auth.site_url = "https://ujiankita-three.vercel.app"`.
- `auth.additional_redirect_urls` strictly allow:
  - `https://ujiankita-three.vercel.app/auth/callback`
  - `https://ujiankita-three.vercel.app/reset-password`
  - `https://ujiankita-*-gabrielbatavia7-2132s-projects.vercel.app/auth/callback`
  - `https://ujiankita-*-gabrielbatavia7-2132s-projects.vercel.app/reset-password`
  - Localhost ports `3000` and `3100` callbacks.

---

## 5. Rollback Coordinates

In the event of an emergency requiring reversion, the prior metadata coordinates are:
- Prior commit: `dd1ba1d` (`git checkout dd1ba1d`).
- Prior Production deployment ID: `dpl_FFzFqNHAjbfBri29whryeXc4GFes`.
- Detailed rollback procedures are documented in [`docs/PRODUCTION_ROLLBACK_PLAN.md`](PRODUCTION_ROLLBACK_PLAN.md).
