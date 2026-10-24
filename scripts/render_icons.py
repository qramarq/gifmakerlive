"""Draw the GIF Maker Live app icons into web/icons."""
import math
import struct
import zlib
from pathlib import Path

BG = (0x14, 0x17, 0x17)
LIME = (0xC2, 0xF9, 0x70)
INK = (0x14, 0x20, 0x0F)


def sd_round_box(px, py, hx, hy, rad):
    qx = abs(px) - hx + rad
    qy = abs(py) - hy + rad
    return math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - rad


def in_triangle(px, py, a, b, c):
    def sign(p1, p2, p3):
        return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])
    d1, d2, d3 = sign((px, py), a, b), sign((px, py), b, c), sign((px, py), c, a)
    neg = d1 < 0 or d2 < 0 or d3 < 0
    pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (neg and pos)


def symbol(x, y):
    radius = math.hypot(x, y)
    angle = math.atan2(y, x)
    ring = 0.42 <= radius <= 0.74 and not (-0.45 <= angle <= 0.95)
    end = 0.95
    mid = 0.58
    ax, ay = math.cos(end) * mid, math.sin(end) * mid
    tx, ty = -math.sin(end), math.cos(end)
    nx, ny = math.cos(end), math.sin(end)
    tip = (ax + tx * 0.34, ay + ty * 0.34)
    left = (ax - tx * 0.08 - nx * 0.28, ay - ty * 0.08 - ny * 0.28)
    right = (ax - tx * 0.08 + nx * 0.28, ay - ty * 0.08 + ny * 0.28)
    return ring or in_triangle(x, y, tip, left, right)


def sample(u, v, maskable):
    du, dv = u - 0.5, v - 0.5
    if maskable:
        if math.hypot(du, dv) <= 0.30 and symbol(du / 0.30, dv / 0.30):
            return INK
        if math.hypot(du, dv) <= 0.30:
            return LIME
        return BG
    if sd_round_box(du, dv, 0.40, 0.40, 0.14) <= 0:
        return INK if symbol(du / 0.40, dv / 0.40) else LIME
    return BG


def render(size, maskable):
    scale = 4
    big = size * scale
    raw = bytearray(size * size * 3)
    for y in range(size):
        for x in range(size):
            acc = [0, 0, 0]
            for oy in range(scale):
                for ox in range(scale):
                    color = sample((x * scale + ox + 0.5) / big, (y * scale + oy + 0.5) / big, maskable)
                    acc[0] += color[0]
                    acc[1] += color[1]
                    acc[2] += color[2]
            offset = (y * size + x) * 3
            samples = scale * scale
            raw[offset] = acc[0] // samples
            raw[offset + 1] = acc[1] // samples
            raw[offset + 2] = acc[2] // samples
    return raw


def write_png(path, size, rgb):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    raw = b"".join(b"\x00" + rgb[y * size * 3:(y + 1) * size * 3] for y in range(size))
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def main():
    out = Path(__file__).resolve().parents[1] / "web" / "icons"
    out.mkdir(parents=True, exist_ok=True)
    icons = {
        "icon-192.png": (192, False),
        "icon-512.png": (512, False),
        "icon-maskable-192.png": (192, True),
        "icon-maskable-512.png": (512, True),
        "apple-touch-icon.png": (180, False),
    }
    for name, (size, maskable) in icons.items():
        write_png(out / name, size, render(size, maskable))
        print(name)


if __name__ == "__main__":
    main()
