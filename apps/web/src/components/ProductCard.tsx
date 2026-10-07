// Port af templates/macros/product_card.html. script.js læser alle data-*-
// attributterne (overlay, kurv, butiksfilter), så de skal være 1:1.
import type { DisplayProduct } from '~/lib/types'
import { imgSrc, on, pyFloatStr, pyFormat2f, pyStr, pyTruthy, jinjaFloor, jinjaInt } from './jinja'

function badgeFor(storeLower: string): [string, string] {
  const has = (s: string) => storeLower.includes(s)
  if (has('bilka')) return ['bilka', 'Bilka']
  if (has('netto')) return ['netto', 'Netto']
  if (has('foetex') || has('føtex')) return ['foetex', 'Føtex']
  if (has('min') || has('kobmand')) return ['mk', 'Min Købmand']
  if (has('meny')) return ['meny', 'Meny']
  if (has('superbrugsen')) return ['sb', 'SuperBrugsen']
  if (storeLower === 'brugsen') return ['brugsen', 'Brugsen']
  if (storeLower === 'kvickly') return ['kvickly', 'Kvickly']
  if (has('lidl')) return ['lidl', 'Lidl']
  if (has('loevbjerg') || has('løvbjerg')) return ['loevbjerg', 'Løvbjerg']
  if (has('abc')) return ['abclavpris', 'ABC Lavpris']
  if (has('365')) return ['discount365', '365 Discount']
  if (has('spar')) return ['spar', 'Spar']
  return ['rema', 'Rema 1000']
}

/** `x or ''` / `x or 'default'` i Jinja */
const or = (v: unknown, d: string): string => (pyTruthy(v) ? pyStr(v) : d)

/** rema_price er int 0 (ingen Rema-pris) eller en float i cachen. */
const remaPriceStr = (v: unknown): string => (v === 0 ? '0' : pyFloatStr(v))

const isPos = (v: unknown): boolean => pyTruthy(v) && (v as number) > 0

