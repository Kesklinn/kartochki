# Иконки приложения: две карточки, на передней "En" на зеленом фоне.
import sys
from PIL import Image, ImageDraw, ImageFont

out = sys.argv[1]

def font(size):
    for f in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf']:
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            pass
    return ImageFont.load_default()

def icon(n):
    s = 4  # рисуем крупно и уменьшаем для сглаживания
    N = n * s
    im = Image.new('RGB', (N, N), '#2f6f5e')
    d = ImageDraw.Draw(im)
    w, h = int(N * .42), int(N * .52)
    # задняя карточка
    x0, y0 = int(N * .22), int(N * .20)
    d.rounded_rectangle([x0, y0, x0 + w, y0 + h], radius=N // 20, fill='#a9d3c5')
    # передняя карточка
    x1, y1 = int(N * .36), int(N * .30)
    d.rounded_rectangle([x1, y1, x1 + w, y1 + h], radius=N // 20, fill='#ffffff')
    f = font(int(N * .15))
    d.text((x1 + w / 2, y1 + h / 2), 'En', font=f, fill='#2f6f5e', anchor='mm')
    return im.resize((n, n), Image.LANCZOS)

for n in (192, 512):
    icon(n).save(f'{out}/icon-{n}.png')
