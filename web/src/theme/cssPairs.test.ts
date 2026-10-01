// The stylesheet scanner behind the two-look contrast check: what it reads as a colour pair, what it leaves
// out, and that it does not quietly find nothing.
import { describe, expect, it } from 'vitest'
import { mergeScans, scanCssPairs, uniquePairs } from './cssPairs'

const scan = (css: string) => scanCssPairs(css, 'x.css')

describe('scanCssPairs: what is a pair', () => {
  it('takes a rule that sets a text colour and a fill, both from tokens', () => {
    const { pairs } = scan('.a { color: var(--text); background: var(--raised); }')
    expect(pairs).toEqual([{ fg: 'text', bg: 'raised', min: 4.5, selector: '.a', source: 'x.css', inactive: false }])
  })

  it('reads background-color, a var() fallback and !important', () => {
    const { pairs } = scan('.a { color: var(--muted, #999) !important; background-color: var(--bg); }')
    expect(pairs.map((p) => `${p.fg}/${p.bg}`)).toEqual(['muted/bg'])
  })

  it('reads inside @media and @supports, and skips @keyframes and @font-face', () => {
    const css = `
      @media (max-width: 700px) { .m { color: var(--white); background: var(--fn-bar); } }
      @supports (display: grid) { .s { color: var(--black); background: var(--tab-on); } }
      @keyframes k { from { color: var(--text); background: var(--bg); } }
      @font-face { font-family: X; src: url(x.woff2); }`
    expect(scan(css).pairs.map((p) => `${p.fg}/${p.bg}`)).toEqual(['white/fn-bar', 'black/tab-on'])
  })

  it('keeps a selector list as one rule and ignores comments', () => {
    const { pairs } = scan('/* .x { color: var(--a); background: var(--b); } */\n.a,\n.b:hover { color: var(--text); background: var(--bg); }')
    expect(pairs).toHaveLength(1)
    expect(pairs[0]!.selector).toBe('.a,\n.b:hover')
  })

  it('leaves out a colour or a fill that is not a plain token', () => {
    expect(scan('.a { color: #fff; background: var(--bg); }').pairs).toEqual([])
    expect(scan('.a { color: var(--text); background: linear-gradient(var(--a), var(--b)); }').pairs).toEqual([])
    expect(scan('.a { color: var(--text); background: transparent; }').pairs).toEqual([])
    expect(scan('.a { border-color: var(--text); background: var(--bg); }').pairs).toEqual([])
  })

  it('lists a fill without a text colour apart, since the text on it is inherited', () => {
    const { pairs, fills } = scan('.a { background: var(--hover-row); } .b { background: var(--raised); color: inherit; }')
    expect(pairs).toEqual([])
    expect(fills.map((f) => `${f.bg}:${f.ownText}`)).toEqual(['hover-row:false', 'raised:true'])
  })

  it('marks a disabled control as inactive (WCAG 1.4.3 exempts it) and nothing else', () => {
    const css = `
      .a[aria-disabled="true"] { color: var(--fn-off); background: var(--fn-bar); }
      .b:disabled { color: var(--muted); background: var(--bg); }
      .c { color: var(--text); background: var(--bg); }`
    expect(scan(css).pairs.map((p) => `${p.selector}:${p.inactive}`)).toEqual([
      '.a[aria-disabled="true"]:true',
      '.b:disabled:true',
      '.c:false',
    ])
  })
})

describe('scanCssPairs: merging and repeats', () => {
  it('merges scans and drops repeated pairs, keeping the first rule that wrote each', () => {
    const a = scan('.a { color: var(--text); background: var(--bg); }')
    const b = scanCssPairs('.b { color: var(--text); background: var(--bg); } .c { color: var(--muted); background: var(--bg); }', 'y.css')
    const merged = mergeScans([a, b])
    expect(merged.pairs).toHaveLength(3)
    const unique = uniquePairs(merged.pairs)
    expect(unique.map((p) => `${p.fg}/${p.bg}:${p.source}`)).toEqual(['text/bg:x.css', 'muted/bg:y.css'])
  })
})
