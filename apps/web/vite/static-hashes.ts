// Indholds-hash pr. fil i static/ som virtuelt modul - svarer til
// app.py::_static_cache_bust + scripts/build-static-hashes.py. Templates skriver
// aldrig ?v= selv; staticUrl() i src/lib/static.ts slår op her.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import type { Plugin } from 'vite'

const ID = 'virtual:static-hashes'
const STATIC_DIR = resolve(__dirname, '../../../static')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

export function staticHashes(): Plugin {
  return {
    name: 'madshopper-static-hashes',
    resolveId(id) {
      return id === ID ? '\0' + ID : undefined
    },
    load(id) {
      if (id !== '\0' + ID) return
      const map: Record<string, string> = {}
      for (const file of walk(STATIC_DIR)) {
        const rel = relative(STATIC_DIR, file).split('\\').join('/')
        if (rel.startsWith('fonts/')) continue
        map[rel] = createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 10)
      }
      return `export default ${JSON.stringify(map)}`
    },
  }
}
