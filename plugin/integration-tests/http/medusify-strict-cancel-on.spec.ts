import { strictCancelSuite } from "../helpers/strict-cancel-suite"
import { rbacRunner } from "../helpers/rbac-license"

jest.setTimeout(120 * 1000)

// The option is read from the environment by medusa-config.ts, before the runner loads it.
process.env.MEDUSIFY_STRICT_CANCEL_REFUND = "true"
rbacRunner()({ testSuite: strictCancelSuite(true) })
