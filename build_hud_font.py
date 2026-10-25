"""生成 Gameplay HUD 固定字号灰度字形图集（需要 Pillow，无运行时依赖）。"""
import json
import pathlib

from PIL import Image, ImageDraw, ImageFont, features

ROOT = pathlib.Path(__file__).resolve().parent
HUD = ROOT / 'res' / 'hud'
SIZES = (24, 36, 50, 70)


def main():
    chars = set(chr(i) for i in range(32, 127))
    # 图集包含现有谱面库的曲名；未收录字符仍由浏览器字体回退。
    library = ROOT / 'res' / 'library' / 'index.json'
    if library.exists():
        for entry in json.loads(library.read_text(encoding='utf-8'))['charts']:
            chars.update(entry.get('name', ''))
            chars.update(entry.get('level', ''))
    glyphs = {}
    tiles = []
    for size in SIZES:
        font = ImageFont.truetype(str(HUD / 'PhiHUD.ttf'), size,
                                  layout_engine=ImageFont.Layout.BASIC)
        table = {}
        for char in sorted(chars):
            advance = round(font.getlength(char))
            box = font.getbbox(char, anchor='ls')
            tile = Image.new('L', (max(1, box[2] - box[0]), max(1, box[3] - box[1])))
            ImageDraw.Draw(tile).text((-box[0], -box[1]), char, font=font,
                                     anchor='ls', fill=255)
            bounds = tile.getbbox()
            record = {'advance': advance}
            if bounds:
                tile = tile.crop(bounds)
                # 采样矩形内保留一圈透明像素，让双线性过滤完整覆盖最外侧笔画。
                padded = Image.new('L', (tile.width + 2, tile.height + 2))
                padded.paste(tile, (1, 1))
                tile = padded
                record.update({'left': box[0] + bounds[0] - 1, 'top': box[1] + bounds[1] - 1,
                               'w': tile.width, 'h': tile.height})
                tiles.append((tile, record))
            table[char] = record
        glyphs[str(size)] = table

    width, padding = 1024, 2
    x = y = padding
    row_height = 0
    for tile, record in tiles:
        if x + tile.width + padding > width:
            x, y = padding, y + row_height + padding * 2
            row_height = 0
        record.update({'x': x, 'y': y})
        x += tile.width + padding * 2
        row_height = max(row_height, tile.height)
    atlas = Image.new('RGBA', (width, y + row_height + padding), (255, 255, 255, 0))
    for tile, record in tiles:
        rgba = Image.new('RGBA', tile.size, 'white')
        rgba.putalpha(tile)
        atlas.paste(rgba, (record['x'], record['y']))
    atlas.save(HUD / 'glyphs.png', optimize=True)
    metadata = {'version': 1, 'ascent': 0.88, 'sizes': glyphs,
                'generator': 'Pillow FreeType ' + features.version('freetype2')}
    (HUD / 'glyphs.json').write_text(json.dumps(metadata, ensure_ascii=False,
                                               separators=(',', ':')), encoding='utf-8')
    print(f'{len(chars)} characters, {len(SIZES)} sizes, {atlas.width}x{atlas.height}')


if __name__ == '__main__':
    main()
