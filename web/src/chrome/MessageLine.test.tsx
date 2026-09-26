// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MESSAGES } from '../copy/chrome'
import { MessageLine, keyTokens } from './MessageLine'
import { clearMessage, postMessage, resetMessage, useMessage } from './MessageLine.store'

afterEach(() => {
  cleanup()
  resetMessage()
})

describe('MessageLine (spec 4.2): the one place for prompts and status, in place of toasts', () => {
  it('is a polite live region', () => {
    render(<MessageLine />)
    const line = screen.getByRole('status')
    expect(line.getAttribute('aria-live')).toBe('polite')
  })

  it('shows the idle prompt outside the live region, so it is never announced', () => {
    const { container } = render(<MessageLine />)
    expect(screen.getByRole('status').textContent).toBe('')
    const idle = container.querySelector('.msg-idle')
    expect(idle?.textContent).toBe(MESSAGES.idle)
    expect(idle?.getAttribute('aria-hidden')).toBe('true')
  })

  it('shows a posted message and a fresh node for a repeat of it', () => {
    render(<MessageLine />)
    act(() => postMessage('Layout saved.'))
    const first = screen.getByRole('status').firstElementChild
    expect(screen.getByRole('status').textContent).toBe('Layout saved.')
    act(() => postMessage('Layout saved.'))
    expect(screen.getByRole('status').firstElementChild).not.toBe(first)
  })

  it('colours <Key> tokens by key group and keeps the text as typed', () => {
    render(<MessageLine />)
    act(() => postMessage('<HELP> for explanation. <CANCEL> to clear. <F10> for Index.'))
    const line = screen.getByRole('status')
    expect(line.textContent).toBe('<HELP> for explanation. <CANCEL> to clear. <F10> for Index.')
    expect(line.querySelector('.key-go')?.textContent).toBe('<HELP>')
    expect(line.querySelector('.key-cancel')?.textContent).toBe('<CANCEL>')
    expect(line.querySelector('.key-sector')?.textContent).toBe('<F10>')
  })

  it('clearMessage drops only an error, so a notice is not lost to an edit', () => {
    postMessage('Opened REG.')
    clearMessage('error')
    expect(useMessage.getState().text).toBe('Opened REG.')
    postMessage('Bad line.', 'error')
    clearMessage('error')
    expect(useMessage.getState().text).toBe('')
  })

  it('splits text into plain and key tokens', () => {
    expect(keyTokens('Press <GO> now')).toEqual([
      { text: 'Press ', key: null },
      { text: '<GO>', key: 'go' },
      { text: ' now', key: null },
    ])
    expect(keyTokens('<Esc> command')[0]).toEqual({ text: '<Esc>', key: 'cancel' })
    expect(keyTokens('<Enter filter>')[0]).toEqual({ text: '<Enter filter>', key: null })
  })
})
