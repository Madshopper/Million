// Kører Python-funktioner direkte (fra src/worker.py / app_support.py) til
// paritetstests. Springes over hvis python3 ikke findes.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))

export const hasPython = (() => {
  try {
    execFileSync('python3', ['-c', 'import sys'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

/** Kør et Python-script; det skal printe ét JSON-dokument på stdout. */
export function py<T = any>(script: string, input: unknown = null): T {
  const out = execFileSync('python3', ['-c', script], {
    cwd: REPO_ROOT,
    input: JSON.stringify(input),
    env: { ...process.env, PYTHONPATH: REPO_ROOT },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  return JSON.parse(out)
}

/** Henter navngivne top-level-funktioner fra src/worker.py uden at importere
 * modulet (det kræver edgekit/Pyodide) - funktionernes egen kildekode
 * eksekveres. */
export const WORKER_FUNCS = `
import ast, json, sys
_src = open('src/worker.py', encoding='utf-8').read()
_tree = ast.parse(_src)
_ns = {}
def load_worker_funcs(*names):
    mod = ast.Module(body=[n for n in _tree.body if isinstance(n, ast.FunctionDef) and n.name in names], type_ignores=[])
    exec(compile(mod, 'src/worker.py', 'exec'), _ns)
    return _ns
`

/** Kører app.py's rigtige Flask-ruter via test_client med Supabase,
 * Turnstile og feature-flag udskiftet (ingen netværk). Hvert tilfælde:
 * {path, body, contentType, supa: [status, data], verify, stats}. */
export const FLASK_HARNESS = `
import json, os, sys
os.environ.pop('CLOUDFLARE_WORKERS', None)
os.environ['TABLE_SUFFIX'] = '_dev'
import logging; logging.disable(logging.CRITICAL)
import app as A, app_support as S
out = []
for case in json.load(sys.stdin):
    calls = []
    def fake_rest(method, path, params=None, json_body=None, prefer=None, timeout=15.0, auth_token=None, _c=case):
        calls.append({'method': method, 'path': path, 'body': json_body, 'prefer': prefer, 'timeout': timeout})
        st, data = _c.get('supa', [204, None])
        return data, st
    A._supabase_rest = fake_rest
    A._supabase_available = lambda _c=case: _c.get('available', True)
    A._feature_enabled = lambda k, _c=case: bool(_c.get('stats')) if k == 'stats' else False
    A._verify_turnstile_token = lambda t, _c=case: bool(t) and _c.get('verify', True)
    S.api_limiter._hits.clear(); S.cart_event_limiter._hits.clear()
    c = A.app.test_client()
    r = c.post(case['path'], data=case['body'].encode('utf-8'), headers={'Content-Type': case.get('contentType', 'application/json')})
    out.append({'status': r.status_code, 'json': r.get_json(silent=True), 'calls': calls})
print(json.dumps(out))
`
