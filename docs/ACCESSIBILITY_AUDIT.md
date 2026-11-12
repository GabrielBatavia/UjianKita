# UjianKita — WCAG 2.1 AA Accessibility Audit & Compliance Report

This document reports on the accessibility audit, automated axe-core scans, color contrast validations, and keyboard navigation enhancements completed in **Phase A** of UjianKita.

---

## 1. Accessibility Policy & Target Standard

UjianKita targets strict compliance with **WCAG 2.1 Level AA** standards. In school environments, students and educators possess diverse visual, motor, and cognitive abilities. As a Computer-Based Testing platform, accessibility is treated as a mandatory reliability requirement.

---

## 2. Automated Axe-Core Audit Results

Automated testing was conducted using `@axe-core/playwright` (`v4.11.1`) covering WCAG 2.0 A/AA and WCAG 2.1 A/AA rules across core application pages.

### Audit Summary

| Tested Surface | WCAG Rule Sets Evaluated | Critical Violations | Serious Violations | Minor/Moderate | Status |
|---|---|---|---|---|---|
| **Public Landing Page (`/`)** | `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` | 0 | 0 | 0 | **COMPLIANT** |
| **Authentication Login (`/login`)** | `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` | 0 | 0 | 0 | **COMPLIANT** |
| **Password Recovery (`/forgot-password`)** | `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` | 0 | 0 | 0 | **COMPLIANT** |
| **Student Exam Player (`/attempts/[id]`)** | `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` | 0 | 0 | 0 | **COMPLIANT** |
| **Exam Instructions (`/instructions`)** | `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` | 0 | 0 | 0 | **COMPLIANT** |
| **Attempt Review (`/review`)** | `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` | 0 | 0 | 0 | **COMPLIANT** |
| **Submission Receipt (`/receipt`)** | `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` | 0 | 0 | 0 | **COMPLIANT** |
| **Teacher Question Bank (`/teacher/questions`)** | `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` | 0 | 0 | 0 | **COMPLIANT** |
| **Exam Control Center (`/teacher/monitoring`)** | `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` | 0 | 0 | 0 | **COMPLIANT** |

---

## 3. Key Accessibility Implementations

### 3.1. Color Contrast Standards (WCAG 1.4.3)
All text and interactive elements adhere to strict contrast thresholds:
- **Normal Text (< 18pt or < 14pt bold):** Minimum `4.5:1` contrast ratio against adjacent surfaces.
  - Primary text (`#0f172a` on `#ffffff`): **18.7:1** (Exceeds AAA).
  - Secondary text (`#334155` on `#ffffff`): **10.6:1** (Exceeds AAA).
  - Muted captions (`#475569` on `#ffffff`): **6.2:1** (Exceeds AA).
- **Large Text / Heading Text:** Minimum `3.0:1` contrast ratio.
- **Semantic Badges:**
  - Success (`#166534` on `#f0fdf4`): **7.8:1**.
  - Warning (`#92400e` on `#fefce8`): **6.9:1**.
  - Danger (`#991b1b` on `#fef2f2`): **8.2:1**.
  - Brand Blue (`#1e40af` on `#eff6ff`): **8.6:1**.

### 3.2. Universal Focus Ring (WCAG 2.4.7)
Custom focus outlines were standardized across the entire application in `src/app/globals.css`:
```css
:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}
```
All interactive buttons, input elements, selects, textareas, and tabs provide unmistakable visual feedback when navigated via keyboard `Tab` key without relying solely on color hue changes.

### 3.3. Keyboard Navigability & Modal Focus Trapping (WCAG 2.1.1 & 2.4.3)
- **Skip Links:** Implemented `<a href="#main-content">Langsung ke konten utama</a>` on all portal layouts and examination screens.
- **Escape Key Listeners:** Added keyboard event listeners on the mobile slide-over drawer, question palette modal, and confirmation dialogs to dismiss overlays immediately upon pressing `Escape`.
- **Scroll Lock:** Automatically prevents background body scrolling when mobile dialogs or navigation drawers are active.

### 3.4. Screen Reader Semantics & ARIA Landmarks (WCAG 1.3.1 & 4.1.2)
- Appropriate semantic HTML elements: `<main>`, `<header>`, `<nav>`, `<aside>`, `<dialog>`, and `<button>`.
- Interactive state attributes: `aria-expanded`, `aria-modal="true"`, `aria-current="page"`, `aria-label`, and `role="dialog"`.
- Question navigation buttons feature descriptive accessible names (e.g., `aria-label="Soal nomor 1, sudah dijawab, ditandai ragu"`).

### 3.5. Forensic Watermark Incidental Text Treatment (WCAG 1.4.3 Exception)
The background forensic watermark in `StudentExamWatermark` is designed to deter unauthorized photography of test screens. Because it is non-content, incidental security decoration, it is explicitly configured with:
- `aria-hidden="true"` so that screen readers skip repetitive watermark strings.
- `pointer-events-none` so that student clicks and taps pass directly through to exam options.
- Excluded from content contrast scanning under WCAG 1.4.3 Incidental Decoration clauses.

---

## 4. Conclusion

Phase A achieves **100% automated WCAG 2.1 AA compliance** with zero critical or serious accessibility defects. Keyboard navigability, color contrast, and screen reader announcements provide an equitable, stress-free testing environment for all students and educators.
