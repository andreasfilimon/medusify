import { cleanTrackingNumber } from "./format"

export type ScanHandle = { stop(): void }

type ZX = typeof import("zxing-wasm/reader")

/** Formats that carriers print on parcel labels. */
const FORMATS = ["Code128", "Code39", "Code93", "ITF", "DataMatrix", "QRCode", "EAN-13", "Codabar"] as const

let zxPromise: Promise<ZX> | null = null

/** Loads the decoder only when the camera opens; the .wasm file is served from the app itself. */
function loadDecoder(): Promise<ZX> {
  zxPromise ??= (async () => {
    const [zx, wasm] = await Promise.all([import("zxing-wasm/reader"), import("zxing-wasm/reader/zxing_reader.wasm?url")])
    zx.setZXingModuleOverrides({
      locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasm.default : prefix + path),
    })
    return zx
  })()
  return zxPromise
}

export type ScanStart =
  | { kind: "started"; handle: ScanHandle }
  | { kind: "no-camera" }
  | { kind: "denied" }

/**
 * Opens the rear camera in `video`, decodes about five frames per second and calls `onCode` with a cleaned
 * tracking number. Permission is asked here, so call it only after a tap.
 */
export async function startScan(video: HTMLVideoElement, onCode: (value: string) => void): Promise<ScanStart> {
  if (!navigator.mediaDevices?.getUserMedia) return { kind: "no-camera" }
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
  } catch (e) {
    const name = (e as DOMException).name
    return name === "NotAllowedError" || name === "SecurityError" ? { kind: "denied" } : { kind: "no-camera" }
  }
  video.srcObject = stream
  video.setAttribute("playsinline", "true")
  await video.play().catch(() => undefined)
  const zx = await loadDecoder()
  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const tick = async () => {
    if (stopped) return
    if (ctx && video.videoWidth > 0) {
      const w = Math.min(video.videoWidth, 960)
      const h = Math.round((video.videoHeight / video.videoWidth) * w)
      canvas.width = w
      canvas.height = h
      ctx.drawImage(video, 0, 0, w, h)
      try {
        const results = await zx.readBarcodes(ctx.getImageData(0, 0, w, h), { formats: [...FORMATS], maxNumberOfSymbols: 1, tryHarder: true })
        const text = results[0]?.isValid ? cleanTrackingNumber(results[0].text) : ""
        if (text && !stopped) {
          navigator.vibrate?.(30)
          onCode(text)
        }
      } catch {
        /* a bad frame is not an error */
      }
    }
    if (!stopped) timer = setTimeout(tick, 200)
  }
  timer = setTimeout(tick, 200)

  return {
    kind: "started",
    handle: {
      stop() {
        stopped = true
        if (timer) clearTimeout(timer)
        stream.getTracks().forEach((t) => t.stop())
        video.srcObject = null
      },
    },
  }
}
