// Born-failing checks that the figures docs/desktop/README.md quotes equal those of the latest stated G2 verdict (run: node --test tests).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DOCS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'desktop')
const read = (rel) => fs.readFileSync(path.join(DOCS, rel), 'utf8')

const LATEST_HEADING = '## Release 0.3.2'
const PREVIOUS_HEADING = '## Release 0.3.1'

// The verdict section of the latest published release: from its heading to the heading of the release before it.
function latestVerdict(verdict) {
  const start = verdict.indexOf(LATEST_HEADING)
  const end = verdict.indexOf(PREVIOUS_HEADING)
  assert.ok(start >= 0 && end > start, 'verdict.md has the 0.3.2 and 0.3.1 headings in that order')
  return verdict.slice(start, end)
}

// The bold figure of a verdict table row, such as **206.0 MB**, from the row whose label starts with rowLabel.
function rowFigure(section, rowLabel) {
  const row = section.split('\n').find((line) => line.startsWith(`| ${rowLabel}`))
  assert.ok(row, `verdict.md has a row labelled "${rowLabel}"`)
  const match = row.match(/\*\*([\d,.]+ (?:MB|ms))\*\*/)
  assert.ok(match, `the row "${rowLabel}" carries a bold figure`)
  return match[1]
}

// The Status section of the README, where the release figures are quoted.
function statusSection(readme) {
  const start = readme.indexOf('## Status')
  assert.ok(start >= 0, 'README.md has a Status section')
  return readme.slice(start)
}

// The figure a README sentence quotes, found by the words before it.
function quotedFigure(status, pattern, what) {
  const match = status.match(pattern)
  assert.ok(match, `README.md Status quotes ${what}`)
  return match[1]
}

const verdict = latestVerdict(read('g2_windows/verdict.md'))
const status = statusSection(read('README.md'))

test('the README status quotes the whole-app idle memory of the latest verdict', () => {
  const quoted = quotedFigure(status, /Whole-app idle memory at HOME reads ([\d,.]+ MB)/, 'the idle memory at HOME')
  assert.equal(quoted, rowFigure(verdict, 'Whole app idle at HOME'))
})

test('the README status quotes the first-launch cold HOME of the latest verdict', () => {
  const quoted = quotedFigure(status, /first-launch cold HOME at ([\d,.]+ ms)/, 'the first-launch cold HOME')
  assert.equal(quoted, rowFigure(verdict, 'Cold HOME, first launch'))
})

test('the README status names the latest release and the verdict it states', () => {
  assert.match(status, /release 0\.3\.2/i)
  assert.ok(verdict.includes('AUTOMATED PASS, OWNER ROWS PENDING'), 'verdict.md states the 0.3.2 verdict')
  assert.ok(status.includes('AUTOMATED PASS, OWNER ROWS PENDING'), 'README.md quotes the same verdict')
})

test('the README status keeps no 0.1.1 reading and no pitch deck still to come', () => {
  assert.doesNotMatch(status, /477\.3 MB/)
  assert.doesNotMatch(status, /3,192\.5 ms/)
  assert.doesNotMatch(status, /pitch deck is still to come/i)
})
