#!/usr/bin/env python3
"""Hver var app.py læser fra edge-env'et (_EDGE_ENV_VARS) skal være deklareret
i Env-klassen i src/worker.py. EdgeKit udleverer kun deklarerede navne, så en
manglende linje giver ingen fejl - værdien er bare usynlig for appen. Sket
03-10-2026: CF_ANALYTICS_TOKEN lå på workeren, men admin sagde "ikke sat op".
Ren tekstanalyse, kræver ingen afhængigheder."""
import ast
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def edge_env_vars() -> list[str]:
    tree = ast.parse((ROOT / "app.py").read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id == "_EDGE_ENV_VARS" for t in node.targets):
            return [e.value for e in node.value.elts]
    sys.exit("FEJL: fandt ikke _EDGE_ENV_VARS i app.py")


def declared_env() -> set[str]:
    tree = ast.parse((ROOT / "src" / "worker.py").read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == "Env":
            return {s.target.id for s in node.body
                    if isinstance(s, ast.AnnAssign) and isinstance(s.target, ast.Name)}
    sys.exit("FEJL: fandt ikke class Env i src/worker.py")


missing = [n for n in edge_env_vars() if n not in declared_env()]
if missing:
    print("FEJL: mangler i Env (src/worker.py): " + ", ".join(missing))
    sys.exit(1)
print("ALLE TESTS BESTAAET")
