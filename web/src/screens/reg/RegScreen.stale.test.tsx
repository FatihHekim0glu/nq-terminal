// @vitest-environment jsdom
// V031: REG's registry staleness banner. A stale registry (the backend's `stale`, `generated_at` and `newest_input_at`)
// shows one polite status line with an icon, and no control that writes anything; a fresh registry, and the answer of a
// backend that serves none of the fields, show nothing and leave the screen as it always was.
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetConnection } from '../../api/connection'
import { resetMessage } from '../../chrome/MessageLine.store'
import { resetNumbered } from '../../chrome/NumberedActions'
import { stubLayout } from '../../grids/testing'
import { ANSWERS, mountScreen, panelParams, stubApi } from './testHarness'
import { REGISTRY } from './regFixtures'
import RegScreen from './RegScreen'
import RegStaleBanner from './RegStaleBanner'

beforeAll(() => stubLayout(1200))
beforeEach(() => {
  resetNumbered()
  resetMessage()
})
afterEach(() => {
  cleanup()
  resetConnection()
  vi.restoreAllMocks()
})

const STALE_FIELDS = {
  stale: true,
  generated_at: '2026-10-05T09:15:30Z',
  newest_input_at: '2026-10-06T07:42:10Z',
  newest_input_path: 'results/nt_new_run/summary.json',
}

/** The live region of the banner (a plain aria-live div, so REG keeps the one status role it always had). */
function banner(): HTMLElement {
  const region = document.querySelector<HTMLElement>('[data-reg-stale]')
  if (!region) throw new Error('no staleness region')
  return region
}

/** One macrotask: the banner inserts its line a tick after it is in the page. */
async function tick(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function open(registry: unknown): Promise<HTMLElement> {
  stubApi({}, { '/api/registry': registry })
  mountScreen(<RegScreen params={panelParams('REG')} context={null} />)
  await screen.findByRole('grid', { name: /Registry board/ })
  await waitFor(() => expect(screen.getAllByRole('row').length).toBeGreaterThan(1))
  await tick()
  return banner()
}

describe('REG staleness banner', () => {
  it('says the registry is older than the newest result, with its path and time and the way to rebuild it', async () => {
    const region = await open({ ...REGISTRY, ...STALE_FIELDS })
    expect(region.textContent).toContain('Registry is older than the newest result (results/nt_new_run/summary.json, 2026-10-06 07:42 UTC); rebuild it with scripts/registry.py.')
    expect(region.textContent).toContain('Registry built 2026-10-05 09:15 UTC.')
  })

  it('is a polite live region with a decorative icon next to the text, and has no button or link', async () => {
    const region = await open({ ...REGISTRY, ...STALE_FIELDS })
    expect(region.getAttribute('aria-live')).toBe('polite')
    expect(region.getAttribute('aria-atomic')).toBe('true')
    const icon = region.querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
    expect(within(region).queryAllByRole('button')).toHaveLength(0)
    expect(within(region).queryAllByRole('link')).toHaveLength(0)
  })

  it('names the cause in words, never by the icon or a colour alone', async () => {
    const region = await open({ ...REGISTRY, ...STALE_FIELDS })
    expect(region.querySelector('svg')?.textContent ?? '').toBe('')
    expect(region.textContent).toMatch(/older than the newest result/)
  })

  it('shows the banner without a path or a time when the backend serves neither', async () => {
    const region = await open({ ...REGISTRY, stale: true })
    expect(region.textContent?.trim()).toBe('Registry is older than the newest result; rebuild it with scripts/registry.py.')
  })

  it('shows nothing for a fresh registry', async () => {
    const region = await open({ ...REGISTRY, ...STALE_FIELDS, stale: false })
    expect(region.textContent).toBe('')
    expect(region.querySelector('svg')).toBeNull()
  })

  it('shows nothing when the backend serves none of the fields', async () => {
    const region = await open(ANSWERS['/api/registry'])
    expect(region.textContent).toBe('')
    expect(region.querySelector('svg')).toBeNull()
  })

  it('keeps one status region in the same place before and after the data arrives, so the line is announced when it appears', async () => {
    stubApi({}, { '/api/registry': { ...REGISTRY, ...STALE_FIELDS } })
    mountScreen(<RegScreen params={panelParams('REG')} context={null} />)
    const early = Array.from(document.querySelectorAll('[data-reg-stale]'))
    expect(early).toHaveLength(1)
    await screen.findByRole('grid', { name: /Registry board/ })
    const late = Array.from(document.querySelectorAll('[data-reg-stale]'))
    expect(late).toHaveLength(1)
    expect(late[0]).toBe(early[0])
  })

  it('reads the registry only with GET', async () => {
    const seen = stubApi({}, { '/api/registry': { ...REGISTRY, ...STALE_FIELDS } })
    mountScreen(<RegScreen params={panelParams('REG')} context={null} />)
    await screen.findByRole('grid', { name: /Registry board/ })
    expect(seen.filter((r) => r.method !== 'GET')).toEqual([])
  })
})

/** Counts the times text is added to the live region (a screen reader announces an insertion into an aria-live region). */
function watchInsertions(region: HTMLElement): { readonly count: () => number; readonly stop: () => void } {
  let added = 0
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of Array.from(record.addedNodes)) if ((node.textContent ?? '').trim() !== '') added += 1
    }
  })
  observer.observe(region, { childList: true, subtree: true, characterData: true })
  return { count: () => added, stop: () => observer.disconnect() }
}

