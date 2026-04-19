"""Проверка наличия GPS в EXIF через Pillow и piexif."""

from __future__ import annotations

import io
from typing import Tuple

import piexif
from PIL import Image, ImageOps
from PIL.ExifTags import IFD


def _ratio_to_float(value: tuple | float | int) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    num, den = value
    return float(num) / float(den) if den else float(num)


def _dms_to_decimal(dms: tuple, ref: str) -> float:
    d, m, s = [_ratio_to_float(x) for x in dms]
    sign = -1 if ref in ("S", "W") else 1
    return sign * (d + m / 60.0 + s / 3600.0)


def extract_gps_pillow(data: bytes) -> tuple[float, float] | None:
    try:
        with Image.open(io.BytesIO(data)) as im:
            ImageOps.exif_transpose(im)
            exif = im.getexif()
            if not exif:
                return None
            try:
                gps_ifd = exif.get_ifd(IFD.GPS)
            except Exception:
                gps_ifd = exif.get_ifd(0x8825)
            if not gps_ifd:
                return None
            lat = gps_ifd.get(2)
            lat_ref = gps_ifd.get(1)
            lon = gps_ifd.get(4)
            lon_ref = gps_ifd.get(3)
            if not all([lat, lat_ref, lon, lon_ref]):
                return None
            return _dms_to_decimal(lat, lat_ref.decode()), _dms_to_decimal(lon, lon_ref.decode())
    except Exception:
        return None


def extract_gps_piexif(data: bytes) -> tuple[float, float] | None:
    try:
        exif_dict = piexif.load(data)
        gps = exif_dict.get("GPS")
        if not gps:
            return None
        lat = gps.get(piexif.GPSIFD.GPSLatitude)
        lat_ref = gps.get(piexif.GPSIFD.GPSLatitudeRef)
        lon = gps.get(piexif.GPSIFD.GPSLongitude)
        lon_ref = gps.get(piexif.GPSIFD.GPSLongitudeRef)
        if not all([lat, lat_ref, lon, lon_ref]):
            return None
        if isinstance(lat_ref, bytes):
            lat_ref = lat_ref.decode("ascii", errors="ignore")
        if isinstance(lon_ref, bytes):
            lon_ref = lon_ref.decode("ascii", errors="ignore")
        return _dms_to_decimal(lat, lat_ref), _dms_to_decimal(lon, lon_ref)
    except Exception:
        return None


def get_gps_coords(data: bytes) -> Tuple[bool, float | None, float | None]:
    """
    Возвращает (ok, lat, lon). Сначала Pillow, затем piexif.
    """
    for fn in (extract_gps_pillow, extract_gps_piexif):
        coords = fn(data)
        if coords:
            lat, lon = coords
            if -90 <= lat <= 90 and -180 <= lon <= 180:
                return True, lat, lon
    return False, None, None
