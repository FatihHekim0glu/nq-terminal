// Copy for REG's registry staleness banner (V031). UK spelling, no em or en dashes (copyRules.test.ts reads this
// module). `where` is the newest input's path and time as far as the backend serves them; the registry is only
// ever rebuilt by the research script, never by the terminal.
export const REG_STALE = {
  line: 'Registry is older than the newest result ({where}); rebuild it with scripts/registry.py.',
  lineBare: 'Registry is older than the newest result; rebuild it with scripts/registry.py.',
  built: 'Registry built {time}.',
} as const
