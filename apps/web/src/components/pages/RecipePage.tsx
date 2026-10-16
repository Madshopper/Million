// Port af templates/opskrift.html. Ingrediens-data ligger i én JSON-blok
// (tojson), som det inline-script bruger til personer-skalering og
// "Læg fundne varer i kurv"; de skjulte produktkort er datakilde til
// openOverlay() i static/js/script.js.
import { Fragment } from 'react'
import type { RequestInfo, SiteContext } from '../context'
import { pyFloatRepr, pyFormat2f, pyStr, pyTruthy, imgSrc, tojson } from '../jinja'
import { Layout } from '../Layout'
import { ProductCard } from '../ProductCard'

export interface RecipePageProps {
  site: SiteContext
  req: RequestInfo
  recipe: Record<string, any> | null
  ingredients?: any[]
  snapshot?: Record<string, any> | null
}

const SCRIPT_PRE = "\n  // Registrerer ét klik pr. sidevisning (record_recipe_click-RPC via\n  // /api/recipe-click) - fyres i browseren, ikke server-side, så\n  // get_recipe_page kan edge-caches uden at underminere tællingen. Fejler\n  // stille (samme fail-safe som addToCart i static/js/script.js).\n  fetch('/api/recipe-click', {\n    method: 'POST',\n    headers: { 'Content-Type': 'application/json' },\n    body: JSON.stringify({ recipe_id: "
const SCRIPT_POST = " }),\n  }).catch(function () {});\n\n  document.addEventListener('DOMContentLoaded', function () {\n    // Al ingrediens-data (quantity/unit/navn/matched_product/candidates)\n    // ligger i ÉN JSON-blok i stedet for HTML data-*-attributter - et\n    // produktnavn eller en billed-URL med anførselstegn i ville ellers knække\n    // attributten (fundet 2026-08-01: tojson direkte i et data-*-attribut\n    // producerer rå \" i værdien, som lukker attributten for tidligt).\n    // <li>-elementerne bærer kun det trygge data-ingredient-id (et heltal).\n    let ingredientsById = {};\n    try {\n      const raw = JSON.parse(document.getElementById('recipe-ingredients-data').textContent);\n      raw.forEach(function (ing) { ingredientsById[ing.id] = ing; });\n    } catch (e) { ingredientsById = {}; }\n\n    const btn = document.getElementById('recipeAddAllBtn');\n    if (btn) {\n      btn.addEventListener('click', function () {\n        // currentProduct/currentUnits (sat af render(), se nedenfor) er den\n        // pakke og det antal der rent faktisk vises lige nu - ikke\n        // nødvendigvis serverens oprindelige match, hvis personer-tallet er\n        // ændret og en anden pakkestørrelse er billigst for den mængde.\n        const items = Object.values(ingredientsById)\n          .filter(function (ing) { return ing.currentProduct; })\n          .map(function (ing) {\n            return Object.assign({}, ing.currentProduct, { quantity: ing.currentUnits || 1 });\n          });\n        addRecipeToCart(items, btn);\n      });\n    }\n\n    // Klik på en ingrediens åbner produkt-overlayet for det AKTUELT viste\n    // match (data-overlay-id opdateres af render()/renderIngredientMatch\n    // nedenfor, når personer-skalering skifter til en anden kandidat-pakke).\n    document.querySelectorAll('#recipeIngredientList .recipe-ingredient').forEach(function (li) {\n      li.addEventListener('click', function () {\n        if (li.dataset.overlayId) openOverlay(li.dataset.overlayId);\n      });\n    });\n\n    // Personer-stepper: skalerer ingrediensmængderne, og genvurderer hvilken\n    // kandidat-pakke der er billigst for den NYE mængde (fx en stor pakke der\n    // bliver billigere end standard-matchet, når 300 g bliver til 1200 g).\n    // Aldrig under 1 person.\n    const stepper = document.getElementById('recipeServingsStepper');\n    if (!stepper) return;\n    const baseServings = parseFloat(stepper.dataset.baseServings) || 1;\n    const valueEl = document.getElementById('recipeServingsValue');\n    const minusBtn = document.getElementById('recipeServingsMinus');\n    const plusBtn = document.getElementById('recipeServingsPlus');\n    const ctaAmountEl = document.getElementById('recipeCtaAmount');\n    const nutritionBox = document.getElementById('recipeNutritionBox');\n    let currentServings = baseServings;\n\n    // Samme g/kg/l/ml/cl/dl-konvertering som app_support.py::_unit_to_grams -\n    // \"gram-ækvivalent\" til at sammenligne opskrift-mængder med pakkers\n    // weight_g, uafhængigt af om begge er vægt eller væske.\n    const UNIT_TO_GRAMS = { g: 1, kg: 1000, ml: 1, cl: 10, dl: 100, l: 1000 };\n\n    function formatQty(n) {\n      const rounded = Math.round(n * 100) / 100;\n      return String(rounded).replace('.', ',');\n    }\n\n    // Billigste kandidat (og hvor mange pakker) for den skalerede mængde -\n    // eller null hvis ingen kandidat kan vurderes (fx vægtløse Dagrofa-varer),\n    // i så fald beholdes det oprindelige match uændret.\n    function pickBestCandidate(scaledQty, unit, candidates) {\n      if (!candidates || candidates.length === 0) return null;\n      const targetGrams = UNIT_TO_GRAMS[unit] ? scaledQty * UNIT_TO_GRAMS[unit] : null;\n      let best = null;\n      candidates.forEach(function (c) {\n        let units = null;\n        if (targetGrams !== null && c.weight_g) {\n          units = Math.max(1, Math.ceil(targetGrams / c.weight_g));\n        } else if (!unit && c.stk_count) {\n          units = Math.max(1, Math.ceil(scaledQty / c.stk_count));\n        } else {\n          return; // kan ikke mængdevurderes mod denne kandidat\n        }\n        const cost = units * c.price;\n        if (!best || cost < best.cost) {\n          best = { product: c, units: units, cost: cost };\n        }\n      });\n      return best;\n    }\n\n    function renderIngredientMatch(li, picked) {\n      const matchEl = li.querySelector('.recipe-ingredient-match-text');\n      const img = li.querySelector('.recipe-ingredient-thumb');\n      if (!picked) return; // intet bedre valg fundet - behold serverens match\n      const p = picked.product;\n      const totalPrice = picked.cost.toFixed(2).replace('.', ',');\n      const timesLabel = picked.units > 1 ? ' × ' + picked.units : '';\n      const saleTag = p.is_sale ? '<span class=\"recipe-ingredient-sale-tag\">Tilbud</span>' : '';\n      if (matchEl) {\n        matchEl.innerHTML = '(' + [p.unit_measure, p.name].filter(Boolean).join(' ') +\n          timesLabel + ' · ' + totalPrice + ' kr) ' + saleTag;\n      }\n      if (img && p.image) img.src = p.image;\n      li.dataset.overlayId = 'product' + p.id; // \"åbn produkt\" følger den nu viste pakke\n    }\n\n    function render() {\n      valueEl.textContent = currentServings;\n      minusBtn.disabled = currentServings <= 1;\n      const scale = currentServings / baseServings;\n      let total = 0;\n\n      document.querySelectorAll('#recipeIngredientList .recipe-ingredient').forEach(function (li) {\n        const ing = ingredientsById[li.dataset.ingredientId];\n        if (!ing) return;\n        const rawQty = ing.quantity;\n        const unit = ing.unit || '';\n        const name = ing.ingredient_name || ing.raw_text;\n\n        // currentProduct/currentUnits er den pakke + det antal \"Læg fundne\n        // varer i kurv\" rent faktisk lægger i kurven - holdes i sync med det\n        // der vises på skærmen (web-paritet med apps/mobile's RecipeDetailScreen,\n        // som allerede gjorde dette fra starten).\n        ing.currentProduct = ing.matched_product;\n        ing.currentUnits = 1;\n        if (ing.matched_product) li.dataset.overlayId = 'product' + ing.matched_product.id;\n\n        let lineCost = null;\n        if (rawQty !== null && rawQty !== undefined) {\n          const qtyText = li.querySelector('.recipe-ingredient-qty-text');\n          const scaled = rawQty * scale;\n          if (qtyText) qtyText.textContent = [formatQty(scaled), unit, name].filter(Boolean).join(' ');\n\n          // Kun genvurdér hvilken pakke der er billigst når personer-antallet\n          // rent faktisk er ændret - ved udgangspunktet (scale=1) vises\n          // serverens oprindelige navne-match uændret, så en tilfældigt\n          // billigere kandidat ikke overrasker ved første sidevisning.\n          if (scale !== 1) {\n            const picked = pickBestCandidate(scaled, unit, ing.candidates);\n            renderIngredientMatch(li, picked);\n            lineCost = picked ? picked.cost : null;\n            if (picked) {\n              ing.currentProduct = picked.product;\n              ing.currentUnits = picked.units;\n            }\n          }\n        }\n        if (lineCost === null && ing.matched_product) {\n          lineCost = ing.matched_product.price; // uskalerbar linje/scale=1 - fast pris\n        }\n        if (lineCost !== null) total += lineCost;\n      });\n\n      // Ved scale=1 vises serverens egen snapshot-pris uændret (den kan afvige\n      // ganske lidt fra klient-summen, da snapshottet ser på ALLE butikkers\n      // priser pr. ingrediens, mens matched_product kun er kortets forside-\n      // pris) - kun ved faktisk skalering erstattes den af klient-summen.\n      if (ctaAmountEl && total > 0 && scale !== 1) {\n        ctaAmountEl.textContent = total.toFixed(2).replace('.', ',') + ' kr';\n      }\n\n      // Næringsestimatet skalerer lineært med scale: alle bidragende\n      // ingrediensers mængder ganges med samme faktor, så summen gør det\n      // samme - ingen grund til at genberegne pr. ingrediens som ved pris\n      // (der skal vurdere billigste PAKKESTØRRELSE, ikke bare skalere).\n      if (nutritionBox && scale !== 1) {\n        const kcal = document.getElementById('recipeNutritionKcal');\n        const protein = document.getElementById('recipeNutritionProtein');\n        const fedt = document.getElementById('recipeNutritionFedt');\n        const kulhydrat = document.getElementById('recipeNutritionKulhydrat');\n        const round1 = function (n) { return Math.round(n * 10) / 10; };\n        if (kcal) kcal.textContent = round1(parseFloat(nutritionBox.dataset.baseKcal) * scale);\n        if (protein) protein.textContent = round1(parseFloat(nutritionBox.dataset.baseProtein) * scale);\n        if (fedt) fedt.textContent = round1(parseFloat(nutritionBox.dataset.baseFedt) * scale);\n        if (kulhydrat) kulhydrat.textContent = round1(parseFloat(nutritionBox.dataset.baseKulhydrat) * scale);\n      }\n    }\n\n    minusBtn.addEventListener('click', function () {\n      if (currentServings > 1) {\n        currentServings -= 1;\n        render();\n      }\n    });\n    plusBtn.addEventListener('click', function () {\n      currentServings += 1;\n      render();\n    });\n\n    render();\n  });\n"

