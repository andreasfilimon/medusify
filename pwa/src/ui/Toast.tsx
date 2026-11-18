import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react"

type ToastCtx = { show(text: string, opts?: { error?: boolean }): void }
const Ctx = createContext<ToastCtx>({ show() {} })
export const useToast = () => useContext(Ctx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const show = useCallback((text: string, opts?: { error?: boolean }) => {
    clearTimeout(timer.current)
    setToast({ text, error: !!opts?.error })
    // Errors stay until the next action; confirmations fade after 4 s.
    if (!opts?.error) timer.current = setTimeout(() => setToast(null), 4000)
  }, [])
  const value = useMemo(() => ({ show }), [show])
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toast-region" aria-live="polite" role="status">
        {toast ? (
          <div className={`toast${toast.error ? " error" : ""}`} onClick={() => setToast(null)}>
            {toast.text}
          </div>
        ) : null}
      </div>
    </Ctx.Provider>
  )
}
