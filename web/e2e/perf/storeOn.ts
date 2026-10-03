// The shipped page starts the workspace store before its first render (src/main.tsx); the gallery build the E2E run serves
// starts it only when the page sets window.__NQT_STORE__ first. The HOME first-render budget sets it, so the figure
// includes the store chunk, the meta read and the six document reads that production waits for (up to 1.5 s).
// Kept free of Playwright imports so the unit tests can load it.

export interface InitScriptHost {
  addInitScript(script: () => void): Promise<unknown>
}

/** Runs in the page before any of its scripts (there globalThis is window). Self-contained: Playwright serialises it. */
export const enableStoreInit = (): void => {
  ;(globalThis as { __NQT_STORE__?: boolean }).__NQT_STORE__ = true
}

export async function startStoreInContext(context: InitScriptHost): Promise<void> {
  await context.addInitScript(enableStoreInit)
}
