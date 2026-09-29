// Types for nodeGuard.mjs, which is plain JavaScript because it must run on an old Node.

export interface EnginesLike {
  readonly node?: string
}

export interface NodeVerdict {
  readonly ok: boolean
  /** The version found, without a leading "v"; the input unchanged when it is not a version. */
  readonly found: string
  /** The required major. */
  readonly required: number
}

export interface CandidateInput {
  readonly home: string
  readonly platform: string
  readonly env: Readonly<Record<string, string | undefined>>
  /** The required major, used in the Homebrew node@N locations (default 24). */
  readonly required?: number
  /** Whether a path exists (default fs.existsSync); for tests. */
  readonly exists?: (path: string) => boolean
  /** Folder listing (default fs.readdirSync); throws for a missing folder; for tests. */
  readonly list?: (dir: string) => string[]
}

export interface PickedNode {
  readonly path: string
  /** Without a leading "v". */
  readonly version: string
}

export function requiredMajor(engines: EnginesLike | undefined): number
export function checkNode(version: string, engines: EnginesLike | undefined): NodeVerdict
export function nodeCandidates(input: CandidateInput): string[]
export function pickCandidate(
  paths: readonly string[],
  probe: (path: string) => string | null | undefined,
  required: number,
): PickedNode | null
export function switchNotice(found: string, picked: PickedNode): string
export function refusalText(verdict: { readonly found: string; readonly required: number }): string
