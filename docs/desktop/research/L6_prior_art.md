# L6: Prior art and case studies

Research lens L6 of the desktop migration plan. It looks at how other trading tools, data terminals and fast developer tools are built, what made each one fast or slow, which migrations worked and which stalled, and what that means for a one-owner research terminal.

- Evidence checked: 2 October 2026. Every external claim carries a source in the Sources list at the end (S1, S2, ...). Repository facts (stars, licences, versions, dates) were read from the GitHub REST API and the crates.io API on that date.
- Anything not confirmed from a primary source is marked **unverified**. Vendor performance numbers are the vendor's own measurements unless stated otherwise, and are marked **vendor claim**.
- No local apps were run and nothing was measured for this lens.

## 1. Bottom line

1. **The heaviest professional data terminal in the world renders with a browser engine.** Bloomberg has used JavaScript to render Terminal applications since 2004, JavaScript is now "the primary language for client-side development" and "tens of millions of lines" of its code (S1), and a Bloomberg engineer describes the Terminal as "based on Chromium so the UI is nearly all DOM rendering" (S2). TradingView Desktop is Electron and is on Electron 41 as of version 3.4.0, 27 August 2026 (S3). Web rendering is not what separates a pro tool from a toy.
2. **The pro trading platforms that are native are mostly Windows-only.** Sierra Chart, NinjaTrader 8 and Quantower have no native Mac build; Mac users run them in Parallels, CrossOver or Wine (S9, S10, S11). MetaTrader 5's official Mac installer ships the Windows program inside Wine (S8). Native C++ or .NET did not buy these vendors a Mac app; it cost them one.
3. **The fastest native developer tools built their own GPU UI framework, with funded teams, over years.** Zed (gpui, 120 fps target, 8.33 ms frame budget, S14) and Warp (Metal renderer, 1.9 ms average redraw, vendor claim, S16) are both real speed wins. Both paid for it: Zed's Windows build arrived on 15 October 2025 (S15), more than two and a half years after the 2023 Mac-only gpui write-up (S14), and Zed's Windows screen reader issue is still open (S17). Warp's Windows screen reader issue has been open since November 2023 (S18).
4. **Wrap first, then port, has a much better record than a big-bang rewrite.** Slack kept Electron and replaced its client piece by piece behind a "legacy-interop" boundary (S24). Firefox moved to Rust one component at a time (S27). 1Password moved its logic into one Rust core and kept web front ends on desktop (S22). The stalled cases are rewrites: Netscape (almost three years between major releases, S28), xi-editor (S29), Atom (S30), Spacedrive v1 to v2 (S33) and Lapce, which rewrote its UI layer and is still at 0.4.x after eight years (S31).
5. **Tauri is proven for this exact front-end stack, and so are its sharp edges.** Spacedrive v2 ships Tauri 2 with React 19, Vite plus Tailwind CSS 4: the nq-lab terminal's stack (S33). GitButler, the best known Tauri app, is building its next client on Electron 44 because of WebKit text-input bugs, the need to support several engines, and Linux packaging (S34, S35). Two of those three reasons apply to a Mac build of the nq-lab terminal.
6. **Speed in the cited cases mostly came from data structures and work scheduling, not from the shell.** VS Code cut memory for a 35 MB, 13.7 million line file from about 600 MB to roughly the file size by changing a data structure, and abandoned a C++ version because JavaScript to C++ round trips ate the gain (S25). Figma's speed comes from a C++ engine compiled to WebAssembly (S23). Microsoft's new Teams claims twice the speed on half the memory on WebView2, which is still a browser engine (S20, S21).

## 2. The nq-lab facts that frame the comparison

- Front end: React 19, Vite 8, TypeScript 6, Tailwind 4, dockview, uPlot, lightweight-charts, ECharts, Perspective (WebAssembly grids), 30 function screens, a keyboard grammar, WCAG 2.2 AA, an amber-on-black look.
- Backend: FastAPI on Python 3.12 over NautilusTrader 1.231.0, read-only apart from a backtest queue; data only through the out-of-sample gate.
- Measured today in the browser: HOME first render 647 ms against a 1,500 ms budget; a grid of 8,411 rows opens in 61 ms against 500 ms; the shell bundle is 114.9 kB gzip.
- One owner, two machines (Windows 11 and a Mac), about 2,875 backend tests, about 6,925 unit tests, 383 end-to-end tests and a 2,325-check numerical crosscheck.

