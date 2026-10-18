# Security

## Reporting a vulnerability

Report it privately through [GitHub's advisory form](https://github.com/jadedm/openconnect-gui/security/advisories/new). Do not open a public issue or Discussion for something that is not already listed below.

Include the release you downloaded, your OS and version, and the steps to reproduce.

## Supported versions

Only the latest release gets fixes. There are no backports.

## What the app does with your credentials and data

The app runs `openconnect` under `sudo`, so it handles two secrets: your administrator password (for `sudo`) and your VPN password.

- **Administrator password.** Asked for on every connect (in a separate window) and every process kill and route delete (in a dialog inside the main window). It is never written to disk and never passed on a command line; the connection script reads it from a pipe on standard input. After some failed kills or route deletes the dialog keeps it in memory and shows it filled in the next time it opens.
- **VPN password.** Typed into the Connection form. If you save a profile with the password filled in, it is encrypted at rest with the system keyring (Electron `safeStorage`, which uses macOS Keychain, the Windows Credential Store, libsecret or KWallet depending on the platform) and stored in `profiles.json` in the app's folder under `~/Library/Application Support/` (`openconnect-gui` when running from source) with owner-only permissions. Existing plaintext profiles are migrated to the encrypted format on first launch. On a system with no keyring available the password is stored unencrypted and the form shows a warning; leave the field empty before saving, or tick "Ask for password on connect", to keep it out of the file entirely.
- **Public IP lookup.** The app sends a request to api.ipify.org when it starts and whenever the connection status changes, to show your public IP.

## Protections in place

- The main window runs with context isolation and reaches the main process only through the functions in `preload.js`. The splash, installer helper and password-prompt windows run the same way, through the allow-listed channels in `preload-pages.js`, with Node.js access disabled.
- The connection script takes the sudo password and VPN password on standard input, never as command-line arguments, so they do not appear in the process list. It starts with `sudo -k -S`, which forces a fresh sudo prompt so the first `Password:` answer always goes to sudo and never to the VPN server.
- Connection fields and credentials are never interpreted as code or options on the way to openconnect: each field arrives as one argument, changed only by trimming surrounding spaces and adding `https://` to a bare server name. `npm run test:expect` checks this against hostile values.
- Process IDs must be numeric, and route destinations must be `default` or four dot-separated numbers with an optional prefix length, before they reach `sudo`.
- Most system commands run through `spawn()` with argument arrays. Four use `exec()` with a shell string: the process list, the routing table, the interface list and the OpenConnect installer launcher. The installer string includes the app's install path; none of them include anything you type.

## Fixed weaknesses

Every issue labelled [`security`](https://github.com/jadedm/openconnect-gui/issues?q=is%3Aissue+label%3Asecurity) at the time of v1.2.0 is fixed:

| Issue | Weakness | Fix |
|---|---|---|
| [#4](https://github.com/jadedm/openconnect-gui/issues/4) | While connected, the administrator password, VPN username and VPN password were passed to the connection script as command-line arguments. `ps` showed them, and the installed app displayed them in its own Processes tab. | Credentials are written to the script's standard input. Nothing sensitive appears in `ps` or the process list. |
| [#6](https://github.com/jadedm/openconnect-gui/issues/6) | Saved VPN passwords were plaintext in `profiles.json`. | Passwords are encrypted with the system keyring, the file is written with `0600` permissions, and plaintext profiles are migrated on first launch. If no keyring is available the password is stored unencrypted and the form warns. |
| [#12](https://github.com/jadedm/openconnect-gui/issues/12) | The splash, installer and password-prompt windows ran with Node.js access and without context isolation. | All three run with context isolation and `nodeIntegration` disabled, and can only reach the main process through the allow-listed IPC channels in `preload-pages.js`. |
| [#36](https://github.com/jadedm/openconnect-gui/issues/36) | If sudo already had a cached login and the VPN server's first prompt was `Password:`, the connection script answered it with the administrator password. | The script runs `sudo -k -S`, so sudo always prompts first, and reads both passwords from standard input. `npm run test:expect` covers the cached-sudo case. |
