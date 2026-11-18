// Run from the project root: node scripts/collect-avatars.mjs
// Download once; the app serves the checked-in assets without any external requests.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const revision = '1ffb34c752ecf5d402f04cfb4b392c77f57c54bc';
const repository = 'microsoft/fluentui-emoji';
const root = new URL('../public/assets/avatars/', import.meta.url);
const categories = [{ id: 'animals', name: '动物伙伴' }, { id: 'nature', name: '自然花园' }, { id: 'fun', name: '趣味灵感' }];
const selections = [
  ['Cat face', '猫咪', 'animals'], ['Dog face', '小狗', 'animals'], ['Fox', '狐狸', 'animals'],
  ['Panda', '熊猫', 'animals'], ['Bear', '小熊', 'animals'], ['Koala', '考拉', 'animals'],
  ['Rabbit face', '兔子', 'animals'], ['Tiger face', '老虎', 'animals'], ['Lion', '狮子', 'animals'],
  ['Penguin', '企鹅', 'animals'], ['Owl', '猫头鹰', 'animals'], ['Unicorn', '独角兽', 'animals'],
  ['Sunflower', '向日葵', 'nature'], ['Cherry blossom', '樱花', 'nature'], ['Cactus', '仙人掌', 'nature'],
  ['Four leaf clover', '四叶草', 'nature'], ['Mushroom', '蘑菇', 'nature'], ['Rainbow', '彩虹', 'nature'],
  ['Rocket', '火箭', 'fun'], ['Ringed planet', '星球', 'fun'], ['Artist palette', '调色盘', 'fun'],
  ['Headphone', '耳机', 'fun'], ['Robot', '机器人', 'fun'], ['Alien', '外星人', 'fun'],
];

async function download(path) {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  try {
    const response = await fetch(`https://raw.githubusercontent.com/${repository}/${revision}/${encoded}`, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } catch {
    const response = await fetch(`https://api.github.com/repos/${repository}/contents/${encoded}?ref=${revision}`, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'Harbor-avatar-collector' } });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    const result = await response.json();
    if (result.encoding !== 'base64') throw new Error(`${path}: unexpected encoding`);
    return Buffer.from(result.content, 'base64');
  }
}

await mkdir(root, { recursive: true });
const items = [];
// Small batches avoid hammering the upstream and keep all failures visible.
for (let start = 0; start < selections.length; start += 4) {
  const batch = await Promise.all(selections.slice(start, start + 4).map(async ([sourceName, name, category]) => {
    const id = sourceName.toLowerCase().replaceAll(' ', '-');
    const path = `assets/${sourceName}/3D/${sourceName.toLowerCase().replaceAll(' ', '_')}_3d.png`;
    const file = `${id}.png`;
    let bytes;
    try { bytes = await readFile(new URL(file, root)); }
    catch { bytes = await download(path); }
    if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`${file}: not PNG`);
    await writeFile(new URL(file, root), bytes);
    return { id, name, category, url: `/assets/avatars/${file}`, source: `https://github.com/${repository}/blob/${revision}/${path.split('/').map(encodeURIComponent).join('/')}`, sha256: createHash('sha256').update(bytes).digest('hex') };
  }));
  items.push(...batch);
  console.log(`Avatars: ${items.length}/${selections.length}`);
}
let license;
try { license = await readFile(new URL('LICENSE.txt', root)); }
catch { license = await download('LICENSE'); }
if (!license.toString().includes('MIT License') || !license.toString().includes('Microsoft Corporation')) throw new Error('Unexpected avatar license');
await writeFile(new URL('LICENSE.txt', root), license);
const catalog = `${JSON.stringify({ categories, items }, null, 2)}\n`;
await writeFile(new URL('catalog.json', root), catalog);
await writeFile(new URL('../server/avatar_catalog.json', import.meta.url), catalog);
console.log(`Bundled ${items.length} local avatars with license and source metadata.`);
