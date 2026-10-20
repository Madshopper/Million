/**
 * Tjekker at et køb virkelig kommer fra Apple (StoreKit 2 / App Store Server
 * Notifications V2). Begge dele er en JWS: header.payload.signatur, hvor
 * headeren har x5c = [blad, mellemled, rod]. Vi kræver at roden er præcis
 * Apples "Apple Root CA - G3" (fingeraftryk nedenfor), at hvert led er
 * underskrevet af det næste, og at bladet har underskrevet selve beskeden.
 * Samme fremgangsmåde som Apples eget app-store-server-library.
 */
import * as x509 from 'npm:@peculiar/x509@1.14.3';

// SHA-256 af https://www.apple.com/certificateauthority/AppleRootCA-G3.cer
// (tjekket 09-10-2026).
export const APPLE_ROOT_G3_SHA256 =
  '63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179';

// Apples egne mærker i certifikaterne: mellemleddet (WWDR) og bladet
// (underskriver af App Store-kvitteringer).
const OID_INTERMEDIATE = '1.2.840.113635.100.6.2.1';
const OID_LEAF = '1.2.840.113635.100.6.11.1';

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hasExtension(cert: x509.X509Certificate, oid: string): boolean {
  return cert.extensions.some((e) => e.type === oid);
}

function inDate(cert: x509.X509Certificate, now: Date): boolean {
  return cert.notBefore <= now && now <= cert.notAfter;
}

/**
 * Returnerer payloaden, hvis beskeden er underskrevet af Apple, ellers kastes
 * en fejl. rootSha256 kan kun skiftes i testen.
 */
export async function verifyAppleJws(
  jws: string,
  rootSha256: string = APPLE_ROOT_G3_SHA256,
  now: Date = new Date(),
): Promise<Record<string, unknown>> {
  const parts = typeof jws === 'string' ? jws.split('.') : [];
  if (parts.length !== 3) throw new Error('not a jws');
  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
  if (header.alg !== 'ES256' || !Array.isArray(header.x5c) || header.x5c.length !== 3) {
    throw new Error('bad header');
  }
  const [leaf, mid, root] = header.x5c.map(
    (c: string) => new x509.X509Certificate(Uint8Array.from(atob(c), (ch) => ch.charCodeAt(0))),
  );

  const rootHash = hex(await crypto.subtle.digest('SHA-256', root.rawData));
  if (rootHash !== rootSha256) throw new Error('unknown root');
  if (!hasExtension(mid, OID_INTERMEDIATE) || !hasExtension(leaf, OID_LEAF)) {
    throw new Error('not an apple chain');
  }
  for (const c of [leaf, mid, root]) {
    if (!inDate(c, now)) throw new Error('certificate expired');
  }
  if (!(await mid.verify({ publicKey: root.publicKey, signatureOnly: true }))) {
    throw new Error('bad intermediate');
  }
  if (!(await leaf.verify({ publicKey: mid.publicKey, signatureOnly: true }))) {
    throw new Error('bad leaf');
  }

  // JWS' ES256-signatur er r||s, præcis det WebCrypto forventer.
  const key = await crypto.subtle.importKey(
    'spki', leaf.publicKey.rawData, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'],
  );
  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    b64urlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!ok) throw new Error('bad signature');
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
}
