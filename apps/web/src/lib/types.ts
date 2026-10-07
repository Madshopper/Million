// Fælles typer for PoC'en. Rå produkter er JSON-blobs fra D1's data-kolonne
// (scripts/seed-d1.py::slim_product) med nøgler som '/product/title'.
export type RawProduct = Record<string, any>

// Svarer 1:1 til app_support.product_to_display_dict - samme nøgler, samme
// betydning, så skabelonerne kan porteres felt for felt.
export interface DisplayProduct {
  id: string
  name: string
  price: number
  sale_price: number | null
  description: string
  category: string
  brand: string
  image_url: string
  rema_image: any
  is_sale: boolean
  is_any_sale: any
  sale_end_date: string | null
  store: string
  unit_measure: string
  weight_g: number | null
  stk_count: number | null
  price_per_kg: any
  store_matches: Record<string, any>
  cheaper_at: any
  cheapest_at: any
  rema_price: any
  rema_is_sale: any
  multi_deal: any
  lowest_price_30d: any
  subcategory: string
  is_organic: boolean
  is_lactose_free: boolean
  _flavor_field?: string
  _norm_fields?: [string, string, string]
}

/** request.args-ækvivalent: læses fra URL'ens query. */
export type Args = URLSearchParams

/** None = alle butikker (ingen valg), ellers sættet af valgte butiks-labels. */
export type ActiveStores = Set<string> | null
