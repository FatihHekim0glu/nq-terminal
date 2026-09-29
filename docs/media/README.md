# README media

The images on the [root README](../../README.md). Every screen image comes from demo mode on fixture data, captured on
2026-09-28; every full screen, and the OOS and LIVE crops, show the DEMO DATA flag. The last captures ran against a demo bundle built from
commit `ac70607` (`vite build --mode demo`, served on a spare loopback port), and the older full screens match that
bundle, apart from the clock and a few sparkline pixels on HOME.

Capture: Chrome through Playwright, a 1920x1080 viewport, reduced motion, dark colour scheme, a fresh browser context
per shot. Full screens are taken at device pixel ratio 1. The crops (command line, menu, status line and the
Sharpe-difference card) are taken at device pixel ratio 2 and published with their CSS width, so their text stays
sharp on HiDPI screens. Frame: a 1 CSS px #3D444D edge and a rounded corner, written as lossless WebP. The command
line and menu crops follow the element's own box and sit on a 6 CSS px black margin.

Four images were added on 2026-09-29 (`screen-reg-evidence.webp`, `screen-mt-replication.webp`,
`screen-des-robustness.webp` and `export-grab.webp`). They were captured the same way from the demo served by
`vite --mode demo` (the Vite dev server on 127.0.0.1:5174, hot-reloading the working tree at commit `b746b02` and
after), in a fresh browser context each, and framed like the others as lossless WebP. The three screens are the full
1920x1080 viewport. `export-grab.webp` is not a screen: it is the file `GRAB` saved for the focused EQ panel, through
the browser's download, at its own size (1936x1008) and with the same frame.

The walkthrough was recorded at 1600x900 and 25 frames per second. The GIF starts at 1.0 s, once HOME has loaded, so
the loop begins and ends on HOME; it is 1200 px wide, 10 frames per second, 149 frames (14.9 s), one 256-colour
palette without dithering. The recording is lossy, so before quantising, a pixel that moves by at most 16 levels from
the previous frame keeps its previous value, and a frame that repaints a quarter of the screen or more is taken
whole.

| File | Screen | Source |
|---|---|---|
| `banner.svg` | Wordmark and tagline | Drawn as SVG: no script, no external reference, no web font |
| `hero-home.webp` | HOME | The default layout on load |
| `walkthrough.gif` | REG, DES, RET, HOME | `REG`, `volmanaged_v0 DES`, `volmanaged_v0 RET`, `HOME`, each typed and run with `<GO>` |
| `screen-reg-mt.webp` | REG + MT | `REG <GO>` |
| `screen-reg-evidence.webp` | REG 92) Evidence, beside MT 85) Family | `REG <GO>`, then `92 <GO>` |
| `screen-mt-replication.webp` | REG 91) Board, beside MT 86) Replication | `REG <GO>`, Alt+2 to focus the MT panel, then `86 <GO>` |
| `screen-des.webp` | DES | `volmanaged_v0 DES <GO>` |
| `screen-des-robustness.webp` | DES 5) Robustness | `volmanaged_v0 DES <GO>`, then `5 <GO>` |
| `screen-eq.webp` | EQ | `volmanaged_v0 EQ <GO>` |
| `screen-dd.webp` | DD | `volmanaged_v0 DD <GO>` |
| `screen-ret.webp` | RET | `volmanaged_v0 RET <GO>` |
| `screen-corr.webp` | CORR | `27F CORR <GO>` |
| `screen-oos.webp` | OOS | `OOS <GO>`, cropped to the upper 626 px that hold the log |
| `screen-live-jrnl.webp` | LIVE + JRNL | `LIVE <GO>`, cropped to the upper 886 px that hold both panels |
| `command-line.webp` | Command line suggestions | `VC` typed on HOME, cropped to the line and its list |
| `menu.webp` | Related functions menu | `MENU <GO>` on HOME with the GP panel focused, cropped to the menu |
| `status-line.webp` | Status line | HOME, cropped from the DATA segment to NO ORDER PATH |
| `sv7-card.webp` | Sharpe-difference card | `volmanaged_v0 RET <GO>`, cropped to the card |
| `export-grab.webp` | The image `GRAB` saves | `volmanaged_v0 EQ <GO>`, then `GRAB <GO>`: the saved PNG, converted to WebP |

Demo prices are synthetic, from a seeded generator, and never pass through the gate; the correlation matrix is a
seeded filler on the backend's scale. Run and analytics bodies are the fixture backend's answers.
