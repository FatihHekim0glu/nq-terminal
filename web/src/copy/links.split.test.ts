// The link copy's shell rule (W5-ADJ): LINKS holds only what the first-paint shell reads (useDeepLinks
// refuses a bad link from the address bar). The Copy link rows and their messages live in LINK_COPY
// (copy/linkCopy.ts), read by chrome/copyLink.ts only, which loads with the Workspace chunk. The link
// builders (hashFor, linkFor, markdownLink) sit beside it for the same reason. This reads the sources
// as text.
import { describe, expect, it } from 'vitest'
import { LINK_COPY } from './linkCopy'
import { LINKS } from './links'

const SOURCES = import.meta.glob<string>(['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** An import statement for linkCopy, from anywhere (a comment that names the file does not count). */
const IMPORTS_LINK_COPY = /\bfrom\s+['"][^'"]*\blinkCopy['"]/

describe('LINKS: the shell lines', () => {
  it('holds the two refusals and nothing else', () => {
    expect(Object.keys(LINKS)).toEqual(['refused', 'refusedLine'])
  })
})

describe('LINK_COPY: the Copy link lines', () => {
  it('keeps the strings the panel menu showed before the split', () => {
    expect(LINK_COPY).toEqual({
      copyLink: 'Copy link',
      copyMarkdown: 'Copy link as Markdown',
      copied: 'Link to {line} copied.',
      copyFailed: 'The browser refused the clipboard. The link is {url}',
    })
  })
})

describe('who reads what', () => {
  it('scans the real sources, and both sides exist', () => {
    expect(Object.keys(SOURCES)).toEqual(expect.arrayContaining(['/src/chrome/copyLink.ts', '/src/chrome/deepLink.ts']))
  })

  it('only chrome/copyLink.ts imports copy/linkCopy', () => {
    const readers = Object.entries(SOURCES)
      .filter(([, text]) => IMPORTS_LINK_COPY.test(text))
      .map(([file]) => file)
      .sort()
    expect(readers).toEqual(['/src/chrome/copyLink.ts'])
  })

  it('chrome/deepLink.ts (the shell) holds no link builder', () => {
    const shell = SOURCES['/src/chrome/deepLink.ts'] ?? ''
    for (const name of ['hashFor', 'linkFor', 'markdownLink']) expect(shell).not.toContain(name)
  })
})
