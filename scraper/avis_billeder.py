"""
Varebilleder klippet ud af butikkernes egne aviser (Løvbjerg-PDF'en,
ABC Lavpris' avis-billeder), gemt i Supabase Storage-bucket'en avis-billeder
(scripts/supabase-avis-billeder.sql) med én mappe pr. butik.

Kun ugens madtilbud gemmes. Filnavnet er billedets indholds-hash, så samme
billede uge efter uge ikke lægges op igen, og billeder ingen vare har brugt i
IMAGE_KEEP_DAYS dage slettes.
"""
import hashlib
import io
import os
from datetime import datetime, timedelta, timezone

import imagehash
from PIL import Image

from supabase_utils import get_client

BUCKET = "avis-billeder"
IMAGE_KEEP_DAYS = 14


def _jpeg(im: Image.Image) -> bytes:
    im = im.copy()
    im.thumbnail((400, 400))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=82, optimize=True)
    return buf.getvalue()


def _image_url(prefix: str, name: str) -> str:
    base = (os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL") or "").rstrip("/")
    return f"{base}/storage/v1/object/public/{BUCKET}/{prefix}/{name}"


def _list_stored_images(bucket, prefix: str) -> dict:
    return {o["name"]: o for o in bucket.list(prefix, {"limit": 1000})}


def store_images(pairs: list[tuple[dict, Image.Image]], prefix: str) -> None:
    """Læg ugens varebilleder op og sæt billede_url/billede_hash på rækkerne.
    Fejler lageret (fx før bucket'en er oprettet), vises varerne med butikkens
    logo som før - scraperen fejler ikke af den grund."""
    if not pairs:
        return
    try:
        bucket = get_client().storage.from_(BUCKET)
        existing = _list_stored_images(bucket, prefix)
    except Exception as e:
        print(f"  ⚠ Billedlager utilgængeligt ({e}) - varerne vises uden billeder")
        return
    uploaded = 0
    for row, im in pairs:
        data = _jpeg(im)
        name = hashlib.sha1(data).hexdigest()[:20] + ".jpg"
        if name not in existing:
            try:
                bucket.upload(f"{prefix}/{name}", data, {"content-type": "image/jpeg"})
                existing[name] = {}
                uploaded += 1
            except Exception as e:
                print(f"  ⚠ Kunne ikke gemme billede til {row['navn']}: {e}")
                continue
        row["billede_url"] = _image_url(prefix, name)
        row["billede_hash"] = str(imagehash.phash(im))
    print(f"  Billeder: {len(pairs)} varer, {uploaded} nye gemt")


def cleanup_images(rows: list[dict], prefix: str) -> None:
    """Slet billeder, som ingen vare bruger, når de er over IMAGE_KEEP_DAYS gamle.
    Ventetiden gør, at gårsdagens produkt-cache (som nattens updater først
    bygger om senere) aldrig peger på et slettet billede."""
    try:
        bucket = get_client().storage.from_(BUCKET)
        existing = _list_stored_images(bucket, prefix)
    except Exception as e:
        print(f"  ⚠ Kunne ikke rydde gamle billeder: {e}")
        return
    in_use = {r["billede_url"].rsplit("/", 1)[-1] for r in rows if r.get("billede_url")}
    cutoff = datetime.now(timezone.utc) - timedelta(days=IMAGE_KEEP_DAYS)
    stale = []
    for name, meta in existing.items():
        created = meta.get("created_at") or ""
        try:
            old = datetime.fromisoformat(created.replace("Z", "+00:00")) < cutoff
        except ValueError:
            old = False
        if name not in in_use and old:
            stale.append(f"{prefix}/{name}")
    if stale:
        bucket.remove(stale)
        print(f"  Slettede {len(stale)} gamle billeder")
