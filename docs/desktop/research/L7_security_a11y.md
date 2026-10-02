# L7: Security and accessibility on the desktop

Research lens L7 of the desktop migration plan. It asks what changes in the attack surface, the supply chain, the handling of secrets, the two safety guarantees (the read-only IB snapshot and the out-of-sample research gate) and accessibility when the nq-lab terminal moves from a local web app to a native desktop app on Windows and macOS.

- Evidence checked: 2 October 2026. Every external claim carries a source in the Sources list at the end (S1, S2, ...). Anything not confirmed from a primary source is marked **unverified**.
- Local facts come from reading the repository at HEAD `c7f9e61` on the same date (no app was run and nothing was measured live).
- Scope: the shell choices the other lenses consider, mainly Tauri 2 (system webview plus Rust), Electron (bundled Chromium plus Node), Wails (system webview plus Go) and fully native Rust toolkits (egui, iced, Slint). The Python backend is assumed to stay, at least in the first phase, as a sidecar process.

## 1. Bottom line

1. **The terminal already carries most of the security it needs.** The backend is loopback only, same-origin, GET only bar two job routes, has a strict CSP, an AST ban on IB order calls with four layers of defence, and an AST ban that keeps every data read inside `nq_lab.data.serve` (ARCHITECTURE sections 5 to 9). A desktop shell must not weaken any of that. The safest migration keeps the Python backend and its tests unchanged and treats the shell as a thin, nearly powerless window.
2. **A webview shell adds a new trust boundary: the IPC bridge from the page to native code.** In Tauri this is controlled by capabilities (default deny once configured, S9). Tauri has had 9 security advisories in its own repository since 2022, two of them in 2026, both IPC access-control flaws: an origin confusion on Windows that let a remote page call local-only commands (fixed in 2.11.1, S3) and a channel queue that let one webview read another's responses (high severity, fixed in 2.11.6, published 26 September 2026, S2). The current stable release is 2.12.1 (30 September 2026, S8). **The lesson: give the page no Tauri commands at all, or as few as possible, and track Tauri releases closely.**
3. **Electron is the heavier security burden.** It ships its own Chromium and Node, so the app owns every Chromium patch. Its repository lists 61 advisories, 41 of them published in 2026 up to 2 October (S22), several high and one critical (a heap overflow in `Buffer`). Its 20 point security checklist (S20) and nine fuses (S21) are good, but each is one more thing to get right. For a one-owner research terminal there is no security reason to pick Electron.
4. **Native Rust toolkits remove the IPC surface but fail accessibility today.** iced has had no screen reader support since the request was opened in October 2020 (issue still open, S28). egui uses AccessKit but has no live regions (open since January 2023, S29), which a streaming terminal needs. Zed's own toolkit is "absolutely inaccessible" to NVDA and JAWS on Windows (open, S30). Rewriting the UI natively would put the WCAG 2.2 AA promise at real risk; a webview shell keeps the existing ARIA work.
5. **The sidecar's loopback port is the main new risk, and it has a cheap fix.** Load the UI from the backend's own origin, choose a random free port per launch, give the backend a per-launch token, and have the shell check the backend's identity before it shows the window. This keeps the existing `SameOriginApiMiddleware` and CSP working unchanged. A custom-protocol proxy cannot carry the SSE live streams, because wry has no streaming response support (open feature request, S19).
6. **Updates are a signing problem, not a code problem.** The Tauri updater refuses unsigned updates and this cannot be turned off (S14). The real asset is the updater private key: losing it strands every installed copy (S14), and Tauri itself once leaked such keys through Vite environment variables (CVE-2023-46115, S5).
7. **Supply chain: the front end is already well defended, the Rust side needs the same.** The web app pins pnpm 11.5.1, whose defaults since 11.0.0 hold back any package less than one day old and refuse unlisted install scripts (S49). The npm and crates.io ecosystems both had real attacks in the last 13 months (Shai-Hulud, more than 500 npm packages, September 2025, S50; Axios, March 2026, S51; `arrayref` on crates.io, live for 86 to 107 minutes, August 2026, S53). The Rust side needs `Cargo.lock` with `--locked`, cargo-deny (0.20.2) and cargo-audit (0.22.2) in CI from the first commit (S46, S47).
8. **The terminal itself holds almost no secrets.** It never uses the QuantPad key (it only reports the `quantpad-data` version), and the IB settings are a flag, a host and a port, not credentials. The secrets that matter are build-side: the updater key, the Apple notarisation key and any Windows signing credential. The one runtime leak path is that the job runner copies the whole parent environment into each backtest child (`_child_env`, measured), so whatever the shell puts in the backend's environment reaches every `run_base.py` run.
9. **The read-only IB guarantee and the research gate stay in Python.** The shell must contain no IB code and no data-reading code, and that can be enforced in Rust with cargo-deny `bans` (forbid the `ibapi`, `parquet`, `arrow`, `polars` and `duckdb` crates in the shell), Clippy `disallowed-methods`, and an extension of the existing source scans to the new `src-tauri` folder.
10. **Accessibility: WCAG 2.2 AA still applies, through WCAG2ICT** (W3C Group Note, 11 December 2025, S37). Four criteria do not apply to non-web software under EN 301 549 and Section 508 (2.4.1, 2.4.5, 3.2.3, 3.2.4). Two gaps exist today regardless of the shell: there is no `forced-colors` handling (Windows contrast themes) anywhere in `web/src`, and the canvas charts are invisible to screen readers unless each has a text or table alternative. The desktop move adds one keyboard risk: WebView2's own browser keys (F5, F7, F12, Ctrl+F, Ctrl+P) collide with the terminal's F-key grammar.

## 2. The baseline that must not regress

These facts were read from the repository (HEAD `c7f9e61`, 2 October 2026). They are the starting line for every desktop option.