export function ProductCard({ product }: { product: DisplayProduct }) {
  const p = product
  const storeLower = (pyTruthy(p.store) ? String(p.store) : 'rema').toLowerCase()
  const [badgeClass, badgeLabel] = badgeFor(storeLower)
  const storeMatches = (p.store_matches ?? {}) as Record<string, any>
  const hasMatches = pyTruthy(storeMatches)

  const matchAttrs: Record<string, string> = {}
  for (const [key, m] of Object.entries(storeMatches)) {
    matchAttrs[`data-${key}-price`] = pyFloatStr(m.price)
    matchAttrs[`data-${key}-name`] = pyStr(m.name)
    matchAttrs[`data-${key}-kg-price`] = m.kg_price !== null && m.kg_price !== undefined ? pyFormat2f(m.kg_price) : ''
    matchAttrs[`data-${key}-is-sale`] = pyTruthy(m.is_sale) ? 'true' : 'false'
    matchAttrs[`data-${key}-id`] = or(m.ean, '')
    matchAttrs[`data-${key}-multideal`] = or(m.multi_deal, '')
  }

  const showSale = pyTruthy(p.is_sale) || pyTruthy(p.is_any_sale)
  let discountPct: number | null = null
  if (pyTruthy(p.is_sale) && pyTruthy(p.price) && pyTruthy(p.sale_price) && (p.sale_price as number) < p.price) {
    discountPct = jinjaFloor((1 - (p.sale_price as number) / p.price) * 100)
  }

  return (
    <div
      id={`product${pyStr(p.id)}`}
      className="product"
      data-rema-price={p.rema_price !== null && p.rema_price !== undefined ? remaPriceStr(p.rema_price) : ''}
      data-rema-weight={pyTruthy(p.unit_measure) ? pyStr(p.unit_measure) : ''}
      data-weight-g={pyTruthy(p.weight_g) ? pyFloatStr(p.weight_g) : ''}
      data-stk-count={pyTruthy(p.stk_count) ? pyStr(p.stk_count) : ''}
      data-rema-kg-price={p.price_per_kg !== null && p.price_per_kg !== undefined ? pyFormat2f(p.price_per_kg) : ''}
      data-store={or(p.store, 'Rema 1000')}
      data-has-match={hasMatches || isPos(p.rema_price) ? 'true' : 'false'}
      data-has-match-rema={isPos(p.rema_price) ? 'true' : 'false'}
      {...matchAttrs}
      data-rema-is-sale={pyTruthy(p.rema_is_sale) ? 'true' : 'false'}
      data-rema-id={storeLower.includes('rema') ? pyStr(p.id) : ''}
      data-multideal={or(p.multi_deal, '')}
      data-cheapest-at={or(p.cheapest_at, '')}
      data-category={p.category === undefined ? 'Andre varer' : pyStr(p.category)}
      data-subcategory={p.subcategory === undefined ? '' : pyStr(p.subcategory)}
      data-main-image={pyStr(p.image_url)}
      data-rema-image={pyStr(p.rema_image)}
      data-is-organic={pyTruthy(p.is_organic) ? 'true' : 'false'}
      data-is-lactose-free={pyTruthy(p.is_lactose_free) ? 'true' : 'false'}
      role="button"
      tabIndex={0}
      aria-label={`Se ${pyStr(p.name)}`}
      {...on({
        onclick: 'openOverlay(this)',
        onkeydown:
          "if((event.key==='Enter'||event.key===' ')&&event.target===this){event.preventDefault();openOverlay(this);}",
      })}
    >
      <div className="product-image-container">
        {showSale && (
          <span className="sale-badge">{pyTruthy(discountPct) ? `Spar ${jinjaInt(discountPct!)}%` : 'Tilbud'}</span>
        )}
        <span className={`store-badge ${badgeClass}`}>{badgeLabel}</span>
        <img {...imgSrc(pyStr(p.image_url))} alt={pyStr(p.name)} className="product-image" loading="lazy" />
      </div>
      <div className="product-content">
        <div className="product-brand">{pyStr(p.brand)}</div>
        <h3>{pyStr(p.name)}</h3>
        {pyTruthy(p.description) && <div className="product-weight">{pyStr(p.description)}</div>}
        {pyTruthy(p.stk_count) && <div className="product-weight">{`${pyStr(p.stk_count)} stk`}</div>}
        {pyTruthy(p.price_per_kg) && <div className="product-kg-price">{`${pyFormat2f(p.price_per_kg)} kr/kg`}</div>}
        {!hasMatches && <div className="compare-badge only">{`Kun hos ${or(p.store, 'Rema 1000')}`}</div>}
      </div>
      <div className="product-footer">
        <div className="product-price">
          {pyTruthy(p.is_sale) ? (
            <>
              <div className="price-original price original">{`${pyFormat2f(p.price)} kr`}</div>
              <div className="price-sale price sale">{`${pyFormat2f(p.sale_price)} kr`}</div>
            </>
          ) : (
            <div className="price-main price">{`${pyFormat2f(p.price)} kr`}</div>
          )}
        </div>
        <button
          className="add-to-cart-btn"
          {...on({ onclick: "event.stopPropagation(); addToCart(event, this.closest('.product'))" })}
          aria-label={`Tilføj ${pyStr(p.name)} til kurv`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="21" r="1" />
            <circle cx="20" cy="21" r="1" />
            <path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6" />
          </svg>
        </button>
      </div>
      <span className="brand" style={{ display: 'none' }}>{pyStr(p.brand)}</span>
      <span className="product-description" style={{ display: 'none' }}>{pyStr(p.description)}</span>
      {pyTruthy(p.is_sale) && pyTruthy(p.sale_end_date) && (
        <span className="sale-end-date" style={{ display: 'none' }}>{`Tilbud frem til: ${pyStr(p.sale_end_date)}`}</span>
      )}
    </div>
  )
}
