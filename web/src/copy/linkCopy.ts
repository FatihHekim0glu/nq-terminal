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
