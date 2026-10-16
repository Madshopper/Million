// Port af templates/partials/index_products.html (= #dynamic-content på forsiden).
import type { DisplayProduct } from '~/lib/types'
import { ProductCard } from './ProductCard'
import { pyStr } from './jinja'
import { RecipeCard, type RecipeTeaser } from './RecipeCard'

export interface IndexProductsProps {
  /** Kategori -> varer, i visningsrækkefølge (Python-dict'ens rækkefølge) */
  categories: Record<string, DisplayProduct[]>
  /** Kategori -> "Vis alle"-link (None = intet link) */
  template_mapping: Record<string, string | null>
  recipes?: RecipeTeaser[]
  recipes_clickable?: boolean
}

export function IndexProducts({ categories, template_mapping, recipes, recipes_clickable }: IndexProductsProps) {
  const sale = categories['Ugens Tilbud']
  return (
    <div id="dynamic-content">
      {sale && sale.length > 0 && (
        <section className="product-type">
          <h2>
            {'Ugens Tilbud '}
            <a href={pyStr(template_mapping['Ugens Tilbud'])}>Vis alle</a>
          </h2>
          <div className="products">
            {sale.slice(0, 10).map((p, i) => (
              <ProductCard key={i} product={p} />
            ))}
          </div>
        </section>
      )}
      {Object.entries(categories).map(([name, products]) =>
        products && products.length > 0 && name in template_mapping && name !== 'Ugens Tilbud' ? (
          <section className="product-type" key={name}>
            <h2>
              {name}
              {template_mapping[name] ? (
                <>
                  {' '}
                  <a href={template_mapping[name]!}>Vis alle</a>
                </>
              ) : null}
            </h2>
            <div className="products">
              {products.slice(0, 10).map((p, i) => (
                <ProductCard key={i} product={p} />
              ))}
            </div>
          </section>
        ) : null,
      )}
      {recipes && recipes.length > 0 && (
        <section className="product-type">
          <h2>
            {'Lækre opskrifter'}
            {recipes_clickable ? (
              <>
                {' '}
                <a href="/opskrifter">Vis alle</a>
              </>
            ) : null}
          </h2>
          <div className="products">
            {recipes.slice(0, 10).map((r, i) => (
              <RecipeCard key={i} recipe={r} clickable={!!recipes_clickable} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
