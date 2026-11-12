# UjianKita — Phase A UI/UX Audit & Issue Inventory

**Document Version:** 1.0.0  
**Phase:** Phase A (UI/UX Modernization, Design System & Mobile-First Compatibility)  
**Date:** 2026-11-13  
**Auditor:** Principal Frontend Engineer, Senior Product Designer, Mobile Web Compatibility Engineer, Accessibility Specialist  
**Local Workspace:** `D:\UjianKita`  
**Git Branch:** `feat/phase-a-ui-ux-mobile`  
**Base Commit:** `41ea88c`

---

## 1. Executive Summary

A comprehensive, full-stack frontend audit of UjianKita was conducted across all major user roles (Public, Student, Teacher, Administrator), covering 31 App Router routes, 24 feature components, and 12 shared UI primitives. 

Visual and responsive baseline captures were performed via Playwright across 8 distinct viewports:
- **320px**: Small Android smartphone (e.g. compact Android Go devices)
- **360px**: Compact Android device
- **375px**: Standard iPhone (e.g. iPhone SE, iPhone 8)
- **390px**: Modern mobile standard (e.g. iPhone 13/14/15/16, Google Pixel)
- **430px**: Large mobile smartphone (e.g. iPhone Pro Max, Samsung Galaxy Ultra)
- **768px**: Tablet portrait (e.g. iPad 10th gen, Galaxy Tab)
- **1024px**: Small laptop / netbook
- **1440px**: Desktop high-resolution monitor

The audit confirms that while the backend security and exam engine invariants are exceptionally robust, the frontend interface had several critical mobile usability defects, touch-target inconsistencies, responsive table horizontal scrolling, and iOS viewport auto-zoom triggers.

---

## 2. Issue Inventory Ranked by Severity

| ID | Category | Location | Severity | Description | Remediated in Phase A |
|---|---|---|---|---|---|
| **ISSUE-01** | Mobile Exam UX | `ExamPlayerClient` | **P0 (Critical)** | Sticky header in exam player wrapped into 3-4 vertical rows on 320px–375px screens, consuming >40% of the visible viewport. | Standardize to a 2-row ultra-compact mobile header with dedicated status pills. |
| **ISSUE-02** | Mobile Exam Navigation | `ExamPlayerClient` | **P0 (Critical)** | Disconnected navigation: Previous/Next buttons were located at the bottom of question cards, while fixed bottom bar only had "Daftar Soal" and "Tinjau". | Implement unified sticky mobile action bar with Previous, Soal X/Y drawer trigger, and Next / Tinjau buttons. |
| **ISSUE-03** | Mobile WebKit | `Input`, `Textarea`, `Select` | **P0 (Critical)** | Form inputs used `text-sm` (14px), triggering unwanted iOS Safari automatic zoom-in and viewport shift upon keyboard focus. | Upgrade form fields to `text-base sm:text-sm` (16px on mobile, 14px on desktop) to eliminate auto-zoom without disabling pinch-to-zoom. |
| **ISSUE-04** | Mobile Safe Area | `RootLayout`, `PortalShell` | **P0 (Critical)** | Missing `viewportFit: "cover"` in `Viewport` metadata and missing safe area padding (`env(safe-area-inset-bottom)`) causing fixed bars to be clipped by iPhone Home Indicator. | Add `viewportFit: "cover"` to Next.js viewport metadata and incorporate `pb-safe` / `safe-area-inset` utilities. |
| **ISSUE-05** | Responsive Layout | `QuestionBankList`, `StudentsManager`, `TeacherExamControlCenter` | **P1 (High)** | Data tables with 6-8 columns forced clumsy horizontal scrolling on mobile viewports (<768px). | Implement responsive hybrid layout: structured mobile record cards on `< md`, professional data tables on `md+`. |
| **ISSUE-06** | Student IA | `PortalShell` | **P1 (High)** | Student mobile interface rendered BOTH a top dropdown burger menu AND a fixed bottom navigation bar with the exact same 4 routes. | Clean up student mobile shell: remove redundant hamburger menu for students; use clean top header and dedicated bottom nav. |
| **ISSUE-07** | Navigation UX | `PortalShell` | **P1 (High)** | Mobile navigation drawer pushed content down inline instead of rendering as a smooth backdrop modal overlay with scroll lock. | Convert mobile navigation to a modern slide-over sheet drawer with backdrop blur, focus lock, and ESC dismissal. |
| **ISSUE-08** | Component IA | `ExamWorkspace` | **P1 (High)** | 5 tabs rendered in an awkward 2-2-1 grid (`grid-cols-2 sm:grid-cols-5`) on mobile screens. | Replace with horizontally scrollable, touch-friendly tab pills with smooth momentum scrolling. |
| **ISSUE-09** | Touch Targets | `ExamPlayerClient` | **P2 (Medium)** | Option selection touch target relied on label borders; radio button itself was small (16px) and lacked prominent visual feedback. | Increase option min-height to 56px, introduce active ring highlights, clear checkmark/radio indicators, and distinct letter badge styles. |
| **ISSUE-10** | Accessibility | `ExamPlayerClient` | **P2 (Medium)** | Question flag button text ("Tandai Ragu-ragu") on mobile was cramped and flag state lacked high-contrast visual differentiation. | Use amber-600 tokens with distinct warning badge icon and clear semantic state for screen readers. |
| **ISSUE-11** | Accessibility | `globals.css` | **P2 (Medium)** | Inconsistent focus-visible outlines (`outline: 2px solid #2563eb` globally vs custom Tailwind classes). | Standardize accessible design tokens for `:focus-visible` with 2px primary ring and 2px offset across all interactive components. |
| **ISSUE-12** | Formula Overflow | `QuestionContentRenderer` | **P2 (Medium)** | Long KaTeX mathematical expressions occasionally caused layout shifts if not wrapped in dedicated horizontal overflow containers. | Ensure all inline and block KaTeX containers feature `overflow-x-auto` with subtle scroll indicators without breaking document width. |

