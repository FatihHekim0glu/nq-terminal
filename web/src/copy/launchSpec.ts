// Copy for the spec binding of a Start from preset: the sha256 of experiments/<exp>.json that the presets route serves,
// and the OFF SPEC badge it drives together with the changed parameters. UK spelling, no em or en dashes. `{name}` slots
// are filled by fillCopy(). The terminal only reads the spec file; it never edits or writes it.

export const LAUNCH_SPEC = {
  hash: 'Spec experiments/{exp}.json, sha256 {sha}.',
  noFile: 'No spec hash: experiments/{exp}.json was not found, so this preset is not tied to a spec.',
  noExp: 'No spec hash: this preset names no experiment, so it is not tied to a spec.',
  offNoSpec: 'OFF SPEC: no spec hash backs this preset, so the run cannot be tied to a spec. It is a warning, not a block.',
} as const