Most of the products below solved a different problem: thousands or millions of users, a team of engineers, and a commercial reason to look native. That difference matters when reading their lessons.

## 3. Trading platforms and data terminals

| Product | Stack (best evidence) | Mac story | Source |
|---|---|---|---|
| Bloomberg Terminal | C++ data layer; Chromium with V8 for the UI; JavaScript since 2004 | Windows client; Mac via other routes (**unverified**) | S1, S2, S4 |
| TradingView Desktop | Electron (41 as of 3.4.0, 27 Aug 2026) | Native-feeling Mac, Windows, Linux builds from one code base | S3 |
| IBKR Trader Workstation | Java desktop app | Runs on Windows, Mac, Linux | S5 (**secondary**) |
| IBKR Desktop | Launched 27 Feb 2024 for Windows and Mac; reported as Qt/QML | Same code base on both | S6, S7 (**unverified** that the Qt/QML posting is for IBKR Desktop) |
| MetaTrader 5 | Native Windows program | Official Mac installer wraps it in Wine 8.0.1 or later, macOS 10.15.7 minimum | S8 |
| Sierra Chart | Native Windows (C++) | None; users run Parallels with Windows 11 ARM or CrossOver | S9 (user forum) |
| NinjaTrader 8 | Windows and .NET Framework | None; web platform or Parallels | S10 (**secondary**) |
| Quantower | Windows, .NET 8 | None announced as of 2026 | S11 (**secondary**) |
| cTrader | Separate Windows and Mac desktop apps; Mac needs macOS 12 | Two desktop apps (implementation **unverified**) | S12 |
| Bookmap | OpenGL 3.3 renderer, separate Intel and Apple Silicon Mac builds; add-on API in Java | GPU acceleration on Mac only from macOS 13 | S13, S13b |

### 3.1 Bloomberg: a browser engine at the top end

Bloomberg's own JavaScript team says JavaScript has rendered Terminal applications since 2004 and is now the main client-side language, at tens of millions of lines (S1). An engineer who joined to work on Terminal JavaScript infrastructure in 2023 wrote that the Terminal "is based on Chromium so the UI is nearly all DOM rendering" and that the job was to make it fast (S2). Bloomberg has also given conference talks on local performance measurement for the Terminal (S4). The lesson is that the speed of a data terminal at this level is engineered inside a browser engine: profiling, data shape, virtualised lists, not a different UI toolkit.

### 3.2 TradingView Desktop: Electron, tracked closely

TradingView's release notes show Electron upgrades as routine items: Electron 18 (May 2022), 21.3.0 (December 2022), 38 (October 2025) and 41 (August 2026) (S3). They also show the costs of the route: an "out of memory" fix in 2.7.8 (June 2024) and an energy-use fix for Intel MacBooks in 2.14.0 (October 2025) (S3). Its chart library, lightweight-charts, is the one the nq-lab terminal already uses (Apache-2.0, 17,443 stars, S36). TradingView is the closest commercial match to a "pro charting terminal on Windows and Mac from one code base".

### 3.3 Interactive Brokers: two desktop stacks side by side

TWS is a long-lived Java application (S5, secondary). In February 2024 IBKR launched IBKR Desktop for Windows and Mac "in addition to, rather than a replacement of" TWS (S6). A September 2026 job advert for IBKR's trading platforms asks for Qt/QML, JavaScript in QML, and Java data models through Qt Jambi and JNI (S7). The advert does not name IBKR Desktop, so the link is **unverified**. If it holds, IBKR chose a cross-platform retained-mode toolkit (Qt) over both Electron and per-platform native code, and kept the old app running while the new one matured. That is a wrap-alongside strategy, not a replacement.

### 3.4 The Windows-native vendors

