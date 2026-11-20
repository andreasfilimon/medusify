/** The size an image is scaled to so that its longer side is at most `max`; never larger than the original. */
export function fitSize(width: number, height: number, max: number): { width: number; height: number } {
  const longer = Math.max(width, height)
  if (longer <= max || longer === 0) return { width, height }
  const scale = max / longer
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** Photos from a phone camera are 12 MP and 3 to 6 MB; a product picture needs a fraction of that. */
export const PHOTO_MAX_SIDE = 1600
export const PHOTO_QUALITY = 0.85

/** The photo as a JPEG blob scaled to `PHOTO_MAX_SIDE`. Throws when the file is not an image the browser can decode. */
export async function shrinkPhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  try {
    const { width, height } = fitSize(bitmap.width, bitmap.height, PHOTO_MAX_SIDE)
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("no canvas")
    ctx.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", PHOTO_QUALITY))
    if (!blob) throw new Error("no image")
    return blob
  } finally {
    bitmap.close()
  }
}
