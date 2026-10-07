"""Fixtures til test/parity/admin.test.ts: admin + session fra app.py og
staging-signaturerne fra src/worker.py, kørt direkte i Python.

Kør fra repo-roden:  python3 apps/web/test/parity/gen_admin_fixtures.py

Intet netværk: Supabase (rpc/is_admin), Cloudflare GraphQL og KV erstattes af
falske objekter, så kun appens egen logik måles. Skriver
apps/web/test/parity/fixtures/admin.json.
"""
import ast
import json
import os
import sys
from datetime import datetime as _real_datetime, timezone
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent / 'fixtures' / 'admin.json'
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)
# Rate limiteren må ikke afvise fixture-kørslen.
os.environ['API_RATE_LIMIT_PER_MIN'] = '1000000'
os.environ.pop('SUPABASE_URL', None)
os.environ.pop('SUPABASE_KEY', None)

import app  # noqa: E402

NOW = 1791369600  # 2026-10-07T08:00:00Z
NOW_DT = _real_datetime.fromtimestamp(NOW, tz=timezone.utc).replace(tzinfo=None)


class FixedDatetime(_real_datetime):
    @classmethod
    def utcnow(cls):
        return NOW_DT

    @classmethod
    def now(cls, tz=None):
        return NOW_DT.replace(tzinfo=timezone.utc).astimezone(tz) if tz else NOW_DT


def worker_funcs():
    """_staging_link_sig/_staging_session_token fra src/worker.py uden at
    importere workeren (den kræver edgekit-runtimen)."""
    src = (ROOT / 'src' / 'worker.py').read_text()
    tree = ast.parse(src)
    ns: dict = {}
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name in ('_staging_link_sig', '_staging_session_token'):
            exec(compile(ast.Module([node], []), 'worker.py', 'exec'), ns)
    return ns['_staging_link_sig'], ns['_staging_session_token']


def b64(obj) -> str:
    import base64
    raw = obj if isinstance(obj, bytes) else json.dumps(obj).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip('=')


def jwt(payload) -> str:
    return f'{b64({"alg": "HS256"})}.{b64(payload)}.c2lnbmF0dXJlLXNpZ25hdHVyZQ'