/** `a or b` i Jinja */
const or = (a: unknown, b: unknown): unknown => (pyTruthy(a) ? a : b)

/** "%.2f"|format(x): Python kaster TypeError på None/streng - det gør vi også,
 *  så siden bliver til samme 500 som i app.py::get_recipe_page. */
function fmt2(v: unknown): string {
  if (typeof v !== 'number' && typeof v !== 'boolean') throw new TypeError('must be real number, not ' + (v === null ? 'NoneType' : typeof v))
  return pyFormat2f(v)
}

/** round(x, 1) er altid float i Python: 12 -> "12.0". */
const floatStr = (v: unknown): string => (typeof v === 'number' ? pyFloatRepr(v) : pyStr(v))

/** Kaster præcis der, hvor Jinja-renderingen ville kaste (se fmt2). */
export function validateRecipeRender(ingredients: any[], snapshot: Record<string, any> | null): void {
  for (const ing of ingredients) if (pyTruthy(ing.matched_product)) fmt2(ing.matched_product.price)
  if (snapshot && pyTruthy(snapshot.cheapest_total_price)) fmt2(snapshot.cheapest_total_price)
}

function NotFound() {
  return (
    <>
      <h1 className="category-title">Opskriften blev ikke fundet</h1>
      <p><a href="/">Til forsiden</a></p>
    </>
  )
}

