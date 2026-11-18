/**
 * `navigator.serviceWorker.ready` never settles when no worker is installing or active (first load before the
 * registration finished, a blocked or failed registration). Everything that waits for it goes through here, so a
 * missing worker becomes an error the UI can show instead of a screen that waits forever.
 */
export class SwTimeoutError extends Error {
  constructor() {
    super("service worker not ready")
    this.name = "SwTimeoutError"
  }
}

/** Mutable on purpose: tests shorten it. */
export const swConfig = { readyTimeoutMs: 10_000 }

export async function swReady<T>(ready: Promise<T>, timeoutMs = swConfig.readyTimeoutMs): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SwTimeoutError()), timeoutMs)
  })
  try {
    return await Promise.race([ready, timeout])
  } finally {
    clearTimeout(timer)
  }
}
