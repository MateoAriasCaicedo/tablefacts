// One logger contract for every tool: log(message, level = 'info'), level is 'info' | 'warn' | 'error'.

export const noopLog = () => {}

/** For CLIs: info goes to stdout, warn and error to stderr. */
export const consoleLog = (message, level = 'info') => {
  if (level === 'info') console.log(message)
  else console.error(message)
}

/** Always returns a function that is called as log(message, level); tolerates a missing log or one that takes one argument. */
export function normalizeLog(log) {
  if (typeof log !== 'function') return noopLog
  return (message, level = 'info') => {
    log(message, level)
  }
}
