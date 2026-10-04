"""Beskeder på telefonen (push) til prisalarmer. Se docs/prisovervaagning.md.

To slags modtagere, begge gratis:
- 'expo': den native app. Sendes via Expos push-tjeneste, der selv videregiver
  til Apple (APNs) og Google (FCM).
- 'web':  hjemmesiden (standard Web Push med VAPID). Virker i Chrome, Edge,
  Firefox og Safari, på iPhone kun når siden er lagt på hjemmeskærmen.

Web Push-krypteringen (RFC 8291, aes128gcm) og VAPID-signaturen (RFC 8292)
laves her med `cryptography` i stedet for pywebpush: dens afhængighed
http-ece kunne ikke engang bygges i vores miljø, og det hele er få linjer.

Enhederne ligger i push_devices (scripts/supabase-push.sql) og læses med
service-nøglen af updater.py. En enhed der er væk (app slettet, tilladelse
trukket tilbage) svarer DeviceNotRegistered/404/410 og slettes bagefter.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import struct
import time
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
# Offentlig nøgle til Web Push. Står også i app.py (_VAPID_PUBLIC_KEY), som
# lægger den i siden. Den hemmelige halvdel er GitHub-secret VAPID_PRIVATE_KEY.
VAPID_PUBLIC_KEY = "BJ-6EyGJ8i36CgrtynD59AIkr57uidHCa7u_owJQMcPSi-js_xuZc3lqfEKZV9anQt8oqY6W8Dtau6VM7cvudQc"
VAPID_SUBJECT = "mailto:alarm@madshopper.dk"


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64url_decode(text: str) -> bytes:
    text = (text or "").strip()
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _hkdf_extract(salt: bytes, ikm: bytes) -> bytes:
    return hmac.new(salt, ikm, hashlib.sha256).digest()


def _hkdf_expand(prk: bytes, info: bytes, length: int) -> bytes:
    # Ét blok er nok: vi skal aldrig bruge mere end 32 byte.
    return hmac.new(prk, info + b"\x01", hashlib.sha256).digest()[:length]


def encrypt_web_push(payload: bytes, p256dh: str, auth: str) -> bytes:
    """Krypter en besked til én browser (RFC 8291, aes128gcm-format)."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    ua_public = _b64url_decode(p256dh)
    auth_secret = _b64url_decode(auth)
    ua_key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_public)

    as_private = ec.generate_private_key(ec.SECP256R1())
    as_public = as_private.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    ecdh_secret = as_private.exchange(ec.ECDH(), ua_key)

    prk_key = _hkdf_extract(auth_secret, ecdh_secret)
    ikm = _hkdf_expand(prk_key, b"WebPush: info\x00" + ua_public + as_public, 32)
    salt = os.urandom(16)
    prk = _hkdf_extract(salt, ikm)
    cek = _hkdf_expand(prk, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf_expand(prk, b"Content-Encoding: nonce\x00", 12)

    ciphertext = AESGCM(cek).encrypt(nonce, payload + b"\x02", None)
    header = salt + struct.pack("!IB", 4096, len(as_public)) + as_public
    return header + ciphertext


def _vapid_auth(endpoint: str, private_key_b64: str) -> str:
    """Authorization-headeren: et kort ES256-signeret JWT til push-tjenesten."""
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

    key = ec.derive_private_key(
        int.from_bytes(_b64url_decode(private_key_b64), "big"), ec.SECP256R1())
    u = urlparse(endpoint)
    head = _b64url(json.dumps({"typ": "JWT", "alg": "ES256"}, separators=(",", ":")).encode())
    claims = _b64url(json.dumps({
        "aud": f"{u.scheme}://{u.netloc}",
        "exp": int(time.time()) + 12 * 3600,
        "sub": VAPID_SUBJECT,
    }, separators=(",", ":")).encode())
    signing_input = f"{head}.{claims}".encode()
    r, s = decode_dss_signature(key.sign(signing_input, ec.ECDSA(hashes.SHA256())))
    sig = _b64url(r.to_bytes(32, "big") + s.to_bytes(32, "big"))
    return f"vapid t={head}.{claims}.{sig}, k={VAPID_PUBLIC_KEY}"


def _send_web(client, device: dict, message: dict, private_key: str) -> str:
    """'ok', 'gone' (slet enheden) eller 'error'."""
    endpoint = device.get("token") or ""
    if not endpoint.startswith("https://"):
        return "gone"
    body = encrypt_web_push(
        json.dumps(message, ensure_ascii=False).encode(),
        device.get("p256dh") or "", device.get("auth") or "")
    resp = client.post(endpoint, content=body, headers={
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        "TTL": str(3 * 24 * 3600),
        "Urgency": "normal",
        "Authorization": _vapid_auth(endpoint, private_key),
    })
    if resp.status_code in (404, 410):
        return "gone"
    if 200 <= resp.status_code < 300:
        return "ok"
    logger.warning("Web Push svarede %s fra %s", resp.status_code, urlparse(endpoint).netloc)
    return "error"


def _send_expo(client, devices: list[dict], message: dict) -> list[str]:
    """Ét samlet kald for alle app-enheder (Expo tager op til 100 ad gangen)."""
    out: list[str] = []
    for i in range(0, len(devices), 100):
        chunk = devices[i:i + 100]
        payload = [{
            "to": d.get("token"),
            "title": message["title"],
            "body": message["body"],
            "data": message.get("data") or {},
            "sound": "default",
        } for d in chunk]
        try:
            resp = client.post(EXPO_PUSH_URL, json=payload,
                               headers={"Accept": "application/json"})
            resp.raise_for_status()
            tickets = resp.json().get("data") or []
        except Exception as e:
            logger.warning("Expo push fejlede: %s", e)
            out.extend("error" for _ in chunk)
            continue
        for j in range(len(chunk)):
            t = tickets[j] if j < len(tickets) and isinstance(tickets[j], dict) else {}
            if t.get("status") == "ok":
                out.append("ok")
            elif (t.get("details") or {}).get("error") == "DeviceNotRegistered":
                out.append("gone")
            else:
                out.append("error")
    return out


def send_to_devices(devices: list[dict], message: dict) -> tuple[int, list]:
    """Send `message` ({title, body, data, url}) til en brugers enheder.

    Returnerer (antal leveret, id'er på enheder der er væk og skal slettes).
    Fejler aldrig højlydt: kalderen falder tilbage til mail ved 0 leveret.
    """
    import httpx

    private_key = os.getenv("VAPID_PRIVATE_KEY", "").strip()
    delivered = 0
    gone: list = []
    web = [d for d in devices if d.get("kind") == "web"]
    expo = [d for d in devices if d.get("kind") == "expo"]
    with httpx.Client(timeout=15.0) as client:
        if web and not private_key:
            logger.info("VAPID_PRIVATE_KEY ikke sat - springer beskeder til hjemmesiden over")
        for d in web if private_key else []:
            try:
                status = _send_web(client, d, message, private_key)
            except Exception as e:
                logger.warning("Web Push fejlede: %s", e)
                status = "error"
            delivered += status == "ok"
            if status == "gone":
                gone.append(d.get("id"))
        if expo:
            for d, status in zip(expo, _send_expo(client, expo, message)):
                delivered += status == "ok"
                if status == "gone":
                    gone.append(d.get("id"))
    return delivered, [g for g in gone if g is not None]


def price_alert_message(product_name: str, target_price: float, current_price: float) -> dict:
    name = (product_name or "Varen du overvåger").replace("\r", " ").replace("\n", " ")[:120]
    return {
        "title": "Prisalarm",
        "body": f"{name} koster nu {current_price:.2f} kr. Din grænse var {target_price:.2f} kr.",
        # Hjemmesiden åbner søgningen på varen; appen åbner Mine prisalarmer.
        "url": "/search/results?q=" + _quote(name[:80]),
        "data": {"type": "price_alert"},
    }


def _quote(text: str) -> str:
    from urllib.parse import quote
    return quote(text, safe="")
