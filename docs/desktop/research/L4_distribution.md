# L4: Distribution and operations for the desktop terminal

Research lens L4 of the desktop migration plan. It covers how a native nq-lab terminal gets onto a Mac and a Windows PC, how it stays up to date, how it is built, how crashes are kept local, and what all of that costs per year.

- Evidence checked: 2 October 2026. Every external claim carries a source in the Sources list at the end (S1, S2, ...). Anything not confirmed from a primary source is marked **unverified**.
- Local facts were measured on the owner's Windows 11 machine on the same date, read only.
- Scope: packaging, signing, notarisation, installers, updates, CI, crash reporting and cost. The choice of shell (Tauri, a native toolkit, and so on) belongs to the other lenses; this lens assumes a Tauri 2 style shell with a bundled or external Python backend, because that is the cheapest route that keeps the React front end, and notes where another shell would change the answer.

## 1. Bottom line

1. **For one owner on two machines, paid signing is optional, not required.** An app you build on your own Mac is not quarantined, and Apple Silicon only demands an ad hoc signature, which the linker adds automatically (S9). A build you download from GitHub Releases is quarantined and, since macOS Sequoia, needs a trip to System Settings to open (S8). On Windows, an unsigned download gets a SmartScreen "Run anyway" prompt; Smart App Control is off on this PC (measured), so nothing blocks it outright.
2. **The Mac target is fixed by NautilusTrader, not by us.** The 1.231.0 wheels for macOS exist only as `macosx_26_0_arm64` (S30). A bundled backend therefore needs Apple Silicon on macOS 26 or later. A universal2 build buys nothing: an Intel Mac could run the shell but not the backend. Build `aarch64-apple-darwin` only.
3. **The heavy part is the Python backend, not the shell.** The lab venv is 723 MB with 383 native `.pyd` modules on Windows (measured). Bundling it means signing and notarising hundreds of native files on macOS, shipping hundreds of megabytes per update unless the updater does deltas, and possible antivirus false positives on Windows. The cheapest honest answer for the owner's own machines is to keep the backend in the existing lab venv and ship only the shell, with a bundled runtime as a later phase.
4. **Windows signing for a UK individual is awkward in 2026.** Microsoft's own service (Artifact Signing, formerly Trusted Signing, $9.99 a month, S5) only takes individual developers in the US or Canada; UK organisations qualify (S4). The routes open to the owner are a commercial OV certificate (Certum Standard from €139 to €209, S15), a UK limited company plus Artifact Signing (£100 to incorporate, £50 a year, S16), or the Microsoft Store with MSIX, where Microsoft signs for free (S18) but Tauri cannot yet produce MSIX (S24). EV buys nothing for SmartScreen any more (S6).
5. **Updates: the Tauri updater is the default and is enough for the shell.** It is mandatory-signed (minisign keys), works from a static JSON on GitHub Releases, and downloads the full artefact every time (S3). Delta updates are an open feature request since December 2024 (S25). If a bundled Python runtime ships inside the app, Velopack (MIT, zstd deltas, per-user install, S20, S21) or a split "engine pack" is the way to keep updates small.
6. **CI is free.** The `nq-terminal` repository is public (measured), and standard GitHub-hosted runners are free and unlimited for public repositories (S11, S12). A macOS 26 arm64 runner exists, which matches the NautilusTrader wheel tag (S12).
7. **Crash reporting stays on disk.** Rust minidumps (crash-handler, minidumper), Python `faulthandler`, macOS DiagnosticReports and Windows WER LocalDumps cover everything without any network call. Self-hosted Sentry wants 16 GB RAM plus 16 GB swap (S22), which is absurd for one user.
8. **Yearly cost ranges from £0 to roughly $330 plus company fees**, see the table in section 8. The recommended path for this owner is $0 in phase 1 and $99 (Apple only) in phase 2, with Windows signing deferred until there is a second user.

## 2. Project facts that drive the answer

| Fact | Value | How it was obtained |
|---|---|---|
| Users | One owner, one Windows 11 PC and one Mac | Owner's brief |
| Repository | `FatihHekim0glu/nq-terminal`, public, no licence file | GitHub API, 2 October 2026 |
| Lab venv size | 723 MB on disk, 722 MB in site-packages | `du` on `nq-lab\.venv` |
| Native modules in venv (Windows) | 383 `.pyd`, 18 `.dll`, 20 `.exe` | `find` on `nq-lab\.venv` |
| NautilusTrader 1.231.0 wheels | Windows `win_amd64` (about 113 MB), macOS `macosx_26_0_arm64` only (about 156 MB), Linux x86_64 and aarch64 | PyPI JSON API (S30) |
| NautilusTrader licence | LGPL-3.0 | GitHub API (S31) |
| WebView2 Runtime on this PC | 154.0.4258.48, per machine | Registry `pv` value (method from S10) |
| Smart App Control on this PC | Off (`VerifiedAndReputablePolicyState` = 0) | Registry, read only |
| Windows build | 10.0.26300 | `OSVersion` |
| Free disk | C: 29 GB, D: about 236 GB (falling as spike builds use it) | `Get-PSDrive` |

