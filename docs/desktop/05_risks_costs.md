# 05: Risks and costs of the desktop migration

Step 05 of the desktop migration. It lists what can go wrong with the plan in `03_migration_plan.md` (a risk register with an owner for each risk), then prices the plan in money and in the owner's time (a cost sheet, one-off and yearly). It does not reopen the decision in `02_decision.md`.

- Date: 2 October 2026. Repository `nq-lab/terminal`, HEAD `c7f9e61` (v2).
- Status: **register and cost sheet**. Nothing here changes code.
- Inputs: `02_decision.md`, `03_migration_plan.md` (sections 21 to 24 and Appendix B), `04_roadmap.md` (the owner actions table, phases D0 to D8), `01_options.md`, `00_spike_webview2.md`, `00_spike_rust.md`, `research/L1` (WebKit gaps), `L4` (distribution and cost), `L7` (security), and the sources in the last section.
- Labels as in 02 and 03: **measured** (on the owner's Windows 11 PC), **sourced** (a URL in the sources list, checked on 2 October 2026), **estimate** (built by this step), **unverified** (not confirmed from a primary source). Tags R1 to R15 are new here; R16 to R18 were added on 5 October 2026, when the signing and licence facts were brought up to date. Tags S, D, L4-S and L7-S point to the source lists of 01, 02, L4 and L7.
- This step ran no app, opened no window, touched nothing under `results/`, `data/` or `live/`, did not touch port 8765 and measured nothing on a Mac. Its only local reads were folder sizes and a lockfile package count under `D:\dev`.

## 0. Summary

1. **Cash cost is small.** The base plan costs **$0 a year**. The one fee that may arrive is the Apple Developer Program at **$99 a year**, and only if stage 0 shows that Gatekeeper blocks a locally built Mac app (decision 13 of 03). Paying for Windows signing is not needed for one owner on one PC.
2. **The real cost is time.** Build effort is 18 to 32.5 focused weeks on the Tauri path (02), and upkeep is 5 to 10 days a year (02). The owner's own hands-on time is about 18 to 31 hours in the first year, built from the owner actions table of `04_roadmap.md` (section 5.1), and about 8 to 19 hours a year after that (section 5.2). Both are estimates.
3. **The register holds 66 risks.** Five matter most and are ranked in section 2, with five more behind them. None can be removed by spending money; most are bought down by the gates already in 02 (G1, G2, G3) and by tests.
4. **Two facts found in this step bear on the Mac plan.**
   - macOS 27 "Golden Gate" was released on 14 September 2026 and no longer runs on any Intel Mac (R10, secondary for the Intel point). G1 must be run on the WebKit of the macOS version the owner's Mac actually has, and an Intel Mac can only use remote mode.
   - Microsoft Edge, and with it the WebView2 runtime, moved to a two-week major release cycle from Stable 152 (R9). The app's Windows engine will change about 26 times a year, so the weekly drift run in 03 section 16 is a necessity, not an extra.
5. **No risk in the register reaches the research gate by design.** Eight gate and write-ban risks are listed (section 6.6) because the owner's rules treat them as the ones that must never happen, not because any is likely.

## 1. How to read the register

### 1.1 Scales

Likelihood is the chance that the event happens during the plan's life, taken as about the next 12 months. Impact is what it costs if it does. Both are **estimates**, scored before the mitigation in the next column works, as most registers do.

| Score | Likelihood | Impact |
|---:|---|---|
| 1 | Low: under 15% | Low: a screen, a feature or up to a week lost |
| 2 | Medium: 15 to 50% | Medium: 1 to 4 weeks of rework, or a feature switched off |
| 3 | High: over 50% | High: wrong numbers shown, a gate or write ban breached, or a stage reworked for more than 4 weeks |

**Score** is likelihood times impact, from 1 to 9. A score of 6 or more needs a named person and a dated check; 3 to 4 is watched at each gate; 1 to 2 is accepted and noted.

### 1.2 Owners

There are two kinds of owner, because there is one human and the rest of the work is done by automated build runs.

| Owner | Meaning |
|---|---|
| **Owner** | Fatih. Decisions, machines, accounts, visible-window checks, approvals. |
| **Build 1, Build 2, Build 3** | The automated build run for stage 1, 2 or 3 of 03 section 21, who must put the mitigation in place and keep its test green. |
| **Build CI** | The same run, for the workflows in 03 section 16. |

A risk with two owners lists the one who must act first.

### 1.3 Categories and IDs

T technical, S schedule, P platform, X security, C correctness, G research gate and write ban, O owner and scope. Section 6 holds the tables, one per category, and section 6.8 lists the mitigations that the roadmap's acceptance criteria must carry.

### 1.4 Trigger names

T1 to T11 are the triggers of 02 section 6.5; G0 to G3 are its gates. The register points to them where one fires on a risk.

## 2. The ranking

Ties are broken by impact, then by how late the risk would show itself.

### 2.1 Top five

| Rank | ID | Score | Why it is at the top |
|---:|---|---:|---|
| 1 | P01 | 6 | **The Mac engine has never run this page.** Perspective on wasm32, dockview drag and drop, blob downloads, clipboard, the live stream and the Mac key alternatives are all unproven in WKWebView. Nothing has been measured on a Mac by any step. A failure at G1 means Electron on both systems (T1), and if Windows is already built on Tauri that is 3 to 5 weeks of rework. |
| 2 | P02 | 6 | **Crosschecked maths on a second JavaScript engine.** The ECMAScript specification leaves functions such as `Math.exp` implementation-approximated (R13), so JavaScriptCore may differ from V8 in the last digits. The crosscheck tolerance is 1e-9 relative. This is the only risk that could put a wrong number on screen without any test failing, if the golden tests miss the path. |
| 3 | X07 | 6 | **Remote mode opens the trading PC.** Installing the Windows OpenSSH server creates an enabled inbound rule for port 22 (R14). That PC holds the IB paper session and the research API keys. |
| 4 | O01 | 6 | **The expectation gap.** "Light and fast as fuck" meets a web-engine shell. The whole app is about 330 to 380 MB idle (estimate from measured parts) and the lab's 690 to 723 MB venv does not shrink. Unless the pitch says this plainly, a correct plan will feel like a broken promise. |
| 5 | S09 | 6 | **Calendar time against focused weeks.** 18 to 32.5 focused weeks is not a date. The owner also runs the weekly portfolio work and the research, so elapsed time is likely a multiple of the estimate. |

### 2.2 Next five

| Rank | ID | Score | Why |
|---:|---|---:|---|
| 6 | S04 | 4 | G1 fails after Windows is already built on Tauri: 3 to 5 weeks to move to Electron. |
| 7 | S01 | 4 | The effort range is an estimate with no validation. The Mac stage alone spans 6.25 of the 14.5 weeks of spread. |
| 8 | T03 | 4 | Whole-app memory over the 500 MB idle or 1.5 GB heavy ceilings. The measured sweep reached a 1,170 MB working set in the backend alone at a 256 MiB cache. |
| 9 | T02 | 4 | Cold start over 5 s. The backend alone took 3.6 to 5.1 s under load before any lazy-import work (measured). |
| 10 | X01 | 4 | Another Tauri IPC advisory. There were 9 since 2022 and 2 in 2026, the latest on 26 September 2026 (R12). |

### 2.3 Spread of the effort estimate

Where the 14.5-week spread between 18 and 32.5 weeks comes from (section 5 of 02):

| Stage | Low | High | Spread | Share of the spread |
|---|---:|---:|---:|---:|
| 0: decide and measure | 1.2 | 2.5 | 1.3 | 9% |
| 1: shell-neutral foundation | 4.75 | 8.25 | 3.5 | 24% |
| 2: Windows app | 6.25 | 9.75 | 3.5 | 24% |
| 3: Mac app | 5.75 | 12 | 6.25 | 43% |
| **Total** | **17.95** | **32.5** | **14.55** | 100% |

The Mac stage carries 43% of the uncertainty and is the only stage with no measurement behind it. **Planning figure for any calendar commitment: use the high end, 32.5 focused weeks, and move it only after the first stage 2 item gives a real ratio of actual to estimated time** (02 already says this).

## 3. Early-warning map

What to watch, where it is read, and which risks it feeds.

| Signal | Read at | Threshold that matters | Risks it feeds |
|---|---|---|---|
| Backend ready, quiet machine | stage 1 exit, then each release | above 2.5 s (T3) | T01, T02 |
| Cold double-click to HOME | stage 2.4, after a reboot | above 5 s (T3) | T02 |
| Whole-tree memory at idle and after the soak | stage 2.4 | above 500 MB or 1.5 GB (T4) | T03 |
| Pan and zoom p95 at 20,000 bars; the 20,000-bar data hop | stage 2.4 | above 25 ms; above 100 ms (T5) | T04 |
| G1 self-test page and numbers on the Mac | stage 0.3 | any of the four items fails (T1) | P01, P02, P04, P10, C06 |
| Electron 44 measured on this PC | stage 0.2 | 15% less memory, or 300 ms faster (T2) | S04, O01 |
| Weekly WebView2 drift run | every week from stage 2 | any suite result changes (T8) | P05, C04, C05 |
| Gatekeeper on a locally built app | stage 0.3d | a prompt or a block (decision 13) | P06, cost sheet 4.1 |
| Tauri security advisories | weekly | any touching IPC, capabilities or downloads (T9) | X01, X06 |
| Cached against fresh body test, and the crosscheck through the cache | every stage 1.2 change | any byte difference | T05, C01 |
| Gate scans on the shell and the backend | every pull request | any ban fails | G01 to G07, X05 |
| SSH tunnel stream reconnects | stage 3.4 | HOME above 5 s, or more than one reconnect an hour (T10) | P11 |
| Free space on C: | each build | under 10 GB free | S07 |

### 3.1 Dated watch list

| Date | Event | Source | Risks |
|---|---|---|---|
| 14 September 2026 | macOS 27 "Golden Gate" released; Intel Macs cannot run it | R10 (the Intel point is from Wikipedia, secondary) | P03, P04 |
| 28 September 2026 | macOS 27.0.1 released | R10 | P03 |
| 26 September 2026 | Tauri high-severity IPC advisory published, fixed in 2.11.6 | R12 | X01 |
| 1 October 2026 | Tauri 3.0.0-alpha.4 tagged | L4 S32, 03 M7 | P13 |
| 8 and 22 October, 5 and 19 November, 3 December 2026 | Edge Stable 155, 156, 157, 158 and 159 target weeks; WebView2 follows | R9 | P05 |
| about 15 months after issue | a Windows code-signing certificate, if one is ever bought, must be renewed (Certum states a 459-day maximum from 27 February 2026) | R5 | cost sheet 4.2 |

## 4. Cost sheet: money

Prices are in the seller's currency as published on the date checked. No currency conversion was done, as in L4. "Re-read" means this step fetched the page again on 2 October 2026; "from L4" means the research lens checked it on the same date and this step did not re-read it.

### 4.1 Apple, for the Mac app

| Item | One-off | Yearly | Needed when | Source | Checked |
|---|---:|---:|---|---|---|
| Apple Developer Program | none | **$99** (USD list; the page says prices vary by region and are shown in local currency when you join) | Only if Gatekeeper blocks a locally built app, or the app is ever given to someone else. Needed for a Developer ID certificate and notarisation; a free Apple account cannot notarise (L4 S1) | R1 (re-read) | 2 October 2026 |
| UK price of the same programme | | £79 reported | Secondary sources only; confirm at enrolment | L4 S40 (from L4) | unverified |
| Notarisation service itself | none | none | Included with the programme; the tool is `notarytool` (L4 S2) | L4 S2 (from L4) | 2 October 2026 |
| A Mac to build on | none assumed | none | The owner already has one (G0 does not yet say which). A build made on the Mac itself carries no quarantine attribute and needs only an ad hoc signature (L4 S9) | L4 (from L4) | 2 October 2026 |

Apple's "Upcoming requirements" page lists no change to Developer ID, notarisation or Gatekeeper for 2026 (R11, re-read). Since macOS Sequoia (6 August 2024) Control-click no longer overrides Gatekeeper for software that is not correctly signed and notarised (L4 S8, from L4).

### 4.2 Windows signing

The base plan signs nothing (03 section 13.1). A locally built installer has no Mark of the Web, and Smart App Control is off on this PC (measured, L4). A CI build downloaded through a browser gets one SmartScreen "Run anyway" prompt per new file.

| Route | One-off | Yearly | Who can buy it | Effect | Source |
|---|---:|---:|---|---|---|
| **Unsigned (base plan)** | $0 | **$0** | anyone | One SmartScreen prompt on a downloaded installer; none on a local build. Unsigned files start again at zero reputation with every new version | R6 (re-read) |
| Certum Standard code signing, cloud version | | from **€209** | Certum's own page does not say whether private individuals may buy it. A reseller sells an individual variant, "Certum Cloud CODE Signing for Individual Developer ... intended exclusively for individual software creators", at about $139 a year before VAT (5 October 2026), so a UK individual can buy one | Publisher name shown; still a warning until reputation builds, which "can take several weeks and hundreds of clean installs" | R5, R6 and R16 |
| Certum Standard, card set or electronic code | | from €169, from €139 | as above | as above | R5 (re-read) |
| SSL.com IV (individual validation) code signing | | **$129** a year, plus eSigner cloud signing from $20 a month (20 signings), or a supported hardware token | Sold to individuals | As an OV certificate: publisher name shown, warning until reputation builds | R17 |
| Certum Open Source code signing | | from €49 (cloud) | Open source projects only. The repository's `LICENSE` is all rights reserved (published for viewing and evaluation only), not an open source licence, so not eligible | as above | R5 (re-read); L4 S27 |
| Certum EV code signing | | from €379 (cloud) | organisations | **No SmartScreen advantage any more**: "paying a premium for EV solely to avoid SmartScreen warnings is no longer justified" | R5 and R6 (re-read) |
| Artifact Signing (Microsoft, formerly Trusted Signing), Basic | | "starts at **$9.99** a month", so $119.88 | **Organisations** in the UK, EU, US, Canada and others. **Individuals only in the US or Canada**, so a UK individual cannot use it | Same reputation rules as an OV certificate. Identity validation takes 1 to 20 business days | R6 and R7 (re-read) |
| A UK limited company, to qualify for Artifact Signing | **£100** to incorporate online | **£50** confirmation statement | Needed only for that route. Accounts, tax returns and a registered office are not costed (unverified) | GOV.UK fee table, updated 25 September 2026 | R8 (re-read) |
| Microsoft Store, EXE listing | none | none (developer account free, L4 S17) | anyone who passes the identity checks | No SmartScreen warning for Store installs, but the Store requires the EXE to be code signed and the WebView2 offline installer mode, which grows the installer from about 3 MB to well over 100 MB. It does not remove the need for a certificate | R6 (re-read); R18 |
| SignPath Foundation | | free | OSI-licensed projects only; the repository's licence is all rights reserved, not OSI | The certificate names SignPath as publisher | L4 S27 (from L4) |

For a UK individual the cheapest workable route, if signing is ever wanted, is an individual OV or IV certificate (Certum's cloud variant or SSL.com IV); Artifact Signing only through a company formed for other reasons. The recommendation stays unsigned for 0.x (`smartscreen.md`).

Certificate lifetimes are short now. Certum states that from 27 February 2026 one certificate is valid for at most 459 days (R5), so any bought certificate is renewed about every 15 months.

### 4.3 Continuous integration

| Case | Cost | Source |
|---|---|---|
| **Public repository (today: `nq-terminal` is public, L4 section 2)** | **$0**. "Use of the standard GitHub-hosted runners is free and unlimited on public repositories" | R3 (re-read) |
| Private repository, list prices per minute | Linux 2-core $0.006, Windows 2-core $0.010, macOS 3 or 4 core $0.062 | R2 (re-read) |
| Private repository, included allowance | GitHub Free: 2,000 minutes and 500 MB of artefact storage a month; Pro: 3,000 and 1 GB. Whether macOS and Windows minutes count at a multiple against the allowance is not stated on the page (unverified) | R4 (re-read) |
| Cache | 10 GB per repository, entries unused for 7 days evicted (L4 S36); cache the Cargo registry and the pnpm store, not `target` folders | L4 S36 (from L4) |

**Estimate if the repository went private**, using the four workflows of 03 section 16. The run counts are this step's assumptions, not measurements:

| Workflow | Assumed use a month | Minutes | At list price |
|---|---|---:|---:|
| `desktop-check` (Windows) | 40 runs of 15 min | 600 | $6.00 |
| `webview2-drift` (Windows) | 4 runs of 10 min | 40 | $0.40 |
| `desktop-release` (Windows) | 1 run of 25 min | 25 | $0.25 |
| `mac-webkit` (macOS) | 10 runs of 8 min | 80 | $4.96 |
| **Total** | | **745** | **$11.61 a month, $139.32 a year** |

The included allowance would absorb part or all of that, so the private-repository case is **$0 to about $139 a year**. Private runners have 2 CPUs against 4 on public ones (L4 S11), so real minutes would be higher. L4 gave about $72 a year for a lighter pattern (four releases a month); the two figures do not conflict, they assume different run counts. Self-hosted runners are not an answer: GitHub says they "should almost never be used for public repositories" (L4 S39).

### 4.4 Licences and software

| Item | Licence | Fee | Note |
|---|---|---:|---|
| Tauri 2, its plugins, `webview2-com`, `hmac`, `sha2`, `serde`, the `windows` crate, cargo-deny, cargo-audit | MIT or Apache-2.0 (03 Appendix B.2) | $0 | |
| Rust toolchain, NSIS | MIT or Apache-2.0; zlib | $0 | |
| Electron 44 (fallback only) | MIT | $0 | |
| WebView2 Evergreen runtime | Microsoft | none found | Not shipped, only the 1.8 MB bootstrapper is. This step read Microsoft's distribution page for sizes, not for terms, so "no fee" is **unverified** |
| WKWebView | Apple, part of macOS | none | |
| NautilusTrader 1.231.0 | LGPL-3.0 (L4 S31) | $0 | Already in the lab venv; the shell does not ship it. A later bundled-engine phase (03 section 21, 3 to 5 weeks) would bring LGPL notice duties |
| ECharts, lightweight-charts, Perspective, fonts | Apache-2.0, BSD-3-Clause, MPL-2.0, OFL-1.1 | $0 | Notices go in the HELP licence list (03 B.1) |
| A licence for the public repository | `LICENSE`, added after L4: all rights reserved, published for viewing and evaluation only | $0 | It grants no right to use the code. Changing it is free; it only matters for open source signing or for anyone else's use |
| Python packages, npm packages | as today | $0 | unchanged |
| Windows OpenSSH server for remote mode | in-box Windows feature (R14) | no price listed | Installing it creates an enabled inbound rule for port 22 (R14). A private-network service would be an alternative; none is priced here |

**No paid licence is needed by the plan.**

### 4.5 Disk, hardware and running costs

| Item | Cost | Basis |
|---|---|---|
| Toolchains and caches under `D:\dev` | about 3.0 GB (Rust 886 MB, Cargo 1,198 MB, MinGW 939 MB), with 244 GB free on D: | measured 2 October 2026 (R15); no cost, C: is not used |
| Tauri shell build, dependency tree | 417 packages in the spike's lockfile | measured (R15); a production shell adds several crates, so reviewing lockfile changes is a standing cost |
| Release build on this PC | $0: the releases (0.1.0, 0.1.1) are built on this PC on the GNU host into `D:\dev\release\<version>`, by provisional owner decision 4 (`owner_decisions_windows.md`), which departs from 02 C3-13 (MSVC in CI). No CI workflow exists yet, so no MSVC build exists | The size of a local MSVC install was not checked: **unverified** |
| WebView2 data folder | proposed on D: (03 section 7.1) | |
| Fixed Version WebView2, only while a break is fixed (T8) | about 180 to 250 MB of disk on D: while pinned | L4 section 4.4 (from L4) |
| Electricity for a PC that stays on in remote mode | not priced | The owner's PC is used daily already; the extra hours are unknown |
| A new Mac | none assumed | G0 |

### 4.6 Build effort that is not money

| Item | Size | Note |
|---|---|---|
| Build effort, Tauri path | **18 to 32.5 focused weeks** (02) | Done by automated build runs on the owner's existing subscription. Not priced in money here, because that subscription is a fixed fee, but a long run can use a weekly allowance. See risk S10 |
| Build effort, Electron on both after a G1 failure | 14 to 25 focused weeks (02) | |
| Build effort, Windows moved to Electron after being built on Tauri | plus 3 to 5 weeks (02) | |
| Yearly upkeep, Tauri | 5 to 10 days (02 section 7.2) | WebKit re-checks after each macOS release, WebView2 drift, Tauri minors, the Rust toolchain, cargo-deny, two screenshot sets |
| Yearly upkeep, Electron | 3 to 8 days (02 section 7.2) | A policy of skipping majors, since only the latest three are supported (S3) |

## 5. Cost sheet: the owner's time

All figures are **estimates**, built from the owner's tasks in 03 and 02. They are hands-on hours of the owner, not the build runs' time. No hourly rate is applied.

### 5.1 One-off, first year

Built from the "Owner actions, in order" table of `04_roadmap.md`, row by row, so that the two documents carry one set of figures. Rows marked "this step" are not in that table and are this step's estimates.

| When (04) | Task | Hours |
|---|---|---:|
| Now | Commit the other build workflow's work so D1 can start; answer O1 (which Mac, remote mode or a second lab), O16 (quiet-machine windows) and O17 (how the kit reaches the Mac) | 0.25 to 0.5 |
| D0 | One or two Mac sessions: install the Xcode command line tools, Rust, Node and pnpm; get the kit; run the maths, features and numbers; the Gatekeeper check; copy the results back | 2 to 3 |
| D0 | One visible measurement on the Mac, only if the hidden window gives no frames for pan and zoom (this step; 04 step 7 says to run that case visibly) | 0 to 1 |
| D1 and D3 | Leave the PC quiet in the named windows for the timings | 0 (waiting only) |
| D3 | Commit stage 1 and keep using the browser terminal | 0.25 |
| D4 | Answer O2, O4, O6, O7, O10 to O12 and O15; enable GitHub Actions; push the branch | 0.5 |
| D5 | A reboot; the real-keyboard check; the NVDA and Narrator passes; push the tag; install from D: | 1.5 |
| D6 | The parity list once a week for four weeks (15 minutes each), then O8 | 1 |
| D7 | O9; a Mac session for the self-test, the WebDriver smoke and the first Mac screenshot set; a VoiceOver pass (about 30 minutes) | 2.5 |
| D8 | O3 (install the OpenSSH server and an SSH key); Mac sessions per fix round and for G2, including the first install of the Mac app; O13 only if needed | 2 to 6 |
| After M6 | The parity list on the Mac once a week for four weeks (15 minutes each) | 1 |
| Subtotal, rows of 04 | | **11 to 16.25** |
| All phases (this step) | Phase-end commits, pushes and tags beyond the three rows above, under the default for O15 (the owner pushes): D0 so the Mac can clone, D1, D2, the CI loops of D4, D7 and D8; about 8 to 10 times at 5 to 10 minutes. Granting O15 removes most of this row | 1 to 2 |
| Gates (this step) | Reading and approving the results at each gate and stage exit (stage 0, 1, 2, 3, G1, G2). 04 does not list this time, because the reviews are done by the build runs and the owner reads their reports | 6 to 12 |
| **Total** | | **about 18 to 31** |

The two rows marked "this step" make up 7 to 14 of those hours and are the least certain; the visible Mac measurement adds up to 1 more. The total is 18.0 to 31.25 before rounding. The first Mac install of the toolchain (Xcode command line tools, Rust, Node, pnpm) sits inside the D0 Mac session, and the VoiceOver pass inside the D7 session, so neither is counted twice.

### 5.2 Each later year

| Task | Hours |
|---|---:|
| Review and approve each release (a few a year, 1 to 2 hours each) | 3 to 8 |
| Screen reader pass for releases that touch the page or the shell, a few a year | 2 to 6 |
| Re-approve Mac screenshots after a macOS release | 1 to 2 |
| Decisions on advisories and engine drift | 1 to 2 |
| Renewing any bought certificate or the Apple programme | 0.5 to 1 |
| **Total** | **7.5 to 19, about 8 to 19** |

The build effort for upkeep (5 to 10 days a year for Tauri) is separate and is in 4.6.

### 5.3 Waiting time that is not work

| Item | Time | Source |
|---|---|---|
| Artifact Signing identity validation, if ever used | 1 to 20 business days | R7 |
| Apple sign-up, if ever needed | not stated; the page lists a legal name and two-factor authentication | R1 |

## 6. The risk register

### 6.1 Technical (T)

| ID | Risk | L | I | Score | Early signal | Mitigation | Owner |
|---|---|:-:|:-:|:-:|---|---|---|
| T01 | Lazy imports do not bring backend start to 2.5 s. About 2.3 s of the 2.6 to 3.1 s is imports, with scipy.stats and `analytics.perf` alone 0.57 to 0.66 s (measured); the gain from lazy loading is not measured | 2 | 2 | 4 | Import profile after item 1.1b above 2.5 s on a quiet machine; the start-up import test | T3: profile again; offer the opt-in resident backend; no shell work until fixed | Build 1 |
| T02 | Cold double-click to HOME above 5 s. The backend alone took 3.6 to 5.1 s under load (measured), and first launch after a reboot is slower | 2 | 2 | 4 | Harness run after a reboot above 5 s | T3 response; warm-up of the heaviest imports on a background thread; resident backend as an owner's option | Build 2 |
| T03 | Whole-app memory above 500 MB idle or 1.5 GB heavy. WebView2 held 375 MB private after the heavy set; the backend reached 1,170 MB working set at a 256 MiB cache and its default cap is 2 GiB | 2 | 2 | 4 | Harness idle figure above 400 MB; the all-day soak above 1.0 GB | Desktop caps of 512 MiB bars and 128 MiB files; T4: lower the caps, look at canvas backing stores per panel; a memory target while minimised, measured before adoption | Build 2 |
| T04 | Pan and zoom or the 20,000-point data hop miss their budgets; the pan and zoom rule test is skipped offline today | 2 | 2 | 4 | p95 above 25 ms; hop above 100 ms | T5: Arrow binary columns for the chart routes only (2 to 3 weeks); one natively drawn view only after that (4 to 8 weeks) | Build 2 |
| T05 | The result cache serves a stale body: a file rewritten with the same size and a restored modification time cannot be seen by a key of path, mtime and size. The key records every file the computation read, so a missed input is unlikely | 1 | 3 | 3 | Cached against fresh bodies differ; the crosscheck through the cache fails | Key on `mtime_ns` and size; compare cached and fresh dumps byte for byte; a "clear caches" menu item. Add a content hash for small inputs, if a tool that restores timestamps is ever used on `results/` | Build 1 |
| T06 | The session middleware breaks a route or the stream, because a hand-picked test list misses it | 2 | 1 | 2 | A screen shows an error; the route walk in the session test fails | The session test walks the app's full route list, the stream included (03 section 15.2) | Build 1 |
| T07 | A stale lock file or two launchers racing for the lock leave the app attached to nothing, or start two backends | 2 | 1 | 2 | The app shows "backend stopped" after a crash | Stale detection by pid, proof and a port check, then takeover; a held lock makes a second start attach (tests in 03 section 15.2) | Build 1 |
| T08 | The shell stops reading the backend's stdout and the pipe fills, which blocks the backend; or stray output is mistaken for the handshake line | 2 | 2 | 4 | `/api/health` hangs while the process is alive | A reader thread that drains stdout into `backend.log` from the first line; the handshake is the first `NQT-` line only; a test with a noisy child | Build 2 |
| T09 | A backtest child outlives a crashed backend or shell and keeps files open | 1 | 2 | 2 | A `run_base.py` process with no parent | The stdin watchdog calls `JobService.close()`; the Windows Job Object ends the tree; macOS relies on the watchdog only | Build 2 |
| T10 | Closing the app stops a running backtest and leaves partial output | 2 | 1 | 2 | The owner closes the window mid-run | A native confirmation first (03 section 2.3); the ledger is append-only and written only by `scripts/ledger_append.py`, so a partial run adds no row; opt-in resident backend | Build 2 |
| T11 | The app attaches to a backend that started before a `git pull`, so the page and the backend are out of step | 2 | 2 | 4 | The contract hash in the handshake differs from the page's | The shell compares the contract hash and offers a restart (03 section 4.4); the "out of step" page names the side to update | Build 2 |
| T12 | The workspace store loses or mixes edits: a merge by "newest wins" uses a clock, and the two machines of remote mode may disagree | 1 | 2 | 2 | A workspace reverts after a PUT clash | A version check with 412; the last five versions kept as `.1` to `.5`; the server stamps the time, not the client (acceptance text for D3.1 in section 6.8) | Build 1 |
| T13 | Reaching WebView2's accelerator setting and `ProcessFailed` through `with_webview` needs raw COM calls that are unverified | 2 | 1 | 2 | F5 or F12 still act in the window; a crashed renderer is not caught | The page's `preventDefault` already blocks the keys in the browser; a direct `webview2-com` call as the second route; keep the unsafe code in one small module | Build 2 |
| T14 | Hidden-window tests cannot see focus, real key and paint behaviour, because a hidden WebView2 gets no frames and throttled timers unless its controller is made visible | 3 | 1 | 3 | A key or focus bug found only in daily use | The spike's hidden-window method with the controller visible; one real-keyboard check by the owner; the Mac WebDriver smoke set sends real key events | Owner |

### 6.2 Schedule (S)

| ID | Risk | L | I | Score | Early signal | Mitigation | Owner |
|---|---|:-:|:-:|:-:|---|---|---|
| S01 | Effort above the 32.5-week top. The range is an estimate with no actual-to-estimate ratio behind it, and the Mac stage spans 6.25 weeks | 2 | 2 | 4 | The first stage 1 item takes more than 1.5 times its estimate | Recalibrate after the first stage 2 item, as 02 says; stage gates; descope order: Mac last, later phases never without a trigger | Owner |
| S02 | The other build workflow's 132 uncommitted paths collide with the seam files of stage 1 (`app.py`, `jobs.py`, `client.ts` and others) | 3 | 1 | 3 | Merge conflicts; `gen_03_tables.py` output changes | Start stage 1 after that work lands; regenerate Appendix A and the route table first | Owner |
| S03 | G0 stays unanswered, so G1 and stage 3 cannot start and the Mac stays at zero | 2 | 2 | 4 | No Mac answer by the end of stage 1 | The default in 03: stage 2 starts on Tauri anyway; the bridge interface keeps a later move to Electron at 3 to 5 weeks | Owner |
| S04 | G1 fails after Windows is built on Tauri, or T2 favours Electron late | 2 | 2 | 4 | A G1 item fails; Electron 44 measures 15% lighter or 300 ms faster | T1 and T2 are decided in stage 0, before shell code, by default. The owner chooses between moving Windows (3 to 5 weeks) and a split shell (2 to 3 weeks extra) | Owner |
| S06 | Stage 1 changes regress the browser terminal the owner uses every day: the token on port 8765, the workspace store, lazy imports | 2 | 2 | 4 | A browser screen, a saved workspace or `start.ps1` fails after a stage 1 commit | Each seam is one commit with its tests; the rollback table in 03 section 20; browser budgets unchanged; `localStorage` kept as a cache | Build 1 |
| S07 | No MSVC build tools and a full C: drive (about 30 GB free): a local release build is not possible, and the spike's GNU build printed a manifest merge warning | 2 | 2 | 4 | Free space on C: under 10 GB; a warning that a manifest was dropped | Releases are built in CI on the MSVC host; every toolchain, cache and profile stays on D:; the release check measures artefact size | Build CI |
| S08 | There is no CI today and hosted runners cannot reach the private lab, so the backend tests, the crosscheck and the real-data smoke run by hand before a tag and may be skipped | 2 | 2 | 4 | A tag without a recorded green run of the three | A release checklist script that refuses to tag unless the three have passed on the PC that day; the build run does it before the tag | Build CI |
| S09 | Elapsed time is a multiple of focused time. The owner also runs the weekly portfolio work and the research | 3 | 2 | 6 | Weeks of calendar with no commit | Stage 1 ships to the browser on its own, so value arrives before any shell; report progress in focused weeks, not dates; plan on the high end | Owner |
| S10 | Long automated build runs use up a weekly allowance on the owner's subscription, and a heavy parallel run costs more than a serial one. The owner's standing rule is to flag heavy or parallel use before it starts | 2 | 2 | 4 | A run stops on a usage limit | Stage by stage with a stated size before each; fewer than five parallel workers unless the owner says otherwise; lighter workers for mechanical stages and the strongest setup kept for costly reviews | Owner |

### 6.3 Platform (P)

| ID | Risk | L | I | Score | Early signal | Mitigation | Owner |
|---|---|:-:|:-:|:-:|---|---|---|
| P01 | A WKWebView gap found at G1 or later: Perspective on wasm32 (memory64 is not shipped in Safari), dockview drag and drop, blob downloads reaching `on_download`, clipboard image write, EventSource in stream mode, `Ctrl+Option+letter` reaching the page, F10 and Alt. Every Mac number is unmeasured | 2 | 3 | 6 | Any G1 item fails in the hidden WKWebView self-test page | G1 before any Mac shell code; item 3.2 holds 1 to 4 weeks of fixes; T1 sends the plan to Electron on both systems; typed commands replace any key that cannot be fixed | Owner |
| P02 | JavaScriptCore differs from V8 in the crosschecked maths beyond 1e-9 relative. The ECMAScript specification calls some mathematical operations, such as `Math.exp`, implementation-approximated (R13) | 2 | 3 | 6 | The G1 golden run under JavaScriptCore shows a difference above 1e-9 | The golden tests of `web/src/quant` under JavaScriptCore at G1 and in CI on every change touching them; if one kernel differs, move that kernel behind the backend, where the crosscheck lives | Build 3 |
| P03 | A yearly macOS release changes WebKit under the app. macOS 27 came out on 14 September 2026 and 27.0.1 on 28 September (R10) | 2 | 2 | 4 | The self-test page or the WebDriver smoke set fails after a macOS update | G1 is run on the owner's actual macOS version, not only 26; re-run after each macOS release; do not update the Mac before the re-run; upkeep budgeted at 5 to 10 days a year | Owner |
| P04 | The owner's Mac does not meet the lab's floor. NautilusTrader 1.231.0 has macOS wheels only for `macosx_26_0_arm64` (L4 S30), and macOS 27 runs on Apple silicon only (R10, secondary) | 2 | 2 | 4 | G0 shows an Intel Mac or macOS before 26 | Remote mode has no macOS floor, because the lab runs on the PC; whether an Intel Mac is a supported Tauri target is not checked here (unverified) | Owner |
| P05 | WebView2 changes under the app. Edge Stable moved to a two-week major cycle from 152 (R9), and the runtime updates by itself | 2 | 2 | 4 | The weekly drift run changes result; the `NewBrowserVersionAvailable` event fires | The `webview2-drift.yml` run (03 section 16) re-runs vitest and the offline Playwright project; T8: fix forward, and pin the Fixed Version runtime only while the fix is made | Build CI |
| P06 | Apple tightens Gatekeeper or notarisation again, so a locally built app is blocked. The change in Sequoia (6 August 2024) shows the direction | 2 | 1 | 2 | A prompt or a block on the first local build at stage 0.3d | Join the Apple Developer Program ($99 a year, R1) and add notarisation (03 section 13.2); Apple lists no such change for 2026 (R11) | Owner |
| P08 | Smart App Control or SmartScreen blocks an unsigned installer on another Windows machine. It is off on this PC (measured) | 1 | 2 | 2 | A block message, not a "Run anyway" prompt | Build locally; sign only when a second machine appears (section 4.2) | Owner |
| P09 | Antivirus flags the shell exe. Tauri issue 2486 has been open since 2021 with 84 comments (L4 S24) | 2 | 1 | 2 | Defender quarantines a build | Submit it to Microsoft's security intelligence portal; publish SHA-256 checksums; keep the shell free of frozen Python | Build CI |
| P10 | macOS blocks the loopback page or prompts on every launch: App Transport Security without `NSAllowsLocalNetworking`, or a firewall prompt for a local listener (L1 section 5.11, unverified) | 2 | 2 | 4 | A blank window or a repeated prompt in the G1 self-test | `NSAllowsLocalNetworking = YES` in `Info.plist` (S25); in remote mode the Mac opens no listener except the tunnel's local port | Build 3 |
| P11 | Remote mode is not good enough for daily use: the PC is off, asleep or restarted by an update, or the tunnel drops the stream. Latency over a tunnel is unmeasured | 2 | 2 | 4 | HOME over the tunnel above 5 s, or more than one reconnect an hour (T10) | A bundled "PC not reachable" page; `ServerAliveInterval`; T10 offers local-lab mode (1 to 2 weeks plus the gate change) | Owner |
| P12 | Plan workarounds depend on open upstream issues: NVDA silent in a frameless window (issue 12901, open), no `SharedArrayBuffer` (1522, open), no streaming through the custom protocol (13069, open) | 1 | 2 | 2 | A Tauri release note that touches window frames, the loopback load or `with_webview` | A framed window, no threaded WebAssembly, the page served over HTTP from the backend; re-read the three issues at each Tauri minor | Build 2 |
| P13 | The Tauri 2 line loses support as Tauri 3 matures. 3.0.0-alpha.4 was tagged on 1 October 2026 | 2 | 1 | 2 | A support-policy statement, or advisories fixed only on 3 | T7: re-run G1 against 3 with its Chromium runtime at a release candidate; pin 2.12.x until then | Owner |
| P14 | WebKit evicts script-written storage after seven days (L1 section 5.5; for a first-party origin used daily this is unverified) | 1 | 1 | 1 | Empty `localStorage` after a week away | Workspaces and layouts are files served by the backend; `localStorage` is only a cache | Build 1 |

(P07 was folded into P06 and S05 into S04; the gaps in the numbering are deliberate, so that IDs stay stable if rows are added later.)

### 6.4 Security (X)

| ID | Risk | L | I | Score | Early signal | Mitigation | Owner |
|---|---|:-:|:-:|:-:|---|---|---|
| X01 | Another Tauri IPC access-control flaw. The repository lists 9 advisories since 2022, 2 in 2026: origin confusion fixed in 2.11.1 and a high-severity channel flaw fixed in 2.11.6 on 26 September 2026 (R12) | 2 | 2 | 4 | A new advisory; a Tauri release note naming IPC, capabilities or downloads | The page gets no command, no plugin and no capability (03 section 2.1); a floor of 2.11.6; T9: patch within 7 days; the IPC refusal test calls every command from the page | Owner |
| X02 | The token or the lock file is readable by another local user or process: Windows needs an explicit ACL, `os.chmod` mode bits do not set one, and a lab on D: may inherit wider rights than a folder under the user profile | 2 | 2 | 4 | `icacls` on `terminal/state/backend.lock` shows a group other than the owner, SYSTEM and Administrators | Set an explicit owner-only ACL when the file is created and test it with `icacls` (acceptance text for D2.1 in section 6.8); the token goes in on stdin, never in argv, the environment or a URL; mode 0600 on macOS | Build 1 |
| X03 | A malicious or compromised crate or npm package lands in the shell or the page. The bare Tauri shell's lockfile has 417 packages (R15) | 1 | 3 | 3 | A `cargo deny` or `cargo audit` failure; an unreviewed lockfile change | cargo-deny with a source allow list, cargo-audit, reviewed lockfile changes, `--locked`, actions pinned to commit SHAs; the plan states that banning crates by name does not stop a renamed one (02 section 7.2) | Build CI |
| X04 | A test hook or a `WEBVIEW2_*` variable reaches a release build and opens a debugging port | 1 | 3 | 3 | `cargo tree -e features` shows the `smoke` feature in a release; the HKCU WebView2 policy key holds a debugging flag | Hooks compiled only under `smoke`, which release CI refuses; `WEBVIEW2_*` removed from the shell's environment; the HKCU key checked at start | Build 2 |
| X05 | A bypass of the shell's write deny list: junctions, 8.3 names, symlinks and the `\\?\` prefix are covered; NTFS alternate data streams, case differences, UNC paths and reserved device names are **not named** in 03 | 1 | 3 | 3 | A write test lands under `results/`, `data/`, `live/`, `backtests/output`, `.venv` or `src` | Resolve fully, compare case-insensitively on Windows, refuse any path with a colon after the drive, refuse UNC and device names; the Clippy ban on file writes outside `writes.rs`; the cases are written into the acceptance criteria of D4.4 (section 6.8) | Build 2 |
| X06 | A shell with a known fix goes unpatched. With no updater, a fix means a manual rebuild | 2 | 2 | 4 | An advisory older than 7 days with no new tag | T9; a weekly check of the Tauri advisory feed in the drift workflow; a short release procedure | Owner |
| X07 | Remote mode widens the attack surface of the PC that holds the IB paper session, the API keys and the lab. Installing the Windows OpenSSH server creates and enables an inbound rule for port 22 (R14) | 2 | 3 | 6 | Port 22 reachable from a network the owner does not control | Key-only authentication with passwords off, `AllowUsers` for one account, the firewall rule limited to the private network or one address, `ssh` host key checking on, and the whole thing off unless remote mode is chosen. This is owner decision 3 | Owner |
| X08 | Signing secrets in a public repository's CI, if signing is ever added | 1 | 3 | 3 | A workflow that uses a secret on a pull-request trigger | No secrets in any workflow today; if added: a protected environment with the owner as reviewer, an offline key, no secrets for pull-request jobs (02 C3-2). Secrets are not passed to workflows from forks (L4 S37) | Build CI |
| X09 | The environment allow list is wrong. Too narrow and a backtest fails for lack of a variable; too wide and `QUANTPAD_API_KEY` or `TYPESAFE_API_KEY` reaches a child | 2 | 2 | 4 | A job that exits with a missing-variable error; the canary test fails | The three-column table in 03 section 8; canary values in two key variables checked in the backend and in a job child; the first real backtest in stage 1 uses the list | Build 1 |
| X10 | A flaw in the session design: code replay, an origin-binding bug, or a cookie clash because cookies do not separate by port (RFC 6265, M2 of 03) | 1 | 2 | 2 | The session test accepts a foreign origin or a reused code | The cookie name carries the port; the code works once and expires after 60 s; the middleware compares with `hmac.compare_digest` and checks the origin | Build 1 |

### 6.5 Correctness (C)

| ID | Risk | L | I | Score | Early signal | Mitigation | Owner |
|---|---|:-:|:-:|:-:|---|---|---|
| C01 | The numbers on screen differ from the crosschecked ones. The crosscheck reads dumps written by in-process tests and never sees the served JSON | 1 | 3 | 3 | The stage 2.4 comparison of served and in-process bodies finds a byte difference | Start the app against the fixture backend, fetch every route that has a dump through the app's session, and compare byte for byte; the crosscheck against the app-launched backend at G2 | Build 2 |
| C02 | A cache hit writes no gate log line, exactly as a `GatedBarCache` hit does today, so the audit page counts fewer lines than reads and may be read as a breach or hide a real one | 2 | 1 | 2 | The owner sees fewer log lines than screens opened | Document it on the OOS screen; `smoke_real.ps1` keeps its two checks (research file hashes unchanged, only `caller="terminal"` lines appended) | Build 1 |
| C04 | Amber on black looks different in WebKit: stroke weight and hinting change, so perceived contrast drops even if the ratio does not. The 204 screenshot baselines are Windows Chromium | 3 | 1 | 3 | A contrast check or a visual diff fails on the Mac | A second, Mac-specific baseline set approved by the owner; the contrast tests re-run on WebKit; the same tokens and self-hosted fonts | Build 3 |
| C05 | An accessibility regression or gap. NVDA, Narrator and VoiceOver behaviour is not covered by automation; `forced-colors` and `prefers-contrast` are missing today in every option, and a desktop app makes contrast themes more likely to be used | 2 | 2 | 4 | A manual screen reader pass finds an unlabelled grid or lost focus | Framed window (NVDA is silent in a frameless Tauri window), axe on both engines, focus returned to the page after app switching; the 2 to 4 week accessibility phase proposed first among the later phases | Owner |
| C06 | F10, Alt, `Ctrl+Option+letter` or F8 to F11 do not reach the page, or the system takes them | 2 | 1 | 2 | The Windows smoke or the Mac WebDriver set misses a key | Typed commands for every action; the Mac table of alternatives; the owner's one real-keyboard check | Build 3 |
| C07 | The app and the browser differ in behaviour during the dual run | 2 | 1 | 2 | A row of the weekly parity list fails | The defect rule: a defect only in the app is fixed before any new feature; the browser door stays as the fallback | Owner |
| C08 | A dependency update switches Perspective to memory64 or threads, which WKWebView does not ship | 1 | 2 | 2 | The wasm32 pin test fails | The test that pins the wasm32 server (stage 1.7); a note in the dependency review | Build 1 |

(C03 was folded into T05 and is not used.)

### 6.6 Research gate and write ban (G)

These protect the rules in the lab's own constitution: one door to prices, no write under `results/`, `data/` or `live/`, a read-only IB client, and sealed data never served. They carry high impact by definition, and low likelihood by design.

| ID | Risk | L | I | Score | Early signal | Mitigation | Owner |
|---|---|:-:|:-:|:-:|---|---|---|
| G01 | The backend scan does not ban `serve_sealed` by name. 03 section 24 lists this as unchecked | 1 | 3 | 3 | A route or a helper imports `serve_sealed` and the scan stays green | Add `serve_sealed` and `data.serve_sealed` to the AST ban in stage 1, and show first that the new test **fails** on a file that names it (the lab's rule 5: a check must be born failing) | Build 1 |
| G02 | A second door to prices opens: a new route that reads parquet, a shell crate for parquet, Arrow or DuckDB, or a Python bridge in the shell | 1 | 3 | 3 | An AST, Clippy or cargo-deny ban fails; a gate log line is missing for a screen that shows prices | One door, `nq_lab.data.serve`; Clippy bans on `std::fs` outside `writes.rs`; cargo-deny bans the data crates by name with a source allow list; the shell has no data path (03 section 6) | Build 1 |
| G03 | The new workspace PUT writes outside `terminal/state/workspaces`, or accepts a name outside its list | 1 | 3 | 3 | The workspace store test finds a file elsewhere; a name outside the seven gets anything but 404 | A fixed list of seven document names; atomic replace in one folder; the GET-only test allows exactly three writes | Build 1 |
| G04 | A second backend on one lab, or a second lab on the Mac, splits the gate's audit log | 1 | 3 | 3 | Two `NQT-READY` lines for one root; two gate logs | One backend per lab by lock file and proof; remote mode keeps one log on the PC; a lab on the Mac needs a gate change and the owner's go | Owner |
| G05 | The IB read-only guarantee slips: a second connection on client id 95, or a crate or code path that can place an order | 1 | 2 | 2 | IB error 326 (client id in use), which the snapshot already treats as fatal; an order-name hit in the shell scan | `ib_readonly_client.py` stays the only file importing `ibapi`; ports 7496 and 4001 refused; the Clippy `TcpStream` ban; the plan does not claim that crate bans stop a renamed crate | Build 2 |
| G06 | A fixture backend runs a real backtest, or real data is served as fixture data | 1 | 3 | 3 | JOBS starts with `NQT_FIXTURE_DIR` set | JOBS refuses unless `sys.prefix` is `<root>/.venv` and, in desktop mode, `NQT_FIXTURE_DIR` is unset; the `--fixture` switch exists only in test builds | Build 1 |
| G07 | A release artefact carries lab data or sealed results | 1 | 3 | 3 | The release check finds a `.parquet` or a path under `data/`, `results/` or `live/` | The check in `desktop-release.yml` fails the build on any of those or on a file named like a sealed result (03 section 6, item 8) | Build CI |
| G08 | Time of check against time of use on the identity proof: the backend is swapped between the handshake and a later navigation | 1 | 2 | 2 | The proof fails on a navigation | The proof is re-run on every top-level navigation; a failing backend is refused; the page is shown only from the picked lab's root | Build 2 |

### 6.7 Owner and scope (O)

| ID | Risk | L | I | Score | Early signal | Mitigation | Owner |
|---|---|:-:|:-:|:-:|---|---|---|
| O01 | The ask and the result differ. "Light and fast as fuck" meets a web-engine shell: whole app about 330 to 380 MB idle (estimate from measured parts); the venv of 690 to 723 MB stays; most of the speed comes from the backend work in stage 1, not from Rust | 3 | 2 | 6 | The owner's first reaction to the deck's numbers | State the table in section 4 of 02 plainly in the pitch, with what a native UI would and would not change; show warm HOME at 1,000 ms and the 15 MB installer against the 330 to 380 MB idle figure | Owner |
| O02 | Scope grows into PyO3 kernels, binary columns or a native view before any trigger fires | 2 | 2 | 4 | A work item without a gate or trigger behind it | G3 and T5 and T6 as written; later phases only on evidence; each PyO3 kernel shadow-tested for a release | Owner |
| O03 | One person to maintain a Rust shell, the Python backend and a React page. Upkeep is 5 to 10 days a year, and a skipped year leaves the shell behind on fixes | 2 | 2 | 4 | No release tag in six months while Tauri has moved two minors | A yearly upkeep slot; the shell kept to about 1,500 lines (02 section 3.4) with seven small modules; the Electron fallback keeps the bridge shell-neutral | Owner |
| O04 | The public repository's licence is all rights reserved (viewing and evaluation only): a later third party cannot reuse the code, and open source signing is impossible without an OSI licence | 1 | 1 | 1 | Any request to use the code, or a wish to sign for free | Change the licence when a second user or open source signing is wanted (decision 14); free to do | Owner |
| O05 | The 14 owner decisions in 03 section 23 are left to defaults that the owner would not have chosen | 2 | 1 | 2 | A default taken without a note | Each default is stated in 03; the register of decisions is reviewed at each gate | Owner |

### 6.8 Mitigations that must reach the roadmap's acceptance criteria

A mitigation in the register is only as good as the check that proves it. The QA gate of `04_roadmap.md` tests the acceptance column of each task, so a mitigation that is not in that column is not checked. This step may not edit `04_roadmap.md` or `03_migration_plan.md`, so the wording is set out here for the roadmap to take over word for word. Status on 2 October 2026: **not yet in 04 or 03** (each row names what those documents say today).

| Register row | Task that owns the file | What 04 or 03 says today | Acceptance text to add |
|---|---|---|---|
| X05: write deny list bypass | D4.4 (03 item 2.3a), `writes.rs` and `tests/writes_deny.rs` | D4.4: refused "through a junction, an 8.3 alias and the `\\?\` prefix". 03 section 6 item 3 lists the same three, plus symlinks | Writes under the six denied folders are also refused through: an NTFS alternate data stream (`results\x.txt:s`); a path that differs only in case (`RESULTS`, `Data`); a UNC path to the same folder (`\\localhost\c$\...` and `\\?\UNC\...`); and a reserved device name (`CON`, `NUL`, `COM1`, `\\.\`). Each case is born failing: the test first fails against a build with the check removed. A path with a colon after the drive letter, a UNC path or a device name is refused outright, wherever it points |
| T12: workspace store clock | D3.1 (03 item 1.6a, section 10.3) | D3.1 tests the version check (412), the caps (413), the name list (404) and the `.1` to `.5` copies. Neither it nor 03 section 10.3 says who stamps the time | Every time stored with a document is written by the backend from its own clock. A test sends a document carrying a `saved_at` far in the past and far in the future and finds the stored value is the backend's time, not the client's. Add the same sentence to 03 section 10.3 |
| X02: lock file readable by others | D2.1 (03 item 1.3a), `desktop/lock.py` and `tests/test_desktop_lock.py` | D2.1: "the lock file is owner-only". No check on Windows is named, and 03 section 4.2 says only "owner-only ACL on Windows, mode 0600 on macOS" | On Windows the lock file is created with an explicit ACL (not `os.chmod`, which sets no ACL). The test runs `icacls` on the file and on the folder it sits in and finds only the owner, SYSTEM and Administrators, with inherited rights removed; it is born failing against a file created with the default inherited rights, including on a folder under `D:`. On macOS the test reads the mode and finds 0600 |

Rows of the register not listed here were not compared against the roadmap's acceptance column in this step. The comparison is cheap to repeat: for every register row, find the 04 task whose files it names and check that the acceptance column says how the mitigation is proved.

## 7. Accepted residual risks

These stay after the mitigations and are accepted by choice, not by neglect.

| Residual | Why accepted |
|---|---|
| Two web engines if G1 passes. The 383 end-to-end tests stay on Chromium; the Mac gets a smaller set | The cost of a single engine (Electron) is 130 to 158 MB of runtime per system and Chromium patches owned by the app (02 section 3.3) |
| WebView2 and WKWebView update under the app | Pinning WebView2 gives up the install-size gain; the weekly drift run catches the same breakage (02 C1-7) |
| Banning crates by name does not stop a renamed or compromised crate | Stated in 02 and 03; the guarantee rests on the Python AST ban plus a small, reviewed Rust tree |
| Signing covers the shell only; the Python side is trusted because the owner controls the lab | There is one owner and no distribution |
| No auto-updater, so shell fixes need a manual rebuild | An updater would let anyone who can push to the public repository ship signed code (02 C3-2) |
| Remote mode needs the PC on | The alternative, a second lab on the Mac, splits the gate's audit log |

## 8. What the owner must decide because of the register

| Decision | Risks | Default and cost |
|---|---|---|
| Is an OpenSSH server on the trading PC acceptable, and on which network? | X07, P11 | Built-in Windows feature, key-only, private network, off unless remote mode is chosen: $0 |
| Which Mac, and which macOS version? | P01, P03, P04, S03 | G1 is run on that version; an Intel Mac means remote mode only |
| Join the Apple Developer Program? | P06, section 4.1 | No, until stage 0.3d shows a Gatekeeper block; then $99 a year |
| Buy Windows signing? | P08, P09, section 4.2 | No; one SmartScreen prompt on a downloaded installer |
| Keep the repository public? | section 4.3 | Yes: CI at $0; private is $0 to about $139 a year |
| Accept the planning figure of 32.5 focused weeks, and the 18 to 31 hours of own time in the first year? | S01, S09, section 5 | Yes |
| Accept an honest pitch on memory and size? | O01 | Yes |

## Sources

All checked on 2 October 2026 unless marked. "Re-read" means fetched again in this step.

- R1. Apple, Apple Developer Program enrolment (99 USD per membership year, with regional prices shown in local currency at sign-up; fee waivers for nonprofits, accredited educational institutions and government entities): https://developer.apple.com/programs/enroll/ (re-read).
- R2. GitHub Docs, Actions runner pricing (Linux 2-core $0.006, Windows 2-core $0.010, macOS 3 or 4 core $0.062 a minute): https://docs.github.com/en/billing/reference/actions-runner-pricing (re-read).
- R3. GitHub Docs, GitHub-hosted runners ("Use of the standard GitHub-hosted runners is free and unlimited on public repositories"; `macos-26` is arm64): https://docs.github.com/en/actions/reference/runners/github-hosted-runners (re-read).
- R4. GitHub Docs, Actions billing (GitHub Free 2,000 minutes and 500 MB, Pro 3,000 minutes and 1 GB; the page states no minute multipliers): https://docs.github.com/en/billing/concepts/product-billing/github-actions (re-read).
- R5. Certum shop, code signing (Standard from €209 cloud, €169 set, €139 electronic; Open Source from €49, €69, €25; EV from €379, €359, €329; a certificate valid for at most 459 days from 27 February 2026): https://shop.certum.eu/code-signing.html (re-read).
- R6. Microsoft Learn, SmartScreen reputation for Windows app developers (page dated 4 May 2026, updated 17 August 2026; Artifact Signing "starts at $9.99/month"; EV no longer bypasses SmartScreen; Store apps never warn; reputation "can take several weeks and hundreds of clean installs"): https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation (re-read).
- R7. Microsoft Learn, Artifact Signing quickstart (updated 29 September 2026; public trust for organisations in the UK, EU, US, Canada and others; "Individual developers must be located in the United States or Canada"; identity validation 1 to 20 business days): https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart (re-read).
- R8. GOV.UK, Companies House fees (updated 25 September 2026; online incorporation £100; confirmation statement £50): https://www.gov.uk/government/publications/companies-house-fees/companies-house-fees (re-read).
- R9. Microsoft Learn, Microsoft Edge release schedule (page updated 25 September 2026): "Starting with Stable channel version 152, Microsoft Edge is moving to a 2-week major release cycle cadence"; Stable 154 on 24 September 2026; targets 155 to 159 from 8 October to 3 December 2026: https://learn.microsoft.com/en-us/deployedge/microsoft-edge-release-schedule (re-read). WebView2 follows Edge's Chromium; the exact mapping of runtime releases to Edge dates was not read.
- R10. Apple Developer, release list (macOS 27.0.1 on 28 September 2026; Xcode 27 on 14 September 2026): https://developer.apple.com/news/releases/ (re-read). Wikipedia, macOS Golden Gate (released 14 September 2026; "the first version of macOS to run exclusively on Macs with Apple silicon"): https://en.wikipedia.org/wiki/MacOS_Golden_Gate (secondary; no Apple page for the Intel point was read).
- R11. Apple Developer, Upcoming requirements (no change to Developer ID, notarisation or Gatekeeper listed; `notarytool` only since 1 November 2023): https://developer.apple.com/news/upcoming-requirements/ (re-read).
- R12. Tauri security advisories, read through the GitHub API (`gh api repos/tauri-apps/tauri/security-advisories`): 9 advisories since 2022; GHSA-w28w-mhc8-qvjv (high, 26 September 2026) and GHSA-7gmj-67g7-phm9 (medium, 6 May 2026) are the two of 2026: https://github.com/tauri-apps/tauri/security/advisories (re-read).
- R13. ECMAScript specification source, terms and definitions: "Some mathematical operations, such as `Math.exp`, are implementation-approximated" (read from `spec.html` of the main branch on 2 October 2026): https://tc39.es/ecma262/ and https://github.com/tc39/ecma262/blob/main/spec.html
- R14. Microsoft Learn, Get started with OpenSSH Server for Windows (page updated 8 September 2026; "Installing OpenSSH Server creates and enables a firewall rule named `OpenSSH-Server-In-TCP`. This rule allows inbound SSH traffic on port 22"; an in-box Feature on Demand): https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_install_firstuse (re-read).
- R15. Local read-only measurements, 2 October 2026: package counts in the Tauri spike's `Cargo.lock` (417) and the egui spike's (431), and folder sizes under `D:\dev` (Rust 886 MB, Cargo 1,198 MB, MinGW 939 MB, Tauri tools 8 MB, npm cache 15 MB).
- R16. Certum individual variant through a reseller ("Certum Cloud CODE Signing for Individual Developer ... intended exclusively for individual software creators", $139 a year before VAT), read 5 October 2026: https://www.sslmentor.com/certum/certumcodecloudindividual
- R17. SSL.com IV code signing ($129 a year) and eSigner pricing (from $20 a month for 20 signings), read 5 October 2026: https://www.ssl.com/products/software-integrity/code-signing/iv/ and https://www.ssl.com/guide/esigner-pricing-for-code-signing/
- R18. Tauri, Microsoft Store distribution (the Store needs a code-signed EXE and the WebView2 offline installer mode), read 5 October 2026: https://v2.tauri.app/distribute/microsoft-store/

Carried from earlier steps and not re-read here: L4 (Apple notarisation and Gatekeeper, SignPath, Microsoft Store, Velopack, CI cache, self-hosted runners, the UK Apple price of £79), L7 (Tauri and Electron advisories, supply-chain incidents, accessibility per stack), L1 (WKWebView gaps, key behaviour, storage), 02 (D1 to D12, the gates G0 to G3 and triggers T1 to T11, the effort estimates and upkeep figures) and 03 (the plan, its budgets and its unverified items).

Not verified in this step, and so not priced or scored with more confidence than the label says: the Apple UK price; whether Certum's own shop sells Standard certificates to private individuals (a reseller sells an individual variant, R16); whether WebView2 redistribution carries any fee or terms beyond the distribution page's sizes; whether GitHub counts Windows and macOS minutes at a multiple against the free allowance; the size of a local MSVC install; whether an Intel Mac is a supported Tauri target; the UK costs of running a company beyond the two Companies House fees; the owner's electricity cost in remote mode.
