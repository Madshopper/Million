// app_support.nutrition_candidate_keys (+ sname_key / salling_sname_key).
import { createHash } from 'node:crypto'
import type { RawProduct } from './types'
import { normalizeName } from './support'

const SALLING_LABEL_TO_KEY: Record<string, string> = { Bilka: 'bilka', Netto: 'netto', Føtex: 'foetex' }

function validEan(value: unknown): string | null {
  const s = String(value || '').trim()
  return /^\d+$/.test(s) && [8, 12, 13, 14].includes(s.length) ? s : null
}

function snameKey(storeKey: string, name: unknown): string | null {
  const norm = normalizeName(name)
  if (!norm) return null
  return `sname:${storeKey}:${createHash('md5').update(norm, 'utf8').digest('hex').slice(0, 12)}`
}

export function nutritionCandidateKeys(product: RawProduct): string[] {
  const keys: string[] = []
  if (Number(product['/product/rema_price'] || 0) > 0) keys.push(`rema:${product['/product/id']}`)
  const own = validEan(product['/product/ean'])
  const matches = Object.values(product['/product/store_matches'] || {}) as any[]
  for (const ean of [...(own ? [own] : []), ...matches.map((m) => validEan((m || {}).ean))]) {
    if (ean && !keys.includes(`ean:${ean}`)) keys.push(`ean:${ean}`)
  }
  const storeKey = SALLING_LABEL_TO_KEY[product['/product/store'] || '']
  if (storeKey) {
    const k = snameKey(storeKey, product['/product/title'] || product['/product/name'])
    if (k) keys.push(k)
  }
  return keys
}
