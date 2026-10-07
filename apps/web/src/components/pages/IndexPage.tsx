// Port af templates/index.html (forsiden).
import type { RequestInfo, SiteContext } from '../context'
import { Filters, FiltersToggleBtn } from '../Filters'
import { IndexProducts, type IndexProductsProps } from '../IndexProducts'
import { Layout } from '../Layout'

export interface IndexPageProps extends IndexProductsProps {
  site: SiteContext
  req: RequestInfo
}

export function IndexPage({ site, req, ...rest }: IndexPageProps) {
  return (
    <Layout site={site} req={req} title="MadShopper - Sammenlign dagligvarepriser">
      <div className="page-wrap">
        <div className="container-index">
          <section className="home-hero">
            <h1>Sammenlign dagligvarepriser</h1>
            <p>Find dagens billigste priser på tværs af danske supermarkeder – billigste bud, før du går ud.</p>
          </section>
          <div className="savings-widget savings-widget--login" id="personalSavingsWidget">
            <div className="savings-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1v22" />
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
            </div>
            <div className="savings-content">
              <div className="savings-label">Personlig besparelse</div>
              <div className="savings-amount">Log ind for at tracke besparelse</div>
            </div>
            <button type="button" className="savings-badge savings-badge--btn" id="savingsLoginBtn">Log ind</button>
          </div>
          <div className="filters-wrapper">
            <div className="advanced-filters-container">
              <FiltersToggleBtn />
              <Filters />
            </div>
          </div>
          <IndexProducts {...rest} />
        </div>
      </div>
    </Layout>
  )
}
