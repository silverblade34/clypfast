"""Local reusable music backgrounds: original geometric scenes and user images/GIFs."""
from __future__ import annotations

import json
import re
import uuid
import threading
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from fastapi import HTTPException

LIBRARY = Path(__file__).resolve().parent.parent / "outputs" / "music_library"
LIBRARY_LOCK = threading.RLock()
THEMES = {
    "nostalgia": ("Atardecer · recuerdos", (61, 30, 65), (225, 137, 105)),
    "soledad": ("Luna · soledad", (7, 17, 35), (40, 65, 85)),
    "desamor": ("Horizonte · desamor", (36, 15, 43), (132, 69, 91)),
    "superacion": ("Amanecer · empezar de nuevo", (22, 40, 62), (229, 176, 110)),
    "calma": ("Montañas · calma", (17, 43, 54), (74, 120, 124)),
    "noche": ("Ciudad · madrugada", (10, 9, 30), (52, 32, 73)),
}


def _initialize_library():
    LIBRARY.mkdir(parents=True, exist_ok=True)
    for theme, (title, top, bottom) in THEMES.items():
        path = LIBRARY / f"scene-{theme}.png"
        if not path.exists():
            # Repo-native geometric artwork, rendered locally; no external downloads.
            w, h = 540, 960
            t = np.linspace(0, 1, h)[:, None, None]
            gradient = (np.array(top)[None, None, :] * (1-t) + np.array(bottom)[None, None, :] * t)
            image = Image.fromarray(np.repeat(gradient.astype(np.uint8), w, axis=1))
            draw = ImageDraw.Draw(image)
            rng = np.random.default_rng(42)
            if theme in {"soledad", "noche", "desamor"}:
                for x, y in rng.integers([10, 10], [530, 450], size=(65, 2)):
                    draw.ellipse((int(x), int(y), int(x)+1, int(y)+1), fill=(125, 145, 163))
                draw.ellipse((355, 165, 425, 235), fill=(211, 218, 218))
                draw.ellipse((335, 151, 405, 221), fill=tuple(np.array(image)[175, 360]))
            else:
                draw.ellipse((185, 360, 355, 530), fill=(244, 189, 141))
            for y, color in [(580, (27, 41, 58)), (665, (17, 30, 45)), (790, (9, 21, 34))]:
                draw.polygon([(0,y+50),(85,y-65),(170,y+5),(290,y-100),(410,y+10),(540,y-45),(540,960),(0,960)], fill=color)
            if theme == "noche":
                for x in range(0, 540, 48):
                    height = int(rng.integers(140, 320))
                    draw.rectangle((x, 960-height, x+37, 960), fill=(8, 13, 26))
                    for yy in range(970-height, 950, 23):
                        if rng.random() > .3:
                            draw.rectangle((x+9, yy, x+13, yy+6), fill=(152, 130, 107))
            temp = path.with_suffix('.tmp.png')
            image.save(temp)
            temp.replace(path)
    gif = LIBRARY / "scene-rain.gif"
    if not gif.exists():
        base = Image.open(LIBRARY / "scene-noche.png").convert("RGB")
        frames = []
        for frame in range(12):
            image = base.copy()
            draw = ImageDraw.Draw(image)
            for i in range(80):
                x = (i*137) % 560 - 10
                y = (i*91 + frame*26) % 1000 - 20
                draw.line((x, y, x-6, y+25), fill=(85, 95, 132), width=1)
            frames.append(image)
        temp = gif.with_suffix('.tmp.gif')
        frames[0].save(temp, save_all=True, append_images=frames[1:], duration=80, loop=0)
        temp.replace(gif)


def ensure_library():
    with LIBRARY_LOCK:
        _initialize_library()


def list_assets():
    ensure_library()
    assets = [{"id": f"scene-{theme}", "title": title, "theme": theme, "kind": "image", "filename": f"scene-{theme}.png", "origin": "Ilustración integrada"}
              for theme, (title, _, _) in THEMES.items()]
    assets.append({"id": "scene-rain", "title": "Lluvia · ciudad nocturna", "theme": "noche", "kind": "gif", "filename": "scene-rain.gif", "origin": "Animación integrada"})
    for path in sorted(LIBRARY.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        assets.append(json.loads(path.read_text()))
    return assets


def asset_by_id(asset_id: str):
    if not re.fullmatch(r"scene-[a-z]+|[a-f0-9]{32}", asset_id):
        raise HTTPException(404, "Fondo no encontrado")
    asset = next((item for item in list_assets() if item["id"] == asset_id), None)
    if not asset:
        raise HTTPException(404, "Fondo no encontrado")
    return asset, LIBRARY / asset["filename"]


def import_asset(payload: bytes, title: str, theme: str):
    if not payload or len(payload) > 20 * 1024 * 1024:
        raise HTTPException(413, "El archivo debe tener entre 1 byte y 20 MB.")
    ensure_library()
    asset_id = uuid.uuid4().hex
    temp = LIBRARY / f"{asset_id}.upload"
    temp.write_bytes(payload)
    try:
        # Decode images with Pillow first, rejecting videos, SVGs and mismatched extensions.
        with Image.open(temp) as image:
            if image.format not in {"PNG", "JPEG", "WEBP", "GIF"} or image.width * image.height > 20_000_000:
                raise ValueError("Formato o dimensiones no admitidos")
            kind = "gif" if getattr(image, "is_animated", False) else "image"
            if kind == "gif" and image.format != "GIF":
                raise ValueError("Para animaciones utiliza GIF")
            if kind == "gif" and getattr(image, "n_frames", 1) > 600:
                raise ValueError("El GIF debe tener como máximo 600 cuadros")
            image.verify()
        destination = LIBRARY / f"{asset_id}.{'gif' if kind == 'gif' else 'png'}"
        if kind == "gif":
            temp.replace(destination)
        else:
            with Image.open(temp) as image:
                from PIL import ImageOps
                image = ImageOps.exif_transpose(image).convert("RGB")
                image.thumbnail((2160, 3840))
                image.save(destination, "PNG")
        asset = {"id": asset_id, "title": title.strip()[:100] or "Mi fondo", "theme": theme if theme in THEMES else "nostalgia",
                 "kind": kind, "filename": destination.name, "origin": "Tu biblioteca"}
        metadata = LIBRARY / f"{asset_id}.tmp"
        metadata.write_text(json.dumps(asset, ensure_ascii=False))
        metadata.replace(LIBRARY / f"{asset_id}.json")
        return asset
    except (ValueError, OSError, Image.DecompressionBombError) as exc:
        raise HTTPException(422, "Sube una imagen JPG, PNG, WebP o un GIF válido, de hasta 20 megapíxeles.") from exc
    finally:
        temp.unlink(missing_ok=True)
