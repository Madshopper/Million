import { createFileRoute } from '@tanstack/react-router'
import { abortResponse, sessionResponse } from '~/lib/admin'

// POST /api/session (app.py::api_session): spejler browserens Supabase-
// access-token til HttpOnly-cookien ms_session, så serveren kan se hvem der er
// logget ind på sider der kræver det (i dag kun /admin). Uden gyldig Bearer
// slettes cookien (log ud). GET svarer 405 som Flask.
export const Route = createFileRoute('/api/session')({
  server: {
    handlers: {
      POST: async ({ request }) => sessionResponse(request),
      GET: async () => abortResponse('api_session', 405, 'OPTIONS, POST'),
    },
  },
})
