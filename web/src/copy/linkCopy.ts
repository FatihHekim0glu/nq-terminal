// Copy for the Copy link rows in a panel's Options menu and what the terminal says once a link is copied
// (or the browser refuses the clipboard). Kept apart from LINKS (copy/links.ts) so the first-paint shell
// does not carry it: only chrome/copyLink.ts reads it, and that loads with the Workspace. UK spelling, no
// em or en dashes. `{name}` slots are filled by fillCopy() (copy/workspace.ts).

export const LINK_COPY = {
  copyLink: 'Copy link',
  copyMarkdown: 'Copy link as Markdown',
  copied: 'Link to {line} copied.',
  copyFailed: 'The browser refused the clipboard. The link is {url}',
} as const

/**
 * The portable form (03 section 4.6). Outside the fixed browser door (the desktop app, or a browser on the app's
 * random port) Copy link copies the bare `#go=<line>` string, because an address would name a port that stops
 * working at the next launch. `copied` is what the message line says then; the rest is what HELP explains
 * (screens/help/HelpIndex.tsx reads it through chrome/copyLink.ts, which re-exports this).
 */
export const PORTABLE_LINK_COPY = {
  copied: 'Portable link to {line} copied. It is a #go= string, not an address: paste it into the command line to open the view.',
  helpHeading: 'Copied links',
  helpFixed:
    'Copy link in a panel\'s Options menu copies the full address when the terminal runs on its fixed browser address, which stays valid from one visit to the next.',
  helpPortable:
    'Everywhere else, including the desktop app, it copies a portable string that starts with #go= and holds the command line. Paste that string, a full address or a Markdown link into the command line and press Enter to open the same view. A pasted link can open screens, contexts and help only, in at most 8 lines, and a link that holds anything else is refused whole.',
} as const
