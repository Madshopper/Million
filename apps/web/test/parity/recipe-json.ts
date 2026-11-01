// Opskrift-siden har ingrediens-data som én JSON-blok ({{ ingredients|tojson }}).
// JS kan ikke skelne 600.0 fra 600 efter JSON.parse, så porten skriver
// heltals-floats uden ".0" - samme værdi for browseren. Sammenligningerne
// normaliserer derfor blokken til kanonisk JSON (sorterede nøgler) først.
const BLOCK_RE = /(<script type="application\/json" id="recipe-ingredients-data">)([\s\S]*?)(<\/script>)/

export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']'
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson((v as any)[k])).join(',') + '}'
  }
  return JSON.stringify(v)
}

export function canonicalizeRecipeJson(html: string): string {
  return html.replace(BLOCK_RE, (_, open: string, body: string, close: string) => {
    // Python kan skrive NaN/Infinity (json.dumps tillader dem) - ikke JSON.
    const parsed = JSON.parse(body.replace(/\bNaN\b/g, 'null').replace(/-?\bInfinity\b/g, 'null'))
    // Kanonisk form uden < > & (de ville ellers ændre HTML-parsningen).
    return open + canonicalJson(parsed).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026') + close
  })
}
