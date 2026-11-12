# UjianKita Phase 4 — Android ExamBro Compatibility Guide

## 1. Real Capabilities & Honest Limitations

Android **ExamBro** (`com.dekikurnia.exambro` by Deki Kurnia Hadi Permana / Gamada Dev) is widely used across Indonesian schools to provide an on-device WebView lockdown:

- Locks display / blocks split-screen & floating windows
- Applies Android `FLAG_SECURE` to block OS screenshots
- Suppresses system notifications and triggers escape alarms when exiting kiosk mode
- Supports direct URL opening and built-in QR code scanning

**Crucial Engineering Limitation:** `com.dekikurnia.exambro` does **not** expose a cryptographic request signing protocol, ConfigKey challenge, or verifiable client attestation API to web servers. HTTP headers (`User-Agent`, `X-Requested-With`) and JavaScript hints can always be spoofed by any standard browser or script.

Consequently, UjianKita **strictly enforces `VerificationTrustLevel = "unverified_client_hint"`** for ExamBro:
- It **never** upgrades trust to `verified_seb_*`.
- It **never** claims ExamBro presence proves the device cannot be tampered with.
- When schools enforce `VERIFIED_SEB_REQUIRED`, Android ExamBro users must either use Safe Exam Browser (where available) or receive an audited proctor/teacher emergency override (`grantBrowserOverrideService`).

## 2. Implemented ExamBro Workflow in UjianKita

When `exambroEnabled` is enabled on an exam security policy:

1. `StudentExamSecurityCard` generates a deterministic **ISO/IEC 18004 Byte-Mode SVG QR Code** (`generateQrCodeSvg` in `src/domain/monitoring/exambro-compat.ts`) pointing directly to `/student/exams/[examId]`.
2. Students can scan the QR directly inside Android ExamBro or copy the exam URL and install link (`https://play.google.com/store/apps/details?id=com.dekikurnia.exambro`).
3. Both UI and server classification (`assessExamBroClientHint`) display clear Indonesian labeling: `"Petunjuk Klien ExamBro (Tidak Terverifikasi Kriptografis)"`.
