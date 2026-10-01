// Source scan over the IB snapshot panel's own files and its copy (ARCHITECTURE sections 8 and 9; PRD: no order path).
// The panel reads and shows; it never names, calls or offers an action on an instruction. Each check is shown to fail
// on a planted bad case first (the nq-lab project rules, rule 5), then run over the real files.
// The banned call names are built from parts, so this file does not contain them (the backend's text scan of web/src
// refuses them anywhere, in a string too).
import { describe, expect, it } from 'vitest'
import { findWriteRequests } from '../../../api/client'
import { findCopyViolations } from '../../../copy/copyRules'
import { IB } from '../../../copy/ib'
import { IB_STATUS_BAR } from '../../../copy/ibStatus'

const SOURCES = import.meta.glob<string>(['./*.ts', './*.tsx', './*.css', '../../../copy/ib.ts', '../../../copy/ibStatus.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

const BANNED_CALLS: readonly string[] = [
  ['place', 'Order'],
  ['cancel', 'Order'],
  ['req', 'Global', 'Cancel'],
  ['exercise', 'Options'],
  ['req', 'Auto', 'Open', 'Orders'],
  ['req', 'Open', 'Orders'],
].map((parts) => parts.join(''))

const ACTION_STEM = /^(order|submit|cancel|modif)/i

const words = (name: string): string[] =>
  name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean)

const isActionName = (name: string): boolean => words(name).some((w) => ACTION_STEM.test(w))

/** The banned call names a text calls (the AST ban's list, ARCHITECTURE section 8). */
function bannedCalls(text: string): string[] {
  return BANNED_CALLS.filter((n) => new RegExp(`\\b${n}\\s*\\(`).test(text))
}

/** File base names and declared function, class, const and let names. */
function declared(file: string, text: string): string[] {
  const base = file.split('/').pop() ?? file
  const names = [...text.matchAll(/\b(?:function|class|const|let)\s+([A-Za-z][A-Za-z0-9_]*)/g)].map((m) => m[1] ?? '')
  return [base, ...names]
}

const isTestFile = (file: string): boolean => /\.test\.tsx?$/.test(file)

describe('born-failing: the scans catch what they ban', () => {
  it('finds every order call name when it is called', () => {
    for (const name of BANNED_CALLS) expect(bannedCalls(`client.${name}(1)`)).toEqual([name])
    expect(bannedCalls('const openRows = rows.map(row)')).toEqual([])
  })
  it('flags action-like names', () => {
    expect(isActionName(['Open', 'Orders', 'Panel'].join(''))).toBe(true)
    expect(isActionName('SUBMIT_FORM')).toBe(true)
    expect(isActionName('cancel-all.ts')).toBe(true)
    expect(isActionName('IbWorkingRow')).toBe(false)
    expect(isActionName('border')).toBe(false)
  })
  it('flags a write request and a direct fetch', () => {
    expect(findWriteRequests('x.ts', "send('POST')")).not.toEqual([])
    expect(findWriteRequests('x.ts', 'await fetch(url)')).not.toEqual([])
  })
})

describe('the IB snapshot sources', () => {
  const files = Object.entries(SOURCES)
  const production = files.filter(([f]) => !isTestFile(f) && !f.endsWith('.css'))

  it('finds the panel, the model, the hook, the store and both copy files', () => {
    const names = files.map(([f]) => f.split('/').pop())
    for (const n of ['IbSnapshotPanel.tsx', 'ibSnapshotModel.ts', 'useIbSnapshot.ts', 'ibLiveStore.ts', 'ib.ts', 'ibStatus.ts']) {
      expect(names).toContain(n)
    }
  })

  it('call no order function and name none', () => {
    expect(files.flatMap(([f, text]) => bannedCalls(text).map((n) => `${f}: ${n}`))).toEqual([])
    expect(files.filter(([, text]) => BANNED_CALLS.some((n) => text.includes(n))).map(([f]) => f)).toEqual([])
  })

  it('declare no file, function, class or constant named like an action', () => {
    expect(files.flatMap(([f, text]) => declared(f, text).filter(isActionName).map((n) => `${f}: ${n}`))).toEqual([])
  })

  it('send no write request and call fetch nowhere (the typed GET client does the reading)', () => {
    expect(production.flatMap(([f, text]) => findWriteRequests(f, text))).toEqual([])
  })

  it('use no raw-HTML sink', () => {
    const sink = new RegExp(`${['dangerously', 'Set', 'Inner', 'HTML'].join('')}|\\.inner${'HTML'}\\s*=`)
    expect(production.filter(([, text]) => sink.test(text)).map(([f]) => f)).toEqual([])
  })
})

describe('the IB copy', () => {
  it('has no em or en dash and no US spelling', () => {
    expect(findCopyViolations(IB)).toEqual([])
    expect(findCopyViolations(IB_STATUS_BAR)).toEqual([])
  })
  it('says the state in the owner words', () => {
    expect(IB.stateOff).toBe('IB snapshot off (NQT_IB_READONLY not set)')
    expect(IB.stateUnreachable).toBe('TWS not reachable')
    expect(IB.stateRefused).toBe('IB snapshot refused')
    expect(IB_STATUS_BAR.twsLive).toBe('read-only snapshot')
  })
  it('mentions no helper program or model name', () => {
    // Joined from parts, so this file holds none of the words itself (the repository's commit hooks refuse them).
    const words = ['AI', 'assis' + 'tant', 'ag' + 'ent', 'cla' + 'ude', 'anthro' + 'pic', 'g' + 'pt', 'l' + 'lm']
    const banned = new RegExp(String.raw`\b(${words.join('|')})\b`, 'i')
    expect(banned.test(JSON.stringify([IB, IB_STATUS_BAR]))).toBe(false)
  })
})
