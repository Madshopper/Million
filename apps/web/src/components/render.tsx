// SSR uden hydrering: renderToString + omdøbning af inline-handlere (se jinja.ts).
import type { ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { restoreRawAttrs } from './jinja'

/** Fuld side (Layout renderer selv <html>). */
export function renderPage(el: ReactElement): string {
  return '<!DOCTYPE html>' + restoreRawAttrs(renderToString(el))
}

/** XHR-fragment (fx partials/product_grid.html). */
export function renderFragment(el: ReactElement): string {
  return restoreRawAttrs(renderToString(el))
}
