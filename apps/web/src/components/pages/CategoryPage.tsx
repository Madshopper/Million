// Port af templates/category.html (kategori + Ugens Tilbud).
import type { DisplayProduct } from '~/lib/types'
import type { RequestInfo, SiteContext } from '../context'
import { Filters, FiltersToggleBtn } from '../Filters'
import { Layout } from '../Layout'
import { ProductGrid } from '../ProductGrid'
import { BreadcrumbJsonLd } from './breadcrumb'

export interface CategoryPageProps {
  site: SiteContext
  req: RequestInfo
  /** Visningsnavnet (fx "Køl & Mejeri"), ikke slug'en */
  category_name: string
  products: DisplayProduct[]
  current_page: number
  total_pages: number
  available_subcategories?: string[]
  current_subcategory?: string | null
}

export function CategoryPage(props: CategoryPageProps) {
  const { site, req, category_name, available_subcategories, current_subcategory } = props
  return (
    <Layout
      site={site}
      req={req}
      title={`${category_name} - MadShopper`}
      structuredData={<BreadcrumbJsonLd siteUrl={site.site_url} name={category_name} />}
    >
      <div className="page-wrap">
        <div className="container-category">
          <h1 className="category-title">{category_name}</h1>
          <div className="filters-wrapper">
            <div className="advanced-filters-container">
              <FiltersToggleBtn />
              <Filters />
            </div>
          </div>
          {available_subcategories && available_subcategories.length > 0 && (
            <div className="subcategory-bar" id="subcategoryBar">
              <button className={`subcategory-pill${current_subcategory ? '' : ' active'}`} data-sub="">Alle</button>
              {available_subcategories.map((sub) => (
                <button key={sub} className={`subcategory-pill${current_subcategory === sub ? ' active' : ''}`} data-sub={sub}>
                  {sub}
                </button>
              ))}
            </div>
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
