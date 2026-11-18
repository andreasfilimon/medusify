/**
 * Container key of the push module. Must be camelCase (Medusa resolves modules
 * via property access, dashes would break it).
 */
export const MEDUSIFY_PUSH_MODULE = "medusifyPush"

/** URL prefix under which the PWA is served. */
export const MEDUSIFY_PWA_BASE_PATH = "/medusify"

/** Delete a subscription after this many consecutive failed sends. */
export const MAX_CONSECUTIVE_FAILURES = 20
