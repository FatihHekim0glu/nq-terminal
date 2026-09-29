// Copy for GRAB (the panel as an image with its labels) and its caption. Read only by the lazy code in
// src/export/grab: nothing in the shell imports this file, so the words stay out of the first load. UK
// spelling, no em or en dashes. `{name}` slots are filled by fillCopy() (copy/workspace.ts).

export const GRAB = {
  menuImage: 'Grab as image',
  menuCopy: 'Copy image',
  savedOne: 'Saved 1 chart with its labels as {file}.',
  saved: 'Saved {n} charts with their labels as {file}.',
  copiedOne: 'Copied 1 chart with its labels to the clipboard.',
  copied: 'Copied {n} charts with their labels to the clipboard.',
  skippedOne: '1 figure drawn without a canvas was left out.',
  skipped: '{n} figures drawn without a canvas were left out.',
  trimmed: 'Some charts did not fit in one image and were left out; grab a maximised panel for the rest.',
  noPanel: 'No panel is focused: click a panel or press Alt+1, then GRAB <GO>.',
  noFigures: 'This panel draws no chart to grab (a table view is on, or it has none). 98) Export saves its table.',
  unavailable: 'This browser cannot save an image here.',
  clipboardUnavailable: 'This browser cannot copy an image; GRAB <GO> saves it as a file.',
  /** The image was made, but the browser refused the clipboard write (no focus, no permission). */
  clipboardRefused: 'The browser did not allow the copy: {detail}. GRAB <GO> saves the image as a file.',
  failed: 'The image could not be made: {detail}.',
  /** The `{detail}` of `failed` when the failure has no message of its own. */
  detail: {
    noSurface: 'the browser gave no drawing surface',
    noImage: 'the browser returned no image data',
    unknown: 'an unknown error',
  },
  caption: {
    separator: ' | ',
    /** Joins the window and the session count on the provenance line. */
    pair: ', ',
    group: '[{group}]',
    basis: 'Basis {basis}: {label}',
    headline: 'headline value',
    window: '{first}..{last}',
    sessions: 'n {n}',
    spec: 'spec {sha}',
    source: 'GET {path}',
    asOf: 'as of {time} ET',
    grabbed: 'grabbed {time} ET',
  },
} as const
