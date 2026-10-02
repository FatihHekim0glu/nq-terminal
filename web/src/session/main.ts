import '../theme/index.css'
import './session.css'
import { NO_CODE, OPENING, REFUSED, TITLE_FAILED, UNREACHABLE, type Message } from './copy.ts'
import { redeem, type Outcome } from './redeem.ts'

function messageFor(outcome: Outcome): Message | null {
  switch (outcome.kind) {
    case 'opened':
      return null
    case 'no-code':
      return NO_CODE
    case 'refused':
      return REFUSED
    case 'unreachable':
      return UNREACHABLE
  }
}

function show(message: Message, failed: boolean): void {
  const status = document.getElementById('session-status')
  const hint = document.getElementById('session-hint')
  if (status === null || hint === null) return
  status.textContent = message.status
  hint.textContent = message.hint
  if (failed) {
    status.setAttribute('role', 'alert')
    document.title = TITLE_FAILED
  }
}

async function main(): Promise<void> {
  show(OPENING, false)
  const outcome = await redeem({
    hash: window.location.hash,
    address: window.location.pathname + window.location.search,
    replaceAddress: (address) => window.history.replaceState(null, '', address),
    request: (path, init) => fetch(path, init),
    go: (path) => window.location.replace(path),
  })
  const failure = messageFor(outcome)
  if (failure !== null) show(failure, true)
}

void main()
