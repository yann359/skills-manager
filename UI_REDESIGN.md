# Workspace UI redesign

## Reference and scope

Reviewed CC Switch `main` at `f92ff0b03964188f1cd011d9302ab8869d7a8219`
(2026-10-19), especially `src/App.tsx`, `components/shell/Sidebar.tsx`,
`components/skills/UnifiedSkillsPanel.tsx`, the UI primitives and `index.css`.
[Reference source](https://github.com/farion1231/cc-switch/tree/f92ff0b03964188f1cd011d9302ab8869d7a8219/src).

The useful patterns are grouped navigation, compact headers, explicit selection,
neutral surfaces, consistent 28–36px controls and deliberate scroll ownership.
Skills Manager keeps its own name, logo, assets, teal palette and domain model.
Public source provided the necessary evidence; REA/runtime reverse engineering
was not needed.

This UI work does not modify the Rust skill-management, persistence, sync,
translation or backup implementations. The preceding checkpoint commit preserves
the user's existing local Agent-switch work and the earlier scrollbar fix.

## Page mapping

| Existing page | New presentation |
| --- | --- |
| Dashboard | Workspace summary, recent Skills, Agent and project shortcuts |
| Library | Search, Agent filter, scope navigation, compact rows/cards |
| Install | Unified header, marketplace/local/Git tabs, shared controls |
| Skill detail | Fixed compact header, copy path, source and deployment information, sticky reading-mode toolbar, constrained document width |
| Agent / project workspace | Existing routes and safety checks, shared switches and view controls, collapsible activation notes |
| Presets | Existing sidebar shortcuts plus `/presets` management page |
| Backup / settings | Existing operations and sections with heading-based navigation |

The library's scope selector navigates to the actual global or project workspace,
so unimported project Skills are never confused with central-library entries.
Agent filtering is a read-only client-side filter. Existing view/theme choices
are retained; the new defaults are list view and the system theme.

## Design system

- Neutral white/slate surfaces, low-saturation teal actions; dark surfaces use
  distinct background/sidebar/card levels.
- 32px regular controls, 28px compact filters, 8px panels, 12px dialogs.
- Shared Button, Card, Badge, Input, Select, Tabs, PageHeader, EmptyState,
  LoadingState and native Dialog in `src/components/ui`.
- Existing `ToggleSwitch`, `CardActionMenu`, segmented controls, Sonner toasts,
  native `title` tooltips and `app-scroll-region` remain the reusable primitives.
- Native dialogs provide focus trapping, Escape and inert background behavior.
  Menus support arrows/Home/End, Escape and focus restoration.
- Motion is short and respects `prefers-reduced-motion`; loading placeholders
  reserve space. Desktop business callbacks and confirmation requirements stay
  attached to their original actions.
- Each content surface has one native 10px vertical scrollbar, `overflow-y:auto`
  and a stable gutter. Sidebar scrolling is independent. Code/table horizontal
  scrolling is confined to the document block.
- Markdown uses a comfortable 880px reading width; bilingual content can expand
  to 1100px. Translation parsing, progress, caching and resume logic are unchanged.

## Online preview

`npm run build:demo` builds `dist-demo` for GitHub Pages. Hash routing preserves
deep links on static hosting. Demo bootstrapping is a compile-time-only dynamic
import; desktop production bundles do not contain the mock backend.

All sample data and document copy are invented. The preview never reads local
Skills, Agent configuration, credentials or translation caches. A small explicit
allowlist permits in-memory preset/switch interactions and browser theme/language
changes. Real installation, file changes, backup, secrets and remote translation
are unavailable. Reloading resets sample data.

## Verification commands

```sh
npm run build
npm run build:demo
npm run lint
node scripts/test-scrollbars.mjs
node scripts/test-ui-redesign.mjs
node scripts/test-translation-markdown.mjs
node scripts/test-translation-ui.mjs
```

Browser scripts use an existing Playwright runtime and Edge. Set
`PLAYWRIGHT_MODULE_ROOT` / `BROWSER_EXE` to override their locations. The long
document scrollbar test reads the local `hyperframes-keyframes` document only
for testing and keeps results in ignored `build-cache.local`; that document is
never shipped in the demo.

### Results (2026-10-20)

- Production build, demo build and ESLint passed; TypeScript is checked by both builds.
- 52 route/theme/window layout cases passed (13 routes, two themes, 1440×860 and
  1100×640), with no browser errors or page-level horizontal overflow.
- Search, Agent filtering, project scope navigation, Preset creation, cancelling
  deletion and document keyboard navigation passed.
- 32 scrollbar cases passed, including the real local `hyperframes-keyframes`
  document, both themes, default/extra-large text, native thumb dragging, wheel,
  keyboard, fixed sidebar position and short-content behavior.
- Markdown preservation and translation UI regressions passed: consent, cached
  reload/resume, partial response recovery, bilingual mode and revocation. No real
  translation API requests were made.

These are automated Chromium/Edge checks with isolated IPC fixtures; physical
touchpad hardware and all Windows monitor DPI combinations were not exercised.
Native scrolling keeps those input paths available without custom event handlers.

### Release checks

- GitHub Actions passed frontend checks, Windows/macOS Rust tests and Linux
  compilation for the UI release.
- The deployed Pages site returned HTTP 200; Dashboard → library → long Skill
  detail navigation passed with no browser errors or failed asset requests.
- Windows EXE and MSI were built as `1.41.1-yann.2`; MSI product version is
  `1.41.1002`. Its UpgradeCode matches the previous installer.
- The first local parallel Rust run exposed a test-fixture race: the duplicate
  Skill-name sync test now uses the shared base-directory test lock and its own
  temporary recovery directory. Only test code changed; application behavior is
  unchanged. The directory override is restored even if the assertion panics.
