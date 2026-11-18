import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "../../docs/mocks/tokens.css"
import "./styles/app.css"
import { App } from "./app/App"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// The service worker only serves the offline page and push. Production builds only.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  addEventListener("load", () => {
    navigator.serviceWorker.register("/medusify/sw.js", { scope: "/medusify/", updateViaCache: "none" }).catch(() => undefined)
  })
}