| Control | What it does today | Where |
|---|---|---|
| Loopback only | 403 unless both the peer and the local address are loopback; server binds 127.0.0.1 | `backend/nq_terminal/security.py`, `LoopbackOnlyMiddleware` |
| Same origin | A GET under `/api` is refused when `Sec-Fetch-Site` is not `same-origin` or `none`, or `Origin` is not the terminal | `SameOriginApiMiddleware` |
| Host check | `TrustedHostMiddleware(allowed_hosts=["127.0.0.1", "localhost"])` against DNS rebinding | ARCHITECTURE section 9 |
| CSP | `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` | `security.py`, `CONTENT_SECURITY_POLICY` |
| Other headers | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` | `security.py` |
| GET only | Every route is GET except `POST` and `DELETE` under `/api/jobs`, which need `X-NQT: 1` and JSON | ARCHITECTURE section 8 |
| IB read-only | Client id 95; twelve order-style calls overridden to raise; outgoing message ids limited to an eight-id allow list; DU accounts only; live ports 7496 and 4001 refused; AST ban on order names across `terminal/` Python and web sources, derived from the library so a new library method is a failing test | `services/ib_readonly_client.py`, `tests/test_ib_readonly_ast.py`, `tests/ib_bypass_scan.py` |
| Research gate | One door (`nq_lab.data.serve`), AST ban on `read_parquet`, `pyarrow.dataset`, `duckdb`, `polars`, `serve_sealed` and any `data/processed` or `data/raw` string; nothing after 2021-12-31 | ARCHITECTURE section 5 |
| No writes | AST scan for writing calls plus an in-process audit hook refusing writes under `results/`, `backtests/output/`, `data/`, `live/` | ARCHITECTURE section 9 |
| Secrets | None served; account ids masked; environment values reported as set or unset only | ARCHITECTURE section 9 |
| Job child environment | `{**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}`: the full parent environment | `services/jobs.py`, `_child_env` |
| Front-end lockfile | 295 package entries in `web/pnpm-lock.yaml`; `packageManager` is `pnpm@11.5.1`; one `minimumReleaseAgeExclude` entry | `web/package.json`, `web/pnpm-workspace.yaml` |
| Python lockfile | 76 packages in the lab's `uv.lock` | `nq-lab/uv.lock` |
| Accessibility tests | axe (`@axe-core/playwright` 4.13.0) in at least 10 e2e specs; 8 `aria-live` uses in `.tsx`; 2 `prefers-reduced-motion` blocks; **no** `forced-colors` or `prefers-contrast` rule in `web/src` | `web/package.json`, `web/e2e`, `web/src` |

The desktop plan should treat this table as a contract: a desktop build that cannot run the same backend tests, the same crosscheck and the same axe checks is a regression.

## 3. Threat model for a one-owner desktop app

| Asset | Why it matters | Main threats in a desktop build |
|---|---|---|
| Research gate integrity (no 2022+ data, sealed data never served, audit log honest) | The lab's results are only valid if the out-of-sample period stays unseen | A new code path that reads data around `serve`; a page that forges gate reads into `oos_access_log.jsonl` |
| IB paper account | Orders must never be sent from the terminal | New IB code in the shell; a page that reaches TWS directly |
| The owner's machine | A desktop app runs with the owner's full user rights | Malicious content reaching native code through IPC; a compromised dependency; a hijacked update |
| Update channel and signing keys | Whoever holds the updater key can push code to the owner's machines | Key leak through build tooling or CI logs; key loss |
| QuantPad key | Paid data access | Leak through logs, environment inheritance or a crash dump |

Out of scope: malware already running as the owner. On both platforms a process running as the same user can read the user's environment variables, files and, on Windows, Credential Manager entries (see section 8). No shell choice fixes that.

What makes this app unusual, and easier, is that it loads **no remote content**. All scripts and fonts are self-hosted (CSP `default-src 'self'`). The usual desktop webview disaster, a remote page or a cross-site script reaching native APIs, needs a way for untrusted script to run inside the window. Today that way would be a compromised npm dependency, not a web page.

## 4. Attack surface per shell

### 4.1 Tauri 2

**Model.** Tauri splits the app into a Rust core with full system access and a webview with access only through the IPC layer, controlled by capabilities (S9). A capability binds a set of permissions to window or webview labels. Once capabilities are configured "only these are used in the application build" (S9). Windows that belong to more than one capability merge their permissions (S9), so one over-broad capability silently widens every window it names.

**What capabilities do not protect against**, in Tauri's own words: malicious Rust code, overly permissive scopes, webview bugs and supply chain attacks (S9).

**Remote content.** By default the APIs are reachable only from bundled code; a capability may name remote URLs to open commands to them (S9). On Linux and Android Tauri "is unable to distinguish between requests from an embedded `<iframe>` and the window itself" (S9). This matters for section 5, where the recommended design loads the UI from a loopback URL.

**CSP.** Tauri injects nonces and hashes into the CSP of bundled assets at compile time, and has **no CSP unless one is configured** (S10). `dangerousDisableAssetCspModification` turns the injection off per directive (S12). A detail to test in the spike: under CSP Level 2 and later, a browser ignores `'unsafe-inline'` in a directive that also carries a nonce or hash, so the terminal's `style-src 'self' 'unsafe-inline'` may stop allowing dynamic `<style>` elements (dockview, ECharts, Perspective) once Tauri adds nonces. This interaction is **unverified** for this app; it does not arise if the UI is served by the backend (section 5), because Tauri modifies only bundled assets.

**Isolation pattern.** Every IPC message passes through a small sandboxed iframe application that can validate or reject it, at a small AES-GCM cost (S11). Tauri "highly recommends" it (S11). Limits: ES modules do not load inside it and Windows needs scripts inlined (S11). The 2024 audit found that the isolation key could be read or exported from the frame (TAU2-040, TAU2-062, both High) before they were fixed (S17). Use it only if the page gets any commands at all.

**Hardening switches** (from the config schema, S12): `freezePrototype` (runs `Object.freeze(Object.prototype)` before any page script, default off); `devtools` is off in release builds unless the `devtools` feature is compiled in; `useHttpsScheme` changes the origin on Windows and moves stored page data (IndexedDB, cookies, local storage) if flipped between releases.

**Advisories.** All 9 advisories in the Tauri repository (S1):

| ID | Published | Severity | Summary | Fixed in |
|---|---|---|---|---|
| GHSA-w28w-mhc8-qvjv | 2026-09-26 | High | Channel `fetch` command skipped the ACL; sequential `u32` ids let one webview read another's queued responses (S2) | 2.11.6 |
| GHSA-7gmj-67g7-phm9 (CVE-2026-42184) | 2026-05-06 | Medium | `is_local_url` on Windows and Android checked only the first label, so `http://app.attacker.com/` passed as local `http://app.localhost/` (S3) | 2.11.1 |
| GHSA-57fm-592m-34r7 (CVE-2024-35222) | 2024-05-23 | Medium | Remote iframes could reach IPC (S4) | 2.0.0-beta.20, 1.6.7 |
| GHSA-2rcp-jvr4-r259 (CVE-2023-46115) | 2023-10-19 | Low | Updater private keys possibly leaked through Vite environment variables (S5) | 1.5.x line |
| Five more (2022 to 2023) | | Low to Medium | Filesystem scope bypasses, an open redirect exposing IPC (S1) | v1 line |

