import { setEndpoint } from './request-state'

/** flask.jsonify - sætter også endpoint-navnet, som cache-headerne afhænger af. */
export function json(endpoint: string, body: unknown, status = 200): Response {
  setEndpoint(endpoint)
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export function text(endpoint: string, body: string, contentType: string, status = 200): Response {
  setEndpoint(endpoint)
  return new Response(body, { status, headers: { 'Content-Type': contentType } })
}
