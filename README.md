# OpenConnect VPN GUI

A desktop app for macOS and Linux that connects to VPNs with [OpenConnect](https://www.infradead.org/openconnect/). It wraps the `openconnect` command line client in a window with saved profiles, live logs, route diagnostics and a process list. Built with Electron, React and shadcn/ui.

## Screenshots

### Connection tab
![Connection Tab](screenshots/openconnect-vpn-1.png)
Connection settings on the left, recent activity on the right.

### Processes tab
![Process Monitor](screenshots/openconnect-vpn-2.png)
Running OpenConnect processes, with a Kill button that asks for your sudo password.

## What it does

- Connects with a username and password over seven protocols: AnyConnect (Cisco), Juniper Network Connect, GlobalProtect (Palo Alto), Pulse Connect Secure, F5 Big-IP, Fortinet and Array Networks.
- Saves connection profiles and fills the form from them.
- Shows your public IP before and after connecting (looked up from ipify.org).
- Streams OpenConnect output to a Logs tab, with the last 10 entries on the Connection tab.
- Flags network routes left over from a previous network, a common cause of failed connections after switching networks, and deletes them.
- Lists OpenConnect processes, including ones started from a terminal or another tool, and kills them.
- Checks for OpenConnect and `expect` at startup, and warns if your account is not an administrator.
- Puts an icon in the system tray. Its menu shows the connection status, quick-connects to any saved profile, disconnects, and has Show Window and Quit.
- Runs in the background: closing the window hides it in the tray instead of quitting, and it can start hidden at login. Both are toggles in the Settings tab.
- Can autoconnect to a profile marked "Auto-connect" when it starts.
- Can ask for the VPN password at connect time instead of storing it, for servers that need a one-time code ([#5](https://github.com/jadedm/openconnect-gui/issues/5)-style MFA).
- Has a light and dark theme, and can follow your desktop's appearance automatically.

## Install

### macOS

1. Download the `.dmg` from [Releases](https://github.com/jadedm/openconnect-gui/releases). The published build is for Apple Silicon; on an Intel Mac, build it yourself ([CONTRIBUTING.md](CONTRIBUTING.md#build-the-dmg)).
2. Open it and drag "OpenConnect VPN" into Applications.
3. Install OpenConnect if you do not have it:

   ```bash
   brew install openconnect
   ```

`expect` ships with macOS. Your account needs to be an administrator, because OpenConnect runs under `sudo`.

### Ubuntu / Debian

1. Download the `.deb` or `.AppImage` from [Releases](https://github.com/jadedm/openconnect-gui/releases), or build it yourself ([CONTRIBUTING.md](CONTRIBUTING.md#build-the-linux-packages)).
2. Install OpenConnect and its helpers:

   ```bash
   sudo apt install openconnect vpnc-scripts expect
   ```

   `vpnc-scripts` provides the route configuration script and `expect` drives the interactive login. Your account needs to be in the `sudo` group, because OpenConnect runs under `sudo`.

   - `.deb`: `sudo apt install ./OpenConnect-VPN-*.deb`, then launch it from your app grid.
   - `.AppImage`: `chmod +x OpenConnect-VPN-*.AppImage && ./OpenConnect-VPN-*.AppImage`.

### First launch (macOS)

The published build is not code-signed, so macOS reports "OpenConnect VPN is damaged" and refuses to open it. Clear the quarantine flag once:

```bash
xattr -cr "/Applications/OpenConnect VPN.app"
```

Later launches work normally. The right-click Open workaround does not help with this message.

## Usage

The window has four tabs: Connection, Logs, Diagnostics and Processes.

### Connect

1. Fill in the Connection tab:
   - Server URL, for example `https://vpn.example.com:443`
   - Username and password
   - Protocol (defaults to AnyConnect)
   - Group or authgroup, if your server uses one
   - Server certificate, if you need to pin it, for example `pin-sha256:...`. It is passed to `openconnect --servercert`.
2. Click Connect. The app opens its own window asking for your login (administrator) password, which it needs to run OpenConnect with `sudo`.
3. The status badge moves from Disconnected to Connecting to Connected, and the IP in the header updates.

### Profiles

Enter a profile name and click Save Profile. Pick a saved profile from the dropdown to fill the form, or click the trash icon next to it to delete it.

Profiles live in `profiles.json` in the app's folder under `~/Library/Application Support/` on macOS and `~/.config/` on Linux. Saved passwords are encrypted at rest with your desktop keyring (macOS Keychain, GNOME Keyring or KWallet) and the file is written with owner-only permissions. If your system has no keyring available, passwords fall back to plaintext storage and the form shows a warning.

Two ways to keep a password out of the file entirely: leave the password field empty before saving, or tick "Ask for password on connect", which prompts each time you connect (also useful for servers that want a fresh one-time code).

### Settings

The Settings tab holds the theme (Follow system, Light or Dark), the tray behavior, and autostart.

It also has an advanced option to run a **custom OpenConnect binary**. By default the app only runs OpenConnect from your system packages (`/usr/bin`, `/usr/local/bin`, `/opt/homebrew/bin`, `/snap/bin`). If you need a build of your own — for example one patched for Okta — you can point the app at it. Because that binary runs as root, turning it on takes two steps: type the path and click Enable, then tick a checkbox in a warning dialog confirming you trust the file. Both must be done before it applies, and the app refuses any binary or `vpnc-script` in a writable location.

### Diagnostics

Opening the Diagnostics tab lists network interfaces (`ifconfig`), reads the routing table (`netstat -rn`), and, if the Connection form has a server URL, tests whether that server is reachable (`nc -zv`).

A route is marked in red with a Delete button when its gateway is a private address (`10.x`, `172.16.x` to `172.31.x`, `192.168.x`) whose first three numbers match none of your interface addresses. That usually means it is left over from another network, for example a phone hotspot. The check assumes every network is a `/24`, so it can flag a valid route on a larger network, and it never flags public gateways ([#11](https://github.com/jadedm/openconnect-gui/issues/11)).

Delete asks for your sudo password and runs `sudo route delete <destination>`. It only accepts `default` or a full four-part address such as `172.20.10.0/28`; routes that `netstat` prints in short form, like `10/8`, fail with "Invalid destination format" and have to be removed from a terminal.

### Processes

Each time you open the Processes tab it lists running processes whose command line matches `sudo ... openconnect`, `/usr/...openconnect` or `/opt/...openconnect`. One connection from this app shows as several rows (sudo, openconnect and the connection script), and the badge on the tab counts all of them ([#13](https://github.com/jadedm/openconnect-gui/issues/13)). Kill asks for your sudo password and sends `SIGKILL`, which drops that VPN connection immediately.

In the installed app this tab shows the command lines of those processes. Your sudo and VPN passwords are never passed on the command line (fixed in [#4](https://github.com/jadedm/openconnect-gui/issues/4)); they are fed to the connection script over a private pipe.

### Logs

The Logs tab shows all OpenConnect output as it arrives. Lines from the connection script start with `[EXPECT]`, errors with `[ERROR]` and debug detail with `[DEBUG]`. It keeps the last 500 entries (an entry can span several lines). Copy puts them on the clipboard; Clear removes them and leaves a single "Logs cleared" line.

## Troubleshooting

**Startup check fails.** Install OpenConnect. On macOS use `brew install openconnect`; on Ubuntu/Debian use `sudo apt install openconnect vpnc-scripts expect`. `expect` ships with macOS and lives at `/usr/bin/expect`. A missing OpenConnect or `expect` stops the remaining checks, so fix it and relaunch to see the rest. A missing admin membership is only a warning.

**"Connection failed. This may be due to incorrect sudo password or network issues."** The app shows this message whenever the connection exits with code 1, and "Connection closed with exit code N" for other codes, whatever the cause ([#9](https://github.com/jadedm/openconnect-gui/issues/9)). The Logs tab has the real cause on an `[EXPECT ERROR]` line:

- `OpenConnect process ended unexpectedly` straight after the sudo prompt: usually a wrong sudo password ([#9](https://github.com/jadedm/openconnect-gui/issues/9) makes this say so). Enter your administrator (sudo) password, not the VPN password.
- `VPN authentication failed`: check the VPN username and password, the server URL, and the certificate pin if you set one.
- `Network connection failed before authentication` or `Timeout waiting for ...`: the server did not answer. Check the URL and try Diagnostics.

**"Failed to connect" or "Can't assign requested address".** Usually a stale route. Open Diagnostics and delete the routes marked in red. A typical one is a route to `172.20.10.1` left over from a phone hotspot.

**Connected but no internet.** The tunnel is up but route setup failed. Look for `vpnc-script` errors in the logs and check routes in Diagnostics. As a last resort you can add a default route by hand: `sudo route add -net 0.0.0.0/0 <gateway>`.

**Stray OpenConnect processes.** Kill them from the Processes tab, from Activity Monitor, or from a terminal:

```bash
pgrep -lf openconnect
sudo kill -9 <PID>
sudo pkill -9 openconnect   # all of them
```

**Connect fails at once in the installed app with an `expect` error about a missing file.** The connection script should be at `/Applications/OpenConnect VPN.app/Contents/Resources/vpn-connect.exp`. If it is missing, the package is broken; rebuild or download again.

## Security and your data

Saved passwords are encrypted at rest with your desktop keyring (macOS Keychain on macOS, GNOME Keyring or KWallet on Linux) and `profiles.json` is written with owner-only permissions. Existing plaintext profiles are migrated to the encrypted format on first launch. Without a keyring on the system, passwords fall back to plaintext storage and the form warns you; leave the password empty before saving, or tick "Ask for password on connect", to keep it out of the file entirely.

Your administrator (sudo) password is asked each time, never written to disk, and passed to the connection script over a pipe rather than the command line. The app looks up your public IP address from api.ipify.org when it starts and whenever the connection status changes.

[SECURITY.md](SECURITY.md) explains how credentials are handled in detail, lists the fixed and open weaknesses, and says how to report a new vulnerability privately.

## Limitations

- macOS and Linux (Ubuntu/Debian). The connection flow depends on `expect` and `sudo`.
- On macOS the published build is unsigned, so the first launch needs the step above.
- Username and password only. No 2FA prompts yet ([#5](https://github.com/jadedm/openconnect-gui/issues/5)) and no [certificate login](https://github.com/jadedm/openconnect-gui/discussions/15).
- Reconnect is limited to what OpenConnect does itself: it retries a dropped connection for 60 seconds. After that you reconnect by hand ([idea](https://github.com/jadedm/openconnect-gui/discussions/17)).
- [One connection at a time](https://github.com/jadedm/openconnect-gui/discussions/26).
- Light and dark themes, with a setting to follow the system appearance.

## Roadmap and ideas

Planned work is in [issues labelled `enhancement`](https://github.com/jadedm/openconnect-gui/issues?q=is%3Aissue+is%3Aopen+label%3Aenhancement). Ideas that are not planned yet live in [Discussions: Ideas](https://github.com/jadedm/openconnect-gui/discussions/categories/ideas); upvote the ones you want or start a new one.

## Contributing

Bug reports, fixes and ideas are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers where each goes, how to build the app from source, and how it is put together. Questions go in [Discussions: Q&A](https://github.com/jadedm/openconnect-gui/discussions/categories/q-a).

## License

[MIT](LICENSE)

---

**Built by [Manish Jadhav](https://manishj.com)**, engineer & technical consultant.

Need something like this designed or built? [Inoltro](https://inoltro.ai) is my studio.
