"""Brend assetlarini assets/brand/source.jpg dan yaratadi: python scripts/make_brand_assets.py (mobile/ ichida).

Manba 1254x1254 JPEG, vektor emas. Vektor logotip chiqsa, shu skriptni yangilang.
"""
from PIL import Image, ImageChops, ImageDraw, ImageFilter

SRC = "assets/brand/source.jpg"
BG = (1, 13, 73)                     # logotip fonining rangi, #010D49
CLOCK = (630, 480)                   # soat markazi manbada
CLOCK_R = 113                        # C ichki chetigacha

src = Image.open(SRC).convert("RGB")


def cut(box, floor, top):
    """Qismni fondan ajratadi: alpha yorqinlikdan, rang manbadan."""
    part = src.crop(box)
    r, g, b = part.split()
    bright = ImageChops.lighter(ImageChops.lighter(r, g), b)
    alpha = bright.point(lambda v: max(0, min(255, int((v - floor) * 255 / (top - floor)))))
    part.putalpha(alpha)
    return part


# C belgisi: to'liq (ikonka va tizim splash'i uchun) va soatsiz (animatsiya uchun)
MARK_BOX = (380, 225, 850, 695)
mark = cut(MARK_BOX, 95, 150)
mark.resize((800, 800), Image.LANCZOS).save("assets/splash-icon.png")

ring = mark.copy()
hole = Image.new("L", ring.size, 255)
cx, cy = CLOCK[0] - MARK_BOX[0], CLOCK[1] - MARK_BOX[1]
ImageDraw.Draw(hole).ellipse((cx - CLOCK_R, cy - CLOCK_R, cx + CLOCK_R, cy + CLOCK_R), fill=0)
hole = hole.filter(ImageFilter.GaussianBlur(1))
ring.putalpha(ImageChops.multiply(ring.getchannel("A"), hole))
ring.resize((800, 800), Image.LANCZOS).save("assets/brand/ring.png")

# Yozuv va shior
cut((285, 705, 970, 870), 70, 160).save("assets/brand/wordmark.png")
cut((295, 885, 960, 945), 45, 130).save("assets/brand/tagline.png")

# Animatsiya oxiridagi to'liq rasm: manba fonining burchaklari qoraroq, ekranda dog' bo'lib ko'rinmasin,
# shuning uchun fondan yorqin piksellar (logotip va nuri) qoladi, qolgani ilova foni bilan bir xil
bg = Image.new("RGB", src.size, BG)
ImageChops.lighter(src, bg).save("assets/brand/full.jpg", quality=92, subsampling=0)

# Ilova ikonkasi: belgi fon rangida (yozuv ikonkada o'qilmaydi)
icon = Image.new("RGBA", (1024, 1024), BG + (255,))
icon.alpha_composite(mark.resize((700, 700), Image.LANCZOS), (162, 162))
icon = icon.convert("RGB")
icon.save("assets/icon.png")
icon.resize((48, 48), Image.LANCZOS).save("assets/favicon.png")

# Android adaptive: tizim chetlarini kesadi, belgi markazdagi 66% ichida qolishi kerak
canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
small = mark.resize((600, 600), Image.LANCZOS)
canvas.alpha_composite(small, (212, 212))
canvas.save("assets/android-icon-foreground.png")
Image.new("RGB", (1024, 1024), BG).save("assets/android-icon-background.png")

mono = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
white = Image.new("RGBA", small.size, (255, 255, 255, 255))
white.putalpha(small.getchannel("A"))
mono.alpha_composite(white, (212, 212))
mono.save("assets/android-icon-monochrome.png")
print("ok")
