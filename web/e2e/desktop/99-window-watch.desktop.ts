// The global window and foreground watch, judged at the end of the run (04 standing rule 4): from the moment the watch took
// its baseline, this run's app tree drew no new window, showed no unexpected undrawn window and never took the foreground.
// Other programs' windows and foreground changes are notes, not failures (owner decision, 3 October 2026). The tear-down judges again after the app is ended (and adds the stray-backend check); this makes a failure
// show as a failed test in the list, with the window's process, class, title and rectangle.
import { expect, test } from './fixtures.ts'
import { judge, readWatchLog } from './watch.ts'

test("the app's tree drew no window and never took the foreground during the run", async ({ run }) => {
  const events = readWatchLog(run.watchLog)
  expect(events.some((e) => e.event === 'ready'), 'the watch took its baseline').toBe(true)
  expect(judge(events, run.pid)).toEqual([])
})
