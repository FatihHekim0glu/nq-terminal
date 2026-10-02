// The words of the launch page (session.html). UK spelling, no dashes; each outcome says what happened and what to do.
export interface Message {
  readonly status: string
  readonly hint: string
}

export const OPENING: Message = { status: 'Opening the terminal.', hint: '' }

export const NO_CODE: Message = {
  status: 'This page needs a launch link.',
  hint: 'Start the terminal again with start.ps1 (or start.sh) and open the link it prints.',
}

export const REFUSED: Message = {
  status: 'This launch link has expired or was already used.',
  hint: 'A link works once and lasts 60 seconds. Start the terminal again for a new one.',
}

export const UNREACHABLE: Message = {
  status: 'The terminal did not answer.',
  hint: 'Check that the window you started it from is still open, then start it again.',
}

export const TITLE_FAILED = 'nq-lab terminal: not opened'
