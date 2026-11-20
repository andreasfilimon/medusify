import type { ReactNode } from "react"
import { Sheet } from "./Sheet"

export type Choice = { id: string; title: string; sub?: string; end?: ReactNode }

/** A short list to pick one from: several products with the same code, or the place a scan books to. */
export function PickSheet({ title, text, choices, onPick, onClose }: { title: string; text?: string; choices: Choice[]; onPick(id: string): void; onClose(): void }) {
  return (
    <Sheet title={title} onClose={onClose}>
      {text ? <p className="sheet-text">{text}</p> : null}
      <div className="group">
        {choices.map((c) => (
          <button key={c.id} className="row" onClick={() => onPick(c.id)}>
            <span className="row-main">
              <span className="row-title">{c.title}</span>
              {c.sub ? <span className="row-sub">{c.sub}</span> : null}
            </span>
            {c.end ? <span className="row-end">{c.end}</span> : null}
          </button>
        ))}
      </div>
    </Sheet>
  )
}
