import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react"
import { Icon } from "./Icon"

type ToastCtx = { show(text: string, opts?: { error?: boolean }): void }
const Ctx = createContext<ToastCtx>({ show() {} })
export const useToast = () => useContext(Ctx)

const LEAVE_MS = 200

/** A short message in a capsule of the control material: it drops in from the top edge, and leaves the same way. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ text: string; error: boolean; leaving: boolean; id: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const gone = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const seq = useRef(0)
  const dismiss = useCallback(() => {
    clearTimeout(timer.current)
    clearTimeout(gone.current)
    setToast((t) => (t ? { ...t, leaving: true } : t))
    // A timer instead of animationend: with reduced motion there is no animation and no event.
    gone.current = setTimeout(() => setToast(null), LEAVE_MS)
  }, [])
  const show = useCallback(
    (text: string, opts?: { error?: boolean }) => {
      clearTimeout(timer.current)
      clearTimeout(gone.current)
      setToast({ text, error: !!opts?.error, leaving: false, id: ++seq.current })
      // Errors stay until the next action; confirmations leave after 4 s.
      if (!opts?.error) timer.current = setTimeout(dismiss, 4000)
    },
    [dismiss],
  )
  const value = useMemo(() => ({ show }), [show])
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toast-region" aria-live="polite" role="status">
        {toast ? (
          <div key={toast.id} className={`toast${toast.error ? " error" : ""}${toast.leaving ? " leaving" : ""}`} onClick={dismiss}>
            <Icon name={toast.error ? "warning-circle" : "check-circle"} size="sm" />
            {toast.text}
          </div>
        ) : null}
      </div>
    </Ctx.Provider>
  )
}
