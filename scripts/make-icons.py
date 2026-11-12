#!/usr/bin/env python3
"""把一张 PNG 处理成扩展所需的多尺寸图标（纯标准库，无 PIL 依赖）

用法:
    python scripts/make-icons.py <源图> [输出目录]
默认输出到 packages/extension/assets/icon-{16,48,128}.png
"""
import struct
import sys
import os
import zlib

SRC = sys.argv[1] if len(sys.argv) > 1 else r"D:/我的坚果云/.2025年NEW/1x/资源 17.png"
OUT_DIR = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "packages", "extension", "assets"
)
SIZES = [16, 48, 128]


# ---------- PNG 解码 ----------
def read_chunks(data):
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "不是 PNG"
    pos = 8
    chunks = {}
    order = []
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        ctype = data[pos + 4 : pos + 8].decode("ascii")
        payload = data[pos + 8 : pos + 8 + length]
        chunks.setdefault(ctype, bytearray())
        chunks[ctype] += payload
        order.append(ctype)
        pos += 12 + length
    return chunks, order


def paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def unfilter(raw, width, height, bpp, stride):
    out = bytearray()
    prev = bytearray(stride)
    pos = 0
    for _ in range(height):
        ftype = raw[pos]
        pos += 1
        line = bytearray(raw[pos : pos + stride])
        pos += stride
        if ftype == 0:
            pass
        elif ftype == 1:
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 0xFF
        elif ftype == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ftype == 3:
            for i in range(stride):
                left = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif ftype == 4:
            for i in range(stride):
                left = line[i - bpp] if i >= bpp else 0
                upleft = prev[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + paeth(left, prev[i], upleft)) & 0xFF
        else:
            raise ValueError("未知的行过滤类型 %d" % ftype)
        out += line
        prev = line
    return out


def decode(path):
    data = open(path, "rb").read()
    chunks, _ = read_chunks(data)
    w, h, depth, ctype, _, _, interlace = struct.unpack(">IIBBBBB", chunks["IHDR"][:13])
    assert depth == 8 and interlace == 0, "只支持 8bit 非隔行 PNG"
    raw = zlib.decompress(bytes(chunks["IDAT"]))

    if ctype == 3:  # 调色板
        palette = chunks["PLTE"]
        trns = chunks.get("tRNS", b"")
        bpp, stride = 1, w
        pixels = unfilter(raw, w, h, bpp, stride)
        rgba = bytearray(w * h * 4)
        for i, idx in enumerate(pixels):
            r, g, b = palette[idx * 3 : idx * 3 + 3]
            a = trns[idx] if idx < len(trns) else 255
            rgba[i * 4 : i * 4 + 4] = bytes((r, g, b, a))
        return w, h, rgba
    if ctype == 2:  # RGB
        bpp = 3
        pixels = unfilter(raw, w, h, bpp, w * bpp)
        rgba = bytearray(w * h * 4)
        for i in range(w * h):
            rgba[i * 4 : i * 4 + 3] = pixels[i * 3 : i * 3 + 3]
            rgba[i * 4 + 3] = 255
        return w, h, rgba
    if ctype == 6:  # RGBA
        return w, h, bytearray(unfilter(raw, w, h, 4, w * 4))
    raise ValueError("不支持的 color type %d" % ctype)


# ---------- 图像处理 ----------
def content_bbox(w, h, rgba, white_threshold=246):
    """非白、非全透明像素的包围盒"""
    minx, miny, maxx, maxy = w, h, -1, -1
    for y in range(h):
        row = y * w * 4
        for x in range(w):
            i = row + x * 4
            r, g, b, a = rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]
            if a < 8:
                continue
            if r >= white_threshold and g >= white_threshold and b >= white_threshold:
                continue
            if x < minx:
                minx = x
            if x > maxx:
                maxx = x
            if y < miny:
                miny = y
            if y > maxy:
                maxy = y
    if maxx < 0:
        return 0, 0, w - 1, h - 1
    return minx, miny, maxx, maxy


