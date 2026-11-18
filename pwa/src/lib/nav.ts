/**
 * The installed app has no browser back button, so every sub page brings its own. A page that was opened
 * directly (push tap, home screen link) has no history of its own: back then goes to a fixed fallback.
 */
let navigated = false

export function markNavigated() {
  navigated = true
}

export function goBack(navigate: (to: string, opts?: { replace?: boolean }) => void, fallback: string) {
  if (navigated) history.back()
  else navigate(fallback, { replace: true })
}

export function resetNavigation() {
  navigated = false
}
