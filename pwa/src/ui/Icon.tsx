// Phosphor Icons (MIT, docs/mocks/icons/LICENSE-phosphor-MIT.txt). Only the icons the app uses are bundled.
const files = import.meta.glob(
  "../../../docs/mocks/icons/{house,house-fill,receipt,receipt-fill,dots-three,dots-three-fill,package,package-fill,check,check-circle,clock,x-circle,x,truck,barcode,camera,magnifying-glass,caret-left,caret-down,caret-right,wifi-slash,export,bell-ringing,plus,warning-circle,flashlight,storefront,lock-simple,info,user-circle,moon,translate,note-pencil,arrow-u-up-left,arrow-down,minus,tag,image-square,barcode-fill,camera-fill}.svg",
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>

const inner: Record<string, string> = {}
for (const [path, raw] of Object.entries(files)) {
  const name = path.split("/").pop()!.replace(".svg", "")
  inner[name] = raw.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "")
}

export type IconName = keyof typeof ICON_NAMES
const ICON_NAMES = {
  house: 1, "house-fill": 1, receipt: 1, "receipt-fill": 1, "dots-three": 1, "dots-three-fill": 1, package: 1, "package-fill": 1,
  check: 1, "check-circle": 1, clock: 1, "x-circle": 1, x: 1, truck: 1, barcode: 1, camera: 1, "magnifying-glass": 1,
  "caret-left": 1, "caret-down": 1, "caret-right": 1, "wifi-slash": 1, export: 1, "bell-ringing": 1, plus: 1,
  "warning-circle": 1, flashlight: 1, storefront: 1, "lock-simple": 1, info: 1, "user-circle": 1, moon: 1, translate: 1, "note-pencil": 1, "arrow-u-up-left": 1, "arrow-down": 1, minus: 1, tag: 1, "image-square": 1, "barcode-fill": 1, "camera-fill": 1,
} as const

export function Icon({ name, size }: { name: IconName; size?: "sm" | "xs" | "lg" }) {
  return (
    <svg className={`ic${size ? ` ${size}` : ""}`} viewBox="0 0 256 256" aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: inner[name] ?? "" }} />
  )
}
