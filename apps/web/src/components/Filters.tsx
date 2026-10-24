// Port af templates/partials/filters.html + filters_toggle_btn.html.
// Panelet ligger to gange pr. side (scope "search" i base, "page" på siden) -
// derfor ingen id'er; script.js finder felterne via data-filter-key.

export function FiltersToggleBtn() {
  return (
    <button className="advanced-filters-toggle">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
      </svg>
      {" Filtrering & Sortering "}
    </button>
  )
}

export function Filters({ scope = 'page' }: { scope?: 'page' | 'search' }) {
  return (
    <div className="advanced-filters" data-filter-scope={scope}>
      <div className="filter-group">
        <h4 className="filter-section-title">Sortering</h4>
        <select className="filter-select" data-filter-key="sort">
          <option value="relevance">Relevans</option>
          <option value="price-asc">Pris: Laveste først</option>
          <option value="price-desc">Pris: Højeste først</option>
          <option value="kg-price-asc">Kg-pris: Laveste først</option>
          <option value="name-asc">Navn: A-Å</option>
        </select>
      </div>
      <div className="filter-group">
        <h4 className="filter-section-title">Pris (kr)</h4>
        <div className="price-inputs">
          <input type="number" data-filter-key="min_price" placeholder="Min" min="0" className="filter-input" />
          <input type="number" data-filter-key="max_price" placeholder="Max" min="0" className="filter-input" />
        </div>
      </div>
      <div className="filter-group">
        <h4 className="filter-section-title">Egenskaber</h4>
        <div className="checkbox-grid">
          <label className="filter-checkbox-label">
            <input type="checkbox" data-filter-key="sale" />
            <span>Kun tilbud</span>
          </label>
          <label className="filter-checkbox-label">
            <input type="checkbox" data-filter-key="organic" />
            <span>Økologi</span>
          </label>
          <label className="filter-checkbox-label">
            <input type="checkbox" data-filter-key="lactose" />
            <span>Laktosefri</span>
          </label>
        </div>
      </div>
      <button type="button" className="filter-reset-btn">Nulstil alle filtre</button>
    </div>
  )
}
