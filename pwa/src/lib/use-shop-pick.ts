import { useState } from "react"
import { useApp } from "../app/context"
import type { Shop } from "./types"

/**
 * The one shop a catalog screen works on. The catalog is per shop (stock and prices of two shops are never added up), so
 * with "Alle Shops" the user picks one; with a single shop in scope there is nothing to pick.
 */
export function useShopPick(): { shop: Shop | undefined; options: Shop[]; pick(id: string): void } {
  const { scoped } = useApp()
  const options = scoped.filter((s) => s.home || s.token)
  const [chosen, setChosen] = useState<string | null>(null)
  const shop = options.find((s) => s.id === chosen) ?? options[0]
  return { shop, options, pick: setChosen }
}
