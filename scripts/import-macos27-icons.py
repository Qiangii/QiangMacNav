"""Import the user supplied macos27-icons export. Requires Pillow.

Run without flags to inspect; --apply imports, --check verifies the import,
and --remove-source verifies every original file before removing the export.
"""
import argparse
import hashlib
import json
import shutil
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'macos27-icons'
PUBLIC = ROOT / 'public'
ICONS = PUBLIC / 'assets/icons'
ARCHIVE = ICONS / 'macos27'
REPORT = ARCHIVE / 'import-report.json'

NAMES = {
    'appstore': '应用商店', 'launchpad': '启动台', 'calculator': '计算器', 'calendar': '日历',
    'clock': '时钟', 'contacts': '通讯录', 'facetime': '视频通话', 'finder': '访达',
    'freeform': '无边记', 'games': '游戏', 'mail': '邮件', 'maps': '地图', 'messages': '信息',
    'music': '音乐', 'news': '新闻', 'notes': '备忘录', 'phone': '电话', 'photobooth': '拍照亭',
    'photos': '照片', 'podcasts': '播客', 'preview': '预览', 'quicktime': '视频播放器',
    'reminders': '提醒事项', 'safari': '浏览器', 'stickies': '便笺', 'stocks': '股市',
    'settings': '系统设置', 'textedit': '文本编辑', 'tv': '电视', 'voicememos': '语音备忘录',
    'weather': '天气', 'activitymonitor': '活动监视器', 'diskutility': '磁盘工具', 'terminal': '终端',
    'tahoe-trip': '旅行文件夹', 'welcome-txt': '文本文件', 'utilities-folder': '实用工具文件夹',
    'recents': '最近使用', 'airdrop': '隔空投送', 'applications': '应用程序', 'desktop': '桌面',
    'documents': '文稿', 'downloads': '下载', 'icloud-drive': '云盘', 'macbook': '笔记本电脑',
    'icloud': '云服务', 'network': '网络', 'apple-account': '苹果账户', 'wi-fi': '无线网络',
    'bluetooth': '蓝牙', 'vpn': '虚拟专用网络', 'battery': '电池', 'general': '通用',
    'accessibility': '辅助功能', 'appearance': '外观', 'menu-bar': '菜单栏',
    'apple-intelligence-and-siri': '智能助理', 'desktop-and-dock': '桌面与程序坞',
    'displays': '显示器', 'wallpaper': '壁纸', 'screen-saver': '屏幕保护', 'notifications': '通知',
    'focus': '专注模式', 'sound': '声音', 'keyboard': '键盘', 'trackpad': '触控板', 'mouse': '鼠标',
    'privacy-and-security': '隐私与安全', 'users-and-groups': '用户与群组', 'time-machine': '时间机器',
    'listen-now': '立即收听', 'browse': '浏览', 'radio': '广播', 'recently-added': '最近添加',
    'artists': '艺人', 'albums': '专辑', 'songs': '歌曲',
}

def digest(data):
    return hashlib.sha256(data).hexdigest()

def load(path):
    return json.loads(path.read_text(encoding='utf-8'))

