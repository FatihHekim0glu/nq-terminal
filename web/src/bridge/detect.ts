// What shell the page runs in. The desktop shell injects one read-only object before any page script runs
// (an initialization script); this file is the only place that reads it. The page never calls a command of
// the shell: nothing here, or anywhere in web/src, uses a webview command channel (scripts/noShellIpc.test.ts
// fails on one). With nothing injected the page is in a browser and bridgeVersion is 0.

export type ShellPlatform = 'browser' | 'windows' | 'macos'
export type ShellKeys = 'pc' | 'mac'

/** The facts the shell states about itself. */
export interface ShellInfo {
  readonly bridgeVersion: number
  readonly platform: ShellPlatform
  readonly keys: ShellKeys
  /**
   * Whether the read-only IB snapshot is on in this session, as a shell of bridgeVersion 3 or later states it (the
   * value the terminal started with; the Options switch changes it for the next start). Null in a browser and in an
   * older shell, which have no switch.
   */
  readonly ibSnapshot: boolean | null
}

declare global {
  interface Window {
    /** Injected by the desktop shell before the page scripts run; absent in a browser. */
    readonly __NQT_SHELL__?: unknown
  }
}

export const BROWSER_SHELL: ShellInfo = Object.freeze({ bridgeVersion: 0, platform: 'browser', keys: 'pc', ibSnapshot: null })

/** The first bridgeVersion whose shell states the IB snapshot state (and recognises the Options switch). */
export const IB_SWITCH_FROM = 3

const SHELL_PLATFORMS: readonly ShellPlatform[] = ['windows', 'macos']
const SHELL_KEYS: readonly ShellKeys[] = ['pc', 'mac']

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The shell described by `injected`. Anything that is not a whole version of 1 or more with a known shell
 * platform is read as no shell at all, so a bad injection never turns on a feature the shell cannot serve.
 * The keys follow the platform when the injected ones are missing or unknown.
 */
export function detectShell(injected: unknown): ShellInfo {
  if (!isRecord(injected)) return BROWSER_SHELL
  const { bridgeVersion, platform, keys, ibSnapshot } = injected
  if (typeof bridgeVersion !== 'number' || !Number.isInteger(bridgeVersion) || bridgeVersion < 1) return BROWSER_SHELL
  const known = SHELL_PLATFORMS.find((candidate) => candidate === platform)
  if (known === undefined) return BROWSER_SHELL
  const injectedKeys = SHELL_KEYS.find((candidate) => candidate === keys)
  const ib = bridgeVersion >= IB_SWITCH_FROM && typeof ibSnapshot === 'boolean' ? ibSnapshot : null
  return Object.freeze({ bridgeVersion, platform: known, keys: injectedKeys ?? (known === 'macos' ? 'mac' : 'pc'), ibSnapshot: ib })
}

/** Reads the injected object from `scope` (the window); a missing or throwing global is the browser. */
export function readInjectedShell(scope: object = globalThis): ShellInfo {
  try {
    return detectShell((scope as { __NQT_SHELL__?: unknown }).__NQT_SHELL__)
  } catch {
    return BROWSER_SHELL
  }
}
