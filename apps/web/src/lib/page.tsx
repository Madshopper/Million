// Fælles hjælpere til side-ruterne.
import type { ReactElement } from 'react'
import { makeRequestInfo, type RequestInfo } from '~/components/context'
import { renderFragment } from '~/components/render'
import { reqState, setEndpoint } from './request-state'

export function req(endpoint: string, viewArgs: Record<string, string> = {}): RequestInfo {
  return makeRequestInfo(reqState().url, endpoint, viewArgs)
}

export const isXhr = (request: Request) => request.headers.get('X-Requested-With') === 'XMLHttpRequest'

export function htmlResponse(endpoint: string, el: ReactElement, status = 200): Response {
  setEndpoint(endpoint)
  return new Response(renderFragment(el), { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

export function redirect301(location: string): Response {
  return new Response(null, { status: 301, headers: { Location: location } })
}