Plugin advisories in `tauri-apps/plugins-workspace` (S6, S7): the `shell` plugin's `open` endpoint let `file://`, `smb://` and `nfs://` through its protocol filter, a path to code execution (High, CVE-2025-31477, fixed in 2.2.1); and default filesystem permissions were hardened in `fs` 2.5.2 (Low, 2026-08-31).

**Independent audit.** Radically Open Security tested Tauri 2.0 between November 2023 and August 2024, funded by NLnet: 11 High, 2 Elevated, 3 Moderate, 5 Low and 2 Info findings, including "Inline frame is allowed to call IPC" and an unauthenticated development server that leaked arbitrary files (S17, counts read from the report). Tauri states all findings were resolved before the 2.0 release (S18).

**Plugins to avoid.** `localhost` ("considerable security risks", S13); `shell` exposed to the page (spawn the sidecar from Rust instead, S15); `fs`, `http` and `deep-link` unless a feature needs them. Deep links are command-line input on Windows, and Tauri warns that "the user could trigger a fake deep link manually" (S16). The terminal has no use for a URL scheme.

**Version state.** Stable 2.12.1 (30 September 2026); a 3.0.0 alpha line is in progress (alpha.4, 1 October 2026) (S8). A major version during the migration is a planning risk, not a security one.

### 4.2 Electron

- Ships its own Chromium and Node, so every Chromium security fix arrives only when the app is rebuilt on a new Electron. Current release 44.5.1, 30 September 2026 (S23).
- Repository advisories: 61 in total, 3 published in 2025 and 41 in 2026 up to 2 October (S22). The 2026 list includes a critical heap overflow in `Buffer` (CVE-2026-54257), a context isolation bypass by prototype hijack (CVE-2026-70601, High), and a sandboxed preload code-cache poisoning (CVE-2026-102677, High). These are Electron's own bugs, on top of Chromium's.
- Defaults are sound: context isolation since 12.0.0 and process sandboxing since 20.0.0 (S20). The 20 point checklist (S20) and the fuses (S21) must still be applied by hand. Four fuses that matter here are on by default and should be turned off: `runAsNode`, `nodeOptions`, `nodeCliInspect` and `grantFileProtocolExtraPrivileges`; `embeddedAsarIntegrityValidation` and `onlyLoadAppFromAsar` are off by default and should be turned on (S21).
- Accessibility is Chromium's, which is the most complete of all the options.

### 4.3 Wails

Uses the same system webviews as Tauri, with Go instead of Rust. Latest release v2.14.0 (10 August 2026); the repository lists no security advisories (S24). No published third-party audit was found (**unverified**). No Go toolchain is installed on the owner's PC.

### 4.4 Native Rust toolkits (egui, iced, Slint)

No webview and no IPC bridge: the attack surface is the Rust code and its crates. This is the smallest surface on paper. The cost is accessibility (section 10) and a full rewrite of 30 function screens, which is where new bugs would come from. They also lose the axe test suite, since there is no DOM.

### 4.5 System webviews: who patches them

| Webview | Patched by | Note |
|---|---|---|
| WebView2 (Windows; used by Tauri and Wails) | Microsoft, Evergreen runtime, same cadence as Edge Stable (S25) | A running app keeps the old runtime until it restarts; Microsoft calls this out as a security implication and offers a `NewBrowserVersionAvailable` event (S25). A terminal left open for days should prompt a restart. WebView2 Runtime 154 is installed here. |
| WKWebView (macOS) | Apple, with macOS updates (latest batch 28 September 2026, S26) | Fixes depend on the owner keeping macOS current. |
| Bundled Chromium (Electron) | The app developer | Every Chromium fix needs a rebuild and an update. |

A Fixed Version WebView2 runtime would freeze patches and add more than 250 MB (S25); keep Evergreen.

## 5. The sidecar and its loopback port

The Python backend stays as a separate process. How the window talks to it decides most of the new risk.

| Option | How it works | Security | Fit |
|---|---|---|---|
| A. UI served by the backend | The shell starts the backend, waits until it is healthy, then points the window at `http://127.0.0.1:<port>/` | Page and API stay same-origin, so `SameOriginApiMiddleware`, `TrustedHost` and the backend CSP work unchanged. The page is a "remote" URL to Tauri, so it gets no Tauri commands unless a capability names it (S9) | Best. No front-end change; SSE keeps working |
| B. UI bundled in the app, API on loopback | Window loads `tauri://localhost` (macOS) or `http://tauri.localhost` (Windows) and calls `http://127.0.0.1:<port>/api` | Cross-origin, so the backend would need CORS and the same-origin middleware would have to change; that weakens a tested control | Poor |
| C. Rust proxy through a custom protocol | Bundled UI; Rust forwards `/api` to the backend | Same-origin again, but SSE cannot pass: wry custom protocols return whole bodies, streaming responses are an open request since October 2024 with no one working on it (S19) | Breaks live streams |
| D. Replace HTTP with Tauri IPC | Rust commands and channels carry the data | Rewrites the API layer and puts the IPC surface (section 4.1 advisories) on the critical path | Large change, more risk |

