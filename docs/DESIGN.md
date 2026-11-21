# Design and interface conventions

## Visual system

The interface uses ivory page backgrounds, white surfaces, neutral text and lime interactive accents. Color tokens live in `apps/web/src/index.css`.

| Palette       | Value     | Use                                                    |
| ------------- | --------- | ------------------------------------------------------ |
| Soft Ivory    | `#F6F5EC` | Application background                                 |
| Pure White    | `#FFFFFF` | Cards, forms and dialogs                               |
| Warm Greige   | `#CDCBB7` | Welcome panel and neutral accents                      |
| Electric Lime | `#BFFF4F` | Primary actions and active navigation                  |
| Orange        | `#FF6B35` | Pending request accents and the on-leave chart segment |
| Charcoal      | `#282828` | Primary text and icons                                 |
| Muted Olive   | `#929487` | Chart accent                                           |
| Soft Lavender | `#C6A7F2` | Role badges and informational borders                  |
| Light Border  | `#E2E3DC` | Card borders and dividers                              |

Use the darker control border for inputs and the violet focus token for keyboard focus. Success, warning, error and information use independent text and background tokens. Reserve the lighter olive and greige shades for surfaces and graphics.

`apps/web/src/styles/theme.css` defines the 4px spacing scale and radius tokens of 10, 14 and 18px plus pill corners. Use the scale for control gaps (8 px), related fields (16 px), and section spacing (20–32 px). Page gutters are 16 px on phones, 24 px on tablets, and 36 px on wide screens. Panels use 16 or 24 px of internal padding, with a shared 44 px minimum for primary controls. Feature and dashboard styles live next to their components.

## CSS ownership

`main.tsx` imports base CSS, `App`, then `refresh.css`, `theme.css` and `polish.css`. Component imports also contribute styles. Later declarations can override earlier ones; inspect computed styles before adding overrides. Despite the comment in `theme.css`, `polish.css` loads after it. Prefer a focused component change and avoid escalating selector specificity across several files.

Brand components are in `app/Brand.tsx`; icons are in `app/Icons.tsx`; dashboard cards use `app/StatCard.tsx`. Extend these assets for consistent navigation and status presentation.

## Layout and interaction

The workspace uses desktop sidebar navigation and compact phone navigation, with a sidebar breakpoint at 768px in the theme. Keep primary actions reachable on narrow screens and give wide tables an intentional overflow treatment. Verify dialogs, forms and sticky controls with the on-screen keyboard open.

Administrator and employee screens expose different capabilities. Keep self-service language explicit about whose data is shown. Display temporary credentials only in their intended result view, with clear copy instructions; never use example employee secrets in UI screenshots.

Forms should preserve input after a server error, associate labels with controls, distinguish field errors from service failures, and disable repeated submissions while pending. Provide loading, empty, error and success states. Destructive actions and review decisions need clear consequences and any required reason.

## Language and accessibility

Use the existing `tr`, `useLanguage` and numeric formatting helpers in `src/i18n/`. Check English and Bangla layouts: translated labels may wrap or need more space. Machine import/export column names remain stable even when the interface language changes.

Use semantic buttons, links and headings, visible keyboard focus, descriptive control names and text alongside status colors. Preserve the skip link and usable focus order. Check keyboard navigation and focus restoration for dialogs. Check the mobile menu’s focus containment and Escape behavior, and verify arrow-key navigation between profile record tabs.

## Review a visual change

Check a narrow phone viewport and desktop, both roles and both languages. Exercise long names, empty results, validation errors, missing images and unavailable services. Use fictional data in screenshots and review the browser console for rendering errors.
