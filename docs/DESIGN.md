# Design and interface conventions

## Visual system

The interface uses Payra-inspired green, white surfaces and a pale green-gray background. Maintain the existing visual language rather than introducing a second component theme.

| Token               | Value                 | Use                             |
| ------------------- | --------------------- | ------------------------------- |
| `--g-700`           | `#087f3e`             | Primary green                   |
| `--bg`              | `#f3f6f3`             | Page background                 |
| `--surface`         | `#ffffff`             | Cards and panels                |
| `--ink`             | `#1d2f25`             | Main text                       |
| `--muted`           | `#607466`             | Supporting text                 |
| `--border`          | `#dfe7e1`             | Dividers and control boundaries |
| `--amber` / `--red` | `#c98219` / `#d6283b` | Caution and destructive states  |

`apps/web/src/styles/theme.css` defines a 4px spacing scale and radius tokens of 10, 14 and 18px plus pill corners. Reuse these tokens. Feature and dashboard styles live next to their components.

## CSS ownership

`main.tsx` imports base CSS, `App`, then `refresh.css`, `theme.css` and `polish.css`. Component imports also contribute styles. Later declarations can override earlier ones; inspect computed styles before adding overrides. Despite the comment in `theme.css`, `polish.css` loads after it. Prefer a focused component change and avoid escalating selector specificity across several files.

Brand components are in `app/Brand.tsx`; icons are in `app/Icons.tsx`; dashboard cards use `app/StatCard.tsx`. Extend these assets for consistent navigation and status presentation.

## Layout and interaction

The workspace uses desktop sidebar navigation and compact phone navigation, with a sidebar breakpoint at 768px in the theme. Keep primary actions reachable on narrow screens and give wide tables an intentional overflow treatment. Verify dialogs, forms and sticky controls with the on-screen keyboard open.

Administrator and employee screens expose different capabilities. Keep self-service language explicit about whose data is shown. Display temporary credentials only in their intended result view, with clear copy instructions; never use example employee secrets in UI screenshots.

Forms should preserve input after a server error, associate labels with controls, distinguish field errors from service failures, and disable repeated submissions while pending. Provide loading, empty, error and success states. Destructive actions and review decisions need clear consequences and any required reason.

## Language and accessibility

Use the existing `tr`, `useLanguage` and numeric formatting helpers in `src/i18n/`. Check English and Bangla layouts: translated labels may wrap or need more space. Machine import/export column names remain stable even when the interface language changes.

Use semantic buttons, links and headings, visible keyboard focus, descriptive control names and text alongside status colors. Preserve the skip link and usable focus order. Check keyboard navigation and focus restoration for dialogs. These are maintenance expectations, not a claim of a completed accessibility certification.

## Review a visual change

Check a narrow phone viewport and desktop, both roles and both languages. Exercise long names, empty results, validation errors, missing images and unavailable services. Use fictional data in screenshots and review the browser console for rendering errors.
