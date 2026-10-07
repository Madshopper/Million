import { createFileRoute } from '@tanstack/react-router'
import { adminGate, adminJson, requestJson } from '~/lib/admin'
import { d1Products } from '~/lib/data'
import { pyStr } from '~/components/jinja'

// /api/admin/products (app.py::admin_products): navn, butik og billede til
// varestatistikken i /admin. Statistikken gemmer kun produkt-id'er; navnene
// slås op i kataloget (D1) ved visning. Varer der ikke længere findes i
// kataloget mangler i svaret. POST, kun admins, ellers 404.
const ADMIN_NAMES_MAX = 300
// D1 tillader højst 100 parametre pr. forespørgsel.
const CHUNK = 90

/** [str(i)[:64] for i in ids if isinstance(i, (str, int))], uden dubletter. */
export function adminProductIds(body: unknown): string[] {
  const ids = body && typeof body === 'object' && !Array.isArray(body) ? (body as { ids?: unknown }).ids : undefined
  if (!Array.isArray(ids)) return []
  const out: string[] = []
  for (const i of ids) {
    let s: string
    if (typeof i === 'string') s = i
    else if (typeof i === 'boolean') s = i ? 'True' : 'False' // bool er en int i Python
    else if (typeof i === 'number' && Number.isInteger(i)) s = pyStr(i)
    else continue
    out.push([...s].slice(0, 64).join(''))
  }
  return [...new Set(out)].slice(0, ADMIN_NAMES_MAX)
}

async function handle({ request }: { request: Request }) {
  const denied = await adminGate(request, 'admin_products')
  if (denied) return denied
  // get_json(silent=True, force=True): Content-Type er ligegyldig.
  const ids = adminProductIds(await requestJson(request, true)).filter((i) => i.trim())
  const out: Record<string, { title: string; store: string; image: string }> = {}
  try {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK)
      const found = await d1Products(`SELECT data FROM products WHERE id IN (${chunk.map(() => '?').join(',')})`, chunk)
      for (const p of found) {
        const pid = pyStr(p['/product/id'] ?? '')
        if (!pid) continue
        out[pid] = {
          title: pyStr(p['/product/title'] || ''),
          store: pyStr(p['/product/store'] || ''),
          image: pyStr(p['/product/imageLink'] || p['/product/rema_image'] || ''),
        }
      }
    }
  } catch (e) {
    console.warn('admin products lookup failed:', e)
  }
  return adminJson('admin_products', { success: true, products: out })
}

export const Route = createFileRoute('/api/admin/products')({
  server: { handlers: { GET: handle, POST: handle } },
})
