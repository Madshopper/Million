// Port af templates/partials/product_grid.html. Tom-tilstanden hører til her,
// fordi XHR-flowet kun udskifter #dynamic-content med denne partial.
import type { DisplayProduct } from '~/lib/types'
import type { RequestInfo, SiteContext } from './context'
import { Pagination } from './Pagination'
import { ProductCard } from './ProductCard'

export interface ProductGridProps {
  site: SiteContext
  req: RequestInfo
  products: DisplayProduct[]
  current_page: number
  total_pages: number
  /** Kun /search (JSON-panelet) sætter den: 'search_page' */
  pagination_endpoint?: string | null
}

export function ProductGrid({ site, req, products, current_page, total_pages, pagination_endpoint }: ProductGridProps) {
  return (
    <>
      {products && products.length ? (
        <div className="products">
          {products.map((p, i) => (
            <ProductCard key={i} product={p} />
          ))}
        </div>
      ) : (
        // data-degraded fanges af script.js' healDegradedContent()
        <div className="products-empty" {...(site.data_degraded ? { 'data-degraded': '1' } : {})}>
          <p>Ingen varer matcher dine valg.</p>
          <span>Prøv at fjerne et filter, vælge flere butikker eller søge bredere.</span>
        </div>
      )}
      <Pagination currentPage={current_page} totalPages={total_pages} endpoint={pagination_endpoint ?? null} req={req} />
    </>
  )
}
