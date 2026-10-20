/**
 * Adgang til opskrifterne (docs/abonnement.md). To veje ind, begge med en
 * besked underskrevet af Apple:
 *
 * 1. Appen, lige efter et køb eller "Gendan køb": POST med brugerens
 *    Supabase-token i Authorization og { "transaction": "<JWS>" }.
 *    Købet skal være lavet af samme konto (appAccountToken = konto-id).
 * 2. Apple selv (App Store Server Notifications V2): POST { "signedPayload" }
 *    ved fornyelse, opsigelse og refusion, så adgangen på hjemmesiden følger
 *    med, selvom appen ikke bliver åbnet.
 *
 * Skriver kun i recipe_access (scripts/supabase-recipe-access.sql) med
 * service-nøglen, som Supabase selv giver funktionen. Deployes med
 * --no-verify-jwt, fordi Apple ikke sender et Supabase-token; vej 1 tjekker
 * selv tokenen.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.75.0';
import { verifyAppleJws } from './apple.ts';

// Skal stå præcis sådan i App Store Connect (apps/mobile/src/recipes/access.ts).
const PRODUCT_ID = 'dk.madshopper.opskrifter.maaned';
const BUNDLE_IDS = new Set(['dk.madshopper.app', 'dk.madshopper.app.test']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

type Tx = {
  originalTransactionId?: string;
  bundleId?: string;
  productId?: string;
  expiresDate?: number;
  revocationDate?: number;
  appAccountToken?: string;
  environment?: string;
};

/** Gemmer købet på kontoen. Returnerer adgangens udløb, eller en fejltekst. */
async function apply(tx: Tx, userId: string): Promise<{ expires?: string; error?: string; status?: number }> {
  if (!tx.originalTransactionId || !BUNDLE_IDS.has(tx.bundleId ?? '') || tx.productId !== PRODUCT_ID) {
    return { error: 'wrong product', status: 400 };
  }
  // Refunderet eller trukket tilbage: adgangen stopper nu.
  const expiresMs = tx.revocationDate ? Date.now() : Number(tx.expiresDate ?? 0);
  const expires = new Date(expiresMs).toISOString();

  const { data: owner, error: readErr } = await admin
    .from('recipe_access')
    .select('user_id')
    .eq('original_transaction_id', tx.originalTransactionId)
    .maybeSingle();
  if (readErr) return { error: 'db', status: 503 };
  // Ét abonnement låser kun én konto op.
  if (owner && owner.user_id !== userId) return { error: 'other account', status: 409 };

  const { error } = await admin.from('recipe_access').upsert({
    user_id: userId,
    original_transaction_id: tx.originalTransactionId,
    product_id: tx.productId,
    environment: tx.environment ?? 'Production',
    expires_at: expires,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  // 23503: kontoen findes ikke (længere). Ingen grund til at prøve igen.
  if (error) return error.code === '23503' ? { error: 'no user', status: 404 } : { error: 'db', status: 503 };
  return { expires };
}

async function fromApp(req: Request, body: Record<string, unknown>) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '');
  const { data: auth } = await admin.auth.getUser(token);
  const user = auth?.user;
  if (!user) return json({ success: false, error: 'login' }, 401);
  let tx: Tx;
  try {
    tx = (await verifyAppleJws(String(body.transaction ?? ''))) as Tx;
  } catch {
    return json({ success: false, error: 'invalid' }, 400);
  }
  if ((tx.appAccountToken ?? '').toLowerCase() !== user.id.toLowerCase()) {
    return json({ success: false, error: 'other account' }, 409);
  }
  const r = await apply(tx, user.id);
  if (r.error) return json({ success: false, error: r.error }, r.status);
  return json({ success: true, expires_at: r.expires, access: Date.parse(r.expires!) > Date.now() });
}

async function fromApple(body: Record<string, unknown>) {
  let note: { data?: { signedTransactionInfo?: string } };
  let tx: Tx;
  try {
    note = (await verifyAppleJws(String(body.signedPayload ?? ''))) as typeof note;
    if (!note.data?.signedTransactionInfo) return json({ success: true }); // fx TEST
    tx = (await verifyAppleJws(note.data.signedTransactionInfo)) as Tx;
  } catch {
    return json({ success: false }, 400);
  }
  const userId = (tx.appAccountToken ?? '').toLowerCase();
  // Uden konto kan vi ikke vide hvem der skal have adgang. 200, så Apple
  // ikke bliver ved med at sende den.
  if (!UUID_RE.test(userId)) return json({ success: true });
  const r = await apply(tx, userId);
  // Fejl i databasen: 503, så Apple prøver igen senere.
  if (r.status === 503) return json({ success: false }, 503);
  return json({ success: true });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ success: false }, 405);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ success: false }, 400);
  }
  if (!body || typeof body !== 'object') return json({ success: false }, 400);
  if ('signedPayload' in body) return fromApple(body);
  return fromApp(req, body);
});