Three consequences follow straight away:

- The Mac build must target **arm64, macOS 26 minimum** if it bundles NautilusTrader. The owner's Mac model and macOS version are not known from here (open question Q1).
- A bundled backend is large. A full-download updater would move well over 100 MB per release on each platform.
- Because C: is nearly full, a per-user Windows install (which lands under the user profile on C: by default) of a bundled build would eat into the 29 GB that is left. The installer should allow a D: folder, or the shell-only build should be used.

## 3. macOS

### 3.1 Developer ID and the Apple Developer Program

- Distribution outside the Mac App Store uses a **Developer ID Application** certificate; only the Account Holder can create one (S1).
- The Apple Developer Program costs **$99 a year**, with local currency prices shown at enrolment (S7). The UK price is reported as **£79 a year** by secondary sources only (S40, **secondary**, confirm at enrolment).
- An individual enrolment needs a legal name and two-factor authentication; an organisation enrolment needs a D-U-N-S number and a public website (S7).
- A free Apple account cannot notarise (S1).

### 3.2 Notarisation

Apple's notary service is an automated malware and signature scan, not App Review (S2). To pass, the software must (S2):

- sign every executable with a Developer ID certificate;
- enable the **Hardened Runtime**;
- include a **secure timestamp** (only `timestamp.apple.com` is accepted, S2b);
- not carry `com.apple.security.get-task-allow` set to true;
- link against the macOS 10.9 SDK or later.

Since 1 November 2023 only `notarytool` (or Xcode 14 and later) is accepted; `altool` is gone (S2). Apps, disk images (UDIF) and flat installer packages can all be notarised, and the ticket can be stapled so Gatekeeper does not need to go online (S2). Tauri reads notarisation credentials either as an App Store Connect API key (`APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_PATH`) or as an Apple ID with an app-specific password (`APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`) (S1). For CI the API key is the better choice because it does not depend on a personal password.

Turnaround: Apple says results come back "quickly" (S2). Reports of multi-hour delays exist in community forums but were not checked here (**unverified**). Plan the release job so a slow notarisation does not block the Windows artefact.

### 3.3 Hardened Runtime and entitlements

Entitlements belong to executables only; shared libraries inherit them from the host process (S2c). For this app that means two separate entitlement sets:

| Executable | Likely entitlements | Why |
|---|---|---|
| Tauri shell | None beyond the defaults | WKWebView runs its web content in system processes, so the shell does not need JIT. To confirm in a spike (**unverified**). |
| Bundled Python (sidecar) | `com.apple.security.cs.allow-unsigned-executable-memory`, possibly `com.apple.security.cs.disable-library-validation` | BeeWare Briefcase applies exactly these two by default to every Python app it ships for macOS (S23). If every `.so` and `.dylib` is re-signed with our own Team ID, library validation may pass without the second one (**unverified**, test in the spike). |

