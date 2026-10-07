// Port af templates/not_found.html.
import type { RequestInfo, SiteContext } from '../context'
import { urlFor } from '../context'
import { Layout } from '../Layout'

export interface NotFoundPageProps {
  site: SiteContext
  req: RequestInfo
}

export function NotFoundPage({ site, req }: NotFoundPageProps) {
  return (
    <Layout site={site} req={req} title={'Siden blev ikke fundet - MadShopper'}>
      <div className="page-wrap">
        <article className="static-page" data-session-retry="">
          <h1>Siden blev ikke fundet</h1>
          <p className="static-page-lead">Vi kan ikke finde den side, du leder efter. Den kan være flyttet, eller linket kan være forkert.</p>
          <p>
            <a href={urlFor('home')}>Gå til forsiden</a>
          </p>
        </article>
      </div>
    </Layout>
  )
}