def crop_square(rgba, w, h, bbox, pad_ratio=0.06):
    """按内容包围盒裁成正方形，四周留白 pad_ratio；越界部分在缩放时按白色补齐"""
    minx, miny, maxx, maxy = bbox
    cx = (minx + maxx) / 2.0
    cy = (miny + maxy) / 2.0
    side = max(maxx - minx + 1, maxy - miny + 1) * (1 + pad_ratio * 2)
    half = side / 2.0
    x0 = int(round(cx - half))
    y0 = int(round(cy - half))
    return x0, y0, int(round(side))


def resize_area(rgba, w, h, x0, y0, side, target):
    """面积平均缩放，源区域 [x0,y0,side,side] -> target x target，越界按白色处理"""
    scale = side / float(target)
    out = bytearray(target * target * 4)
    for ty in range(target):
        sy0 = y0 + ty * scale
        sy1 = sy0 + scale
        iy0 = int(sy0 // 1)
        iy1 = int(-(-sy1 // 1))
        for tx in range(target):
            sx0 = x0 + tx * scale
            sx1 = sx0 + scale
            ix0 = int(sx0 // 1)
            ix1 = int(-(-sx1 // 1))
            rsum = gsum = bsum = asum = wsum = 0.0
            for yy in range(iy0, iy1):
                if yy < 0 or yy >= h:
                    cov_y = 1.0
                else:
                    cov_y = min(sy1, yy + 1) - max(sy0, yy)
                    if cov_y <= 0:
                        continue
                for xx in range(ix0, ix1):
                    if xx < 0 or xx >= w:
                        # 画面外按纯白不透明处理
                        cov = cov_y
                        rsum += 255 * cov
                        gsum += 255 * cov
                        bsum += 255 * cov
                        asum += 255 * cov
                        wsum += cov
                        continue
                    cov_x = min(sx1, xx + 1) - max(sx0, xx)
                    if cov_x <= 0:
                        continue
                    cov = cov_x * cov_y
                    i = (yy * w + xx) * 4
                    a = rgba[i + 3] / 255.0
                    # 预乘 alpha 后再平均，避免边缘发黑
                    rsum += rgba[i] * a * cov
                    gsum += rgba[i + 1] * a * cov
                    bsum += rgba[i + 2] * a * cov
                    asum += rgba[i + 3] * cov
                    wsum += cov
            if wsum == 0:
                continue
            o = (ty * target + tx) * 4
            alpha = asum / wsum
            if alpha <= 0:
                out[o : o + 4] = bytes((255, 255, 255, 0))
                continue
            # 还原非预乘颜色
            out[o] = min(255, int(round(rsum / wsum / (alpha / 255.0))))
            out[o + 1] = min(255, int(round(gsum / wsum / (alpha / 255.0))))
            out[o + 2] = min(255, int(round(bsum / wsum / (alpha / 255.0))))
            out[o + 3] = min(255, int(round(alpha)))
    return out


# ---------- PNG 编码 ----------
def encode(size, rgba):
    def chunk(ctype, payload):
        body = ctype + payload
        return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter: none
        raw += rgba[y * size * 4 : (y + 1) * size * 4]
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def main():
    w, h, rgba = decode(SRC)
    bbox = content_bbox(w, h, rgba)
    minx, miny, maxx, maxy = bbox
    print("源图 %dx%d，内容包围盒 (%d,%d)-(%d,%d)，占画面 %.0f%% x %.0f%%"
          % (w, h, minx, miny, maxx, maxy,
             (maxx - minx + 1) * 100.0 / w, (maxy - miny + 1) * 100.0 / h))

    x0, y0, side = crop_square(rgba, w, h, bbox)
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in SIZES:
        data = encode(size, resize_area(rgba, w, h, x0, y0, side, size))
        path = os.path.join(OUT_DIR, "icon-%d.png" % size)
        open(path, "wb").write(data)
        print("写入 %s (%d 字节)" % (path, len(data)))


if __name__ == "__main__":
    main()
