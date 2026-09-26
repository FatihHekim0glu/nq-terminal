import { describe, expect, it } from 'vitest'
import { pageOf } from './PanelChrome.page'

describe('pageOf: Page n/m of a panel body paged by its own height', () => {
  it('shows nothing while the body is not laid out or everything fits', () => {
    expect(pageOf(0, 0, 500)).toBeNull()
    expect(pageOf(0, 400, 400)).toBeNull()
    expect(pageOf(0, 400, 401)).toBeNull()
  })

  it('counts pages of the body height, the last page reached at the end of the scroll', () => {
    expect(pageOf(0, 400, 1000)).toEqual({ n: 1, m: 3 })
    expect(pageOf(400, 400, 1000)).toEqual({ n: 2, m: 3 })
    expect(pageOf(600, 400, 1000)).toEqual({ n: 3, m: 3 })
  })
})