function Ingredient({ ing }: { ing: any }) {
  const mp = ing.matched_product
  const matched = pyTruthy(mp)
  return (
    <li className={`recipe-ingredient${matched ? '' : ' recipe-ingredient--unmatched'}`}
      data-ingredient-id={pyStr(ing.id)}
      {...(matched ? { 'data-overlay-id': `product${pyStr(mp.id)}`, style: { cursor: 'pointer' } } : {})}>
      {matched
        ? <img {...imgSrc(pyStr(mp.image))} alt="" className="recipe-ingredient-thumb" loading="lazy" />
        : <span className="recipe-ingredient-thumb recipe-ingredient-thumb--empty"></span>}
      <div className="recipe-ingredient-body">
        <span className="recipe-ingredient-text recipe-ingredient-qty-text">{pyStr(ing.raw_text)}</span>
        {matched ? (
          <span className="recipe-ingredient-match recipe-ingredient-match-text">
            {`(${pyStr(mp.unit_measure)} ${pyStr(mp.name)} · ${fmt2(mp.price)} kr) `}
            {pyTruthy(mp.is_sale) && <span className="recipe-ingredient-sale-tag">Tilbud</span>}
          </span>
        ) : (
          <span className="recipe-ingredient-nomatch">Ikke fundet i prissammenligningen</span>
        )}
      </div>
    </li>
  )
}

