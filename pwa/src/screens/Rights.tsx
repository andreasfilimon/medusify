import { useQueries } from "@tanstack/react-query"
import { useLocation } from "wouter"
import { useApp } from "../app/context"
import * as api from "../lib/api"
import type { Key } from "../lib/i18n"
import { goBack } from "../lib/nav"
import { RIGHT_GROUPS, lineState } from "../lib/rights"
import { Icon } from "../ui/Icon"
import { ErrorState, Monogram, Section, Skeleton } from "../ui/kit"
import { NavBar } from "../ui/Nav"
import { Scroll } from "../ui/Scroll"

/**
 * What the signed-in user may do, per shop, in plain words. The app hides what a role may not do; this screen says why
 * a button is missing. Read only: roles are given in the Medusa admin.
 */
export function Rights() {
  const { t, shops } = useApp()
  const [, navigate] = useLocation()
  const authed = shops.filter((s) => s.home || s.token)
  const results = useQueries({
    queries: authed.map((shop) => ({ queryKey: ["rights", shop.id], queryFn: () => api.getRights(shop), retry: false, staleTime: 60_000 })),
  })
  const back = { label: t("nav.back"), onClick: () => goBack(navigate, "/more") }

  return (
    <div className="screen">
      <NavBar back={back} title={t("rights.title")} />
      <Scroll heading={{ title: t("rights.title") }}>
        {authed.map((shop, i) => {
          const q = results[i]!
          return (
            <Section id={`rights-${shop.id}`} key={shop.id} title={authed.length > 1 ? shop.name : undefined}>
              {q.isPending ? <Skeleton rows={3} /> : null}
              {q.isError ? <ErrorState text={t("rights.error", { name: shop.name })} onRetry={() => void q.refetch()} /> : null}
              {q.data ? (
                <>
                  {q.data.rbac === false ? (
                    <div className="group plain">
                      <p className="row single">
                        {authed.length > 1 ? <Monogram shop={shop} small /> : null}
                        <span className="row-main"><span className="row-title reg wrap">{t("rights.noRoles")}</span></span>
                      </p>
                    </div>
                  ) : null}
                  {RIGHT_GROUPS.map((g) => (
                    <div key={g.id}>
                      <div className="section-head sub"><h3>{t(`rights.group.${g.id}` as Key)}</h3></div>
                      <div className="group">
                        {g.lines.map((line) => {
                          const state = lineState(q.data!.actions, line.actions)
                          return (
                            <div className="row single" key={line.id}>
                              <span className="row-main"><span className={`row-title reg wrap${state === "no" ? " quiet" : ""}`}>{t(`rights.line.${line.id}` as Key)}</span></span>
                              <span className={`row-end inline${state === "yes" ? "" : " quiet"}`}>
                                <Icon name={state === "yes" ? "check" : state === "part" ? "minus" : "lock-simple"} size="sm" />
                                <span className="num">{t(`rights.${state}` as Key)}</span>
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </>
              ) : null}
            </Section>
          )
        })}
        <p className="foot">{t("rights.hint")}</p>
      </Scroll>
    </div>
  )
}
