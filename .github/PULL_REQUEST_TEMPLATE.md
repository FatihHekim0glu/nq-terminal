## Summary

<!-- What changes and why, in a few sentences. -->

## Linked issue

<!-- For example: Closes #123. For anything larger than a small fix, open an issue first (see CONTRIBUTING.md). -->

## Type

<!-- Keep one. It should match the prefix of your commit message. -->

- [ ] feat (new behaviour)
- [ ] fix (a bug)
- [ ] perf (speed or memory)
- [ ] docs (documentation only)
- [ ] test
- [ ] refactor or chore

## Tests

The test for the change came first and failed before the fix or feature.

- [ ] Yes
- [ ] Not applicable (say why):

## Suites run

Tick what you ran, and say what you could not run. Some suites need the research project (the backend ones and `e2e` on Windows).

- [ ] `corepack pnpm --dir web test` (contract check, then Vitest)
- [ ] `corepack pnpm --dir web test:types`
- [ ] `corepack pnpm --dir web build`
- [ ] Playwright: `corepack pnpm --dir web e2e` (Windows) or `e2e:offline` (macOS, Linux), and `test:e2e-types` if a spec changed
- [ ] Backend pytest (`backend\tests`)
- [ ] Cross-check: `qa\tests`, then `python -m crosscheck --strict` with no FAIL
- [ ] Desktop check: `desktop\scripts\check.ps1` (only when `desktop/` changed)
- [ ] I could not run some suites: <!-- which, and why -->

## Screenshots

<!-- For a change to what the screen shows: before and after, and the viewport size. Delete this section otherwise. -->

## Project rules

- [ ] Nothing in the change places, modifies or cancels an order, or connects to a real broker account (the optional read-only paper snapshot excepted). I did not edit the safety tests to make it pass.
- [ ] Prices are read only through the data gate, and nothing past its date fence (2021-12-31) is served.
- [ ] If the API changed, `contract/openapi.json` and the generated front-end types are regenerated in this pull request.
- [ ] Files use LF line endings.
- [ ] User-facing text is in `web/src/copy/`, in UK spelling, with no em or en dashes.
- [ ] New or changed UI works from the keyboard and meets WCAG 2.2 AA (axe is clean at both viewport sizes).
- [ ] No secrets, tokens, personal paths or email addresses, and none of the research project's data.
- [ ] Docs that I touched only name commands, paths and settings that exist.