MetaTrader 5's Mac route is official but is still the Windows program in Wine: the installer downloads and configures Wine, and the help page tells users with Wine below 8.0.1 to reinstall (S8). Sierra Chart users on Apple Silicon run the ARM64 Windows build in Parallels, or CrossOver; custom studies not built for ARM need the x64 build (S9, user forum, February 2026). NinjaTrader Desktop needs Windows and the .NET Framework, with web access as the Mac answer (S10, secondary). Quantower is Windows only (S11, secondary). Bookmap is the odd one out: it ships separate Intel and Apple Silicon builds, renders with OpenGL 3.3, and only enables GPU acceleration on macOS 13 and later (S13). Its Windows requirements still list .NET Framework 3.5 (S13).

Lesson: writing the platform in C++ or C# against Windows APIs gave these vendors fast Windows apps and no Mac app. A Mac build later meant either a second app (cTrader, S12) or an emulation layer.

## 4. Fast developer tools, by stack

Repository facts read on 2 October 2026 (S37):

| Project | UI stack | Licence | Stars | Latest stable |
|---|---|---|---|---|
| Zed | gpui (own GPU framework, Rust) | GPL-3.0 and Apache-2.0 files; gpui crate Apache-2.0 | 91,176 | v1.22.0, 30 Sep 2026 |
| Warp | own GPU framework (Rust) | AGPL-3.0; UI crates MIT | 65,334 | rolling builds |
| Rerun viewer | egui 0.36.2 on wgpu 30 | Apache-2.0 | 11,526 | 0.38.1, 17 Sep 2026 |
| egui | immediate mode, Rust | Apache-2.0 or MIT | 30,790 | 0.36.2, 8 Sep 2026 |
| Lapce | Floem on wgpu (Rust) | Apache-2.0 | 38,878 | v0.4.6, 21 Jan 2026 |
| GitButler (current) | Tauri 2 and Svelte | FSL-1.1-MIT | 21,751 | 0.22.3, 29 Aug 2026 |
| GitButler Next | Electron 44, React 19, Rust SDK | FSL-1.1-MIT | same repo | nightly |
| Spacedrive v2 | Tauri 2, React 19, Vite, Tailwind 4 | FSL-1.1-ALv2 | 39,063 | v2.0.0-alpha.2, 7 Feb 2026 |
| Tauri | system webview (WebView2, WKWebView, WebKitGTK) | Apache-2.0 or MIT | 111,531 | v3.0.0-alpha.4, 1 Oct 2026 |
| Electron | bundled Chromium and Node | MIT | 123,375 | n/a |
| VS Code | Electron | MIT | 193,358 | n/a |

### 4.1 Zed on gpui: the fast path, and its bill

Why fast: Zed's founders built Atom on Electron and blamed its frame drops on garbage-collection pauses and DOM relayout (S14). gpui renders every primitive with its own shaders, targets 120 fps and treats 8.33 ms as the whole budget for a frame, from state update to drawing (S14). The post gives no benchmark against alternatives (S14).

What it cost:

- **Platforms one at a time.** The 2023 write-up is Metal on macOS (S14). Windows shipped on 15 October 2025 on DirectX 11 and DirectWrite, with a dedicated Windows group, and asked users to report problems with IME, keyboard layouts and multi-monitor setups (S15).
- **Accessibility late.** AccessKit support landed in gpui on 27 May 2026 (PR 56065), and work on node propagation was still being merged in September 2026 (PR 64143) (S17). The issue "Windows: Screen reader accessibility missing completely" (41138) is still open, last updated 22 May 2026 (S17).
- **Not a product for others yet.** gpui is Apache-2.0 and publishable, but the crates.io release is 0.2.2 from 22 October 2025 while Zed itself was at v1.22.0 on 30 September 2026 (S37, S38). Using gpui outside Zed in practice means tracking Zed's repository.

### 4.2 Warp: the same idea, earlier

Warp chose Rust and a Metal renderer with about 200 lines of shader code, and reported 144 fps or more on 4K and a 1.9 ms average redraw over a week (S16, vendor claim, July 2021). Its reason for building its own framework was "the lack of a stable UI framework for Rust" (S16). Warp's client is now open source: the UI crates are MIT and the rest AGPL-3.0 (S37). Accessibility: "App inaccessible with VoiceOver" (901) was opened in April 2022, and "Accessibility and screenreader users for Windows" (3847) has been open since November 2023 (S18).

### 4.3 Rerun on egui: immediate mode for data views

