// Port af templates/macros/recipe_card.html. Bevidst IKKE .product-klassen
// (den fanges af script.js' butiksfilter/overlay) - kun de indre klasser.
import { imgSrc, jinjaFloor, jinjaInt, pyFormat2f, pyStr, pyTruthy } from './jinja'

/** Form som scripts/seed-d1.py::fetch_recipe_pool leverer. */
export interface RecipeTeaser {
  id: string | number
  title: string
  image_url: string
  total_points?: number
  click_count?: number
  cheapest_total_price?: number | null
  matched_ingredient_count?: number
  total_ingredient_count?: number
  sale_ratio?: number
}

export function RecipeCard({ recipe, clickable = true }: { recipe: RecipeTeaser; clickable?: boolean }) {
  const Tag = clickable ? 'a' : 'div'
  const r = recipe
  return (
    <Tag
      {...(clickable ? { href: `/opskrift/${pyStr(r.id)}` } : {})}
      className={`recipe-card${clickable ? '' : ' recipe-card--teaser'}`}
      id={`recipe${pyStr(r.id)}`}
    >
      <div className="product-image-container">
        {clickable && pyTruthy(r.sale_ratio) && (r.sale_ratio as number) > 0 && (
          <span className="sale-badge">{`${jinjaInt(jinjaFloor((r.sale_ratio as number) * 100))}% på tilbud`}</span>
        )}
        <img {...imgSrc(pyStr(r.image_url))} alt={pyStr(r.title)} className="product-image" loading="lazy" />
      </div>
      <div className="product-content">
        <h3>{pyStr(r.title)}</h3>
        {clickable && pyTruthy(r.total_ingredient_count) && (
          <div className="product-weight">
            {`${pyStr(r.matched_ingredient_count)}/${pyStr(r.total_ingredient_count)} ingredienser fundet`}
          </div>
        )}
      </div>
      <div className="product-footer">
        <div className="product-price">
          {clickable ? (
            pyTruthy(r.cheapest_total_price) ? (
              <div className="price-main price">{`~${pyFormat2f(r.cheapest_total_price)} kr`}</div>
            ) : (
              <div className="price-main price">Pris ukendt</div>
            )
          ) : (
            <div className="price-main price recipe-card--teaser-label">Kommer snart</div>
          )}
        </div>
      </div>
    </Tag>
  )
}
