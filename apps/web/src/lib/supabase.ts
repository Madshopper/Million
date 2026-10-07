// app.py::_supabase_rest - kun læsninger med den offentlige nøgle.
import { env } from 'cloudflare:workers'

export function tableSuffix(): string {
  return env.TABLE_SUFFIX ?? ''
}

export async function supabaseGet<T = unknown>(path: string, params: Record<string, string>): Promise<[T | null, number]> {
  const base = (env.SUPABASE_URL || '').replace(/\/$/, '')
  const key = env.SUPABASE_KEY || ''
  if (!base || !key) return [null, 0]
  try {
    const res = await fetch(`${base}/rest/v1/${path}?${new URLSearchParams(params)}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    const text = await res.text()
    let data: T | null = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = null
    }
    return [data, res.status]
  } catch (e) {
    console.warn('Supabase REST fejlede', path, e)
    return [null, 0]
  }
}