Rerun's viewer, a tool for streaming multimodal sensor data, is the example egui's readme gives of a "professional looking application" (S19). egui is immediate mode: the UI is rebuilt every frame from state, with no callbacks, and it offers accessibility through AccessKit (S19). Rerun pins egui 0.36.2 and wgpu 30 and follows egui's main branch closely (S37). The pattern suits dense, constantly changing views such as a live depth or tick panel. egui's own readme lists it as simple and portable, not as a full document UI; the 30 nq-lab screens with their tables and forms would be a large rebuild in it.

### 4.4 Lapce and xi-editor: Rust-native rewrites that stalled

xi-editor aimed for a Rust core with native front ends per platform. Its author's 2020 retrospective lists what went wrong: async "complicated everything", the CRDT got convoluted, JSON-RPC between processes became a bottleneck (slow JSON in Swift, code size from serde), and "there is no such thing as native GUI" once GPU rendering was needed (S29). His advice: "clearly identify which parts are research" (S29). The UI toolkit that followed, Druid, is now marked unmaintained in favour of Xilem (S32).

Lapce, built on xi's rope ideas, rewrote its UI from Druid to its own Floem toolkit in v0.3.0 (October 2023) (S31). Releases since then: 0.4.0 April 2024, 0.4.2 August 2024, 0.4.3 June 2025, 0.4.6 January 2026 (S31). After eight years the project is still 0.x. It is fast, by user reports, but has not reached the "stable daily tool" point that Zed reached with a funded team.

### 4.5 GitButler: from Tauri to Electron

GitButler's shipping app is Tauri 2 (apps/desktop uses @tauri-apps/api 2.11) (S37). In July 2025 a GitButler engineer opened an experiment, "Gitbutler Electron", listing reasons (S34):

- "The use of WebKit makes the dev-exp worse, means we have to support a wide range of browsers."
- Linux packaging is hard "because tauri doesn't bundle it's own browser".
- "Ctrl Z only works either in rich text mode or in regular text boxes", and "random characters get inserted into text boxes when hitting arrow keys".
- Moving off Tauri-specific APIs would allow true end-to-end tests through the UI against real repositories.

A GitButler maintainer then wrote in the Linux compatibility issue that there was "no tauri-based solution in sight" and that this was why they were "looking to switch to Electron" (S35). On 18 February 2026 the team scaffolded "GitButler Lite", an Electron app backed by a native Rust SDK, now shipped as "GitButler Next Nightly" on Electron 44 (S37). Their builds needed Ubuntu 24 or later on Linux (S35). Tauri's own issue to bundle a Chromium renderer has been open since November 2023 with 72 comments (S39), and the Tauri team maintains cef-rs, Rust bindings to the Chromium Embedded Framework (S37).

A separate developer moved a rich-text editor from Tauri to Electron for the same reason: "several UI regressions that looked/felt really janky" on Windows, and the value of shipping one Chromium everywhere (S40, a forum comment, not a vendor statement).

### 4.6 Spacedrive: a Tauri rewrite of a Tauri app

Spacedrive v1 was Tauri 2.0.3 and React 18; its last v1 release was 0.4.3 on 24 March 2025 (S37). The project says "v2 development began in June 2025. This is a ground-up rewrite addressing lessons from the v1 alpha", without listing the lessons (S33). v2 keeps Tauri 2 and moves to React 19, Vite, TanStack Query and Tailwind CSS 4 (S33), the same front-end family as the nq-lab terminal. The repository also holds a gpui photo grid, a GPU-native view that talks to the same local daemon over a socket or HTTP (S37). So even a Tauri project tries a native island for one heavy view rather than porting the whole UI. The stall is the lesson here, not the stack: v1 spent years in alpha, and the fix was a rewrite.

### 4.7 1Password 8: shared Rust core, web front ends

Before version 8, 1Password kept four separate platform apps, and every cross-platform change met "Now's not a good time, we're busy" from each client team (S22). Version 8 put the logic in a Rust core and used Electron on Windows, Linux and, after a planned SwiftUI app was dropped, macOS; iOS uses SwiftUI and Android its native views (S22). The team doubled in the first eleven months (S22). The announcement does not address the Electron criticism it drew (S22). The pattern, one core in a fast language behind thin per-platform shells, is the one the nq-lab terminal already has with its Python service.

