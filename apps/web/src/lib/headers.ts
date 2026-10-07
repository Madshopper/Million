// Sikkerheds- og cache-headers - port af app.py::_SECURITY_HEADERS, _CSP og
// _set_response_headers. Samme regler: degraderede svar må aldrig i den delte
// cache, AJAX-fragmenter heller ikke, og cookie-personlige svar er private.
export const IMG_HOSTS = [
  'https://rema-product-images.digital.rema1000.dk',
  'https://digitalassets.sallinggroup.com',
  'https://dagrofa-dam.s3.eu-central-1.amazonaws.com',
  'https://image-transformer-api.tjek.com',
  'https://imgproxy-retcat.assets.schwarz',
  'https://www.lidl.dk',
  'https://image.prod.iposeninfra.com',
  'https://nxtumbraco.azurewebsites.net',
  'https://images.arla.com',
].join(' ')

export function csp(isEdge: boolean): string {
  return (
    "default-src 'self'; " +
    "base-uri 'self'; " +
    "object-src 'none'; " +
    "frame-ancestors 'self'; " +
    "form-action 'self'; " +
    "script-src 'self' 'unsafe-inline' https://accounts.google.com " +
    'https://challenges.cloudflare.com https://appleid.cdn-apple.com ' +
    'https://static.cloudflareinsights.com; ' +
    "style-src 'self' 'unsafe-inline' https://accounts.google.com; " +
    "font-src 'self' data:; " +
    `img-src 'self' data: ${IMG_HOSTS} https://accounts.google.com https://lh3.googleusercontent.com; ` +
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co " +
    'https://accounts.google.com ' +
    'https://challenges.cloudflare.com https://appleid.apple.com ' +
    'https://verify.madshopper.dk ' +
    'https://cloudflareinsights.com; ' +
    'frame-src https://accounts.google.com https://challenges.cloudflare.com https://appleid.apple.com; ' +
    "manifest-src 'self'" +
    (isEdge ? '; upgrade-insecure-requests' : '')
  )
}

export function securityHeaders(isEdge: boolean): Record<string, string> {
  const h: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), interest-cohort=()',
    'Content-Security-Policy': csp(isEdge),
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    'X-Permitted-Cross-Domain-Policies': 'none',
  }
  if (isEdge) h['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
  return h
}

export const EDGE_CACHE_SECONDS = 86400
const JSON_BROWSER_CACHE_SECONDS = 300

export const CACHEABLE_ENDPOINTS = new Set([
  'home', 'category', 'ugens_tilbud', 'search_page', 'search',
  'autocomplete', 'get_stores', 'get_separate_products', 'get_product_info',
  'terms_of_service', 'privacy_policy', 'about', 'feedback_page',
  'api_home', 'api_category', 'api_sale', 'api_search',
  'get_price_history', 'get_nutrition',
])
const STORE_DEPENDENT_ENDPOINTS = new Set([
  'home', 'category', 'ugens_tilbud', 'search_page', 'search', 'autocomplete',
  'api_home', 'api_category', 'api_sale', 'api_search',
])
const CACHEABLE_JSON_ENDPOINTS = new Set([
  'get_stores', 'get_separate_products', 'get_product_info',
  'get_price_history', 'get_nutrition',
  'api_home', 'api_category', 'api_sale', 'api_search', 'autocomplete',
])

export function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie') || ''
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return null
}

/** app.py::_set_response_headers. Muterer response.headers. */
export function applyResponseHeaders(
  request: Request, url: URL, response: Response,
  endpoint: string | null, degraded: string | null, isEdge: boolean,
): Response {
  const h = response.headers
  for (const [k, v] of Object.entries(securityHeaders(isEdge))) if (!h.has(k)) h.set(k, v)
  if (degraded) {
    h.set('X-Data-Degraded', '1')
    h.set('X-Data-Degraded-Reason', degraded.slice(0, 60))
  }
  const cacheable = request.method === 'GET' && response.status === 200 && !!endpoint && CACHEABLE_ENDPOINTS.has(endpoint)
  if (!cacheable) return response
  if (degraded) {
    h.set('Cache-Control', 'no-store')
    h.delete('CDN-Cache-Control')
    h.delete('Cloudflare-CDN-Cache-Control')
  } else if (request.headers.get('X-Requested-With') === 'XMLHttpRequest') {
    h.set('Cache-Control', 'no-store')
  } else if (STORE_DEPENDENT_ENDPOINTS.has(endpoint!) && url.searchParams.get('stores') === null && getCookie(request, 'madshopper_stores')) {
    h.set('Cache-Control', 'private, no-store')
  } else {
    h.set('Cache-Control', CACHEABLE_JSON_ENDPOINTS.has(endpoint!) ? `private, max-age=${JSON_BROWSER_CACHE_SECONDS}` : 'no-store')
    const cdn = `public, max-age=${EDGE_CACHE_SECONDS}`
    h.set('CDN-Cache-Control', cdn)
    h.set('Cloudflare-CDN-Cache-Control', cdn)
  }
  return response
}
