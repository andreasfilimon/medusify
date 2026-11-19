import { cleanTrackingNumber } from "./format"

export type ScanHandle = { stop(): void }

type ZX = typeof import("zxing-wasm/reader")

/** Formats that carriers print on parcel labels. No EAN-13: that is the product code on the goods, never a parcel number. */
const FORMATS = ["Code128", "Code39", "Code93", "ITF", "DataMatrix", "QRCode", "Codabar"] as const

/** 1D codes. A parcel number is printed as one of these; a 2D code on a label usually carries address and routing data. */
const LINEAR = new Set<string>(["Code128", "Code39", "Code93", "ITF", "Codabar"])

/** What a parcel number looks like: letters and digits, 8 to 35 characters (UPU 13, GLS 12, DPD 14, UPS 18, DHL up to 20 and more). */
const TRACKING = /^[0-9A-Za-z]{8,35}$/

export type Decoded = { format: string; text: string; isValid: boolean }

/**
 * The parcel number among the codes of one camera frame, or "" when none looks like one. A label carries several codes
 * (a GLS label: two DataMatrix with address and routing data and one ITF with the 12-digit number, measured on a real
 * label); the decoder returns them in reading order, so the first one is often a 2D code. A 1D code wins; a 2D code
 * counts only when its whole content looks like a parcel number.
 */
export function pickTrackingCode(results: readonly Decoded[]): string {
  const candidates = results
    .filter((r) => r.isValid)
    .map((r) => ({ linear: LINEAR.has(r.format), text: cleanTrackingNumber(r.text) }))
    .filter((c) => TRACKING.test(c.text))
  return (candidates.find((c) => c.linear) ?? candidates[0])?.text ?? ""
}

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
    // Without a size wish iOS delivers 640x480, too coarse for the thin bars of a label held at arm's length.
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    })
  } catch (e) {
    const name = (e as DOMException).name
    return name === "NotAllowedError" || name === "SecurityError" ? { kind: "denied" } : { kind: "no-camera" }
  }
  video.srcObject = stream
  video.setAttribute("playsinline", "true")
  await video.play().catch(() => undefined)
  let zx: ZX
  try {
    zx = await loadDecoder()
  } catch {
    // The decoder did not load (a lost connection while the app updates, an old cache): close the camera instead of
    // leaving it on without reading, and let the next try load it again. The number can still be typed.
    stream.getTracks().forEach((t) => t.stop())
    video.srcObject = null
    zxPromise = null
    return { kind: "no-camera" }
  }
  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const tick = async () => {
    if (stopped) return
    if (ctx && video.videoWidth > 0) {
      const w = Math.min(video.videoWidth, 1280)
      const h = Math.round((video.videoHeight / video.videoWidth) * w)
      canvas.width = w
      canvas.height = h
      ctx.drawImage(video, 0, 0, w, h)
      try {
        const results = await zx.readBarcodes(ctx.getImageData(0, 0, w, h), { formats: [...FORMATS], maxNumberOfSymbols: 8, tryHarder: true })
        const text = pickTrackingCode(results)
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