### 4.8 Other web-stack apps

- **Figma**: the editor is C++ compiled to asm.js and then WebAssembly; load time fell by "more than 3x" measured from start-up to first full render (S23, June 2017). The desktop app is Electron (S26).
- **Linear**: its speed is credited to a real-time sync engine (S41), and the desktop app is widely reported as Electron (**unverified**: not in the Electron app list, S26). The S41 page is a talk summary without numbers.
- **Discord**: Electron (S26). In December 2025 Discord began testing an automatic restart of the Windows 11 client when it passes 4 GB of memory, limited to idle users, at most once a day, and called it a stopgap (S42, press report quoting Discord).
- **Slack**: rebuilt its desktop client on React inside the same Electron shell, moving from many processes to one, starting with the emoji picker and then the sidebar and message pane over more than two years, with a "legacy-interop" rule that new code never imports old code (S24, July 2019).
- **Microsoft Teams**: the new client claims "up to two times faster app performance while using 50% less memory" (S20, S21, vendor claim; the 2023 announcement says GigaOm checked it). It lists WebView2 as a requirement on Windows and on macOS, and still needs 3.0 GB of disk on Windows (S21).
- **VS Code**: Electron (S26). Its 2018 text buffer rewrite moved from an array of lines to a piece tree; a 35 MB file with 13.7 million lines went from about 600 MB of memory to about the file's size. A C++ native module was tried and dropped because "JavaScript to C++ round trips" and string conversion cancelled the gain (S25).

## 5. Migrations that worked and migrations that stalled

| Case | Strategy | Outcome | Why |
|---|---|---|---|
| Slack desktop 2017 to 2019 | Kept Electron, replaced client one feature at a time behind a boundary | Shipped | Each step small and shippable; old and new ran side by side (S24) |
| Firefox Oxidation | Rust components into the C++ browser one at a time: encoding_rs (56), Stylo (57), WebRender (67) | Shipped | Isolated components with narrow boundaries (S27) |
| 1Password 8 | Shared Rust core, web UI on desktop | Shipped, with user pushback on Electron | One logic core instead of four apps (S22) |
| IBKR Desktop | New app beside TWS, not instead of it | Shipped 2024, TWS still supported | No forced cut-over (S6) |
| Microsoft Teams 2.0 | Electron to WebView2, ground-up rebuild | Shipped; vendor claims 2x speed, half memory | Large funded team (S20, S21) |
| GitButler Next | Same Rust core, Tauri to Electron shell | In progress (nightly) | Engine consistency and Linux packaging (S34, S35) |
| Netscape 6 | Rewrite from scratch | Almost three years between major releases | Lost market while rewriting (S28) |
| xi-editor | Research-grade Rust core with native front ends | Abandoned | Too many experiments at once (S29) |
| Atom | Electron editor, not reworked | Archived 15 Dec 2022 | Stalled development, owner moved on (S30) |
| Lapce | UI layer rewrite (Druid to Floem) | Still 0.x after 8 years | Small team building its own toolkit (S31, S32) |
| Spacedrive v1 | Tauri alpha for years | Rewritten from June 2025 | "Lessons from the v1 alpha" (S33) |
| Zed | New editor on own GPU framework | Shipped, but Windows and screen readers years later | Funded team, framework built for one app (S14, S15, S17) |

What separates the two columns:

1. **The working cases kept a shippable product at every step.** Slack's emoji picker shipped before the rest of the rewrite (S24). Firefox shipped encoding_rs two releases before Stylo (S27).
2. **They drew a hard boundary first.** Slack's "legacy-interop" rule (S24); 1Password's Rust core behind the UI (S22); GitButler's Rust SDK that made the shell swap possible (S34, S37).
3. **The stalled cases mixed research with delivery.** xi's author names this directly (S29). Lapce and Zed both had to build a UI toolkit before they could build the product (S14, S31).
4. **Performance wins came from measured hot spots.** VS Code's piece tree (S25) and Figma's WebAssembly engine (S23) were targeted changes with before and after numbers, not stack changes.

## 6. Marketing versus measurement

