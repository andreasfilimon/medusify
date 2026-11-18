import { Module } from "@medusajs/framework/utils"
import { MEDUSIFY_PUSH_MODULE } from "../../constants"
import validateOptionsLoader from "./loaders/validate-options"
import MedusifyPushModuleService from "./service"

export default Module(MEDUSIFY_PUSH_MODULE, {
  service: MedusifyPushModuleService,
  loaders: [validateOptionsLoader],
})

export { MedusifyPushModuleService }
export * from "./types"
