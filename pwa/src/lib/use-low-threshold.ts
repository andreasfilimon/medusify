import { useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { useApp } from "../app/context"
import * as api from "./api"
import type { Shop } from "./types"

/** The same default the plugin uses when a device has not chosen (plugin/src/lib/push-kinds.ts). */
export const DEFAULT_LOW_STOCK = 5

/**
 * From how many units on this device calls a product "low": the threshold of the push setting, so the list and the
 * message agree. Without a push subscription, or with a plugin older than 0.3.0, the default is used.
 */
export function useLowThreshold(shop: Shop | undefined): number {
  const { currentEndpoint } = useApp()
  const [endpoint, setEndpoint] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void currentEndpoint().then((e) => alive && setEndpoint(e)).catch(() => {})
    return () => {
      alive = false
    }
  }, [currentEndpoint])
  const prefs = useQuery({
    queryKey: ["push-prefs", shop?.id, endpoint],
    queryFn: () => api.getPushPreferences(shop!, endpoint!),
    enabled: !!shop && !!endpoint,
    retry: false,
    staleTime: 60_000,
  })
  const n = prefs.data?.low_stock_threshold
  return n !== undefined && n >= 0 ? n : DEFAULT_LOW_STOCK
}
