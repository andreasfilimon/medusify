/**
 * Lets a function run once at a time. A second call while the first is still running returns `undefined` without
 * calling it: a double tap on a button that moves money must never send two requests.
 */
export function singleFlight<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R | undefined> {
  let running = false
  return async (...args) => {
    if (running) return undefined
    running = true
    try {
      return await fn(...args)
    } finally {
      running = false
    }
  }
}