Known trouble with frozen Python on macOS: PyInstaller has open issues where signed one-folder builds fail with "no cdhash, completely unsigned?" (pyinstaller #8029, open since 2023) and a closed report of a PySide6 one-folder app that could not be notarised (#8927) (S26). The lesson is to sign inside-out (every Mach-O file, then the bundle) with a script and to run `codesign --verify --deep --strict` and `spctl` on the result before uploading, as Apple's troubleshooting guide recommends (S2b).

### 3.4 App Sandbox: no

The App Sandbox is only mandatory for the Mac App Store. The terminal spawns a Python process, binds a loopback port, reads the lab's data folder through `nq_lab.data.serve` and runs backtests through `Popen`. Each of those needs a sandbox exception or a security-scoped bookmark. Tauri itself still has an open request just to support sandbox entitlements during `tauri dev` (tauri #15144, S24). Recommendation: **no sandbox, no Mac App Store**, Developer ID plus notarisation only.

### 3.5 Gatekeeper, quarantine and what happens without paying

- Apple Silicon Macs refuse to run any unsigned native arm64 code, but an **ad hoc signature is enough**, and `clang` and `ld` add one automatically at link time (S9). Tools that change a binary after linking (`strip`, `install_name_tool`) break it, so re-sign ad hoc after such steps (S9).
- Gatekeeper checks software that carries the quarantine attribute, which browsers and AirDrop add (S2). A build produced on the Mac itself has no quarantine attribute and runs without prompts.
- Since macOS Sequoia (announced 6 August 2024), Control-click no longer overrides Gatekeeper for software that is not signed and notarised correctly; the user must approve it in **System Settings > Privacy & Security** (S8).
- Tauri notes that ad hoc signing "does not prevent MacOS from requiring users to whitelist the installation" (S1).
- Whether an update downloaded by the Tauri updater's own HTTP client gets the quarantine attribute was not confirmed (**unverified**). If it does not, an unsigned build only needs the System Settings approval once, at first install.

For one owner this means: either build on the Mac, or download from Releases and approve once per install in System Settings (or remove the attribute with `xattr -dr com.apple.quarantine` on the app). Paying $99 removes that friction and is required before anyone else uses the app.

### 3.6 universal2 or separate builds

Tauri can build `universal-apple-darwin` (a fat binary for arm64 and x86_64). It does not help here: NautilusTrader 1.231.0 publishes no x86_64 macOS wheel (S30), and Briefcase documents that merging per-architecture Python wheels into universal2 fails for packages with platform-specific content, NumPy being the example (S23). Tauri also had a sidecar lookup bug for the universal target (tauri #3355, closed 2022, S24). Recommendation: **arm64 only, `LSMinimumSystemVersion` 26.0** when the backend is bundled; the shell-only build can stay arm64 too.

### 3.7 DMG or pkg

| Format | Pros | Cons |
|---|---|---|
| DMG | Drag to Applications, no admin, Tauri builds it, can be notarised and stapled (S2, S29) | Tauri's DMG icon layout is not applied on CI runners (known issue noted in S29), cosmetic only |
| pkg | Scripted installs, choice of `/Applications` or `~/Applications` (Velopack's choice, S21) | Needs a second certificate type (Developer ID Installer, S2b); more to go wrong |
| `.app.tar.gz` | The format the Tauri updater consumes (S3) | Not a first-install format |

Recommendation: **DMG for first install, `.app.tar.gz` for updates**, both from the same signed app.

## 4. Windows

### 4.1 Authenticode options

| Option | Price | Who can get it | SmartScreen effect | Notes |
|---|---|---|---|---|
| Unsigned | £0 | Anyone | "Windows protected your PC", must click Run anyway (S6) | Fine for the owner's own PC; each new build starts from zero reputation (S6) |
| OV certificate, cloud key (Certum SimplySign) | from €209 per year (Standard), from €49 (Open Source) (S15) | Standard: publishers. Open Source: open source projects only. Whether Certum Standard is sold to private individuals was not stated on the page (**unverified**) | Publisher name shown; warning until reputation builds (S6) | Since 1 June 2023 keys must live in hardware or a cloud HSM (S14); since 1 March 2026 a certificate lasts at most 460 days (S13) |
| EV certificate | from €329 to €379 (Certum, S15) | Organisations | **No advantage** over OV for SmartScreen any more (S6, S14) | Not worth it for this project |
| Azure Artifact Signing (formerly Trusted Signing) | Basic $9.99 a month, 5,000 signatures, then $0.005 each; Premium $99.99 (S5, S6) | Organisations in the US, Canada, EU, **UK** and others; **individuals only in the US or Canada** (S4) | Same as OV: reputation builds over time (S4b) | Needs a paid Azure subscription, no free or trial ones (S4b); no EV, no custom CN (S4b); identity validation takes 1 to 20 business days (S4) |
| Microsoft Store, MSIX | Free developer account for individuals and companies (S17); Microsoft re-signs MSIX for free (S18) | Anyone who passes ID checks | **No SmartScreen warning at all** for Store installs (S6) | Tauri has no MSIX output (open since 2022, tauri #4818, S24); a fresh Tauri 2 project fails the Windows App Certification Kit on S Mode checks (tauri #14935, S24); MSI or EXE in the Store must be self-signed (S19) |
| SignPath Foundation | Free | OSI-licensed projects with no proprietary parts; the certificate names SignPath Foundation as publisher (S27) | Same as OV | The repository has no licence today, so not eligible as it stands |

What is marketing and what is not:

- "EV gives instant SmartScreen trust" is out of date. Microsoft says plainly that EV no longer bypasses SmartScreen and that "paying a premium for EV solely to avoid SmartScreen warnings is no longer justified" (S6).
- "Signing removes SmartScreen warnings" is only partly true. A signed new file still warns until the certificate or file hash builds reputation, which "can take several weeks and hundreds of clean installs from a wide audience" (S6). With one user, a signed build will probably keep warning for a long time (**inference**, not measured).

### 4.2 SmartScreen and Smart App Control

- SmartScreen judges downloaded files by publisher reputation and file hash reputation (S6). It only applies to files with the Mark of the Web, which is why a locally built installer does not trigger it.
- Smart App Control, on Windows 11, can block unsigned files outright and applies to all executables, not only downloads (S6). It is **off** on the owner's PC (measured), so unsigned builds will run after the SmartScreen click-through.

### 4.3 Installer format

| Format | Tauri support | Admin | Notes |
|---|---|---|---|
| NSIS `-setup.exe` | Yes; can cross-build from macOS or Linux (S28) | Per-user by default, no admin; `perMachine` or `both` optional (S28) | Recommended. The Tauri updater can apply it (S3). |
| MSI (WiX v3) | Yes, but only built on Windows (S28) | Usually per-machine | WiX v3 is old; nothing here needs MSI unless a company deploys it. |
| MSIX | No (tauri #4818 open, S24) | Per-user | Only worth it for the Store route. |
| Velopack `Setup.exe` | Through the Velopack Rust crate (S20) | Per-user, in a per-user local data folder named after the pack id, no admin; optional `--msi` (S21) | Deltas, one-click install. |

### 4.4 WebView2 runtime

- Windows 11 includes the Evergreen WebView2 Runtime (S10), and this PC has 154.0.4258.48.
- Tauri's install modes and their size cost: `downloadBootstrapper` 0 MB (default), `embedBootstrapper` about 1.8 MB, `offlineInstaller` about 127 MB, `fixedVersion` about 180 MB, `skip` 0 MB (S28). Microsoft puts Fixed Version binaries at "over 250 MB" (S10); the two figures differ, take Microsoft's as the upper bound.
- Fixed Version does not update itself; the app must ship new runtimes for security fixes, and from Fixed Version 120 unpackaged apps on Windows 10 need extra `icacls` grants (S10).
- An Evergreen runtime installed per user is replaced by a per-machine one when Edge's per-machine updater is present (S10).
- A long-running app keeps the old runtime until it restarts; the `NewBrowserVersionAvailable` event can prompt a restart (S10).

Recommendation: **Evergreen with `embedBootstrapper`** (1.8 MB, works if the runtime is ever missing). The terminal loads only its own local pages, so the Evergreen auto-update is a benefit, not a risk. Because Evergreen moves under the app, keep the Playwright and vitest suites running against the Edge stable channel the runtime tracks, and pin nothing to a WebView2 build.

### 4.5 Antivirus false positives

Tauri's issue "Trojan alert from Windows Defender and other anti-virus providers" has been open since August 2021 with 84 comments (tauri #2486, S24). Frozen Python bundles are a common trigger too (**unverified** for this app). Mitigations: sign when a second user appears; submit false positives at the Microsoft Security Intelligence portal (S6); keep a shell-only build that has no frozen Python in it.

## 5. Updates

### 5.1 Options

| Updater | Version (2 Oct 2026) | Licence | Platforms | Signed feed | Deltas | Fit |
|---|---|---|---|---|---|---|
| Tauri updater plugin | 2.13.1 (S32) | Apache-2.0 per the GitHub API (S32) | macOS, Windows, Linux | Yes, minisign signature is mandatory and cannot be disabled (S3) | **No**; binary diff request open since 4 Dec 2024 (tauri #11863, S25) | Default for a Tauri shell |
| Velopack | 1.2.161, Rust crate 1.2.161 (S20, S33) | MIT (S20) | Windows, macOS, Linux | Code-signed packages; macOS signing and notarisation flags built into `vpk` (S21b) | **Yes**, zstd per-file patches, applied in sequence, falls back to full when cheaper (S21c) | Best when the bundle carries Python |
| Sparkle 2 | 2.10.0 (S32) | MIT-style (Sparkle LICENSE file, S32) | macOS only | EdDSA (ed25519), `SUPublicEDKey` (S34) | Yes, `generate_appcast` builds them (S34) | Native Mac apps; awkward from Rust |
| WinSparkle | 0.9.4 (S32) | MIT (S32) | Windows only | Yes, Ed25519 `sparkle:edSignature` in the appcast, keys from `winsparkle-tool`; old DSA still accepted but deprecated (S41) | Not offered; the README describes full installer downloads only (S41) | Pairs with Sparkle for a native C++ or Rust app without a web view |

Facts about the Tauri updater that matter here (S3):

- The public key sits in `tauri.conf.json`; the private key comes from `TAURI_SIGNING_PRIVATE_KEY`. "If you lose this key you will NOT be able to publish new updates." Keep an offline backup.
- A static JSON on GitHub Releases is enough; no update server is needed.
- macOS updates are `.app.tar.gz`; Windows updates are the NSIS or MSI installer.
- On Windows the app exits when the installer runs, because of how Windows installers work.

Version churn to plan around: Tauri 3 is in alpha. `tauri` 3.0.0-alpha.4 and a new `tauri-runtime-cef` crate (an optional Chromium-based runtime next to the system web view) were tagged on 1 October 2026, and the updater plugin 3.0.0-alpha.2 on 30 September 2026 (S32). GitHub marks these tags as full releases, but the version string says alpha. Build on Tauri 2 stable (2.12.1, updater 2.13.1) and treat a move to 3 as a separate, later decision; nothing in this lens needs it.

### 5.2 Size and the case for splitting the backend

| Payload | Approximate size | Source |
|---|---|---|
| Shell plus built web assets | tens of MB (Tauri's own issue cites 20 to 50 MB full updates) | S25 |
| NautilusTrader wheel alone | 113 MB (Windows), 156 MB (macOS), compressed | S30 |
| Whole lab venv | 723 MB on disk | measured |

With the Tauri updater, every release would re-download the whole bundle. Two ways out:

1. **Split.** Ship the shell through the Tauri updater; ship the Python runtime as a separate, versioned "engine pack" (a signed archive with a SHA-256 manifest) that only changes when `uv.lock` changes. The shell checks the engine version at start and refuses to run a mismatched one.
2. **Velopack.** One package, deltas built in, per-user install. The cost is a second packaging tool and losing Tauri's built-in updater flow.

For phase 1 (owner's own machines, backend from the lab venv) neither is needed: the shell is small and the venv is updated by the lab's own tooling.

## 6. CI on GitHub Actions

### 6.1 Runners and price

| Runner | Spec (public repo) | Price per minute if private | Source |
|---|---|---|---|
| `macos-26` (arm64, M1) | 3 CPU, 7 GB RAM, 14 GB SSD | $0.062 | S11, S12 |
| `macos-26-intel` | 4 CPU, 14 GB RAM, 14 GB SSD | $0.062 | S11, S12 |
| `windows-2025` | 4 CPU, 16 GB RAM (2 CPU, 8 GB if private) | $0.010 | S11, S12 |
| `ubuntu` (Linux 2-core) | n/a | $0.006 | S11 |

- Standard runners in **public** repositories are free and unlimited (S12, S35). `nq-terminal` is public today, so CI costs $0.
- If the repository goes private: GitHub Free includes 2,000 minutes and 500 MB of artefact storage a month, Pro 3,000 minutes and 1 GB (S35). Whether macOS and Windows minutes still burn the included quota at 10x and 2x is not stated on the current pages (**unverified**). An illustrative release (20 minutes on macOS, 25 on Windows, both **estimates**) would cost about $1.24 + $0.25 = $1.49 at list price; four releases a month is about $72 a year.
- Cache: 10 GB per repository by default, entries unused for 7 days are evicted, more can be bought (50 GB is about $2.80 a month) (S36). A Rust target folder plus a pnpm store plus a uv cache for two OSes will press against 10 GB; cache the Cargo registry and pnpm store, not whole `target` folders.

- **A self-hosted runner on the owner's Mac is free** (S35) and would keep the Developer ID key off GitHub, but GitHub says self-hosted runners "should almost never be used for public repositories", because anyone can open a pull request that runs code on the machine (S39). With `nq-terminal` public, keep hosted runners; a self-hosted Mac runner only makes sense if the repository goes private.

### 6.2 Matrix sketch

```yaml
# .github/workflows/desktop-release.yml (sketch, not committed)
on:
  push:
    tags: ["desktop-v*"]
jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: macos-26            # arm64, matches macosx_26_0_arm64 wheels
            target: aarch64-apple-darwin
          - os: windows-2025
            target: x86_64-pc-windows-msvc
    runs-on: ${{ matrix.os }}
    environment: release          # secrets live here, not at repo level
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - uses: dtolnay/rust-toolchain@stable
        with: { targets: "${{ matrix.target }}" }
      - uses: Swatinem/rust-cache@v2
      - run: pnpm install --frozen-lockfile && pnpm build
      - run: pnpm tauri build --target ${{ matrix.target }}
        env:
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}
          APPLE_API_KEY: ${{ secrets.APPLE_API_KEY }}
      - run: <run the terminal/qa crosscheck against the packaged backend>
```

Action versions in the sketch were not checked (**unverified**); pin them to commit SHAs when the workflow is written.

### 6.3 Secrets

- Secrets are not passed to workflows triggered from forks, except `GITHUB_TOKEN` (S37). That protects a public repository from a malicious pull request reading the signing keys.
- Keep signing secrets in a `release` environment that only tag pushes reach. Whether environment protection rules (required reviewers) are available on this plan for a public repository was not checked (**unverified**).
- Secrets needed: `TAURI_SIGNING_PRIVATE_KEY` (and its password), the Developer ID `.p12` as base64 plus its password, an App Store Connect API key, and for Windows either nothing (unsigned), `AZURE_CLIENT_ID` / `AZURE_TENANT_ID` / `AZURE_CLIENT_SECRET` for Artifact Signing (S1b), or Certum's cloud signing login.

## 7. Crash reporting, kept local

The terminal has no telemetry and should not gain any. Everything below writes to disk only.

| Layer | Tool | Licence | Notes |
|---|---|---|---|
| Rust shell | `crash-handler` 0.8.1 and `minidumper` 0.11.0, both from the crash-handling repository | Apache-2.0 per the GitHub API (S32, S33) | Out-of-process minidump writer; read dumps with `rust-minidump` (MIT, S32) |
| Rust panics | `std::panic::set_hook` writing a text report | Rust stdlib | Covers most Rust failures without a dump |
| Python backend | `faulthandler` to a file, plus the existing logs | CPython stdlib | Native crashes inside NautilusTrader's Rust or Cython code show a stack |
| macOS | System crash reports in `~/Library/Logs/DiagnosticReports` | OS | Nothing to build (**unverified** path on macOS 26) |
| Windows | WER LocalDumps | OS | Off by default; enabling it needs admin and an HKLM key; default folder is the CrashDumps folder in the per-user local data folder, 10 dumps, mini dumps (S38) |
| Not recommended | Self-hosted Sentry 26.9.0 | FSL, Apache-2.0 after two years (S22) | Minimum 4 cores, 16 GB RAM plus 16 GB swap, 20 GB disk (S22) |
| Optional | `sentry-native` 0.17.1 or the `sentry` crate 0.49.3 with no DSN | Both MIT (S32, S33) | Only if a dump format compatible with Sentry tooling is wanted later |

Recommendation: a Diagnostics screen (or a menu item) that zips the latest minidumps, `faulthandler` output and logs into a folder the owner chooses. No upload path at all.

## 8. Yearly cost

Prices as published on 2 October 2026, in the seller's currency; no conversion was done.

| Scenario | Apple | Windows signing | Company fees | CI | Total per year |
|---|---|---|---|---|---|
| A. Owner only, unsigned, shell-only or local builds | $0 | $0 | $0 | $0 (public repo) | **$0** |
| B. Mac notarised, Windows unsigned (recommended phase 2) | $99 (S7) | $0 | $0 | $0 | **$99** |
| C. B plus Certum Standard OV in the cloud | $99 | from €209 (S15) | $0 | $0 | **$99 + €209** |
| D. B plus Artifact Signing through a UK limited company | $99 | $119.88 (S5) | £100 once, then £50 a year (S16) | $0 | **$218.88 + £150 first year, $218.88 + £50 after** |
| E. B plus Microsoft Store MSIX (needs MSIX tooling Tauri lacks) | $99 | $0, Microsoft signs (S18) | $0 (S17) | $0 | **$99**, plus build work |
| F. Same as C or D but private repository | as above | as above | as above | about $72 (estimate, section 6.1) | add about $72 |

Hidden costs that are not money:

- Artifact Signing identity validation: 1 to 20 business days, three document attempts (S4).
- Certificates now last at most 460 days (S13), so OV renewals come round every 15 months.
- A UK company brings filing duties beyond the confirmation statement (accounts, tax returns); not costed here (**unverified**).

## 9. Risks and known issues

| Risk | Evidence | Mitigation |
|---|---|---|
| macOS backend needs macOS 26 on Apple Silicon | Wheel tag `macosx_26_0_arm64` only (S30) | Confirm the owner's Mac (Q1); shell-only fallback that talks to a backend started from a lab checkout |
| Notarisation of a frozen Python bundle fails | PyInstaller #8029 open, #8927 (S26) | Sign inside-out with a script; verify with `codesign --verify --deep --strict` and `spctl` (S2b); spike first |
| Updater key lost | "you will NOT be able to publish new updates" (S3) | Two offline copies of the minisign key |
| Full-size updates with a bundled runtime | No deltas in the Tauri updater (S25) | Split engine pack, or Velopack |
| SmartScreen warnings even when signed | Reputation needs volume (S6) | Accept for one user; Store route if the user base grows |
| Antivirus false positives | tauri #2486 open since 2021 (S24) | Sign, submit to Microsoft, keep a shell-only build |
| WebView2 changes under the app | Evergreen auto-updates (S10) | Keep the browser-based test suites on the Edge stable channel |
| Tauri 3 lands while the app is on 2 | 3.0.0-alpha.4 tagged 1 October 2026 (S32) | Pin Tauri 2 in `Cargo.lock` and the CLI version in CI; migrate only on a stable 3 with its own spike |
| C: drive nearly full | 29 GB free (measured) | Installer directory page pointing at D:, or shell-only install |
| A packaged build drifts from the tested numbers | Bundled Python could differ from the lab venv (inference) | Run the three-way crosscheck against the packaged backend in CI, on both OSes, before publishing |
| A bundle accidentally carries lab data | Data paths are outside the repo today (inference) | A release check that fails if any path under `data/`, `results/` or `live/`, or any sealed file, is in the artefact |

## 10. What this means for the nq-lab terminal

1. **Phase 1, $0.** Build a shell-only desktop app (Tauri style) that starts the existing backend from the lab venv on 127.0.0.1, exactly as `start.ps1` does now. Windows: NSIS, per-user, no admin, Evergreen WebView2 with the embedded bootstrapper, unsigned. Mac: arm64, built on the Mac itself, ad hoc signed. No updater yet; the owner rebuilds from the repository. Nothing about the research gate, the crosscheck or the data paths changes, because the backend is untouched.
2. **Phase 2, $99 a year.** Join the Apple Developer Program, add Developer ID signing, hardened runtime and notarisation in a `macos-26` GitHub Actions job, ship a stapled DMG, and turn on the Tauri updater with a static JSON on GitHub Releases. Windows stays unsigned: one SmartScreen click per new installer on one PC is a smaller cost than €209 a year or a company.
3. **Phase 3, only if the backend is bundled.** Freeze the Python backend per platform, sign every native file on macOS, and move updates to an engine-pack split or Velopack so a release does not re-download hundreds of MB. Run the full crosscheck and the real-data smoke against the packaged backend in CI before any release is published. Add the "no lab data in the artefact" check.
4. **Phase 4, only if anyone else uses it.** Decide Windows signing then: Certum OV (simplest for an individual), Artifact Signing through a company (cheapest per year once a company exists), or the Store with MSIX (free and warning-free, but Tauri cannot build MSIX today). Also choose a licence for the repository at that point; it decides whether free open source signing is even possible.
5. **Crash data never leaves the machine.** Minidumps, `faulthandler` and logs go to a local folder with an export button; no Sentry, no telemetry.

## 11. Open questions

- **Q1.** Which Mac does the owner have, and which macOS version? Anything older than macOS 26, or an Intel Mac, cannot run the bundled NautilusTrader 1.231.0 backend.
- **Q2.** Does the Mac have its own nq-lab checkout and venv? Phase 1 on the Mac depends on it.
- **Q3.** Will anyone other than the owner ever install the app? That alone decides whether Windows signing is worth paying for.
- **Q4.** Should the repository stay public? Public keeps CI free; private adds roughly $72 a year at the estimated build times.
- **Q5.** Does the owner already have, or want, a UK limited company? It is the only route to Artifact Signing from the UK.
- **Q6.** Does an update fetched by the Tauri updater on macOS carry the quarantine attribute? To be tested in the phase 2 spike.
- **Q7.** Which hardened runtime entitlements does the frozen backend really need? To be tested in the phase 3 spike, starting from Briefcase's two defaults.

## Sources

All checked on 2 October 2026.

- S1. Tauri v2, macOS code signing: https://v2.tauri.app/distribute/sign/macos/
- S1b. Tauri v2, Windows code signing: https://v2.tauri.app/distribute/sign/windows/
- S2. Apple, Notarizing macOS software before distribution: https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution
- S2b. Apple, Resolving common notarization issues: https://developer.apple.com/documentation/security/resolving-common-notarization-issues
- S2c. Apple, Hardened Runtime: https://developer.apple.com/documentation/security/hardened-runtime
- S3. Tauri v2, Updater plugin: https://v2.tauri.app/plugin/updater/
- S4. Microsoft Learn, Artifact Signing quickstart (eligibility, regions, validation time): https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart
- S4b. Microsoft Learn, Artifact Signing FAQ (no free subscriptions, no EV, no custom CN): https://learn.microsoft.com/en-us/azure/artifact-signing/faq
- S5. Artifact Signing price: Microsoft's SmartScreen page states "Starts at $9.99/month" (S6); the Azure pricing page renders without figures (https://azure.microsoft.com/en-us/pricing/details/artifact-signing/); the $0.005 overage and $99.99 Premium figures come from a search result summary and the 4D forum thread https://discuss.4d.com/t/windows-application-signing-with-ms-azure-artifact-signing-9-99-month/38154 (**secondary**)
- S6. Microsoft Learn, SmartScreen reputation for Windows app developers (dated 4 May 2026): https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation
- S7. Apple Developer Program enrolment: https://developer.apple.com/programs/enroll/
- S8. Apple Developer News, Updates to runtime protection in macOS Sequoia (6 August 2024): https://developer.apple.com/news/?id=saqachfa
- S9. Apple, macOS Big Sur 11.0.1 Universal Apps release notes (arm64 signing requirement): https://developer.apple.com/documentation/macos-release-notes/macos-big-sur-11_0_1-universal-apps-release-notes
- S10. Microsoft Learn, Distribute your app and the WebView2 Runtime: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution
- S11. GitHub Docs, Actions runner pricing: https://docs.github.com/en/billing/reference/actions-runner-pricing
- S12. GitHub Docs, GitHub-hosted runners: https://docs.github.com/en/actions/reference/runners/github-hosted-runners
- S13. CA/Browser Forum ballot CSC-31, 460-day maximum from 1 March 2026: DigiCert notice https://knowledge.digicert.com/alerts/code-signing-certificates-459-day-validity and GlobalSign notice https://www.globalsign.com/en/company/news-events/news/businesses-must-prepare-two-significant-certificate-lifecycle-reductions-march-2026 ; CA/B Forum requirements page https://cabforum.org/working-groups/code-signing/requirements/ (ballot text not read directly, **secondary**)
- S14. Tauri v2 Windows signing page on the 1 June 2023 hardware key rule and EV parity: https://v2.tauri.app/distribute/sign/windows/
- S15. Certum shop, code signing prices: https://shop.certum.eu/code-signing.html
- S16. GOV.UK, Companies House fees (updated 25 September 2026): https://www.gov.uk/government/publications/companies-house-fees/companies-house-fees
- S17. Microsoft Learn, Open a Microsoft Store developer account (no registration fee): https://learn.microsoft.com/en-us/windows/apps/publish/partner-center/open-a-developer-account
- S18. Microsoft Learn, MSIX app package requirements (Store re-signs MSIX): https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements
- S19. Microsoft Learn, MSI/EXE app package requirements (self-signed by publisher): https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/app-package-requirements
- S20. Velopack documentation and repository: https://docs.velopack.io/ and https://github.com/velopack/velopack
- S21. Velopack installer docs: https://docs.velopack.io/packaging/installer
- S21b. Velopack signing docs: https://docs.velopack.io/packaging/signing
- S21c. Velopack delta docs: https://docs.velopack.io/packaging/deltas
- S22. Sentry self-hosted documentation (requirements, licence): https://develop.sentry.dev/self-hosted/
- S23. BeeWare Briefcase, macOS platform reference (default entitlements, universal wheels): https://briefcase.beeware.org/en/stable/reference/platforms/macOS/index.html
- S24. Tauri issues: #4818 MSIX https://github.com/tauri-apps/tauri/issues/4818 ; #14935 WACK https://github.com/tauri-apps/tauri/issues/14935 ; #15144 sandbox in dev https://github.com/tauri-apps/tauri/issues/15144 ; #2486 antivirus https://github.com/tauri-apps/tauri/issues/2486 ; #3355 universal sidecar https://github.com/tauri-apps/tauri/issues/3355
- S25. Tauri issue #11863, binary diff updater: https://github.com/tauri-apps/tauri/issues/11863
- S26. PyInstaller issues #8029 https://github.com/pyinstaller/pyinstaller/issues/8029 and #8927 https://github.com/pyinstaller/pyinstaller/issues/8927
- S27. SignPath Foundation terms: https://signpath.org/terms
- S28. Tauri v2, Windows installer: https://v2.tauri.app/distribute/windows-installer/
- S29. Tauri v2, DMG: https://v2.tauri.app/distribute/dmg/
- S30. PyPI JSON for nautilus_trader 1.231.0: https://pypi.org/pypi/nautilus_trader/1.231.0/json
- S31. NautilusTrader repository (LGPL-3.0): https://github.com/nautechsystems/nautilus_trader
- S32. GitHub releases and licences, read through the GitHub API: Tauri https://github.com/tauri-apps/tauri/releases (tauri 2.12.1, CLI 2.12.1, bundler 2.10.1, all 30 September 2026; 3.0.0-alpha.4 on 1 October 2026) ; plugins https://github.com/tauri-apps/plugins-workspace/releases (updater 2.13.1, 29 September 2026) ; Sparkle https://github.com/sparkle-project/Sparkle/releases (2.10.0, 13 September 2026) ; WinSparkle https://github.com/vslavik/winsparkle/releases (0.9.4, 21 July 2026) ; sentry-native https://github.com/getsentry/sentry-native/releases (0.17.1, 24 September 2026) ; self-hosted https://github.com/getsentry/self-hosted/releases (26.9.0) ; crash-handling repository, linked from https://crates.io/crates/crash-handler (Apache-2.0) ; rust-minidump https://github.com/rust-minidump/rust-minidump (MIT)
- S33. crates.io API: velopack 1.2.161 https://crates.io/crates/velopack ; sentry 0.49.3, MIT https://crates.io/crates/sentry ; minidumper 0.11.0 https://crates.io/crates/minidumper ; crash-handler 0.8.1 https://crates.io/crates/crash-handler
- S34. Sparkle documentation: https://sparkle-project.org/documentation/
- S35. GitHub Docs, GitHub Actions billing (included minutes, storage): https://docs.github.com/en/billing/concepts/product-billing/github-actions
- S36. GitHub Docs, dependency caching reference: https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching
- S37. GitHub Docs, using secrets in workflows: https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets
- S38. Microsoft Learn, Collecting user-mode dumps: https://learn.microsoft.com/en-us/windows/win32/wer/collecting-user-mode-dumps
- S39. GitHub Docs, secure use reference (self-hosted runners and public repositories): https://docs.github.com/en/actions/reference/security/secure-use
- S40. Apple UK price of £79 a year: search result summaries citing https://www.f2b.co.uk/mobile-apps-how-to-sign-up-for-developer-accounts-apple-android/ and the 2015 price change reported at https://www.macrumors.com/2015/01/02/apple-increases-product-dev-prices-europe/ (**secondary**, not on an Apple page that could be read)
- S41. WinSparkle README, signing section, read through the GitHub API: https://github.com/vslavik/winsparkle