**Recommendation: option A, hardened.** Concretely:

1. **Random port per launch.** The shell asks the OS for a free port and passes it to the backend; no fixed 8765 in the desktop build (the owner's browser terminal on 8765 keeps running separately).
2. **Prove the backend's identity before showing the window.** Port squatting is the real loopback risk: if another local program binds the port first, the window would render that program's page. The shell should create a random per-launch secret, pass it to the backend on standard input (not the command line, which other processes can read), and require the backend to echo a proof (for example an HMAC of a shell-chosen nonce) on a health route before navigating. The window should refuse any navigation away from `http://127.0.0.1:<port>`.
3. **Per-launch token on every API call.** The backend accepts `/api` requests only with the token (a header for fetch, a cookie set by the first page load for SSE and images). This blocks other users' processes and the owner's browser tabs. It does not stop malware running as the owner, which is out of scope.
4. **Zero Tauri permissions for the page.** If a command is ever needed (for example "open the logs folder"), declare a capability that names only that command and only the exact loopback origin, and validate every argument in Rust.
5. **Keep the existing `TrustedHost` list** and add the random port to `terminal_origins`, so the Origin check still matches. These are backend changes that need their own tests; they belong to the build plan, not to this lens.
6. **Unix domain sockets or named pipes** would remove the TCP port entirely, but the browser engine cannot fetch over them, so they only help with option C or D. Not recommended for phase 1.

## 6. The updater channel and signing

- Tauri's updater requires a signature and "this cannot be disabled" (S14). Keys come from `tauri signer generate`; losing the private key means "you will NOT be able to publish new updates to the users that have the app already installed" (S14). Keep two offline backups of the key and its password.
- HTTPS is the default; `dangerousInsecureTransportProtocol` turns it off and must stay off (S14).
- CVE-2023-46115 (S5): Vite exposes environment variables with chosen prefixes to the bundle, and the `TAURI_` prefix once pulled the signing key into the front-end build. The terminal's `vite.config.ts` must never list a prefix that matches a signing variable; a CI check that greps the built `dist` for the key's public half and for `PRIVATE` strings is cheap.
- On Windows the updater's default `passive` mode shows a small progress window; `quiet` needs existing admin rights (S14). Either way an update runs a signed installer.
- Build provenance: GitHub artifact attestations (`actions/attest`, verified with `gh attestation verify`) record where and how a release was built (S56). Plan tier availability was not stated on the page read (**unverified**); the repository is public according to L4.
- Code signing and notarisation are covered in L4. The security point here: an unsigned Windows build trains the owner to click "Run anyway", which is the same click a malicious copy would ask for.

## 7. Supply chain

### 7.1 Recent incidents (why this is not theoretical)

| Date | Ecosystem | What happened | Source |
|---|---|---|---|
| September 2025 | npm | "Shai-Hulud" self-replicating worm compromised more than 500 packages, stole tokens and cloud keys, republished itself; CISA advised pinning to versions from before 16 September 2025 | S50 |
| 24 September 2025 | crates.io | `faster_log` and `async_println` searched file contents for private keys at run time | S52 |
| 31 March 2026 | npm | Axios 1.14.1 and 0.30.4 pulled in `plain-crypto-js@4.2.1`, which fetched a remote access trojan | S51 |
| 25 May 2026 | Cargo | CVE-2026-5223: a crate in a third-party registry could override another crate's source through symlinks in the tarball; fixed in Rust 1.96.0; crates.io users not exposed | S54 |
| 20 August 2026 | crates.io | `arrayref` 0.3.10 (plus `internment` 0.8.7 and `append-only-vec` 0.1.9) published from a likely hijacked account with malware dependencies; online for 86 to 107 minutes | S53 |

### 7.2 Controls

**npm (already strong).** pnpm 11.0.0 (28 April 2026) made `minimumReleaseAge` default to 1440 minutes, so a new version is not resolved for a day; `strictDepBuilds` and `blockExoticSubdeps` default to true; no dependency runs build scripts unless listed in `allowBuilds` (S49). A one-day delay would have kept both the Shai-Hulud and the Axios versions out. The terminal already pins `pnpm@11.5.1` and uses `minimumReleaseAgeExclude` for one package, so these defaults are live. Adding the Tauri JavaScript API package adds a handful of packages to the 295 already locked.

**Rust (new, must be set up from the first commit).**

| Control | Version (crates.io, 2 October 2026) | What it gives |
|---|---|---|
| `Cargo.lock` committed, builds with `--locked` | n/a | No silent upgrades |
| cargo-deny | 0.20.2 (S47) | Advisories (RustSec), licence policy, `bans` with `wrappers` (a crate may be a direct dependency only of named crates, S46), source allow list, and a `build` check that denies native executables in build scripts by default (S46) |
| cargo-audit | 0.22.2 (S47) | RustSec advisories against `Cargo.lock` |
| cargo-vet | 0.10.2 (S47) | Recorded human audits per crate version; heavy for one owner, optional |

A one-day hold like pnpm's has no built-in Cargo equivalent that was confirmed here (**unverified**); the practical substitute is to update crates deliberately, never in the same step as a release, and to run cargo-deny and cargo-audit in CI on every pull request.

**Python (unchanged).** The lab's `uv.lock` (76 packages) and the dependency change procedure in ARCHITECTURE section 10 stay as they are. If a later phase bundles the Python runtime, the bundle must be built from the same lock.

**Reproducible builds.** Neither Tauri nor Electron claims bit-for-bit reproducible release builds in the pages read (**unverified**). For one owner, signed releases built only in CI from a tagged commit, plus attestations (S56), are the realistic goal.

## 8. Secrets

### 8.1 What secrets exist

| Secret | Used by | Where it lives today | Desktop risk |
|---|---|---|---|
| QuantPad API key | Lab scripts (`nq_lab/es_options.py` reads `QUANTPAD_API_KEY` from the environment); **not** the terminal | Environment variable | The shell's environment flows into the backend and then into every backtest child (`_child_env`) |
| IB settings (`NQT_IB_READONLY`, `IB_HOST`, `IB_PORT`) | Terminal IB snapshot | Environment variables | Not secrets. TWS holds the login. Store them in app settings, not the keychain |
| Tauri updater private key and password | CI only | Not created yet | Highest value secret of the whole project (section 6) |
| Apple notarisation API key | CI only | Not created yet | Can sign as the owner's developer identity |
| Windows signing credential | CI only, if bought | Not created yet | Same |

### 8.2 OS keychains

| Store | Facts | Caveat |
|---|---|---|
| Windows Credential Manager | Generic credentials hold at most 2,560 bytes (`CRED_MAX_CREDENTIAL_BLOB_SIZE`, 5 x 512); `CRED_PERSIST_LOCAL_MACHINE` makes the entry visible to the same user's other logon sessions on that machine (S44) | The structure has no per-application access list (S44), so any process running as the owner can read the entry. It protects against other users and offline disk theft, not same-user malware |
| macOS file-based (legacy) keychain | Per-item ACL tied to the code signature of the creating app | Every rebuild with a new signature triggers an "allow access" prompt; the keyring-rs maintainer advises the data protection keychain for real apps (S42) |
| macOS data protection keychain | Access groups come from code signing entitlements, which "must be authorized by a provisioning profile" and need an app-like bundle (S45) | Needs the Apple Developer Program, which L4 costs at $99 a year |

Libraries: the Rust `keyring` crate 4.2.0 (MIT or Apache-2.0) covers macOS Keychain and Windows Credential Manager, and points to `keyring-core` for finer control (S41); the Python `keyring` package is 25.7.0 (MIT, 16 November 2025, S43).

**Recommendation.** Phase 1: the terminal does not need the QuantPad key, so the shell should start the backend with a cleaned environment that drops `QUANTPAD_API_KEY` unless the owner turns on a setting. That closes the inheritance path into job children. Phase 2: if a desktop feature needs the key, read it from the keychain in the process that uses it, at the moment it is used (Python `keyring` in the backend or a Rust command that hands it over a pipe), never through the child environment. On macOS this only becomes prompt-free once the app is signed with a Developer ID and a provisioning profile.

## 9. Keeping the two safety guarantees

### 9.1 Read-only IB

The current guarantee lives in Python: the subclass that raises on twelve order-style calls, the eight-id outgoing allow list, the fixed client id, the DU-only account check, and AST scans across Python and web sources that derive the banned set from the library itself (ARCHITECTURE section 8, `tests/test_ib_readonly_ast.py`). It works because the code that speaks the IB wire protocol is one small file the tests can inspect.

**Keep IB in Python and keep it out of the shell.** The shell needs no IB code. Enforce that mechanically:

1. **cargo-deny `bans`:** deny the `ibapi` crate in the shell's workspace outright (S46). If a Rust IB client is ever wanted, allow it only through one wrapper crate via `wrappers` (S46).
2. **Clippy `disallowed-methods`:** list order-style paths in `clippy.toml`; the lint is warn by default and fires only on configured paths (S48), so CI must run Clippy with `-D warnings`.
3. **A source scan over `src-tauri/`** with the same banned names as the Python scan (they come from `safety_names.py`), so a computed or aliased use is caught the same way the Python bypass scan catches it. The existing scan already covers `web/src`; it must be extended to every new source folder.
4. **No raw sockets in the shell** except the loopback HTTP client used for the health handshake; ban `std::net::TcpStream` outside one module with `disallowed-types`.

Why not a Rust IB client: the maintained crate `ibapi` (4.2.0, MIT, S57) has `place_order` and `cancel_order` in its `src/orders` module. The Python design's second layer, refusing every outgoing message id outside an allow list, would need a fork of that crate, because it builds messages internally. That is a large new safety burden for no gain.

The webview itself cannot reach TWS: the TWS API is a raw TCP protocol that page script cannot open, and `connect-src` falls back to `'self'`.

### 9.2 The research gate

The gate also stays in Python. The shell must not become a second door:

1. No `fs` plugin and the asset protocol off, so the page cannot read files.
2. cargo-deny `bans` on `parquet`, `arrow`, `polars`, `duckdb` and `datafusion` in the shell workspace, the Rust mirror of the Python AST ban in ARCHITECTURE section 5.
3. The shell writes only to its own app data folder (WebView2's user data folder, logs, settings). A test should assert that the configured app data path is not under the nq-lab `results/`, `data/`, `live/` or `backtests/output/` folders.
4. The shell must never set `NQT_FIXTURE_DIR`; the backend's own checks still refuse bad values.
5. Because the backend is unchanged, the three-way crosscheck, the pytest suite and the e2e gate checks (no served point after 2021-12-31) keep running as they do now. A desktop CI job should run them against the exact backend the app ships.

## 10. Accessibility

### 10.1 What WCAG 2.2 AA means for a desktop app

- WCAG2ICT (W3C Group Note, 11 December 2025) explains how WCAG 2.2 applies to non-web software by word substitution ("web page" becomes "software" or "document") (S37).
- EN 301 549 and Section 508 treat 2.4.1 Bypass Blocks, 2.4.5 Multiple Ways, 3.2.3 Consistent Navigation and 3.2.4 Consistent Identification as not applying to non-web software (S37). The terminal meets them anyway as a web app, so nothing is lost by keeping them.
- 1.4.10 Reflow applies as written (S37). A resizable desktop window must still reflow at 320 CSS pixels wide, or the dense panels must justify an exception for two-dimensional content.
- The criteria new in 2.2 at A and AA are 2.4.11 Focus Not Obscured (Minimum), 2.5.7 Dragging Movements, 2.5.8 Target Size (Minimum), 3.2.6 Consistent Help, 3.3.7 Redundant Entry and 3.3.8 Accessible Authentication (Minimum); 4.1.1 Parsing was removed (S38). Dockview panel dragging (2.5.7) needs a keyboard or single-pointer alternative, which the existing UI should already provide.

### 10.2 Screen readers per stack

| Stack | Windows (NVDA, Narrator, JAWS) | macOS (VoiceOver) | Known issues |
|---|---|---|---|
| Tauri (WebView2, WKWebView) | Chromium's accessibility tree through WebView2 | WebKit's tree | NVDA "report text at mouse" fails in frameless windows since Tauri 2.3 (open, S32); WebView2 lost keyboard focus and screen reader access after Alt+Tab when the `unstable` multi-webview feature was on, fixed in 2.12.0 (S33); a tray icon breaks `<select>` for VoiceOver, traced to a macOS bug, not Tauri (S34) |
| Electron | Chromium | Chromium | The most mature; no lens-specific bug found |
| Wails | WebView2 | WKWebView | Same engines as Tauri; no issue search done (**unverified**) |
| egui | AccessKit (UI Automation) | AccessKit (NSAccessibility) | No live regions (open since January 2023, S29); a screen reader freeze on the web demo (open, S29 related list) |
| iced | None | None | Accessibility request open since October 2020 (S28) |
| Slint | AccessKit | AccessKit | Accessibility feature has a big cost on large list views (open since November 2023, S31) |
| GPUI (Zed's toolkit) | None in practice: "absolutely inaccessible" with NVDA and JAWS (open, S30) | Not checked (**unverified**) | |

AccessKit itself is solid infrastructure (adapters for Windows UI Automation, macOS NSAccessibility, AT-SPI on Linux, plus the two mobile systems; MIT or Apache-2.0; 0.25.1 on 25 September 2026) but by its own README does "not yet support all types of UI elements", nor rich text or hypertext (S27). A terminal built from grids and charts that stream live lines is the hard case for it.

**Practical rule for the terminal:** keep the DOM front end in a system webview, use a decorated (framed) window to avoid S32, do not enable Tauri's `unstable` multi-webview feature, and avoid a tray icon on macOS until S34 is fixed by Apple.

### 10.3 Keyboard-only use

- **Browser keys inside WebView2.** WebView2 handles its own keys (F5 reload, F7 caret browsing, F12 developer tools, Ctrl+F find, Ctrl+P print) unless `AreBrowserAcceleratorKeysEnabled` is false. wry exposes this as `with_browser_accelerator_keys` on Windows (S58). A search of the Tauri source on 2 October 2026 found no pass-through (**unverified**, check in the spike). Fallback: the existing key handler calls `preventDefault` on keydown, which a spike must confirm for each key.
- **macOS F-keys** send media actions unless the owner holds fn or changes the system setting. The F-key grammar needs a modifier-free mnemonic alternative (it already has the command line) and the app should document the setting.
- **Focus on activation.** After Alt+Tab or Cmd+Tab, focus must land back in the page (S33 was exactly this failure). Add an automated check in the desktop smoke test.
- Native menus add Cmd and Ctrl shortcuts that must not shadow terminal keys.

### 10.4 High contrast, reduced motion and the canvas problem

| Setting | Web feature | WebView2 (Chromium) | WKWebView (Safari) | Terminal today |
|---|---|---|---|---|
| Windows contrast themes | `forced-colors: active` | Chromium 89 and later (S39) | Media query exists since Safari 16, but macOS has no forced colours mode (S39) | **No rule** in `web/src` |
| macOS Increase contrast | `prefers-contrast: more` | Chromium 96 and later (S39) | Safari 14.1 and later (S39) | **No rule** |
| Reduce motion | `prefers-reduced-motion` | Chromium 74 (S39) | Safari 10.1 (S39) | 2 rules |
| Reduce transparency | `prefers-reduced-transparency` | Chromium 118 (S39) | Not supported (S39) | n/a (no translucency in the amber look) |

Also checked: `script-src 'wasm-unsafe-eval'`, which Perspective needs, is supported from Chromium 97 and Safari 16 (S40), so the existing CSP works in both webviews.

The canvas charts (uPlot, lightweight-charts, ECharts) ignore forced colours and expose nothing to screen readers on their own. ECharts has an `aria` option that writes a text description and adds decal patterns, **off by default** (S36); uPlot's accessibility request is open (S35). The terminal's charts need a text summary and a "show as table" path, and the canvas drawing code should read `matchMedia('(forced-colors: active)')` and switch to system colours. These gaps exist in the browser today; the desktop move simply makes contrast themes more likely to be met.

### 10.5 Testing on the desktop

- Keep axe on the DOM: it runs unchanged against the same front end.
- Add manual passes per release: NVDA and Narrator on Windows, VoiceOver on the Mac, keyboard only, Windows contrast theme on, macOS Increase contrast and Reduce motion on.
- Desktop automation: WebView2 supports remote debugging, so a headless-window smoke test is plausible on Windows (**unverified** for Tauri in this lens); Linux has no such path (open Tauri issue noting "no CDP" on Linux, S59). macOS automation of WKWebView is weaker; plan on manual VoiceOver checks.

## 11. Summary matrix

| Concern | Tauri 2 | Electron | Wails | Native Rust (egui, iced, Slint) |
|---|---|---|---|---|
| New IPC surface | Yes, default deny capabilities; 2 IPC flaws in 2026 (S2, S3) | Yes, contextBridge; 41 own advisories in 2026 (S22) | Yes, Go bindings; no advisories listed (S24) | None |
| Engine patching | OS vendor (S25, S26) | App developer | OS vendor | n/a |
| Third-party audit | Yes, 2024 (S17) | Not checked (**unverified**) | None found (**unverified**) | Not checked |
| Keeps existing CSP and middlewares | Yes with option A | Yes with option A | Yes with option A | n/a |
| Keeps axe tests | Yes | Yes | Yes | No |
| Screen readers | Good, with S32 and S33 caveats | Best | As Tauri (**unverified**) | Partial (egui, Slint) to none (iced, GPUI) |
| Forced colours on Windows | Yes (Chromium) | Yes | Yes | Toolkit work needed |
| Toolchain on this PC | Rust needed (D: only) | Node present | Go needed | Rust needed |

## 12. What this means for the nq-lab terminal

1. **Pick a system-webview shell and keep the DOM front end.** On security and accessibility together, Tauri 2 with the UI served by the existing backend (option A in section 5) is the lowest-risk path. A native Rust rewrite is the highest accessibility risk and loses the axe suite.
2. **Give the page nothing.** No Tauri commands, no `shell`, `fs`, `http`, `localhost` or `deep-link` plugins, `freezePrototype` on, devtools off in release, navigation locked to the backend's loopback origin. Every later command is a reviewed exception with a test.
3. **Harden the sidecar link:** random port, per-launch secret passed on standard input, identity proof before the window opens, token on every `/api` call, origin list updated in `security.py` with tests. These are the only backend changes security needs.
4. **Strip the environment.** Start the backend with an explicit environment that drops `QUANTPAD_API_KEY` and anything else the terminal does not use, because `_child_env` passes everything to backtest children.
5. **Mirror the Python bans in Rust from day one:** cargo-deny (bans on `ibapi`, `parquet`, `arrow`, `polars`, `duckdb`, `datafusion`; advisories; licences; sources), cargo-audit, Clippy `disallowed-methods` and `disallowed-types` with `-D warnings`, and the existing order-name and gate scans extended to `src-tauri/`.
6. **Treat the updater key as the crown jewel:** generate it offline, keep two backups, never expose it to Vite, and check built bundles for it in CI.
7. **Track Tauri security releases.** Two IPC flaws landed in 2026; pin a minimum of 2.11.6 (channel fix) and plan updates within a week of any advisory. Do not adopt 3.0 until it is stable.
8. **Close the two accessibility gaps that exist today:** `forced-colors` and `prefers-contrast` styles, and text or table alternatives for every canvas chart, with forced-colours aware drawing. Then add the desktop specifics: framed window, WebView2 browser keys handled, focus restored after app switching, a manual NVDA and VoiceOver pass per release.
9. **Prompt a restart when WebView2 updates** (`NewBrowserVersionAvailable`, S25), since the terminal tends to stay open for long sessions.
10. **Keep the gate and the IB code where they are tested.** Neither belongs in the shell, and the plan should say so in its acceptance criteria.

## 13. Open questions

- Q1. Does Tauri 2.12 expose WebView2's `AreBrowserAcceleratorKeysEnabled`? If not, does `preventDefault` stop the F5, F7 or Ctrl+P defaults in WebView2 154? Needs the spike.
- Q2. With the UI served by the backend (option A), does Tauri treat `http://127.0.0.1:<port>` as remote for every API, and can the window be locked so no other origin ever loads? Needs the spike.
- Q3. Does Tauri's CSP nonce injection break `style-src 'unsafe-inline'` for dockview, ECharts or Perspective if a later phase bundles the UI? Only relevant if option A is dropped.
- Q4. Will the owner pay the Apple Developer Program fee? Without it the macOS keychain will prompt after every update (S42, S45).
- Q5. Does anything the desktop app should do need the QuantPad key at all? If not, the keychain work can wait.
- Q6. Has Electron or Wails had a published third-party audit? Not found in this lens.
- Q7. How many Rust crates does a minimal Tauri 2.12 app pull in, and which licences? To be measured by the spike step with `cargo tree` and cargo-deny.

## Sources

All checked on 2 October 2026.

- S1. Tauri security advisories: https://github.com/tauri-apps/tauri/security/advisories (GitHub API listing)
- S2. GHSA-w28w-mhc8-qvjv, Improper Tauri IPC Access Control for Fetch Command: https://github.com/tauri-apps/tauri/security/advisories/GHSA-w28w-mhc8-qvjv
- S3. GHSA-7gmj-67g7-phm9, CVE-2026-42184, Origin Confusion: https://github.com/tauri-apps/tauri/security/advisories/GHSA-7gmj-67g7-phm9
- S4. GHSA-57fm-592m-34r7, CVE-2024-35222, iFrames bypass origin checks: https://github.com/tauri-apps/tauri/security/advisories/GHSA-57fm-592m-34r7
- S5. GHSA-2rcp-jvr4-r259, CVE-2023-46115, updater private keys via Vite environment variables: https://github.com/tauri-apps/tauri/security/advisories/GHSA-2rcp-jvr4-r259
- S6. GHSA-c9pr-q8gx-3mgp, CVE-2025-31477, shell plugin `open` scope: https://github.com/tauri-apps/plugins-workspace/security/advisories/GHSA-c9pr-q8gx-3mgp
- S7. GHSA-9g54-6x48-9vpw, fs plugin default permission hardening: https://github.com/tauri-apps/plugins-workspace/security/advisories/GHSA-9g54-6x48-9vpw
- S8. Tauri releases (2.12.1 on 30 September 2026, 3.0.0-alpha.4 on 1 October 2026): https://github.com/tauri-apps/tauri/releases
- S9. Tauri capabilities: https://v2.tauri.app/security/capabilities/
- S10. Tauri CSP: https://v2.tauri.app/security/csp/
- S11. Tauri isolation pattern: https://v2.tauri.app/concept/inter-process-communication/isolation/
- S12. Tauri config schema (`freezePrototype`, `dangerousDisableAssetCspModification`, `useHttpsScheme`, `devtools`): https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-schema-generator/schemas/config.schema.json
- S13. Tauri localhost plugin: https://v2.tauri.app/plugin/localhost/
- S14. Tauri updater plugin: https://v2.tauri.app/plugin/updater/
- S15. Tauri sidecar: https://v2.tauri.app/develop/sidecar/
- S16. Tauri deep linking: https://v2.tauri.app/plugin/deep-linking/
- S17. Radically Open Security, Penetration Test Report Tauri 2.0, 7 August 2024: https://github.com/tauri-apps/tauri/blob/dev/audits/Radically_Open_Security-v2-report.pdf
- S18. Tauri 2.0 stable release post: https://v2.tauri.app/blog/tauri-20/
- S19. wry issue 1404, Streaming protocol: https://github.com/tauri-apps/wry/issues/1404
- S20. Electron security checklist: https://www.electronjs.org/docs/latest/tutorial/security
- S21. Electron fuses: https://www.electronjs.org/docs/latest/tutorial/fuses
- S22. Electron security advisories: https://github.com/electron/electron/security/advisories (GitHub API listing, counted by publication date)
- S23. Electron releases (v44.5.1, 30 September 2026): https://github.com/electron/electron/releases
- S24. Wails releases (v2.14.0, 10 August 2026) and advisories: https://github.com/wailsapp/wails/releases, https://github.com/wailsapp/wails/security/advisories
- S25. Microsoft, Distribute your app and the WebView2 Runtime: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution
- S26. Apple security releases: https://support.apple.com/en-us/100100
- S27. AccessKit: https://github.com/AccessKit/accesskit and https://crates.io/crates/accesskit
- S28. iced issue 552, Implement accessibility support: https://github.com/iced-rs/iced/issues/552
- S29. egui issue 2647, accessibility: expose live regions: https://github.com/emilk/egui/issues/2647 (also issue 7546)
- S30. Zed issue 41138, Windows screen reader accessibility missing completely: https://github.com/zed-industries/zed/issues/41138
- S31. Slint issue 3867, accessibility feature performance on big list views: https://github.com/slint-ui/slint/issues/3867
- S32. Tauri issue 12901, NVDA in a frameless window: https://github.com/tauri-apps/tauri/issues/12901
- S33. Tauri issue 15624 and pull request 15625, focus lost after window activation, released in tauri-v2.12.0: https://github.com/tauri-apps/tauri/issues/15624, https://github.com/tauri-apps/tauri/pull/15625
- S34. Tauri issue 15221, tray icon breaks `<select>` for VoiceOver: https://github.com/tauri-apps/tauri/issues/15221
- S35. uPlot issue 954, Accessibility: https://github.com/leeoniya/uPlot/issues/954
- S36. Apache ECharts, Aria handbook page: https://echarts.apache.org/handbook/en/best-practices/aria/
- S37. W3C, Guidance on Applying WCAG 2 to Non-Web ICT (WCAG2ICT), Group Note 11 December 2025: https://www.w3.org/TR/wcag2ict-22/
- S38. W3C, What's New in WCAG 2.2: https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/
- S39. MDN browser compatibility data, media features: https://github.com/mdn/browser-compat-data/blob/main/css/at-rules/media.json
- S40. MDN browser compatibility data, Content-Security-Policy: https://github.com/mdn/browser-compat-data/blob/main/http/headers/Content-Security-Policy.json
- S41. keyring crate 4.2.0: https://docs.rs/keyring/latest/keyring/
- S42. keyring-rs issue 272, keychain access prompts on rebuild: https://github.com/open-source-cooperative/keyring-rs/issues/272
- S43. Python keyring 25.7.0: https://pypi.org/project/keyring/
- S44. Microsoft, CREDENTIALW structure: https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentialw
- S45. Apple, TN3137 On Mac keychain APIs and implementations: https://developer.apple.com/documentation/technotes/tn3137-on-mac-keychains
- S46. cargo-deny book, bans configuration page (linked from the crate page): https://crates.io/crates/cargo-deny
- S47. crates.io API versions: https://crates.io/crates/cargo-deny, https://crates.io/crates/cargo-audit, https://crates.io/crates/cargo-vet
- S48. Clippy `disallowed_methods` lint source: https://github.com/rust-lang/rust-clippy/blob/master/clippy_lints/src/disallowed_methods.rs
- S49. pnpm v11.0.0 release notes, 28 April 2026: https://github.com/pnpm/pnpm/releases/tag/v11.0.0
- S50. CISA, Widespread Supply Chain Compromise Impacting npm Ecosystem, 23 September 2025: https://www.cisa.gov/news-events/alerts/2025/09/23/widespread-supply-chain-compromise-impacting-npm-ecosystem
- S51. CISA, Supply Chain Compromise Impacts Axios Node Package Manager, 20 April 2026: https://www.cisa.gov/news-events/alerts/2026/04/20/supply-chain-compromise-impacts-axios-node-package-manager
- S52. Rust blog, Malicious crates faster_log and async_println: https://blog.rust-lang.org/2025/09/24/crates.io-malicious-crates-fasterlog-and-asyncprintln/
- S53. Rust blog, Supply chain attack on arrayref: https://blog.rust-lang.org/2026/08/20/supply-chain-attack-on-arrayref/
- S54. Rust blog, Security Advisory for Cargo (CVE-2026-5223): https://blog.rust-lang.org/2026/05/25/cve-2026-5223/
- S56. GitHub Docs, artifact attestations: https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds
- S57. rust-ibapi (crate `ibapi` 4.2.0, MIT): https://github.com/wboayue/rust-ibapi
- S58. wry `with_browser_accelerator_keys`: https://github.com/tauri-apps/wry/blob/dev/src/lib.rs
- S59. Tauri issue 15934, no CDP on Linux: https://github.com/tauri-apps/tauri/issues/15934
