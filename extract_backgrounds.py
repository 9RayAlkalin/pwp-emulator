"""从 APK 的 Addressables catalog 提取当前谱面库对应的原版预模糊曲绘。

用法：py PhigrosWebPlayer/extract_backgrounds.py [Phigros_4.0.1.apk]
需要 UnityPy；不修改谱面库及高清曲绘。输出 assets/backgrounds/index.json 和 PNG。
"""
import base64
import json
from pathlib import Path
import struct
import sys
import unicodedata
import zipfile

import UnityPy

ROOT = Path(__file__).resolve().parent


def extract(apk_path):
    output = ROOT / 'assets/background'
    output.mkdir(exist_ok=True)
    charts = json.loads((ROOT / 'assets/library/index.json').read_text(encoding='utf-8'))['charts']
    result, sources = {}, {}
    with zipfile.ZipFile(apk_path) as apk:
        catalog = json.loads(apk.read('assets/aa/catalog.json'))
        keys = base64.b64decode(catalog['m_KeyDataString'])
        buckets_raw = base64.b64decode(catalog['m_BucketDataString'])
        entries_raw = base64.b64decode(catalog['m_EntryDataString'])
        entries = [struct.unpack_from('<7i', entries_raw, 4 + i * 28)
                   for i in range(struct.unpack_from('<i', entries_raw)[0])]
        buckets, names, offset = [], {}, 4
        for i in range(struct.unpack_from('<i', buckets_raw)[0]):
            key_offset, count = struct.unpack_from('<ii', buckets_raw, offset)
            offset += 8
            indices = struct.unpack_from(f'<{count}i', buckets_raw, offset)
            offset += 4 * count
            buckets.append(indices)
            kind = keys[key_offset]
            if kind in (0, 1):
                length = struct.unpack_from('<i', keys, key_offset + 1)[0]
                text = keys[key_offset + 5:key_offset + 5 + length].decode(
                    'utf-8' if kind == 0 else 'utf-16-le')
                names[unicodedata.normalize('NFC', text)] = i

        for chart in charts:
            song = unicodedata.normalize('NFC', chart['song'])
            if chart['path'] == '/assets/builtin/s6':
                # 内置旧谱没有此版本的对应资源，运行时走高清曲绘+屏幕模糊兜底。
                continue
            prefix = f'Assets/Tracks/{song}.0/IllustrationBlur'
            specific = prefix + f'_{chart["difficulty"]}.jpg'
            key = specific if specific in names else prefix + '.jpg'
            if key not in names:
                print(f'No APK background: {chart["path"]}')
                continue
            if key not in sources:
                entry = entries[buckets[names[key]][0]]
                dependency = entries[buckets[entry[2]][0]]
                bundle = catalog['m_InternalIds'][dependency[0]].rsplit('/', 1)[-1]
                env = UnityPy.load(apk.read('assets/aa/Android/' + bundle))
                sprites = [obj.read() for obj in env.objects if obj.type.name == 'Sprite']
                if len(sprites) != 1:
                    raise ValueError(f'Expected one sprite in {bundle}, got {len(sprites)}')
                sprite = sprites[0]
                filename = f'bg_{len(sources):02d}.png'
                image = sprite.image
                image.save(output / filename)
                sources[key] = {'path': '/assets/backgrounds/' + filename, 'key': key,
                                'bundle': bundle, 'size': list(image.size),
                                'pixelsPerUnit': sprite.m_PixelsToUnits}
            result[chart['path']] = sources[key]['path']

    (output / 'index.json').write_text(json.dumps(
        {'charts': result, 'sources': list(sources.values())}, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8')
    print(f'Extracted {len(sources)} backgrounds for {len(result)} charts')


if __name__ == '__main__':
    extract(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / 'Phigros_4.0.1.apk')
