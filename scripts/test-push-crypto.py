"""Tjekker push_notify.py's Web Push-kryptering og VAPID-signatur.

Spiller browserens rolle: laver et nøglepar som en browser ville, krypterer
en besked til det med push_notify.encrypt_web_push og dekrypterer den igen
efter RFC 8291. Tjekker også at VAPID-JWT'et kan verificeres med den
offentlige nøgle. Kræver ingen netværk.

    python scripts/test-push-crypto.py
"""
from __future__ import annotations

import base64
import json
import os
import struct
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from cryptography.hazmat.primitives import hashes, serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ec  # noqa: E402
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature  # noqa: E402
from cryptography.hazmat.primitives.ciphers.aead import AESGCM  # noqa: E402

import push_notify as pn  # noqa: E402


def _decrypt(body: bytes, ua_private, ua_public: bytes, auth_secret: bytes) -> bytes:
    salt = body[:16]
    rs, idlen = struct.unpack("!IB", body[16:21])
    assert rs == 4096, rs
    as_public = body[21:21 + idlen]
    ciphertext = body[21 + idlen:]
    as_key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), as_public)
    ecdh = ua_private.exchange(ec.ECDH(), as_key)
    prk_key = pn._hkdf_extract(auth_secret, ecdh)
    ikm = pn._hkdf_expand(prk_key, b"WebPush: info\x00" + ua_public + as_public, 32)
    prk = pn._hkdf_extract(salt, ikm)
    cek = pn._hkdf_expand(prk, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = pn._hkdf_expand(prk, b"Content-Encoding: nonce\x00", 12)
    plain = AESGCM(cek).decrypt(nonce, ciphertext, None)
    assert plain.endswith(b"\x02"), "mangler slut-markering"
    return plain[:-1]


def main() -> int:
    ua_private = ec.generate_private_key(ec.SECP256R1())
    ua_public = ua_private.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    auth_secret = os.urandom(16)
    msg = pn.price_alert_message("Arla Minimælk 1 l", 9.0, 8.5)
    payload = json.dumps(msg, ensure_ascii=False).encode()

    body = pn.encrypt_web_push(payload, pn._b64url(ua_public), pn._b64url(auth_secret))
    got = _decrypt(body, ua_private, ua_public, auth_secret)
    assert got == payload, "dekrypteret besked er ikke den samme"
    assert json.loads(got)["title"] == "Prisalarm"

    # Det officielle testeksempel fra RFC 8291, bilag A: med samme faste
    # nøgle og salt skal resultatet være byte for byte det samme.
    from unittest import mock
    asp = ec.derive_private_key(int.from_bytes(pn._b64url_decode(
        "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"), "big"), ec.SECP256R1())
    with mock.patch.object(ec, "generate_private_key", return_value=asp), \
            mock.patch.object(os, "urandom", return_value=pn._b64url_decode("DGv6ra1nlYgDCS1FRnbzlw")):
        rfc = pn.encrypt_web_push(
            b"When I grow up, I want to be a watermelon",
            "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
            "BTBZMqHH6r4Tts7J_aSIgg")
    assert pn._b64url(rfc) == (
        "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYL"
        "ocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouB"
        "WLVWGNWQexSgSxsj_Qulcy4a-fN"), "afviger fra RFC 8291's testeksempel"

    # VAPID: signér med en testnøgle og verificér med dens offentlige halvdel.
    vk = ec.generate_private_key(ec.SECP256R1())
    priv = pn._b64url(vk.private_numbers().private_value.to_bytes(32, "big"))
    header = pn._vapid_auth("https://fcm.googleapis.com/fcm/send/abc", priv)
    token = header.split("t=", 1)[1].split(",", 1)[0]
    head, claims, sig = token.split(".")
    raw = pn._b64url_decode(sig)
    der = encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big"))
    vk.public_key().verify(der, f"{head}.{claims}".encode(), ec.ECDSA(hashes.SHA256()))
    c = json.loads(base64.urlsafe_b64decode(claims + "=" * (-len(claims) % 4)))
    assert c["aud"] == "https://fcm.googleapis.com", c
    assert c["sub"].startswith("mailto:")

    # Den offentlige nøgle i koden skal være et gyldigt P-256-punkt.
    ec.EllipticCurvePublicKey.from_encoded_point(
        ec.SECP256R1(), pn._b64url_decode(pn.VAPID_PUBLIC_KEY))
    # app.py lægger den offentlige nøgle i siden - den skal være den samme.
    import re
    app_src = open(os.path.join(os.path.dirname(__file__), "..", "app.py"), encoding="utf-8").read()
    m = re.search(r'^_VAPID_PUBLIC_KEY = "([^"]+)"', app_src, re.M)
    assert m and m.group(1) == pn.VAPID_PUBLIC_KEY, "app.py og push_notify.py har forskellig nøgle"
    print("OK: Web Push-kryptering og VAPID-signatur virker")
    return 0


if __name__ == "__main__":
    sys.exit(main())
