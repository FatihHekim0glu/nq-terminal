# Starting research from the terminal

From release 0.2.0 you can start a backtest of a registered strategy from LEDG or RUN, watch it from any screen, and re-run a regression anchor to see whether it still matches. This page says what that does, what it will not do, and how to use it with the keyboard.

Everything here goes through the existing JOBS queue. The queue runs one backtest at a time, up to ten wait, and each one is the lab's own `backtests/run_base.py` with the configuration the terminal derived. The terminal still never writes the ledger, never reads a price past 2021-12-31 and never touches an order. Nothing here connects to a broker.

## Start a run from a ledger row

1. Open LEDG. Move to a row with the arrow keys. Press Space to mark one row (it is drawn with a plus and the word marked), or leave none marked to use the newest.
2. Open 96) Actions on the function bar and choose "Start a run from the marked row" (or "from the newest row"). In RUN, Actions offers "Start a run from this run" once the run has loaded.
3. The Start from form opens below the function bar and takes the focus on the first parameter. It shows the strategy and the data variant (both fixed by the preset), the window, a run id, and one field per named parameter with its type, allowed range and default.
4. Change what you want. A parameter that differs from the preset is marked CHANGED with the preset value, and the form says OFF SPEC. That is a warning, not a block: the run is still started, and it is recorded as a run that differs from its preset.
5. Press Enter in a field, or Control with Enter anywhere in the form, to launch. Escape closes the form and returns the focus to where it was.

The run id is suggested from the experiment id (`t_<exp id>_<n>`, with the first free n). Ids always start with `t_`, so a terminal run is never mistaken for one the lab wrote.

### What can be changed

Only parameters the strategy declares, with the ranges the server states: a whole number, a decimal, a short text from a fixed set, or a month or date inside the in-sample window. The window may be narrowed or moved, but it must stay inside 2010-01-01 to 2022-01-01 (the end is exclusive). Everything else is refused by the server with the reason in words, next to the field it concerns:

- a name that is not a parameter of the strategy;
- a value outside its range or choices;
- a calendar value (an end date, a first or last month, a start date for volmanaged_bh) past 2021-12-31;
- any configuration, path, command or argument list. The request carries a preset id, the edited parameter names and the window, and nothing else.

### What it will not do

- It does not write the ledger. When a run finishes, RUN shows the ledger command for you to copy and run yourself, as before.
- It does not start a run when the runner is off (a fixture or demo server) or when ten runs already wait. The form says so and Launch stays disabled.
- It does not start a run from a configuration that is not a preset. A preset is a ledger row of a registered strategy whose window lies in the in-sample period. A run that is not a ledger row can be viewed, but not started from.
- It has no wizard for a new strategy. Only strategies the lab has already registered can be launched.

## The job indicator

While a backtest waits or runs, a strip under the connection line says so in words: QUEUED or RUNNING, the run id and strategy, the time elapsed, and the typical time of earlier runs of that strategy (the median of the jobs the queue still remembers, so it reads "no typical time yet" until one has finished). If more jobs wait, it says how many. Open JOBS takes you to the queue.

When a run ends, the strip becomes a finish notice: "Finished" with the time taken, "Finished with failed checks" (the result is still written), or "ended with an error" (no result). A screen reader is told through one polite live region, and nothing pops up over the screen. Open in RUN opens the new run; Dismiss clears the notice. The strip draws nothing when nothing is running, and a page that was reloaded does not replay old news.

## Re-run a regression anchor

A regression anchor is a finished run executed again with exactly its own configuration. If the engine and the data are unchanged, every number comes out the same.

1. In RUN, or on a row in LEDG (marked, else newest), open Actions and choose "Re-run this run as a regression anchor".
2. A small region opens with the button. Press it. The terminal queues the same configuration under a new id, `t_<base>_regress_r<N>`, with the first free N.
3. The region follows the job through QUEUED and RUNNING and then shows the result in words:
   - **MATCH**: trades, total P&L, total fees and Sharpe equal those of the base run.
   - **MISMATCH**: the first difference is named (the trade count, a trade row field such as `trades[1].entry_ts`, total P&L, total fees or the Sharpe ratio).
   - **NOT COMPARABLE**: the base run was not found, or a run is unusable or lacks a count.
4. Open in RUN opens the new run. Re-run again starts another. The region reads the exact comparison (`GET /api/jobs/actions/anchors/{run_id}`), which checks every trade row, so a changed trade with equal totals is a MISMATCH. RUN's anchor pair compares the trade count and the totals only.

The comparison is exact, field by field. It is not the formal `regress_check` file, which only the lab's own scripts write, and the terminal writes no sidecar. For a re-run the terminal made, the server can also answer the comparison on its own at `GET /api/jobs/actions/anchors/{run_id}`, with the verdict, the first differing field (down to the trade and the field inside it), both values and a note that says this.

## Memory when the window is minimised

In the Windows app, when the main window is minimised or hidden, the shell asks WebView2 to use its low memory target, and returns to normal when the window comes back. Focus alone changes nothing. A window that has never been shown counts as visible. If the installed WebView2 is too old to support the setting, the shell logs that once and carries on.

## Limits to know about

- Parameter ranges in the launcher are sanity bounds of the terminal, not research bounds. A run that passes them is not thereby a sensible experiment.
- A run id is at most 82 characters, so an anchor of a very long base name is refused in words.
- The typical time comes from this machine's job history, not from the ledger, so a restart of the queue's state file clears it.
- The Start from form needs the preset list. If it cannot be read, the form says so and does not launch.