function Nutrition({ recipe }: { recipe: Record<string, any> }) {
  const src = recipe.nutrition_source
  if (pyTruthy(src)) {
    return (
      <section className="recipe-section">
        <h2>Næringsindhold</h2>
        <div className="recipe-nutrition-box">
          <div className="recipe-nutrition-row">
            {pyTruthy(src.calories) && <span><strong>{pyStr(src.calories)}</strong>{' energi'}</span>}
            {pyTruthy(src.protein) && <span><strong>{pyStr(src.protein)}</strong>{' protein'}</span>}
            {pyTruthy(src.fat) && <span><strong>{pyStr(src.fat)}</strong>{' fedt'}</span>}
            {pyTruthy(src.carbohydrate) && <span><strong>{pyStr(src.carbohydrate)}</strong>{' kulhydrat'}</span>}
          </div>
          <p className="recipe-nutrition-note">
            {`Ifølge kilden${pyTruthy(src.serving_size) ? `, pr. ${pyStr(src.serving_size)}` : ''}.`}
          </p>
        </div>
      </section>
    )
  }
  const est = recipe.nutrition_estimate
  if (!pyTruthy(est)) return null
  return (
    <section className="recipe-section">
      <h2>Næringsindhold</h2>
      <div className="recipe-nutrition-box" id="recipeNutritionBox"
        data-base-kcal={floatStr(est.kcal)} data-base-protein={floatStr(est.protein)}
        data-base-fedt={floatStr(est.fedt)} data-base-kulhydrat={floatStr(est.kulhydrat)}>
        <div className="recipe-nutrition-row">
          <span><strong id="recipeNutritionKcal">{floatStr(est.kcal)}</strong>{' kcal'}</span>
          <span><strong id="recipeNutritionProtein">{floatStr(est.protein)}</strong>{' g protein'}</span>
          <span><strong id="recipeNutritionFedt">{floatStr(est.fedt)}</strong>{' g fedt'}</span>
          <span><strong id="recipeNutritionKulhydrat">{floatStr(est.kulhydrat)}</strong>{' g kulhydrat'}</span>
        </div>
        <p className="recipe-nutrition-note">
          {`Estimat for hele opskriften, baseret på ${pyStr(est.contributing_ingredient_count)} af ${pyStr(est.total_ingredient_count)} ingredienser - kan afvige fra det faktiske indhold, er mest tænkt som et udgangspunkt.`}
        </p>
      </div>
    </section>
  )
}

