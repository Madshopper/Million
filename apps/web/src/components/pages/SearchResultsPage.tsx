// Port af templates/search_results.html.
import type { DisplayProduct } from '~/lib/types'
import type { RequestInfo, SiteContext } from '../context'
import { Filters, FiltersToggleBtn } from '../Filters'
import { Layout } from '../Layout'
import { ProductGrid } from '../ProductGrid'
import { BreadcrumbJsonLd } from './breadcrumb'

export interface SearchResultsPageProps {
  site: SiteContext
  req: RequestInfo
  /** Renset søgeord (_clean_search_query) */
  query: string
  products: DisplayProduct[]
  total_products?: number
  current_page: number
  total_pages: number
  /** Sat ved rate-limit (429) og interne fejl */
  error?: string | null
}

export function SearchResultsPage(props: SearchResultsPageProps) {
  const { site, req, query, error } = props
  const heading = `Søgeresultater for "${query}"`
  return (
    <Layout
      site={site}
      req={req}
      title={`${heading} - MadShopper`}
      structuredData={<BreadcrumbJsonLd siteUrl={site.site_url} name={heading} />}
    >
      <div className="page-wrap">
        <div className="container-category">
          <h1 className="category-title">{heading}</h1>
          <div className="filters-wrapper">
            <div className="advanced-filters-container">
              <FiltersToggleBtn />
              <Filters />
            </div>
          </div>
          {error && (
            <p className="search-error" role="alert">{error}</p>
          )}
          <div id="dynamic-content">
            <ProductGrid
              site={site}
              req={req}
              products={props.products}
              current_page={props.current_page}
              total_pages={props.total_pages}
            />
          </div>
        </div>
      </div>
    </Layout>
  )
}
