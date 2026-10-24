import hashes from 'virtual:static-hashes'

/** url_for('static', filename=...) - med ?v=<indholds-hash> som app.py::_static_cache_bust. */
export function staticUrl(filename: string): string {
  const v = filename.startsWith('fonts/') ? undefined : hashes[filename]
  return v ? `/static/${filename}?v=${v}` : `/static/${filename}`
}