function RecipeBody({ recipe, ingredients, snapshot }: { recipe: Record<string, any>; ingredients: any[]; snapshot: Record<string, any> | null }) {
  const servings = pyStr(or(recipe.servings, 4))
  const snap = snapshot
  return (
    <>
      <div className="recipe-hero">
        {pyTruthy(recipe.image_url) && (
          <div className="recipe-hero-image-wrap">
            <img src={pyStr(recipe.image_url)} alt={pyStr(recipe.title)} className="recipe-hero-image" loading="lazy" />
          </div>
        )}
        <div className="recipe-hero-info">
          <h1 className="recipe-title">{pyStr(recipe.title)}</h1>
          <div className="recipe-pills">
            <div className="recipe-pill recipe-servings-stepper" id="recipeServingsStepper" data-base-servings={servings}>
              <button type="button" className="recipe-servings-btn" id="recipeServingsMinus" aria-label="Færre personer">−</button>
              <span><span id="recipeServingsValue">{servings}</span>{' personer'}</span>
              <button type="button" className="recipe-servings-btn" id="recipeServingsPlus" aria-label="Flere personer">+</button>
            </div>
            {pyTruthy(recipe.total_time_minutes) && <span className="recipe-pill">{`${pyStr(recipe.total_time_minutes)} min`}</span>}
            {pyTruthy(snap) && pyTruthy(snap!.ingredients_on_sale_count) && (
              <span className="recipe-pill recipe-pill--sale">{`${pyStr(snap!.ingredients_on_sale_count)} ingredienser på tilbud`}</span>
            )}
          </div>
          {(pyTruthy(recipe.source_name) || pyTruthy(recipe.source_url)) && (
            <div className="recipe-source">
              {pyTruthy(recipe.source_url) ? (
                <>
                  {'Opskrift fra '}
                  <a href={pyStr(recipe.source_url)} rel="nofollow noopener" target="_blank">{pyStr(or(recipe.source_name, recipe.source_url))}</a>
                </>
              ) : (
                `Opskrift fra ${pyStr(recipe.source_name)}`
              )}
            </div>
          )}
          <div className="recipe-cta-card">
            <div className="recipe-cta-price">
              {pyTruthy(snap) && pyTruthy(snap!.cheapest_total_price) ? (
                <>
                  <span className="recipe-cta-amount" id="recipeCtaAmount">{`${fmt2(snap!.cheapest_total_price)} kr`}</span>
                  <span className="recipe-cta-label">for hele opskriften, billigste butik pr. vare</span>
                </>
              ) : (
                <span className="recipe-cta-label">Prisen kunne ikke beregnes endnu</span>
              )}
            </div>
            {pyTruthy(snap) && (
              <div className="recipe-cta-match">
                {`${pyStr(snap!.matched_ingredient_count)} af ${pyStr(snap!.total_ingredient_count)} ingredienser fundet i vores prissammenligning`}
              </div>
            )}
            <button type="button" className="recipe-add-all-btn" id="recipeAddAllBtn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="9" cy="21" r="1" />
                <circle cx="20" cy="21" r="1" />
                <path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6" />
              </svg>
              {' Læg fundne varer i kurv '}
            </button>
          </div>
        </div>
      </div>

      <section className="recipe-section">
        <h2>Ingredienser</h2>
        <ul className="recipe-ingredient-list" id="recipeIngredientList">
          {ingredients.map((ing, i) => <Ingredient key={i} ing={ing} />)}
        </ul>
      </section>

      {/* Skjulte, fuldt udstyrede produktkort - datakilde til openOverlay(). */}
      <div style={{ display: 'none' }} aria-hidden="true">
        {ingredients.map((ing, i) => pyTruthy(ing.matched_product) && (
          <Fragment key={i}>
            <ProductCard product={ing.matched_product.card} />
            {(ing.candidates ?? []).map((c: any, j: number) => c.id !== ing.matched_product.id && <ProductCard key={j} product={c.card} />)}
          </Fragment>
        ))}
      </div>

      <Nutrition recipe={recipe} />

      {pyTruthy(recipe.instructions) ? (
        <section className="recipe-section">
          <h2>Fremgangsmåde</h2>
          <ol className="recipe-instructions">
            {(recipe.instructions as unknown[]).map((step, i) => (
              <li key={i}><span className="recipe-step-number">{i + 1}</span><span>{pyStr(step)}</span></li>
            ))}
          </ol>
        </section>
      ) : pyTruthy(recipe.source_url) ? (
        <section className="recipe-section">
          <h2>Fremgangsmåde</h2>
          <p><a href={pyStr(recipe.source_url)} rel="nofollow noopener" target="_blank">{`Se hele fremgangsmåden hos ${pyStr(or(recipe.source_name, 'kilden'))} →`}</a></p>
        </section>
      ) : null}
    </>
  )
}

export function RecipePage({ site, req, recipe, ingredients = [], snapshot = null }: RecipePageProps) {
  const title = `${recipe ? pyStr(recipe.title) : 'Opskrift ikke fundet'} - MadShopper`
  return (
    <Layout site={site} req={req} title={title}>
      <div className="page-wrap">
        <div className="container-category recipe-page">
          {recipe ? <RecipeBody recipe={recipe} ingredients={ingredients} snapshot={snapshot} /> : <NotFound />}
        </div>
      </div>
      {recipe && (
        <>
          <script type="application/json" id="recipe-ingredients-data" dangerouslySetInnerHTML={{ __html: tojson(ingredients) }} />
          <script dangerouslySetInnerHTML={{ __html: SCRIPT_PRE + pyStr(recipe.id) + SCRIPT_POST }} />
        </>
      )}
    </Layout>
  )
}
