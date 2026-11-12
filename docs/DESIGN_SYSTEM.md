# UjianKita — Design System Specification

**Document Version:** 1.0.0  
**Phase:** Phase A (Design System & Mobile-First Compatibility)  
**Date:** 2026-11-13  
**Status:** Implemented & Enforced  

---

## 1. Visual Direction & Design Philosophy

UjianKita's design philosophy is **Clean, Modern, Approachable, Professional, and Trustworthy**.
As an educational Computer-Based Testing (CBT) platform used during high-stakes examinations:
1. **Focus & Clarity**: Information hierarchy prioritizes immediate readability of question stems, remaining time, and authoritative answer save confirmations.
2. **Honesty & Transparency**: Never display optimistic save feedback without server confirmation. Network delays and local buffering are transparently indicated with non-alarming, polite messaging.
3. **Mobile-First Touch Ergonomics**: Minimum touch targets of 44×44 CSS pixels across all smartphone viewports (320px–430px) without relying on micro-elements.
4. **Distraction-Free Focus**: Zero unnecessary decorative gradients, animations, or glassmorphism. Surfaces use pure white cards on subtle neutral backgrounds (`#f8fafc`).

---

## 2. Design Tokens

### Color Palette

| Token | Value | Tailwind / CSS Variable | Usage | Contrast vs White |
|---|---|---|---|---|
| Background | `#ffffff` | `bg-white` / `--color-background` | Primary page & card canvas | N/A |
| Surface (Muted) | `#f8fafc` | `bg-slate-50` / `--color-surface` | Application background behind cards | 1.06:1 |
| Surface (Border) | `#e2e8f0` | `border-slate-200` / `--color-border` | Subtle structural dividers | 1.25:1 |
| Text Primary | `#0f172a` | `text-slate-900` / `--color-foreground` | Headings, primary question stems | 16.5:1 (AAA) |
| Text Muted | `#475569` | `text-slate-600` / `--color-muted` | Body secondary, metadata, descriptions | 7.0:1 (AAA) |
| Primary Accent | `#1d4ed8` | `bg-blue-700` / `--color-primary` | Primary action buttons, brand logo | 5.9:1 (AA) |
| Primary Hover | `#1e40af` | `hover:bg-blue-800` | Pressed / hover button state | 7.6:1 (AAA) |
| Success Accent | `#15803d` | `text-emerald-800 bg-emerald-50` | Authoritative "Tersimpan", verified states | 5.2:1 (AA) |
| Warning Accent | `#b45309` | `text-amber-950 bg-amber-50` | Flagged for review ("Ragu-ragu"), stale signal | 6.8:1 (AAA) |
| Danger Accent | `#b91c1c` | `text-rose-950 bg-rose-50` | Critical time (<5m), failed save, incidents | 5.9:1 (AA) |

### Typography Hierarchy

UjianKita uses **Plus Jakarta Sans** for user interface elements and prose, paired with **JetBrains Mono** for server timers, version locks, and cryptographic hashes.

- **Page Titles**: `text-xl sm:text-2xl font-bold tracking-tight text-slate-900`
- **Card Headings**: `text-base sm:text-lg font-semibold text-slate-900`
- **Question Stems**: `text-base font-medium leading-relaxed text-slate-900`
- **Options / Labels**: `text-sm sm:text-base text-slate-800 font-medium`
- **Form Inputs**: `text-base sm:text-sm text-slate-900` (16px on mobile to avoid iOS Safari viewport auto-zoom)
- **Badges / Tags**: `text-xs font-semibold tracking-wide`
- **Authoritative Timer**: `font-mono text-sm sm:text-base font-bold`

---

## 3. Elevation & Border Tokens

- **Card Radius**: `rounded-xl` (`0.75rem` / `12px`)
- **Button / Input Radius**: `rounded-lg` (`0.5rem` / `8px`)
- **Badge Radius**: `rounded-full` (`9999px`)
- **Card Shadow**: `shadow-xs` / `shadow-[0_1px_2px_rgba(15,23,42,0.04)]`
- **Modal Overlay**: `bg-slate-900/50 backdrop-blur-[2px]`

---

## 4. Accessibility & Safe-Area Insets

### Focus States
Every interactive button, input, link, and radio option implements standardized visible keyboard focus:
```css
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2
```

### Safe-Area Utilities
```css
@utility pb-safe {
  padding-bottom: max(env(safe-area-inset-bottom, 0px), 1rem);
}
@utility pt-safe {
  padding-top: max(env(safe-area-inset-top, 0px), 1rem);
}
@utility min-h-dvh {
  min-height: 100dvh;
}
```

---

## 5. Standard Component Guidelines

1. **Button (`src/components/ui/button.tsx`)**:
   - Touch targets: Default min-height `44px`, small min-height `38px`, large `50px`.
   - Scale feedback on tap: `active:scale-[0.99]`.
2. **Form Controls (`Input`, `Textarea`, `Select`)**:
   - Always specify `text-base sm:text-sm` to guarantee iOS Safari never performs disruptive automatic zoom upon keyboard invocation.
3. **Badges (`Badge`)**:
   - Semantic color pairs: `default` (blue), `neutral` (slate), `success` (emerald), `warning` (amber), `danger` (rose).
4. **Data Tables & Mobile Cards**:
   - Multi-column tables (`Table`) adapt to `< md` viewports by rendering structured, touch-friendly record cards (`space-y-3 md:hidden`) instead of wide horizontal scroll containers.
