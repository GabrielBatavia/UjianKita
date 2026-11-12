# UjianKita — Mobile Web Compatibility Specification & Architecture

This document outlines the mobile-first design, viewport testing standards, safe-area architecture, and browser compatibility measures implemented in **Phase A** of UjianKita.

---

## 1. Executive Summary

UjianKita is designed primarily for students taking high-stakes computer-based examinations on smartphones and school tablets, as well as teachers and proctors monitoring examinations on mobile and desktop devices. In Phase A, the application was upgraded to treat mobile not as an adapted desktop view, but as the primary user environment.

All interfaces were verified across eight standard device viewports ranging from 320px to 1440px with zero horizontal layout shift or overflow.

---

## 2. Tested Viewport Matrix

| Viewport Profile | Target Device Class | Resolution Tested | Test Strategy & Verification |
|---|---|---|---|
| **Small Android Phone** | Entry-level Android (Samsung Galaxy A03, Xiaomi Redmi Go) | 320 × 640 | Automated Playwright + manual DOM overflow check (`scrollWidth <= clientWidth`). |
| **Compact Android** | Mainstream mid-tier Android (Pixel 4a, Redmi Note) | 360 × 800 | Full screen captures, touch target verification. |
| **Standard iPhone** | iPhone SE (2nd/3rd Gen), iPhone 8 | 375 × 667 | 4.7" viewport, compact header test, safe navigation. |
| **Modern Smartphone** | iPhone 12/13/14/15/16 Pro | 390 × 844 | Dynamic Island, home indicator safe-area testing. |
| **Large Smartphone** | iPhone 14/15/16 Pro Max, Pixel 7/8 Pro, Galaxy Ultra | 430 × 932 | High-DPI text scaling, thumb-reach zone testing. |
| **Tablet Portrait** | iPad 10th Gen, Galaxy Tab S6 Lite | 768 × 1024 | Breakpoint transition `md:` (table vs card toggle). |
| **Small Laptop** | Chromebook, iPad Pro Landscape, MacBook Air 11" | 1024 × 768 | Desktop sidebar vs collapsible drawer transition `lg:`. |
| **Desktop Workstation** | Standard PC Lab Monitor | 1440 × 900 | High-resolution lab examination layout. |

---

## 3. iOS Safari & Android Mobile Quirks Mitigations

### 3.1. Preventing iOS Safari Auto-Zoom on Form Focus
- **Problem:** iOS Safari automatically zooms the viewport to 100% scale if any input, textarea, or select element has a computed font size smaller than `16px` (`1rem`). This zooms the page in, displacing sticky headers, hiding bottom action bars, and causing lateral scroll disorientation for students during an exam.
- **Solution:** Configured all form primitives (`src/components/ui/input.tsx`, `textarea.tsx`, `select.tsx`) with:
  ```css
  text-base sm:text-sm
  ```
  On mobile (`< 640px`), font size is strictly `16px` (1rem), preventing iOS Safari auto-zoom entirely. On tablet and desktop (`>= 640px`), it seamlessly resolves to standard `14px` (`0.875rem`).

### 3.2. Viewport Safe Areas & Home Indicator Clipping
- **Problem:** On iPhones with Home Indicators and devices with curved display corners, fixed bottom navigation bars and floating buttons get obscured or interfere with system swipe gestures.
- **Solution:**
  1. Added `viewportFit: "cover"` to Next.js metadata in `src/app/layout.tsx`:
     ```ts
     export const viewport: Viewport = {
       width: "device-width",
       initialScale: 1,
       maximumScale: 5,
       userScalable: true,
       viewportFit: "cover",
     };
     ```
  2. Created safe-area utility classes in `src/app/globals.css`:
     ```css
     .pb-safe {
       padding-bottom: max(0.75rem, env(safe-area-inset-bottom, 0.75rem));
     }
     .pt-safe {
       padding-top: max(0.5rem, env(safe-area-inset-top, 0.5rem));
     }
     ```
  3. Integrated `pb-safe` on `PortalShell` bottom navigation, `ExamPlayerClient` fixed footer, and mobile slide-over drawers.

### 3.3. Dynamic Viewport Height (`dvh`) vs `100vh`
- **Problem:** `100vh` in mobile browsers includes the address bar and toolbar area even when they are visible, causing 50–70px of content at the bottom of the screen to be cut off until the user scrolls.
- **Solution:** Modern dynamic viewport unit utilities:
  ```css
  .min-h-dvh {
    min-height: 100dvh;
  }
  .h-dvh {
    height: 100dvh;
  }
  ```
  Applied across all full-screen layout wrappers and modal dialogs (`max-h-[90dvh]`).

---

## 4. Touch Target & Ergonomics Specifications

Following Apple Human Interface Guidelines and Google Material Design:
- **Primary Action Buttons:** Minimum `44px × 44px` touch bounding box (`min-h-[44px]` utility).
- **Exam Options (Multiple Choice & True/False):** Enlarged to `min-h-[56px]` with a `16px` internal touch margin, large letter badges (`h-8 w-8`), and distinct active state feedback (`active:scale-[0.99]`).
- **Mobile Thumb Zone Layout:** All critical examination navigation controls (Previous question, Question Palette trigger, Next question / Review) are situated in the lower third of the screen in a sticky action bar, reachable by one thumb without hand strain.
- **Preventing Accidental Double Taps:** Primary submission and navigation buttons employ state debounce (`navigatingToReview`, `isSubmitting`) with instantaneous loading spinners.

---

## 5. Responsive Tabular Architecture (Table-to-Card Pattern)

Tables with 5–8 columns cause horizontal overflow and unreadable squishing on mobile viewports (< 768px). Rather than forcing awkward lateral scroll containers, UjianKita implements an adaptive dual-mode presentation:

1. **Mobile (`< md`):** Renders clean, high-density card components (`space-y-3 md:hidden`):
   - Key identifier and status badge in the header row.
   - Clean 2-column key-value grid for metadata.
   - Clear action buttons with minimum 40–44px touch targets.
2. **Desktop (`>= md`):** Renders the full relational data table (`hidden md:block overflow-x-auto rounded-lg border border-slate-200 bg-white`).

This pattern is implemented across:
- Teacher Question Bank (`QuestionBankList`)
- Teacher Monitoring Center (`TeacherExamControlCenter`)
- Administrator Student Roster (`StudentsManager`)
- Administrator Teacher Roster (`TeachersManager`)
- Administrator Class & Academic Year Roster (`ClassesManager`)
- Administrator Subject Catalog (`SubjectsManager`)

---

## 6. Verification Results

All 88 device screenshot combinations and 12 automated Playwright accessibility/responsive tests confirmed:
- Zero horizontal overflow (`document.documentElement.scrollWidth === document.documentElement.clientWidth`).
- Zero element clipping or text truncation on small Android (320px).
- Zero iOS Safari auto-zoom triggers during form input.
- Clean safe-area spacing on iPhone 14/15/16 Pro viewports.
