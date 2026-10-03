// @vitest-environment jsdom
// 98) Export (look spec 4.4 house numbering): what a screen shows, saved as CSV in the viewer's browser.
// Nothing is requested and nothing is written anywhere but the downloads folder.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EXPORT } from '../copy/panelParts'
import { csvCell, csvFileName, exportCsv, toCsv } from './exportCsv'
import { useMessage } from './MessageLine.store'

const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }
afterEach(() => {
  Object.assign(URL, { createObjectURL: original.create, revokeObjectURL: original.revoke })
  vi.restoreAllMocks()
})

describe('csvCell', () => {
  it('writes numbers at full precision and empty for a missing value', () => {
    expect(csvCell(0.1234567890123)).toBe('0.1234567890123')
    expect(csvCell(-3.5)).toBe('-3.5')
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
    expect(csvCell(true)).toBe('true')
  })

  it('quotes a field with a comma, a quote or a line end (RFC 4180)', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
  })

  it('keeps signed figures as they are shown', () => {
    expect(csvCell('+1.23')).toBe('+1.23')
    expect(csvCell('-0.52%')).toBe('-0.52%')
  })

  it('born failing: a text that a spreadsheet would run as a formula is defused', () => {
    expect(csvCell('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)")
    expect(csvCell('@cmd')).toBe("'@cmd")
    expect(csvCell('+HYPERLINK("x")')).toBe(`"'+HYPERLINK(""x"")"`)
    expect(csvCell('-cmd|x')).toBe("'-cmd|x")
  })
})

describe('toCsv', () => {
  it('joins a header and rows with CRLF line ends', () => {
    expect(toCsv(['a', 'b'], [[1, 'x'], [null, 2]])).toBe('a,b\r\n1,x\r\n,2')
  })
})

describe('csvFileName', () => {
  it('keeps letters, digits, dots, dashes and underscores only', () => {
    expect(csvFileName('eq', 'nt_za v0/a', 'D')).toBe('eq_nt_za_v0_a_D.csv')
    expect(csvFileName('corr', '27F')).toBe('corr_27F.csv')
  })
})

describe('exportCsv', () => {
  it('saves the file and says how many rows it holds, once the save has ended', async () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    expect(exportCsv('runs.csv', 'a\r\n1', 1)).toBe(true)
    expect(click).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(useMessage.getState().text).toBe('Saved 1 row as runs.csv.'))
    exportCsv('runs.csv', 'a\r\n1\r\n2', 2)
    await vi.waitFor(() => expect(useMessage.getState().text).toBe('Saved 2 rows as runs.csv.'))
  })

  it('reports an empty screen and saves nothing', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    expect(exportCsv('runs.csv', 'a', 0)).toBe(false)
    expect(click).not.toHaveBeenCalled()
    expect(useMessage.getState().text).toBe(EXPORT.empty)
  })

  it('says so when the browser cannot save a file', () => {
    Object.assign(URL, { createObjectURL: undefined })
    expect(exportCsv('runs.csv', 'a\r\n1', 1)).toBe(false)
    expect(useMessage.getState().text).toBe(EXPORT.unavailable)
  })
})
