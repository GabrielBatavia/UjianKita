# UjianKita — Phase A.1: Mobile Web Compatibility & Quirks Audit

**Document Status:** Complete Acceptance Verification  
**Date:** November 13, 2026  
**Auditor:** Mobile Web Compatibility Engineer & Principal Frontend Engineer  
**Target Environments:** Android Chrome (v110+), iOS Mobile Safari (iOS 15–18), Samsung Internet, Mobile WebViews (ExamBro / CBT lockdown shells)  

---

## 1. Executive Summary

Mobile examination environments in Indonesian schools present unique technical constraints:
- Widespread use of entry-level Android devices (MediaTek Helio / Unisoc processors with 2GB–3GB RAM).
- Narrow physical display widths ranging from 320px to 390px.
- Unpredictable virtual keyboard behavior across Android OEM keyboards (GBoard, Samsung Keyboard, Xiaomi Keyboard) and iOS Safari.
- Physical notches, dynamic islands, and gesture home indicator bars.
- Specialized Android lockdown browsers (ExamBro, Exambrowser Kemdikbud) that run embedded WebViews with restricted viewport heights.

Phase A.1 audited and hardened UjianKita against these mobile browser quirks.

---

## 2. Mobile Quirks & Solutions Inventory

### 2.1 iOS Safari Auto-Zoom on Form Focus (16px Threshold)
- **Problem:** iOS Safari automatically zooms the viewport whenever a form input (`<input>`, `<textarea>`, `<select>`) with a font size smaller than 16px is focused. This breaks fixed layouts, distorts headers, and forces students to pinch-to-zoom back out.
- **Root Cause:** Standard Tailwind `text-sm` is 14px (0.875rem), which triggers the iOS automatic zoom mechanism.
- **Resolution:**
  - Standardized all form inputs, textareas, and select triggers to `text-base sm:text-sm` (`src/components/ui/input.tsx`, `textarea.tsx`, `select.tsx`).
  - On mobile screens (`< 640px`), form controls render at exactly 16px font size, completely preventing auto-zoom.
  - On desktop screens (`>= 640px`), font size smoothly scales down to 14px for high information density.

### 2.2 Notch & Home Indicator Insets (Safe Area Padding)
- **Problem:** On iPhones with notches or Dynamic Islands (iPhone X through 16 Pro Max) and modern Android devices with gesture navigation bars, fixed headers and bottom action bars can get obscured or collide with system gesture zones.
- **Root Cause:** Missing `viewport-fit=cover` and absence of `env(safe-area-inset-bottom)` / `env(safe-area-inset-top)` utility padding.
- **Resolution:**
  - Added `viewportFit: "cover"` to `viewport` configuration in `src/app/layout.tsx`.
  - Configured `@utility pb-safe` and `@utility pt-safe` in `src/app/globals.css`:
    ```css
    @utility pb-safe {
      padding-bottom: env(safe-area-inset-bottom, 0px);
    }
    @utility pt-safe {
      padding-top: env(safe-area-inset-top, 0px);
    }
    ```
  - Applied `pb-safe` to the bottom navigation bar in `ExamPlayerClient` and `PortalShell`.

### 2.3 Bottom Content Overlap with Sticky Action Bar
- **Problem:** When an exam action bar is fixed to the bottom of the viewport (`fixed inset-x-0 bottom-0 z-30`), questions with long stems, multiple options, or essay explanations can have their bottom content obscured behind the sticky bar when scrolled to the very bottom.
- **Root Cause:** Main scroll container had default padding (`pb-0` or `pb-4`), which did not account for the ~64px-80px height of the fixed navigation bar.
- **Resolution:**
  - Added `pb-24 lg:pb-8` to `<main>` in `ExamPlayerClient` (`src/components/features/student/exam-player-client.tsx`).
  - Guaranteed a minimum of 96px scroll margin on mobile, ensuring the last option card or essay character counter is 100% visible and interactive.