def main():
    link_sig, session_token = worker_funcs()
    secrets = ['s3cret', 'en meget længere hemmelighed æøå', 'x' * 100, '']
    exps = [0, 1700000000, NOW + 120, 9999999999]
    sigs = [{'secret': s, 'exp': e, 'app': app.staging_link_sig(s, e), 'worker': link_sig(s, e)}
            for s in secrets for e in exps]
    tokens = [{'secret': s, 'token': session_token(s)} for s in secrets]

    jwts = [
        jwt({'exp': NOW + 3600, 'sub': 'u'}),
        jwt({'exp': NOW + 999999}),
        jwt({'exp': NOW - 5}),
        jwt({'exp': str(NOW + 60)}),
        jwt({'exp': NOW + 60.9}),
        jwt({'exp': True}),
        jwt({'exp': None}),
        jwt({'exp': 0}),
        jwt({'sub': 'ingen exp'}),
        jwt([1, 2, 3]),
        jwt({'exp': 'abc'}),
        f'{b64(b"x")}.{b64(b"not json")}.sig',
        'a.b.c',
        'a.bbbbb.c',
        'kun-en-del',
        jwt({'exp': NOW + 100, 'navn': 'Søren'}),
    ]
    jwt_exp = [{'token': t, 'exp': app._jwt_exp(t)} for t in jwts]

    client = app.app.test_client()
    session_cases = []
    good = jwt({'exp': NOW + 3600})
    long_lived = jwt({'exp': NOW + 999999})
    header_sets = [
        {},
        {'Authorization': f'Bearer {good}'},
        {'Authorization': f'Bearer {long_lived}'},
        {'Authorization': f'Bearer {jwt({"exp": NOW - 5})}'},
        {'Authorization': 'Bearer kort'},
        {'Authorization': f'bearer {good}'},
        {'Authorization': f'Bearer {good}', 'Origin': 'http://localhost'},
        {'Authorization': f'Bearer {good}', 'Origin': 'https://evil.example'},
        {'Authorization': f'Bearer {good}', 'Origin': 'null'},
        {'Authorization': 'Bearer ' + 'a' * 30},
    ]
    with mock.patch('time.time', return_value=float(NOW)):
        for headers in header_sets:
            r = client.post('/api/session', headers=headers, base_url='http://localhost')
            cookies = r.headers.getlist('Set-Cookie')
            session_cases.append({
                'headers': headers,
                'status': r.status_code,
                'cache_control': r.headers.get('Cache-Control'),
                # Expires regnes af Werkzeug ud fra sit eget ur - testes for sig.
                'set_cookie': ['; '.join(p for p in c.split('; ') if not p.startswith('Expires='))
                               for c in cookies],
                'body': r.get_data(as_text=True),
            })

    # --- 404 for ikke-admins ------------------------------------------------
    not_found = client.get('/findes-ikke-som-sti/med/flere/dele')
    admin_routes = ['/api/admin/traffic', '/api/admin/edge', '/api/admin/products',
                    '/api/admin/features', '/api/admin/staging-link']
    denied = []
    for is_admin_answer in (None, False):
        def fake_rest(method, path, **kw):
            assert path == 'rpc/is_admin' and method == 'POST' and kw.get('json_body') == {}
            return (is_admin_answer, 200) if is_admin_answer is not None else (None, 401)
        with mock.patch.object(app, '_supabase_rest', side_effect=fake_rest):
            for route in admin_routes:
                for method in ('GET', 'POST'):
                    for auth in (None, f'Bearer {good}'):
                        h = {'Authorization': auth} if auth else {}
                        r = client.open(route, method=method, headers=h)
                        denied.append({'route': route, 'method': method, 'auth': bool(auth),
                                       'status': r.status_code, 'body': r.get_data(as_text=True)})
            r = client.get('/admin', headers={'Cookie': f'ms_session={good}'})
            denied.append({'route': '/admin', 'method': 'GET', 'auth': True, 'status': r.status_code})

    # --- Admin-svar ---------------------------------------------------------
    def admin_rest(method, path, **kw):
        return True, 200

    traffic_acc = {
        'days': [{'count': 120, 'sum': {'visits': 80}, 'dimensions': {'date': '2026-10-01'}},
                 {'count': '7', 'sum': {}, 'dimensions': {}},
                 {'count': None, 'dimensions': None}],
        'pages': [{'count': 50, 'dimensions': {'requestPath': '/'}}, {'count': 3, 'dimensions': {'requestPath': None}}],
        'countries': [{'count': 9, 'dimensions': {'countryName': 'DK'}}],
        'devices': [],
        'referers': None,
        'browsers': [{'count': 2.0, 'dimensions': {'userAgentBrowser': 'Chrome'}}],
        'vitals': [{'count': 33, 'quantiles': {'largestContentfulPaintP75': 1250500,
                                                'interactionToNextPaintP75': 2500,
                                                'cumulativeLayoutShiftP75': 0.05}}],
        'worker': [
            {'sum': {'requests': 1000, 'errors': 3}, 'quantiles': {'cpuTimeP50': 12250, 'cpuTimeP99': 250350},
             'dimensions': {'status': 'success'}},
            {'sum': {'requests': 5, 'errors': 5}, 'quantiles': {}, 'dimensions': {'status': 'exceededCpu'}},
            {'sum': {'requests': 2}, 'dimensions': {}},
        ],
    }
    traffic_acc_2 = {'vitals': [], 'worker': [{'sum': {'requests': 1}, 'quantiles': {'cpuTimeP50': 50, 'cpuTimeP99': None},
                                               'dimensions': {'status': 'success'}}]}
    traffic_acc_3 = {'vitals': [{'count': 1, 'quantiles': {'largestContentfulPaintP75': -1,
                                                            'interactionToNextPaintP75': 500,
                                                            'cumulativeLayoutShiftP75': -1}}]}
    traffic = []
    for acc in (traffic_acc, traffic_acc_2, traffic_acc_3):
        calls = []

        def fake_graphql(query, variables, _acc=acc, _calls=calls):
            _calls.append({'query': query, 'variables': variables})
            return _acc, None
        with mock.patch.object(app, 'datetime', FixedDatetime), \
                mock.patch.object(app, '_cf_graphql', side_effect=fake_graphql):
            traffic.append({'acc': acc, 'out': app._admin_traffic(), 'call': calls[0]})
    with mock.patch.object(app, '_edge_var', return_value=None):
        traffic_not_configured = app._admin_traffic()

    groups = [{'sum': {'rowsWritten': 1200, 'rowsRead': 50000}, 'dimensions': {'databaseId': 'abc'}},
              {'sum': {'rowsWritten': None, 'rowsRead': '17'}, 'dimensions': {}},
              {'sum': None, 'dimensions': {'databaseId': None}}]
    budget_calls = []

    class FakeResp:
        status_code = 200

        def json(self):
            return {'data': {'viewer': {'accounts': [{'d1AnalyticsAdaptiveGroups': groups}]}}}

    def fake_post(url, headers=None, content=None, timeout=None):
        budget_calls.append({'url': url, 'body': json.loads(content), 'auth': headers['Authorization']})
        return FakeResp()

    import httpx
    with mock.patch.object(app, 'datetime', FixedDatetime), \
            mock.patch.object(app, '_edge_var', side_effect=lambda n: {'CF_ANALYTICS_TOKEN': 'tok', 'CLOUDFLARE_ACCOUNT_ID': 'acct'}.get(n)), \
            mock.patch.object(httpx, 'post', side_effect=fake_post):
        d1_budget = app._admin_d1_budget()

    # Feature-panelet: en række skridt mod en falsk KV, med skrivning slået til.
    class FakeKv:
        def __init__(self):
            self.data = {}

        def get_text(self, key):
            return self.data.get(key)

        def put(self, key, value):
            self.data[key] = value

    kv = FakeKv()
    kv.data['features_v1'] = json.dumps({'stats': {'on': True, 'at': '2026-10-01T00:00:00+00:00'},
                                         'gammel': {'on': True}})
    steps = [
        {}, {'key': 'recipes', 'on': True}, {'key': 'recipes', 'on': 'ja'},
        {'key': 'findes-ikke', 'on': True}, {'key': 'push', 'permanent': True},
        {'key': 'stats', 'permanent': True}, {'key': 'stats', 'on': False},
        {'key': 'app_store', 'done': True}, {'key': 'app_store'}, {'key': 'tests', 'done': True},
        {'key': 5, 'on': True}, {'key': None}, {'key': 'recipes', 'on': False},
    ]
    feature_steps = []
    envs = {'RECIPES_ENABLED': '1', 'PUSH_ENABLED': '0'}
    with mock.patch.object(app, '_supabase_rest', side_effect=admin_rest), \
            mock.patch.object(app, 'datetime', FixedDatetime), \
            mock.patch.dict(os.environ, envs), \
            mock.patch.object(app, '_features_editable', return_value=True), \
            mock.patch.object(app, '_edge_kv', return_value=kv), \
            mock.patch.object(app, '_sync_bridge_call', side_effect=lambda x: x):
        initial = dict(kv.data)
        for body in steps:
            r = client.post('/api/admin/features', json=body, headers={'Authorization': f'Bearer {good}'})
            feature_steps.append({'body': body, 'status': r.status_code,
                                  'json': r.get_json(silent=True), 'text': None if r.is_json else r.get_data(as_text=True),
                                  'kv': {k: json.loads(v) for k, v in kv.data.items()}})
    # Ikke redigerbar (staging/lokalt): kun visning, ændringer giver 409.
    readonly = []
    with mock.patch.object(app, '_supabase_rest', side_effect=admin_rest), \
            mock.patch.dict(os.environ, envs):
        for body in ({}, {'key': 'recipes', 'on': True}, {'key': 'app_store', 'done': True}, {'key': 'app_store'}):
            r = client.post('/api/admin/features', json=body, headers={'Authorization': f'Bearer {good}'})
            readonly.append({'body': body, 'status': r.status_code, 'json': r.get_json(silent=True)})

    # Staging-link.
    staging = []
    with mock.patch.object(app, '_supabase_rest', side_effect=admin_rest), \
            mock.patch('time.time', return_value=float(NOW)):
        for secret in (None, 'prod-secret'):
            with mock.patch.object(app, '_edge_var', side_effect=lambda n, s=secret: s if n == 'STAGING_LINK_SECRET' else None):
                for body in ({}, {'path': '/admin'}, {'path': '/evil'}, {'path': ['/']}):
                    r = client.post('/api/admin/staging-link', json=body, headers={'Authorization': f'Bearer {good}'})
                    staging.append({'secret': secret, 'body': body, 'status': r.status_code, 'json': r.get_json()})

    # Produkt-id'er: hvad sendes videre til opslaget.
    product_ids = []
    for body in ({'ids': ['1', 2, '1', True, 1.5, None, 'x' * 80, ['n']]}, {'ids': 'nej'}, [], {'ids': [str(i) for i in range(400)]}):
        seen = []
        with mock.patch.object(app, '_supabase_rest', side_effect=admin_rest), \
                mock.patch.object(app, 'load_products_by_ids', side_effect=lambda ids, s=seen: s.extend(ids) or []):
            r = client.post('/api/admin/products', data=json.dumps(body), headers={'Authorization': f'Bearer {good}'})
        product_ids.append({'body': body, 'ids': seen, 'status': r.status_code})

    # Selve panelet (templates/admin.html) med og uden Feature 'stats'.
    import flask
    pages = []
    orig_enabled = app._feature_enabled
    for stats_on in (False, True):
        app._feature_enabled = (lambda key, *a, _on=stats_on, **kw: _on and key == 'stats')
        try:
            with app.app.test_request_context('/admin'):
                site = app._inject_site_meta()
                pages.append({'stats': stats_on, 'site_context': site, 'html': flask.render_template('admin.html')})
        finally:
            app._feature_enabled = orig_enabled

    OUT.write_text(json.dumps({
        'admin_pages': pages,
        'now': NOW,
        'sigs': sigs,
        'session_tokens': tokens,
        'jwt_exp': jwt_exp,
        'session': session_cases,
        'not_found': {'status': not_found.status_code, 'body': not_found.get_data(as_text=True)},
        'denied': denied,
        'traffic': traffic,
        'traffic_not_configured': traffic_not_configured,
        'd1_budget': {'groups': groups, 'out': d1_budget, 'call': budget_calls[0]},
        'features_initial_kv': initial,
        'features_env': envs,
        'features': feature_steps,
        'features_readonly': readonly,
        'staging': staging,
        'product_ids': product_ids,
    }, ensure_ascii=False, indent=1))
    print(f'skrev {OUT}')


if __name__ == '__main__':
    main()