---

## 3. Baseline Screenshot Verification

Baseline screenshots were captured deterministically using Chromium in Playwright across all 8 target viewports:

- **Public Views**:
  - `docs/screenshots/baseline/landing-[viewport].png`
  - `docs/screenshots/baseline/login-[viewport].png`
  - `docs/screenshots/baseline/forgot-password-[viewport].png`
  - `docs/screenshots/baseline/not-found-[viewport].png`
- **Component & Workspace Views**:
  - `docs/screenshots/baseline/student-exam-player-[viewport].png`
  - `docs/screenshots/baseline/student-instructions-[viewport].png`
  - `docs/screenshots/baseline/student-review-[viewport].png`
  - `docs/screenshots/baseline/student-receipt-[viewport].png`
  - `docs/screenshots/baseline/teacher-question-bank-[viewport].png`
  - `docs/screenshots/baseline/admin-students-[viewport].png`
  - `docs/screenshots/baseline/teacher-monitoring-[viewport].png`

Total baseline screenshots recorded: **88 images**.

---

## 4. Remediation Plan & Architecture

The redesign follows an incremental, non-destructive sequence:
1. **Design System Standardization (Step A1)**: Standardize color tokens, typography scales, border radii, shadows, and base shadcn/ui primitives (`Button`, `Input`, `Textarea`, `Card`, `Badge`, `Alert`, `Table`, `Tabs`, `Dialog`).
2. **Mobile-First Responsive Foundation (Step A2)**: Configure safe-area insets, dynamic viewport heights (`dvh`), eliminate horizontal scrolling, and fix iOS font-size zoom behavior.
3. **Student Examination Player (Step A3 - Highest Priority)**: Modernize `ExamPlayerClient`, compact header, sticky bottom action bar, question palette drawer, KaTeX mathematical formula container, essay autosave indicator, and review modal.
4. **Student Dashboard & Portals (Step A4)**: Simplify student dashboard, exam catalog cards, and results view.
5. **Teacher Dashboard & Question Bank (Step A5)**: Implement responsive cards for mobile Question Bank, enhance Question Editor with live math preview, and improve Import Wizard.
6. **Exam Builder UX (Step A6)**: Modernize `ExamWorkspace` tab layout, readiness checklist, and publication modal.
7. **Administrator Experience (Step A7)**: Implement responsive mobile cards for all academic management entities (`students`, `teachers`, `classes`, `subjects`, `settings`).
8. **Teacher Monitoring UX (Step A8)**: Enhance Examination Control Center with responsive student cards and incident drawer.
9. **Navigation Modernization (Step A9)**: Re-architect `PortalShell` with an accessible slide-over drawer for mobile and distraction-free exam mode.
10. **Accessibility & Cross-Browser Verification (Steps A10-A12)**: Run WCAG 2.2 AA audits with `@axe-core/playwright`, re-capture comparison screenshots, and verify complete test suite.
