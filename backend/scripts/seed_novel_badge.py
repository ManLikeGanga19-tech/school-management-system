"""Dev-only: give the 'novel' tenant a real school badge so it shows up on the
Super-Admin tenant avatar (and the tenant login background). Draws a simple
circular crest and stores it through the app's own badge helper."""

import io
import sys

from PIL import Image, ImageDraw, ImageFont
from sqlalchemy import select

from app.core.database import SessionLocal
from app.models.tenant import Tenant
from app.api.v1.tenants.routes import _replace_tenant_badge_file

SLUG = "novel"
SLATE = (25, 40, 48)     # --admin-primary
GOLD = (212, 175, 55)    # --admin-gold
CREAM = (251, 243, 215)


def _font(size: int):
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ):
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()


def _make_badge(initials: str) -> bytes:
    size = 512
    scale = 4  # supersample for smooth edges
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Outer gold ring, inner slate disc.
    d.ellipse([0, 0, s, s], fill=GOLD)
    ring = int(18 * scale)
    d.ellipse([ring, ring, s - ring, s - ring], fill=SLATE)
    inner = int(40 * scale)
    d.ellipse([inner, inner, s - inner, s - inner], outline=GOLD, width=int(4 * scale))

    # Initials.
    font = _font(int(210 * scale))
    bbox = d.textbbox((0, 0), initials, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((s - tw) / 2 - bbox[0], (s - th) / 2 - bbox[1] - int(14 * scale)),
           initials, font=font, fill=CREAM)

    # Small motto band.
    band = _font(int(34 * scale))
    label = "ESTD"
    lb = d.textbbox((0, 0), label, font=band)
    d.text(((s - (lb[2] - lb[0])) / 2, s - int(150 * scale)), label, font=band, fill=GOLD)

    img = img.resize((size, size), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def main() -> None:
    db = SessionLocal()
    try:
        t = db.execute(select(Tenant).where(Tenant.slug == SLUG)).scalar_one_or_none()
        if t is None:
            print(f"[error] tenant '{SLUG}' not found"); sys.exit(1)
        initials = "".join(w[0] for w in t.name.split()[:2]).upper() or "NS"
        payload = _make_badge(initials)
        path = _replace_tenant_badge_file(tenant_id=t.id, extension="png", payload=payload)
        print(f"[done] badge written for {t.name} ({SLUG}) → {path} ({len(payload)} bytes)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
