#!/usr/bin/env bash
# Kører wrangler, men skjuler værdierne af hemmelige vars i outputtet.
#
# `wrangler deploy` / `versions upload` udskriver en tabel over alle bindings,
# og [vars] vises med de første ~37 tegn af værdien - også dem, der kommer fra
# GitHub-secrets (CACHE_REFRESH_SECRET, CF_ANALYTICS_TOKEN,
# STAGING_ACCESS_SECRET; Python Workers ser kun [vars], se build-pages.sh).
# GitHub maskerer kun hele værdien, ikke en afkortet begyndelse, så
# begyndelsen stod i klar tekst i kørselsloggen (opdaget 09-10-2026).
#
# Brug (fra dist/):  bash ../scripts/wrangler-redacted.sh deploy
set -o pipefail
npx --yes wrangler@4.114.0 "$@" 2>&1 \
  | sed -E 's/([A-Z0-9_]*(SECRET|TOKEN|PASSWORD|PRIVATE)[A-Z0-9_]*) \("[^"]*"\)/\1 ("***")/g'
