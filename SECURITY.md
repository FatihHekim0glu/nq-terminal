# Security policy

nq-lab terminal is a local, read-only research terminal. It runs on your own machine, on loopback only, and it never
places, modifies or cancels an order or connects to a real broker. It is a personal research tool shared publicly, and
it is looked after by one maintainer ([@FatihHekim0glu](https://github.com/FatihHekim0glu)). This page says what is
supported, how to report a vulnerability privately, what to expect back, and what the security design is, so that a
report can be judged against the design as it stands.

## Supported versions

| Version | Supported |
| --- | --- |
| `main` | Yes. Fixes land here first |
| Windows desktop app 0.1.x (release `desktop-v0.1.0` and the planned 0.1.1 release) | Yes |
| Anything older than 0.1.0, and any other branch or fork | No |

The desktop app is a 0.x release. Its public surface may still change, and a security fix may ship as a new 0.1.x
installer rather than as a patch to an old one. There is no updater by design: you install a new release by hand
(see [Update and rollback](#update-and-rollback)).

## Reporting a vulnerability

Report privately. Do not open a public issue, a pull request or a discussion for a security problem.

1. Open the repository on GitHub, go to the **Security** tab and choose **Report a vulnerability**. This is GitHub's
   private vulnerability reporting. Only you and the maintainer can see the report.
2. Describe the problem as in the next section.
3. If the Security tab shows no such button, open a public issue that says only that you have a security report and
   want a private channel. Put no details in it. The maintainer will answer on GitHub and enable the private route.

No email address is published for security reports. Contact goes through GitHub.

### What to include

- The version: the release tag, or the commit if you built from source, and whether it is the desktop app or the
  browser door (`start.ps1` or `start.sh`).
- Your Windows version, or your operating system for the browser door.
- What you did, step by step, and what you expected against what happened.
- What an attacker gains: reading a file, running code, getting past the session token, writing outside the allowed
  folders, reaching a broker, or reading a price after the in-sample end date.
- A proof of concept if you have one. Keep it small and harmless.
- Whether the problem needs administrator rights, another local account, a malicious web page in your browser, or a
  planted file in a folder.

Do not attach `backend.lock`, a one-time launch link (`/session.html#<code>`), a session cookie, a settings file or a
log without checking it first. The lock file holds the session secret.

## What to expect

This is one person's project, so the times below are aims and not promises.

| Step | Aim |
| --- | --- |
| Acknowledgement that the report arrived | Within 7 days |
| A first assessment: accepted, needs more information, or declined with a reason | Within 14 days |
| A fix or a mitigation for a confirmed issue | Within 30 days for a serious one, longer for a minor one |
| Public note of the fix (a release note, and an advisory when the issue deserves one) | When the fix is released |

If a fix will take longer, you will be told why. You are asked to keep the details private until a fix is released,
or until 90 days have passed with no reply, whichever comes first. You will be credited in the release note if you
want to be.

## Scope

In scope:

- **The local backend.** It binds `127.0.0.1` in code and refuses a peer that is not loopback. It accepts only the
  hosts `127.0.0.1` and `localhost`, has no CORS, and sends a strict content security policy with `frame-ancestors
  'none'`, `X-Frame-Options: DENY` and `nosniff`. Every `/api` path, the live stream included, answers 401 without a
  live session cookie, and a write needs a same-origin `Origin` as well. The cookie is `HttpOnly` and
  `SameSite=Strict`. The one-time launch code lives 60 seconds and works once. See the safety section of the
  [README](README.md) and `backend/nq_terminal/app.py`.
- **What the backend can write.** Every route is GET except three: queue a backtest and stop one (`JOBS`), and the
  workspace store. A test pins the route set. Anything that adds another write, or reads a price past the in-sample
  end date, or reaches an order call, is a vulnerability here.
- **The desktop shell and its IPC.** The shell is a Tauri 2 app. The page it shows gets no shell command and no
  plugin permission (`desktop/src-tauri/capabilities/main.json` lists none). The test `ipc_refusal.rs` calls every
  core and plugin command from the backend's page and from the shell's own origin and fails unless each is refused.
  The shell writes only inside an allow list under the lab's `terminal\state`, with handle-based checks, and its
  downloads go through WebView2's own download event. The shell proves the backend's identity with a
  challenge-response before it hands over the session token, so a process that took the port first does not receive
  it. Clippy bans sockets, direct file writes and process creation outside a few named functions. A way round any of
  these is in scope. The full list is in [`desktop/README.md`](desktop/README.md).
- **The per-user installer and its protected-folder rules.** The installer is per user and asks for no
  administrator rights. Whatever folder you pick, it is created with a protected access list (you, SYSTEM and
  Administrators, nothing inherited) before any file is written, and the lists are read back afterwards. It refuses
  a drive root, a network path, Program Files, the Windows folder, a link or junction, an existing file, an existing
  folder that another account owns or that holds anything but the program's own files, and a folder inside a parent
  another account could rename away. The hooks are in `desktop/src-tauri/windows/nsis/hooks.nsh`. A way to make the
  installer write somewhere it should refuse, leave a folder writable by another account, or load a file planted in
  the install folder is in scope.
- **The update and rollback path.** There is no updater: `tauri-plugin-updater` is banned in `desktop/src-tauri/deny.toml`, and the
  artefact check asserts that no updater artefact or plugin is present. An installer you download should match its
  published SHA256 hash. A way to make the app fetch or run code by itself is in scope.
- **The supply chain.** `cargo deny`, `cargo audit`, a ban on named crates, a scan of `web\dist` for keys, and a
  lockfile review. A malicious or vulnerable dependency that reaches the shipped app is in scope.
- **The browser door.** `start.ps1` and `start.sh`, the one-time link, and the demo build in the browser.

Out of scope:

- Attacks that already need administrator rights, or code already running as you on the same machine. Such a
  process can do anything you can do. One consequence is stated openly: the backend's lock reader also trusts a lock
  file owned by Administrators or SYSTEM, so an elevated process is trusted as a backend. See
  [`docs/desktop/owner_decisions_windows.md`](docs/desktop/owner_decisions_windows.md), section 3, item 2.
- Another account on a shared PC reading the default state folder. The lock file inside it is owner-only, but the
  folder inherits from its parent today. This is a known, open item (section 3, item 3 of the same document), so a
  report of it adds nothing unless it shows a way to read the session secret.
- The warning Windows shows for an unsigned installer (see below), and Smart App Control refusing an unsigned file.
- A folder you chose yourself that you left writable to others, after the installer refused or you changed its
  permissions by hand.
- Findings about the research itself: a result, a statistic or a hypothesis you disagree with. Open a normal issue.
- Denial of service by a user who can already run programs on the machine, and crashes with no security effect.
- Problems in a third-party library with no route to this app. Report those upstream.
- Social engineering, physical access, and the security of other programs on your machine.
- Interactive Brokers: the optional snapshot is off by default, reads only, accepts paper accounts only, and refuses a
  host that is not this machine. A report that its limits can be bypassed is in scope. The security of TWS or the
  Gateway is not.

## The app is unsigned for now

The 0.1 installer has no Authenticode signature. Windows SmartScreen will warn about a downloaded copy
("Windows protected your PC", unknown publisher), and Smart App Control, if you switch it on, would refuse an unsigned
program outright. This is a decision for now, not an oversight. [`docs/desktop/smartscreen.md`](docs/desktop/smartscreen.md)
explains what you will see, how to check the installer's hash before you run it, and when signing will be reopened.
The release `desktop-v0.1.0` is an installer of 3,253,432 bytes with SHA256
`2f4b5c4cdf37a5a520be4517d7efd725288ac9ae28b047e85b302e9f52c4b590`. Check the hash against a source other than the file
you downloaded. Do not click through a prompt if the hashes differ by even one character.

## Update and rollback

An update is a new installer, installed by hand after the hash check. It replaces the install folder only and never
touches the lab, `terminal\state`, `settings.json` or the WebView2 data folder. The installer allows a downgrade, and
the recommended rollback is to uninstall and install the earlier release you kept. If a release turns out to carry a
security flaw, the fix is a new release and a note on the release page, and the browser door (`start.ps1`) keeps
working in the meantime. The steps are in [`docs/desktop/handover_windows.md`](docs/desktop/handover_windows.md),
section 4.

## Safe harbour

Good-faith research on your own machine that follows this policy is welcome. Do not test against anyone else's
machine, do not read or keep data that is not yours, and stop and report as soon as you have shown the problem. The
terminal holds no accounts and no user data of other people, so there is no hosted service to attack: everything runs
on the machine of the person who installed it.

## Licence

See [LICENSE](LICENSE).
