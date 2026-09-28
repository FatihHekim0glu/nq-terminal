// @vitest-environment jsdom
// D08: on a GIP panel, choosing a new instrument from the red-bar dropdown ran `<root> GIP` with no
// date; GIP's argument is required, so the parser always rejected it and the instrument could never
// change. The field must send a line the parser accepts, and keep the panel's own date when it has one.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { createApiQueryClient } from '../../api/queries'
import { onLineRequest, type LineRequest } from '../../chrome/CommandLine.bus'
import { parseLine } from '../../commands/line'
import { InstrumentField } from './GpControls'

const COMMANDS = {
  grammar: '',
  mnemonics: [],
  universe: [],
  hypotheses: [],
  confirmations: [],
  runs: [],
  registry_error: null,
  instruments: [
    { root: 'NQ', symbol: 'NQ.V.0', sector: 'equity' },
    { root: 'ES', symbol: 'ES.V.0', sector: 'equity' },
  ],
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function serve() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(String(input), 'http://127.0.0.1')
    if (url.pathname === '/api/commands') return json(COMMANDS)
    return json({ detail: 'not found' }, 404)
  })
}

function mount(node: ReactNode) {
  const client = createApiQueryClient()
  client.setDefaultOptions({ queries: { retry: false } })
  return render(<ApiProvider client={client}>{node}</ApiProvider>)
}

afterEach(cleanup)

async function chooseEs() {
  fireEvent.click(await screen.findByRole('combobox', { name: 'Instrument' }))
  fireEvent.click(await screen.findByRole('option', { name: 'ES1 Index' }))
}

describe('InstrumentField on a GIP panel: the dropdown must send a line GIP can parse (D08)', () => {
  it('born failing: with no date passed, the requested line still parses', async () => {
    serve()
    const lines: LineRequest[] = []
    const off = onLineRequest((r) => lines.push(r))
    mount(<InstrumentField root="NQ" mode="GIP" />)
    await chooseEs()
    off()
    expect(lines).toHaveLength(1)
    const result = parseLine(lines[0]!.line, { index: COMMANDS, fallbackContext: null })
    expect(result.ok, `${lines[0]!.line} -> ${result.ok ? 'ok' : result.error.code}`).toBe(true)
  })

  it('born failing: keeps the panel’s own date when one is passed', async () => {
    serve()
    const lines: LineRequest[] = []
    const off = onLineRequest((r) => lines.push(r))
    mount(<InstrumentField root="NQ" mode="GIP" date="2019-03-14" />)
    await chooseEs()
    off()
    expect(lines.map((l) => l.line)).toEqual(['ES GIP 2019-03-14'])
  })

  it('GP mode is unaffected: still sends "<root> GP"', async () => {
    serve()
    const lines: LineRequest[] = []
    const off = onLineRequest((r) => lines.push(r))
    mount(<InstrumentField root="NQ" mode="GP" />)
    await chooseEs()
    off()
    expect(lines.map((l) => l.line)).toEqual(['ES GP'])
  })
})