- Warp's 1.9 ms and 144 fps (S16), Teams' "2x faster, 50% less memory" (S20, S21) and TradingView's "native" positioning are vendor claims. Only Teams cites an outside check (GigaOm), and that report was not read for this lens (**unverified**).
- Zed's gpui post gives a target (120 fps, 8.33 ms), not a measurement against an alternative (S14).
- Comparisons such as "Tauri is 20 to 50 times smaller and uses 5 times less memory" appear in search results from blog sites without a method; none were used here.
- Discord's 4 GB restart is evidence of leaks in a long-running client, not of Electron's baseline cost (S42). A browser-engine shell can stay lean; the ones that do not usually have a leak.

## 7. Risks this prior art points at

| Risk | Seen in | Applies to nq-lab? |
|---|---|---|
| WebKit on macOS behaves differently from Chromium (text input, undo, rendering) | GitButler (S34), developer report (S40) | Yes, if Tauri on Mac: WKWebView is WebKit. The current front end is presumably tested on Chromium-family engines only. |
| Linux packaging with system WebKitGTK | GitButler (S35), Tauri issue (S39) | No: the owner uses Windows and Mac only. |
| Screen reader support missing in GPU-native UIs | Zed (S17), Warp (S18) | Yes, if the UI is rewritten in gpui, egui or similar. WCAG 2.2 AA is a stated requirement. |
| Second platform arrives years late | Zed (S14, S15), Sierra Chart, NinjaTrader, Quantower (S9 to S11) | Yes, for any route that writes against one platform's API first. |
| Rewrite stalls before parity | Netscape, xi, Lapce, Spacedrive (S28 to S33) | Yes: 30 screens, about 6,925 unit tests and a 2,325-check crosscheck define parity. |
| Long-running client memory growth | Discord (S42), TradingView out-of-memory fix (S3) | Yes, for any shell; the terminal streams SSE all day. |
| Toolkit churn | Druid discontinued (S32); gpui crate far behind Zed (S38) | Yes, for small Rust UI toolkits. Electron and Tauri are the most widely used in the table above (S37). |

## 8. What this means for the nq-lab terminal

1. **Wrap, do not rewrite, as phase one.** Every shipped migration above kept a working product and drew a boundary first. The terminal already has the boundary: a Python service behind HTTP and SSE, and a React front end. A thin shell (Tauri 2 on WebView2 and WKWebView, or Electron as the fallback) around the existing front end keeps every test, the crosscheck, the out-of-sample gate and the look unchanged on day one. This is the 1Password and Slack pattern, and the closest working example is Spacedrive v2 on the same front-end stack (S22, S24, S33).
2. **"Pro grade" does not require leaving the browser engine.** Bloomberg and TradingView both render with Chromium (S1 to S3). The terminal's measured 647 ms first render and 61 ms grid open are already inside their budgets in a browser. The prior art says speed is won by profiling hot paths, as VS Code and Figma did (S23, S25), not by changing toolkits.
3. **Treat WebKit on the Mac as the main technical risk of a Tauri shell.** GitButler's list of WebKit bugs (S34) is the warning. Before committing, run the unit suite and a WebKit browser pass against the existing front end, and check the specific heavy parts: Perspective's WebAssembly grids, the uPlot and ECharts canvases, dockview drag and drop, the keyboard grammar and F-keys, and focus handling for WCAG 2.2 AA. If WebKit fails on things that matter, Electron on the Mac (as TradingView and GitButler Next do) is the documented fallback, at the cost of a bundled Chromium.
4. **Do not build a GPU-native UI for the whole terminal.** Zed and Warp show it can be done, with funded teams, over years, and with screen reader support arriving last (S14 to S18). For one owner with 30 screens and an accessibility requirement, that is the stall pattern seen in xi and Lapce, and in Spacedrive v1 (S29, S31, S33).
5. **Allow native islands later, for measured hot spots only.** Spacedrive's gpui photo grid next to a Tauri app (S37), Rerun's egui data viewer (S19) and Bookmap's OpenGL heatmap (S13) show the shape: one dense, fast-changing view drawn natively, talking to the same local service. If a live depth or tick panel ever misses its frame budget in the web view, that panel is the candidate, not the whole app.
6. **Keep the Python core as the 1Password-style core.** Porting NautilusTrader-backed logic to Rust or C++ would put the 2,325-check crosscheck and the out-of-sample gate at risk for no user-visible gain. IBKR kept TWS alive beside its new app (S6); the terminal can keep the browser launcher beside the desktop shell in the same way, so the owner is never without a working terminal.
7. **Plan for a long-running client.** Discord's restart experiment and TradingView's out-of-memory fix (S3, S42) are reminders that an all-day terminal needs a memory soak test in whatever shell is chosen.

