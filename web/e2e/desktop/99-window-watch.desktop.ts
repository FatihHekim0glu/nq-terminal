// The global window and foreground watch, judged at the end of the run (04 standing rule 4): from the moment the watch took
// its baseline, no new window of any process was drawn, no unexpected undrawn window appeared, and the foreground window
// never changed. The tear-down judges again after the app is ended (and adds the stray-backend check); this makes a failure
// show as a failed test in the list, with the window's process, class, title and rectangle.
import { expect, test } from './fixtures.ts'
import { judge, readWatchLog } from './watch.ts'

test('no window was drawn and the foreground never changed during the run', async ({ run }) => {
  const events = readWatchLog(run.watchLog)
  expect(events.some((e) => e.event === 'ready'), 'the watch took its baseline').toBe(true)
  expect(judge(events, run.pid)).toEqual([])
})