def save(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def fingerprint(path):
    if path.suffix == '.png':
        with Image.open(path) as original:
            image = original.convert('RGBA')
            box = image.getchannel('A').getbbox()
            if not box:
                raise ValueError(f'Empty image: {path}')
            image = image.crop(box)
            # Ignore arbitrary RGB data in fully transparent pixels.
            pixels = image.get_flattened_data() if hasattr(image, 'get_flattened_data') else image.getdata()
            image.putdata([(r, g, b, a) if a else (0, 0, 0, 0) for r, g, b, a in pixels])
            return 'pixels:' + digest(str(image.size).encode() + image.tobytes())
    svg = ET.fromstring(path.read_bytes())
    # Lucide silhouettes are duplicates even with a different tint or stroke width.
    shapes = []
    for child in svg:
        tag = child.tag.split('}')[-1]
        if tag not in {'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse'}:
            return 'bytes:' + digest(path.read_bytes())
        shapes.append((tag, sorted((k, v) for k, v in child.attrib.items() if k not in {'class', 'stroke', 'stroke-width', 'fill'})))
    return 'shape:' + digest(json.dumps([svg.get('viewBox'), sorted(shapes)]).encode())

def verify():
    report = load(REPORT)
    catalog = load(ICONS / 'catalog.json')
    assert catalog == load(ROOT / 'server/icon_catalog.json'), 'API and picker catalogs differ'
    assert len({i['id'] for i in catalog['items']}) == len(catalog['items'])
    assert len({i['url'] for i in catalog['items']}) == len(catalog['items'])
    urls = {i['url'] for i in catalog['items']}
    for item in catalog['items']:
        path = PUBLIC / item['url'].lstrip('/')
        assert path.is_file(), path
        fingerprint(path)
    for entry in report['files']:
        path = PUBLIC / entry['url'].lstrip('/')
        assert entry['url'] in urls, entry
        assert digest(path.read_bytes()) == entry['targetSha256'], path
    extras = load(ARCHIVE / 'catalog.json')
    assert all(i in catalog['items'] for i in extras['items'])
    print(f"Verified {len(catalog['items'])} catalog icons and {len(report['files'])} source mappings.")
    return report

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--remove-source', action='store_true')
    args = parser.parse_args()
    if args.check or args.remove_source:
        report = verify()
        if args.remove_source:
            actual = {str(p.relative_to(SOURCE)).replace('\\', '/'): digest(p.read_bytes()) for p in SOURCE.rglob('*') if p.is_file()}
            assert actual == report['sourceChecksums'], 'Source changed or contains unaccounted files; refusing deletion'
            assert (ARCHIVE / 'source-manifest.json').read_bytes() == (SOURCE / 'manifest.json').read_bytes()
            assert (ARCHIVE / 'source-README.md').read_bytes() == (SOURCE / 'README.md').read_bytes()
            shutil.rmtree(SOURCE)
            print('Removed verified macos27-icons source directory.')
        return
    manifest = load(SOURCE / 'manifest.json')
    catalog = load(ICONS / 'catalog.json')
    assert not any(i['id'].startswith('macos27-') for i in catalog['items']), 'Already imported; use --check'
    checksums = {str(p.relative_to(SOURCE)).replace('\\', '/'): digest(p.read_bytes()) for p in SOURCE.rglob('*') if p.is_file()}
    listed = {i['file'] for i in manifest['items']}
    assert set(checksums) == listed | {'manifest.json', 'README.md'}, 'Unlisted source files'
    known = {fingerprint(PUBLIC / i['url'].lstrip('/')): i for i in catalog['items']}
    categories = [{'id': 'macos27-apps', 'name': 'iOS 风格应用'}, {'id': 'macos27-settings', 'name': '彩色系统图标'}, {'id': 'macos27-sidebar', 'name': '侧栏与音乐'}]
    items, mappings, copies = [], {}, []
    for original in sorted(manifest['items'], key=lambda i: (i['type'] != 'svg', i['file'])):
        file = original['file']
        path = SOURCE / file
        assert SOURCE.resolve() in path.resolve().parents
        # PNG and SVG exported from the same sidebar control represent one icon.
        sibling = str(Path(file).with_suffix('.svg')).replace('\\', '/')
        if path.suffix == '.png' and sibling in listed:
            mappings[file] = {**mappings[sibling], 'file': file, 'reason': 'png-svg-pair', 'sourceSha256': checksums[file]}
            continue
        key = fingerprint(path)
        if key in known:
            target = known[key]
            mappings[file] = {'file': file, 'url': target['url'], 'reason': 'matching-artwork', 'sourceSha256': checksums[file]}
            continue
        group = path.parent.name
        category = {'applications': 'macos27-apps', 'settings-sidebar': 'macos27-settings', 'desktop-files': 'files'}.get(group, 'macos27-sidebar')
        item = {'id': f'macos27-{group}-{path.stem}', 'name': f'{NAMES[path.stem]} {original["label"]}', 'category': category, 'url': f'/assets/icons/macos27/{group}-{path.name}'}
        items.append(item); known[key] = item
        copies.append((path, PUBLIC / item['url'].lstrip('/')))
        mappings[file] = {'file': file, 'url': item['url'], 'reason': 'imported', 'sourceSha256': checksums[file]}
    print(json.dumps({'sourceFiles': len(listed), 'added': len(items), 'total': len(catalog['items']) + len(items), 'decisions': dict(Counter(i['reason'] for i in mappings.values())), 'merged': [i for i in mappings.values() if i['reason'] == 'matching-artwork']}, ensure_ascii=False, indent=2))
    if not args.apply:
        return
    ARCHIVE.mkdir(exist_ok=True)
    for source, target in copies:
        assert not target.exists(), target
        shutil.copyfile(source, target)
    for mapping in mappings.values():
        mapping['targetSha256'] = digest((PUBLIC / mapping['url'].lstrip('/')).read_bytes())
    shutil.copyfile(SOURCE / 'manifest.json', ARCHIVE / 'source-manifest.json')
    shutil.copyfile(SOURCE / 'README.md', ARCHIVE / 'source-README.md')
    save(ARCHIVE / 'catalog.json', {'categories': categories, 'items': items})
    save(REPORT, {'source': manifest['source'], 'capturedAt': manifest['capturedAt'], 'sourceChecksums': checksums, 'files': list(mappings.values())})
    catalog['categories'].extend(categories); catalog['items'].extend(items)
    save(ICONS / 'catalog.json', catalog); save(ROOT / 'server/icon_catalog.json', catalog)
    verify()

if __name__ == '__main__':
    main()
