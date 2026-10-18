# Development Rules for OpenConnect VPN GUI

Instructions for AI coding agents and contributors. The app is **Electron 28 + React 18 + Vite + Tailwind/shadcn** — main process logic lives in `main.js`, renderer UI in `src/`, HTML entry points in `pages/`, privileged automation in `vpn-connect.exp`. Build with `npm run build`, packages with `./scripts/build-linux.sh`, verify with `npm run test:expect`.

---

## Accessibility & Readability (WCAG 2.2 AA)

Text clarity and effortless reading are requirements, not polish.

### 1. Typography & sizing
- Critical UI text is **12px minimum**; prefer Tailwind's `text-sm` (14px) for labels and controls. `text-xs` is for secondary hints only, never for required labels or error messages.
- Do not hardcode absolute pixel sizes for text containers; let layouts size from font metrics so system font scaling works.

### 2. Contrast & visual design
- Minimum contrast **4.5:1** for regular text, **3:1** for UI components, icons and large text — in **every** theme (light and dark).
- Both light and dark themes are first-class. Define colors through the CSS custom properties in `src/globals.css` and the semantic Tailwind tokens (`bg-background`, `text-muted-foreground`, …). Never hardcode `bg-white`, `text-gray-*`, raw hex/hsl values in components — the tokens are what makes themes work.
- Interactive states (hover, pressed, checked, disabled, focus) must be visually distinct beyond color alone (borders, icons, weight, opacity).

### 3. Keyboard & focus
- Every control — buttons, inputs, selects, tabs, modals — is reachable and operable with the keyboard (`Tab`, `Shift+Tab`, `Arrow Keys`, `Enter`, `Space`, `Esc`).
- Never remove focus outlines. shadcn components keep their `focus-visible:ring` styles; custom controls need their own `focus-visible:outline`/`ring` treatment.
- Modal dialogs (custom overlays included): `role="dialog"`, `aria-modal="true"`, an accessible name, `Esc` closes, focus moves in on open and returns to the invoker on close.
- Tab-style navigation uses `role="tablist"`/`role="tab"`, `aria-selected`, and arrow-key movement in addition to `Tab`.

### 4. Names & semantics
- Icon-only buttons always carry an `aria-label` (a `title` attribute alone is not enough).
- Every input is associated with a `<Label htmlFor="…">` matching its `id`.
- Status is never conveyed by color alone — pair it with text or an icon.
- Decorative icons use `aria-hidden="true"`.

---

## Security (OWASP-adapted for desktop Electron)

Security is non-negotiable. These rules describe controls the app already relies on; do not weaken them.

### 1. Subprocess execution (command injection)
- **Never** `shell: true`, and never build a shell string with user data. Use `spawn()` with an explicit argument array and always set a timeout.
- Credentials and passwords travel over **stdin** to scripts — never in argv (visible in `ps`).
- Validate every IPC-supplied value before it reaches a command: PIDs must be integer strings, ports 1–65535, hosts `^[a-zA-Z0-9.\-:]+$`, route destinations `default` or four-part CIDR. Keep `npm run test:expect` green; extend it when argument construction changes.

### 2. Privileged execution (sudo)
- The expect script runs `sudo -k -S` so the first `Password:` prompt is always sudo's, never the VPN server's.
- Binaries executed **as root** (openconnect, vpnc-script) must resolve from trusted system directories only (`/usr/bin`, `/usr/local/bin`, `/opt/homebrew/bin`, `/snap/bin`, `/Applications/OpenConnect.app/...`). Never accept a user-writable path for privileged execution by default.
- A user-supplied custom OpenConnect binary is allowed only through the explicit double opt-in: the advanced setting plus a warning dialog whose confirmation checkbox must be ticked before it applies. Keep both defaults off.

### 3. Renderer isolation & IPC
- Every `BrowserWindow`: `contextIsolation: true`, `nodeIntegration: false`, a dedicated allow-listed preload (`preload.js` for the main window, `preload-pages.js` for auxiliary windows). A new IPC channel requires an allow-list entry in the right preload — never expose raw `ipcRenderer`.
- Validate `event.sender` for sensitive channels (anything that returns secrets or accepts passwords, e.g. `password-prompt-result`).
- Every window gets `setWindowOpenHandler` (deny) and a `will-navigate` allow-list (app origin only). Do not add `webSecurity: false`, `allowRunningInsecureContent`, or sandbox-weakening switches.
- Every page (`pages/*.html`) carries a restrictive CSP `<meta>` that works in dev and prod. New HTML entry points get the same tag.

### 4. Secrets & data at rest
- VPN passwords at rest: Electron `safeStorage` (system keyring) with `enc:v1:` prefix, plaintext migration on first launch, plaintext fallback only when no keyring exists and the UI says so.
- `profiles.json` and `settings.json` are written with mode `0600`; autostart files with `0600`.
- Never log secrets or their contents (lengths included). Server/OpenConnect output forwarded to the Logs tab must not include passwords — they are delivered on stdin for exactly this reason.
- External network calls are limited to the public-IP lookup (ipify.org). Do not add telemetry or remote content without explicit user action.

### 5. Accepted exceptions
- None currently. If a rule cannot be met (e.g. a Linux GPU workaround), document the exception here with its rationale and the risk it accepts — do not leave it implicit.