describe('REG staleness line is announced when the data is already there', () => {
  const stale = { ...REGISTRY, ...STALE_FIELDS }

  it('mounts the status region empty even when the registry is cached on the first render, then inserts the line once', async () => {
    const { container } = render(<RegStaleBanner registry={stale} />)
    const region = container.querySelector<HTMLElement>('[data-reg-stale]')!
    expect(region.getAttribute('aria-live')).toBe('polite')
    expect(region.textContent).toBe('')
    const watch = watchInsertions(region)
    await tick()
    expect(region.textContent).toContain('Registry is older than the newest result')
    await tick()
    expect(watch.count()).toBe(1)
    watch.stop()
  })

  it('announces the line once after a cold load too, in the same region', async () => {
    const { container, rerender } = render(<RegStaleBanner registry={undefined} />)
    const region = container.querySelector<HTMLElement>('[data-reg-stale]')!
    await tick()
    expect(region.textContent).toBe('')
    const watch = watchInsertions(region)
    rerender(<RegStaleBanner registry={stale} />)
    await tick()
    expect(region.textContent).toContain('Registry is older than the newest result')
    expect(container.querySelector('[data-reg-stale]')).toBe(region)
    await tick()
    expect(watch.count()).toBe(1)
    watch.stop()
  })

  it('does not announce again when the same answer is read again', async () => {
    const { container, rerender } = render(<RegStaleBanner registry={stale} />)
    const region = container.querySelector<HTMLElement>('[data-reg-stale]')!
    await tick()
    const watch = watchInsertions(region)
    rerender(<RegStaleBanner registry={{ ...stale }} />)
    await tick()
    expect(watch.count()).toBe(0)
    expect(region.textContent).toContain('Registry is older than the newest result')
    watch.stop()
  })

  it('announces nothing for a fresh registry, cached or cold', async () => {
    const fresh = { ...stale, stale: false }
    const { container, rerender } = render(<RegStaleBanner registry={fresh} />)
    const region = container.querySelector<HTMLElement>('[data-reg-stale]')!
    const watch = watchInsertions(region)
    await tick()
    rerender(<RegStaleBanner registry={{ ...fresh }} />)
    await tick()
    expect(region.textContent).toBe('')
    expect(region.querySelector('svg')).toBeNull()
    expect(watch.count()).toBe(0)
    watch.stop()
  })

  it('empties the region when the registry becomes fresh, and announces again if it goes stale again', async () => {
    const { container, rerender } = render(<RegStaleBanner registry={stale} />)
    const region = container.querySelector<HTMLElement>('[data-reg-stale]')!
    await tick()
    rerender(<RegStaleBanner registry={{ ...stale, stale: false }} />)
    await tick()
    expect(region.textContent).toBe('')
    const watch = watchInsertions(region)
    rerender(<RegStaleBanner registry={stale} />)
    await tick()
    expect(watch.count()).toBe(1)
    watch.stop()
  })

  it('keeps the icon and no control in the inserted line', async () => {
    const { container } = render(<RegStaleBanner registry={stale} />)
    await tick()
    const region = container.querySelector<HTMLElement>('[data-reg-stale]')!
    expect(region.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect(within(region).queryAllByRole('button')).toHaveLength(0)
    expect(within(region).queryAllByRole('link')).toHaveLength(0)
  })
})
