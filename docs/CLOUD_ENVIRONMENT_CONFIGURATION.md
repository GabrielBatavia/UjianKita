# Cloud Environment Configuration Matrix

This document provides the definitive specification of all environment variables, cloud infrastructure bindings, and regional configurations for **UjianKita**.

---

## 1. Hosting Architecture & Regional Alignment

| Component | Provider & Tier | Region / Data Center | Hostname / Identifier |
|---|---|---|---|
| **Web & API Host** | Vercel (Hobby / Serverless Node 26.x) | **`bom1` (Mumbai, India)** | `https://ujiankita-three.vercel.app` (`prj_4vtJMVrKdO0ggXelrEsUnPrMPP5R`) |
| **Relational Database** | Supabase (Free Tier / PostgreSQL 17.11) | **`ap-south-1` (Mumbai, India)** | `db.hqoxqmmkysnnneqlepuj.supabase.co` (`hqoxqmmkysnnneqlepuj`) |
| **Authentication Engine** | Supabase Auth (GoTrue 2.119.0) | `ap-south-1` (Mumbai, India) | `https://hqoxqmmkysnnneqlepuj.supabase.co/auth/v1` |
| **Realtime Engine** | Supabase Realtime (WebSockets) | `ap-south-1` (Mumbai, India) | `wss://hqoxqmmkysnnneqlepuj.supabase.co/realtime/v1` |

---

## 2. Environment Variables Specification

### Vercel Production Environment

| Key Name | Target Scope | Classification | Description / Safe Value |
|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | Production | Plain (`--no-sensitive`) | Canonical public URL: `https://ujiankita-three.vercel.app` |
| `NEXT_PUBLIC_SUPABASE_URL` | Production | Plain (`--no-sensitive`) | Supabase REST endpoint: `https://hqoxqmmkysnnneqlepuj.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production | Plain (`--no-sensitive`) | Supabase client publishable JWT (safe for browser context) |
| `SUPABASE_SERVICE_ROLE_KEY` | Production | **Sensitive (`--sensitive`)** | Privileged server-side key for administrative user provisioning |

### Vercel Preview Environment (`feat/phase-6-cloud-integration`)

| Key Name | Target Scope | Classification | Description / Safe Value |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Preview (`feat/phase-6-cloud-integration`) | Plain | Staging Supabase URL: `https://hqoxqmmkysnnneqlepuj.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Preview (`feat/phase-6-cloud-integration`) | Plain | Staging anon JWT key |
| `SUPABASE_SERVICE_ROLE_KEY` | Preview (`feat/phase-6-cloud-integration`) | Sensitive | Staging service role key |

> **Note on Client Exposure:** Only variables prefixed with `NEXT_PUBLIC_` are accessible in browser bundles. `SUPABASE_SERVICE_ROLE_KEY` is validated in `src/lib/env.ts` with an explicit check (`typeof window !== "undefined"` throws an error) to prevent client-side leaks.

---

## 3. Database Connection Pooling & Portability

- **Serverless API Routes:** Connect over HTTPS REST via `@supabase/ssr` (`createSupabaseServerClient()`).
- **Connection Limits:** Uses Supabase's managed connection pooler (`Supavisor`) over port `6543` / `5432` for direct CLI migrations.
- **Portability:** UjianKita avoids vendor-specific serverless APIs; standard Next.js standard Web `Request`/`Response` and `next/server` utilities are used exclusively.
