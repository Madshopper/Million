// Port af templates/opskrifter.html. Siden er en tom skal; opskrifterne
// hentes af det inline-script fra /api/recipes og søges client-side.
import type { RequestInfo, SiteContext } from '../context'
import { Layout } from '../Layout'

export interface RecipesPageProps {
  site: SiteContext
  req: RequestInfo
}

const SCRIPT = "\n  document.addEventListener('DOMContentLoaded', function () {\n    const grid = document.getElementById('recipesGrid');\n    const emptyState = document.getElementById('recipesEmptyState');\n    const input = document.getElementById('recipeSearchInput');\n    // Bevidst SIN EGEN søgning - genbruger ikke #searchInput/performSearch\n    // (script.js), som søger produkter. Denne søger kun i den allerede\n    // hentede opskrift-liste (client-side substring-match), ikke omvendt.\n    let allRecipes = [];\n\n    // Escaper ogsaa anfoerselstegn - vaerdierne bruges i src/alt-attributter.\n    // Se kommentaren ved escapeHtml i static/js/script.js.\n    function escapeHtml(s) {\n      return String(s == null ? '' : s)\n        .replace(/&/g, '&amp;')\n        .replace(/</g, '&lt;')\n        .replace(/>/g, '&gt;')\n        .replace(/\"/g, '&quot;')\n        .replace(/'/g, '&#39;');\n    }\n\n    function renderRecipeCard(r) {\n      const saleBadge = r.sale_ratio > 0\n        ? '<span class=\"sale-badge\">' + Math.floor(r.sale_ratio * 100) + '% på tilbud</span>'\n        : '';\n      const priceHtml = r.cheapest_total_price\n        ? '<div class=\"price-main price\">~' + r.cheapest_total_price.toFixed(2) + ' kr</div>'\n        : '<div class=\"price-main price\">Pris ukendt</div>';\n      const matchHtml = r.total_ingredient_count\n        ? '<div class=\"product-weight\">' + r.matched_ingredient_count + '/' + r.total_ingredient_count + ' ingredienser fundet</div>'\n        : '';\n      return '<a href=\"/opskrift/' + r.id + '\" class=\"recipe-card\" id=\"recipe' + r.id + '\">' +\n        '<div class=\"product-image-container\">' + saleBadge +\n        '<img src=\"' + escapeHtml(r.image_url || '') + '\" alt=\"' + escapeHtml(r.title) + '\" class=\"product-image\" loading=\"lazy\"></div>' +\n        '<div class=\"product-content\"><h3>' + escapeHtml(r.title) + '</h3>' + matchHtml + '</div>' +\n        '<div class=\"product-footer\"><div class=\"product-price\">' + priceHtml + '</div></div></a>';\n    }\n\n    function render(list) {\n      grid.innerHTML = list.map(renderRecipeCard).join('');\n      // Nulstil teksten: en tidligere fejlbesked må ikke blive hængende som\n      // svar på en søgning uden hits.\n      emptyState.textContent = 'Ingen opskrifter matcher din søgning.';\n      emptyState.style.display = list.length === 0 ? 'block' : 'none';\n    }\n\n    function applySearch() {\n      const q = input.value.trim().toLowerCase();\n      if (!q) { render(allRecipes); return; }\n      render(allRecipes.filter(function (r) { return (r.title || '').toLowerCase().includes(q); }));\n    }\n\n    // Ét ekstra forsøg ved fejl. Cloudflares Python-runtime kan afvise en\n    // request FØR appen kører (samme klasse som 1101/GIL-fejlen beskrevet i\n    // CLAUDE.md), og siden henter sit indhold i et separat kald efter selve\n    // HTML'en - så et enkelt uheld gav en permanent tom side, indtil brugeren\n    // selv genindlæste. Serveren svarer nu 503 (ikke 200) ved backend-fejl,\n    // så et mislykket forsøg hverken caches i kanten eller forveksles med\n    // \"der findes ingen opskrifter\".\n    function loadRecipes(attemptsLeft) {\n      fetch('/api/recipes')\n        .then(function (r) {\n          if (!r.ok) throw new Error('HTTP ' + r.status);\n          return r.json();\n        })\n        .then(function (data) {\n          allRecipes = (data && data.recipes) || [];\n          render(allRecipes);\n        })\n        .catch(function () {\n          if (attemptsLeft > 0) {\n            setTimeout(function () { loadRecipes(attemptsLeft - 1); }, 600);\n            return;\n          }\n          allRecipes = [];\n          grid.innerHTML = '';\n          emptyState.textContent = 'Kunne ikke hente opskrifter lige nu. Prøv at genindlæse siden.';\n          emptyState.style.display = 'block';\n        });\n    }\n\n    loadRecipes(1);\n\n    input.addEventListener('input', applySearch);\n  });\n"

export function RecipesPage({ site, req }: RecipesPageProps) {
  return (
    <Layout site={site} req={req} title={'Opskrifter - MadShopper'}>
      <div className="page-wrap">
        <div className="container-category">
          <h1 className="category-title">Opskrifter</h1>
          <div className="recipe-search-bar">
            <span className="recipe-search-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </span>
            <input type="text" id="recipeSearchInput" placeholder="Søg efter opskrifter..." autoComplete="off" />
          </div>
          <div className="products" id="recipesGrid"></div>
          <p id="recipesEmptyState" className="recipes-empty-state" style={{ display: 'none' }}>Ingen opskrifter matcher din søgning.</p>
        </div>
      </div>
      <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />
    </Layout>
  )
}