## 9. Open questions

1. Is IBKR Desktop the Qt/QML product in the September 2026 job advert? A primary statement from IBKR was not found (S7).
2. What does cTrader's Mac app use under the hood? The download page only says macOS 12 and later (S12).
3. Does Linear's desktop app use Electron, and what are its memory numbers? Not confirmed from a primary source.
4. Does the terminal's front end pass its unit and interaction tests on WebKit today? This needs a measured run in a later step, not prior art.
5. GigaOm's check of the Teams claims was not read; the numbers stay marked as vendor claims.
6. What exactly were Spacedrive's "lessons from the v1 alpha"? The project does not say (S33).

## Sources

All checked on 2 October 2026.

- S1. Bloomberg JavaScript blog, About. https://bloomberg.github.io/js-blog/about/
- S2. Dominic Gannaway, post on joining Bloomberg ("The Bloomberg Terminal is based on Chromium so the UI is nearly all DOM rendering"), early 2023. https://x.com/trueadm/status/1609241225730883585 (individual's statement, not a company document)
- S3. TradingView Desktop releases and release notes. https://www.tradingview.com/support/solutions/43000673888-tradingview-desktop-releases-and-release-notes/
- S4. NDC Conferences talk, "Developing the Bloomberg Terminal: local performance and measurement techniques", Paul Williams. https://www.classcentral.com/course/youtube-developing-the-bloomberg-terminal-local-performance-measurement-techniques-paul-williams-140477 (talk listing; video not watched)
- S5. IBKR Desktop vs TWS guide (secondary). https://supa.is/article/ibkr-desktop-vs-tws-which-platform-should-you-use-2026 and IBKR TWS download page https://www.interactivebrokers.com/en/trading/tws-updateable-stable.php
- S6. Interactive Brokers press release on IBKR Desktop, 27 February 2024. https://www.businesswire.com/news/home/20240227650768/en (via search result; page not opened)
- S7. Interactive Brokers job advert, QML/Java Frontend Software Engineer, posted 11 September 2026 (job aggregator copy). https://jobfound.org/job/interactive-brokers-is-hiring-for-qml-java-frontend-software-engineer-greenwich-ct-remote-usa-17-september-2026
- S8. MetaTrader 5 Help, Installation on Mac OS. https://www.metatrader5.com/en/terminal/help/start_advanced/install_mac
- S9. Sierra Chart Support Board, "siera on Mac" thread (user posts, February 2026). https://www.sierrachart.com/SupportBoard.php?ThreadID=103761
- S10. NinjaTrader Support Forum, Mac version thread (secondary summary via search). https://forum.ninjatrader.com/forum/ninjatrader-8/platform-technical-support-aa/1336318-mac-version
- S11. Quantower review 2026 (secondary). https://proptradingvibes.com/blog/quantower-review
- S12. cTrader downloads. https://ctrader.com/download/
- S13. Bookmap system requirements, updated 27 July 2026. https://bookmap.com/knowledgebase/docs/KB-IntroductionToBookmap-SystemRequirements
- S13b. Bookmap Layer 1 API demo strategies (Java). https://github.com/BookmapAPI/DemoStrategies
- S14. Zed blog, post on gpui rendering at 120 fps, 7 March 2023. https://zed.dev/blog/videogame
- S15. Zed blog, "Zed for Windows is here", 15 October 2025. https://zed.dev/blog/zed-for-windows-is-here
- S16. Warp blog, "How Warp works", 12 July 2021. https://www.warp.dev/blog/how-warp-works
- S17. Zed issue 41138 (open) and PRs 56065, 64143. https://github.com/zed-industries/zed/issues/41138 , https://github.com/zed-industries/zed/pull/56065 , https://github.com/zed-industries/zed/pull/64143
- S18. Warp issues 3847 (open) and 901. https://github.com/warpdotdev/warp/issues/3847 , https://github.com/warpdotdev/warp/issues/901
- S19. egui readme. https://github.com/emilk/egui
- S20. Microsoft 365 blog, "Welcome to the new era of Microsoft Teams", 27 March 2023. https://www.microsoft.com/en-us/microsoft-365/blog/2023/03/27/welcome-to-the-new-era-of-microsoft-teams/
- S21. Microsoft Learn, System requirements for the Teams client, 16 July 2026. https://learn.microsoft.com/en-us/microsoftteams/teams-client-system-requirements
- S22. 1Password blog, "1Password 8: The story so far", 12 August 2021. https://1password.com/blog/1password-8-the-story-so-far
- S23. Figma blog, "WebAssembly cut Figma's load time by 3x", 8 June 2017. https://www.figma.com/blog/webassembly-cut-figmas-load-time-by-3x/
- S24. Slack Engineering, "When a rewrite isn't: rebuilding Slack on the desktop", 22 July 2019. https://slack.engineering/rebuilding-slack-on-the-desktop/
- S25. VS Code blog, "Text Buffer Reimplementation", 23 March 2018. https://code.visualstudio.com/blogs/2018/03/23/text-buffer-reimplementation
- S26. Electron app list. https://www.electronjs.org/apps
- S27. Mozilla wiki, Oxidation. https://wiki.mozilla.org/Oxidation
- S28. Joel Spolsky, "Things You Should Never Do, Part I", 6 April 2000. https://www.joelonsoftware.com/2000/04/06/things-you-should-never-do-part-i/
- S29. Raph Levien, "xi-editor retrospective", 27 June 2020. https://raphlinus.github.io/xi/2020/06/27/xi-retrospective.html
- S30. GitHub blog, "Sunsetting Atom", 8 June 2022. https://github.blog/news-insights/product-news/sunsetting-atom/
- S31. Lapce readme and releases (v0.3.0 notes: "Rewrite with Floem UI"). https://github.com/lapce/lapce/releases
- S32. Druid readme ("The Druid project has been discontinued"). https://github.com/linebender/druid
- S33. Spacedrive readme and v2 site ("v2 development began in June 2025"). https://github.com/spacedriveapp/spacedrive , https://v2.spacedrive.com
- S34. GitButler PR 9482, "Experiment: Gitbutler Electron", 19 July 2025. https://github.com/gitbutlerapp/gitbutler/pull/9482
- S35. GitButler issue 8411, "Linux Distribution Compatibility", maintainer comment 24 July 2025. https://github.com/gitbutlerapp/gitbutler/issues/8411
- S36. lightweight-charts repository. https://github.com/tradingview/lightweight-charts
- S37. GitHub REST API reads on 2 October 2026: repository metadata and releases for zed-industries/zed, warpdotdev/warp, rerun-io/rerun (Cargo.toml), emilk/egui, lapce/lapce, gitbutlerapp/gitbutler (apps/desktop and apps/lite package.json, commit 84b2738ac), spacedriveapp/spacedrive (apps at tag 0.4.3 and main), tauri-apps/tauri, tauri-apps/cef-rs, electron/electron, microsoft/vscode, perspective-dev/perspective. https://api.github.com/repos/
- S38. crates.io API, gpui crate (0.2.2, 22 October 2025) and egui crate (0.36.2). https://crates.io/api/v1/crates/gpui , https://crates.io/api/v1/crates/egui
- S39. Tauri issue 14963, "Bundle chromium renderer" (open since 8 November 2023). https://github.com/tauri-apps/tauri/issues/14963
- S40. Hacker News comment by a developer who moved from Tauri to Electron, 28 May 2025. https://news.ycombinator.com/item?id=44118251
- S41. Linear, "Scaling the Linear Sync Engine", 29 June 2023. https://linear.app/now/scaling-the-linear-sync-engine
- S42. Windows Latest, "Discord admits its Windows 11 app is a resource hog, tests auto-restart when RAM usage exceeds 4GB", 6 December 2025. https://www.windowslatest.com/2025/12/06/discord-admits-its-windows-11-app-is-a-resource-hog-tests-auto-restart-when-ram-usage-exceeds-4gb/
