import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import FakeGoogleProvider from "./service"

export default ModuleProvider(Modules.AUTH, { services: [FakeGoogleProvider] })
