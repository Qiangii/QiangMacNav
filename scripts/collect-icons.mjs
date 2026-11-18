// Rebuild the bundled catalog. Run from the project root: node scripts/collect-icons.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as lucide from 'lucide-react';

const root = new URL('../public/assets/icons/', import.meta.url);
await mkdir(root, { recursive: true });
const categories = [
  { id: 'system', name: '系统与应用' }, { id: 'brands', name: '品牌标识' },
  { id: 'actions', name: '常用操作' }, { id: 'files', name: '文件与格式' },
  { id: 'interests', name: '生活与分类' },
];
const items = [];
const bundled = [
  ['finder', '访达 Finder'], ['launchpad', '启动台 Launchpad'], ['safari', 'Safari 浏览器'],
  ['settings', '系统设置'], ['appstore', 'App Store'], ['projects', '项目'],
];
for (const [id, name] of bundled) items.push({ id, name, category: 'system', url: `/assets/${id}-icon.png` });
const upstream = [
  ['airdrop-icon-new', '隔空投送 AirDrop', 'system'], ['apple-music-icon', '音乐 Music', 'system'],
  ['calculator-new-icon', '计算器', 'system'], ['calendar-icon-new', '日历', 'system'],
  ['contact-icon', '通讯录', 'system'], ['maps-icon', '地图 Maps', 'system'],
  ['notes-icon', '备忘录 Notes', 'system'], ['terminal-icon', '终端 Terminal', 'system'],
  ['trash-icon', '废纸篓', 'system'], ['user-profile-icon', '用户头像', 'system'],
  ['folder-icon', '文件夹', 'files'], ['document-icon', '文稿', 'files'],
  ['github-icon', 'GitHub', 'brands'], ['google-icon-new', 'Google', 'brands'],
  ['linkedin-icon', 'LinkedIn', 'brands'], ['vscode-icon', 'Visual Studio Code', 'brands'],
];
// A failed fetch must fail the build of the catalog, rather than publish broken entries.
for (const [id, name, category] of upstream) {
  const file = `${id}.png`;
  let bytes;
  try { bytes = await readFile(new URL(file, root)); }
  catch {
    const response = await fetch(`https://raw.githubusercontent.com/Thanas-R/Thanas-OS/main/src/assets/${file}`, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`${file}: not PNG`);
  await writeFile(new URL(file, root), bytes);
  items.push({ id, name, category, url: `/assets/icons/${file}` });
}
// Pinned Simple Icons shapes, with explicit colors for local <img> rendering.
const simpleIconsBase = 'https://cdn.jsdelivr.net/npm/simple-icons@11.15.0/';
for (const [id, source, name, color] of [
  ['twitter', 'twitter', '推特 Twitter', '#1DA1F2'],
  ['baidu', 'baidu', '百度 Baidu', '#2932E1'],
  ['bing', 'microsoftbing', '必应 Bing', '#008373'],
]) {
  const file = `${id}.svg`;
  let svg;
  try { svg = await readFile(new URL(file, root), 'utf8'); }
  catch {
    const response = await fetch(`${simpleIconsBase}icons/${source}.svg`, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
    svg = (await response.text()).trim().replace('<path ', `<path fill="${color}" `) + '\n';
  }
  if (!svg.startsWith('<svg ') || !svg.includes('<path ') || /<(?:script|image|foreignObject)\b|(?:href|onload)=/i.test(svg)) throw new Error(`${file}: invalid SVG`);
  await writeFile(new URL(file, root), svg);
  items.push({ id, name, category: 'brands', url: `/assets/icons/${file}` });
}
await readFile(new URL('simple-icons-LICENSE.md', root));
const symbols = {
  actions: [['Search','搜索'], ['Plus','添加'], ['Pencil','编辑'], ['Copy','复制'], ['Check','完成'], ['X','关闭'], ['Upload','上传'], ['Download','下载'], ['Share2','分享'], ['Link','链接'], ['RefreshCw','刷新'], ['Trash2','删除'], ['Settings2','设置'], ['Star','收藏'], ['LockKeyhole','锁定'], ['ShieldCheck','安全']],
  files: [['FileText','文本 TXT'], ['FileCode2','代码 HTML JSON'], ['FileJson','JSON 数据'], ['FileImage','图片 PNG JPG'], ['FileVideo','视频 MP4'], ['FileAudio','音频 MP3'], ['FileArchive','压缩 ZIP'], ['FileSpreadsheet','表格 CSV XLS'], ['FileSliders','配置文件'], ['FileType','字体 TTF'], ['BookOpen','文档 PDF'], ['Database','数据库 SQL'], ['FolderOpen','打开文件夹'], ['HardDrive','硬盘'], ['Cloud','云盘']],
  interests: [['UserRound','个人'], ['CircleUserRound','账户'], ['Smile','微笑'], ['Cat','猫咪'], ['Dog','狗狗'], ['Bird','飞鸟'], ['Fish','鱼儿'], ['Rabbit','兔子'], ['Flower2','花朵'], ['Leaf','叶子'], ['Mountain','山峰'], ['Sun','太阳'], ['Moon','月亮'], ['Rocket','火箭'], ['Coffee','咖啡'], ['Heart','喜爱'], ['House','家庭'], ['BriefcaseBusiness','工作'], ['GraduationCap','学习'], ['Gamepad2','游戏'], ['Palette','设计'], ['CodeXml','开发'], ['Camera','摄影'], ['Globe2','网络']],
};
for (const [category, list] of Object.entries(symbols)) for (const [icon, name] of list) {
  if (!lucide[icon]) throw new Error(`Unknown icon: ${icon}`);
  const id = `lucide-${icon.replace(/[A-Z]/g, (c, i) => `${i ? '-' : ''}${c.toLowerCase()}`)}`;
  const svg = renderToStaticMarkup(createElement(lucide[icon], { size: 64, color: '#6485db', strokeWidth: 1.65 }));
  await writeFile(new URL(`${id}.svg`, root), svg);
  items.push({ id, name, category, url: `/assets/icons/${id}.svg` });
}
await writeFile(new URL('lucide-LICENSE.txt', root), await readFile(new URL('../node_modules/lucide-react/LICENSE', import.meta.url)));
// Keep the curated user import when regenerating the original icon collection.
const imported = JSON.parse(await readFile(new URL('macos27/catalog.json', root), 'utf8'));
for (const item of imported.items) await readFile(new URL(`../public${item.url}`, import.meta.url));
categories.push(...imported.categories);
items.push(...imported.items);
if (new Set(items.map(item => item.id)).size !== items.length || new Set(items.map(item => item.url)).size !== items.length) throw new Error('Duplicate catalog entry');
const catalog = `${JSON.stringify({ categories, items }, null, 2)}\n`;
await writeFile(new URL('catalog.json', root), catalog);
// The API validates built-in selections against this same catalog, including in Vite dev mode.
await writeFile(new URL('../server/icon_catalog.json', import.meta.url), catalog);
console.log(`Bundled ${items.length} icons in ${categories.length} categories.`);
