import { strictCancelSuite } from "../helpers/strict-cancel-suite"
import { rbacRunner } from "../helpers/rbac-license"

jest.setTimeout(120 * 1000)

rbacRunner()({ testSuite: strictCancelSuite(false) })
