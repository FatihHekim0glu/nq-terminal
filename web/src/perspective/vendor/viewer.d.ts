// Type shim for @perspective-dev/viewer (tsconfig.app.json `paths`). The package's own declarations
// pull its TypeScript sources into the program, which do not compile under this project's strict flags,
// so the terminal declares only what src/perspective/engine.ts calls. The runtime module is unchanged.
declare const viewer: {
  init_client(wasm: Promise<Response | ArrayBuffer | Uint8Array> | Response | ArrayBuffer | Uint8Array, glue?: unknown): Promise<void>
}
export default viewer
