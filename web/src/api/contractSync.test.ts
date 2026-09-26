import { describe, expect, it } from 'vitest'
import contract from '../../../contract/openapi.json?raw'
import schema from './schema.d.ts?raw'
import shaFile from './openapi.sha256?raw'
import { contractSha256, contractSyncProblems, readSchemaHeaderSha, readShaFile } from './contractSync'

// ARCHITECTURE section 4, "Contract discipline": the generated types must be regenerated
// (`pnpm gen:api`) whenever terminal/contract/openapi.json changes. This is that check.

describe('generated API types match the backend contract', () => {
  it('openapi.sha256 and the schema.d.ts header both carry the sha256 of the current contract', async () => {
    expect(await contractSyncProblems({ contract, shaFile, schema })).toEqual([])
  })

  it('the generated types describe the contract (every contract path is in schema.d.ts)', () => {
    const paths = Object.keys((JSON.parse(contract) as { paths: Record<string, unknown> }).paths)
    expect(paths.length).toBeGreaterThan(0)
    for (const path of paths) expect(schema).toContain(`"${path}": {`)
  })
})

describe('born-failing cases (rule 5): the sync check catches stale types', () => {
  it('fails when the contract changes by one byte and the types are not regenerated', async () => {
    const changed = contract.replace('"openapi"', '"openapi" ')
    const problems = await contractSyncProblems({ contract: changed, shaFile, schema })
    expect(problems).toHaveLength(2)
    expect(problems.join('\n')).toMatch(/openapi\.sha256/)
    expect(problems.join('\n')).toMatch(/schema\.d\.ts/)
  })

  it('fails when only the sha file was updated and schema.d.ts is stale', async () => {
    const changed = contract.replace('"openapi"', '"openapi" ')
    const newSha = `${await contractSha256(changed)}\n`
    const problems = await contractSyncProblems({ contract: changed, shaFile: newSha, schema })
    expect(problems).toEqual([expect.stringMatching(/schema\.d\.ts/)])
  })

  it('fails on a missing or malformed sha file and a schema without the generated header', async () => {
    const problems = await contractSyncProblems({ contract, shaFile: 'not a sha', schema: 'export {}' })
    expect(problems).toHaveLength(2)
    expect(readShaFile('')).toBeNull()
    expect(readSchemaHeaderSha('export {}')).toBeNull()
  })

  it('hashes CRLF and LF copies of the contract to the same value (line endings are not a change)', async () => {
    const lf = '{\n  "a": 1\n}\n'
    expect(await contractSha256(lf.replace(/\n/g, '\r\n'))).toBe(await contractSha256(lf))
    expect(await contractSha256(lf)).toMatch(/^[0-9a-f]{64}$/)
  })
})
