// A stand-in for cmdk's command-score chunk (roadmap wave 9, SHELL-DIET-3). cmdk scores every item against the search
// text with its own fuzzy matcher (about 0.4 kB gzip in the shell), but the terminal never uses the score: the command
// line passes shouldFilter={false} to <Command> and orders and filters its list itself (chrome/CommandLine.tsx). With
// shouldFilter false cmdk neither filters nor sorts by the score, yet it still calls it once for every item it
// registers, so the stub must return a number and must not throw. Any number will do while shouldFilter stays false.
//
// vite.config.ts (cmdkScoreStub) sends cmdk's import of its hashed chunk './chunk-NZJY6EH4.mjs' here, for cmdk's own
// entry file only (its command-score module keeps the real chunk). The chunk exports the scorer as `a`; that is the
// one name cmdk's entry reads. src/vendor/commandScoreStub.test.ts checks the hashed name against the installed cmdk,
// so a cmdk upgrade fails loudly, and that no source file lets cmdk use the score (a `filter` prop, defaultFilter,
// commandScore). If the terminal ever wants cmdk's own filtering, remove the plugin: the shell pays about 0.4 kB.

/** cmdk's `commandScore(value, search, keywords)`: 1 for everything, because the result is never read. */
export const a = (_value: string, _search: string, _keywords?: readonly string[]): number => 1