### 2.4 Essay Virtual Keyboard Interaction
- **Problem:** On mobile devices, opening the on-screen keyboard for essay questions shrinks the visible viewport by 40%–50%. If the textarea has fixed tall dimensions, the question stem and save badges become unreachable.
- **Root Cause:** Excessively tall initial textarea heights (`min-h-[300px]`).
- **Resolution:**
  - Configured responsive min-height: `min-h-[160px] text-base leading-relaxed p-4`.
  - Added debounced autosave (1.5s typing debounce + immediate flush on `onBlur`).
  - Added localized character counter (`X / 30.000 karakter`) and explanatory guidance.

### 2.5 LaTeX Mathematical Formula Horizontal Overflow (KaTeX)
- **Problem:** Mathematical formulas written in LaTeX with fractions, matrices, or exponents (`\frac{...}{...}`) frequently exceed the 320px–360px width of narrow mobile screens. Without localized scrolling, wide formulas blow out the parent card container and trigger horizontal page overflow.
- **Root Cause:** KaTeX display formulas render as full blocks without overflow constraints, and inline formulas use `white-space: nowrap`.
- **Resolution:**
  - Hardened `QuestionContentRenderer` (`src/components/features/exams/question-content-renderer.tsx`) with scoped CSS rules:
    ```tsx
    "[&_.katex-display]:my-2 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_.katex-display]:py-1",
    "[&_.katex]:max-w-full [&_.katex]:overflow-x-auto [&_.katex]:overflow-y-hidden [&_.katex]:inline-block [&_.katex]:align-middle"
    ```
  - Ensured both display-mode (`$$...$$`) and inline-mode (`$...$`) math formulas scroll smoothly inside their localized boundary without disturbing page layout.
  - Verified with Playwright: 0 horizontal overflow at 320px, 360px, 375px, 390px, and 430px.

### 2.6 Mobile Modal / Drawer Scrolling & Focus Containment
- **Problem:** When opening the mobile question palette modal in `ExamPlayerClient` or the navigation drawer in `PortalShell`, scrolling inside the modal could cause the background exam page to scroll beneath it ("scroll leaking"). In addition, pressing `Escape` or tapping the backdrop did not close the modal.
- **Root Cause:** Missing body scroll lock, missing backdrop click handler, and missing keyboard event listeners.
- **Resolution:**
  - Implemented body scroll lock on modal open:
    ```tsx
    const originalStyle = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalStyle;
    };
    ```
  - Added `Escape` key event listener to immediately close the palette overlay.
  - Added full backdrop overlay with `onClick={() => setPaletteOpen(false)}` and `aria-hidden="true"`.

### 2.7 Capacitive Touch Hitbox Standards (WCAG 2.5.5 / 2.5.8)
- **Problem:** Accidental answer selection or missed taps caused by undersized hitboxes (< 32px height) on student touchscreens.
- **Resolution:**
  - Option selection cards: Minimum **56px** tap height with full-width clickable card area.
  - Navigation buttons: Minimum **44px** height and width.
  - Numbered palette buttons: Minimum **48px x 48px** touch target with generous gap.

---

## 3. Automated Mobile Responsive Test Summary

| Viewport | Device Emulation | Width | Height | Horizontal Overflow | Result |
| :--- | :--- | :---: | :---: | :---: | :---: |
| 320px | Small Android (Galaxy Core / Feature) | 320px | 640px | 0px (No overflow) | **PASS** |
| 360px | Compact Android (Redmi 9A / A03) | 360px | 800px | 0px (No overflow) | **PASS** |
| 375px | iPhone SE / 8 / Mini | 375px | 667px | 0px (No overflow) | **PASS** |
| 390px | iPhone 12/13/14 / Pixel 7 | 390px | 844px | 0px (No overflow) | **PASS** |
| 430px | iPhone 14/15/16 Pro Max | 430px | 932px | 0px (No overflow) | **PASS** |
| 768px | iPad 10.2" / Galaxy Tab | 768px | 1024px | 0px (No overflow) | **PASS** |
| 1024px | Chromebook / Small Laptop | 1024px | 768px | 0px (No overflow) | **PASS** |
| 1440px | Desktop Lab Monitor | 1440px | 900px | 0px (No overflow) | **PASS** |
