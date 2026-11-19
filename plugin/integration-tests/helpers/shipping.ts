import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * A shop that can ship: stock location with Medusa's manual fulfillment provider, a shipping fulfillment set with a
 * service zone for Austria, and one shipping option per profile name. Demo data only.
 */
export async function createShippingSetup(container: MedusaContainer, profiles: string[] = ["Standard"]) {
  const fm = container.resolve(Modules.FULFILLMENT) as any
  const sl = container.resolve(Modules.STOCK_LOCATION) as any
  const link = container.resolve(ContainerRegistrationKeys.LINK) as any
  const location = await sl.createStockLocations({ name: "Lager Wien" })
  const set = await fm.createFulfillmentSets({
    name: `Versand ${location.id}`,
    type: "shipping",
    service_zones: [{ name: "Österreich", geo_zones: [{ type: "country", country_code: "at" }] }],
  })
  await link.create([
    { [Modules.STOCK_LOCATION]: { stock_location_id: location.id }, [Modules.FULFILLMENT]: { fulfillment_provider_id: "manual_manual" } },
    { [Modules.STOCK_LOCATION]: { stock_location_id: location.id }, [Modules.FULFILLMENT]: { fulfillment_set_id: set.id } },
  ])
  const options: { profileId: string; optionId: string }[] = []
  for (const name of profiles) {
    const profile = await fm.createShippingProfiles({ name: `${name} ${location.id}`, type: "default" })
    const option = await fm.createShippingOptions({
      name: `Paket ${name}`,
      price_type: "flat",
      service_zone_id: set.service_zones[0].id,
      shipping_profile_id: profile.id,
      provider_id: "manual_manual",
      type: { label: "Paket", description: "Paket", code: `paket-${name.toLowerCase()}` },
      data: {},
      rules: [],
    })
    options.push({ profileId: profile.id, optionId: option.id })
  }
  return { locationId: location.id as string, options }
}
