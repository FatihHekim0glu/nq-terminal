import { describe, expectTypeOf, it } from 'vitest'
import type { SuccessOf } from '../api/types'
import type { LinkContext } from '../state/linkGroups'
import type { CommandIndexData, HealthData, ResolvedContext } from './types'

// Checked by `tsc -b` (pnpm test:types): the chrome's structural types must accept what the generated
// contract types and the link-group store hand it, so no cast is ever needed at the seams.
describe('chrome types fit the generated contract', () => {
  it('GET /api/commands and GET /api/health bodies are assignable', () => {
    expectTypeOf<SuccessOf<'/api/commands'>>().toExtend<CommandIndexData>()
    expectTypeOf<SuccessOf<'/api/health'>>().toExtend<HealthData>()
  })

  it('a link-group context is a parser context and back', () => {
    expectTypeOf<LinkContext>().toExtend<ResolvedContext>()
    expectTypeOf<ResolvedContext>().toExtend<LinkContext>()
  })
})
