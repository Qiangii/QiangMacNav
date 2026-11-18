import { identity, permissionOrigin, safeURL, type Session } from './model';

export const isMediaPath = (value: string) => /^\/api\/media\/[a-f0-9]{64}$/.test(value);

// Binary media stays in the trusted extension page. Chrome runtime messages
// use JSON serialization and cannot carry a File or Blob intact.
async function logoRequest(account: string, suffix: string, body?: FormData, signal?: AbortSignal) {
  const { session } = await chrome.storage.local.get<{ session?: Session }>('session');
  if (!session || identity(session) !== account) throw new Error('账号已变更，请重新打开窗口。');
  if (!await chrome.permissions.contains({ origins: [permissionOrigin(session.base)] })) throw new Error('请先允许访问导航地址。');
  const response = await fetch(`${session.base}/api/extension/logos${suffix}`, {
    method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${session.token}` }, body,
    credentials: 'omit', redirect: 'error', cache: 'no-store', signal: signal || AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    if (body && ((response.status === 415 && data?.error === 'Content-Type must be application/json') ||
        (response.status === 404 && data?.error === 'API endpoint not found'))) {
      throw new Error('当前导航服务未提供插件图片上传接口，请更新并重启导航后端后重试。');
    }
    throw new Error(data?.error || `图片请求失败（${response.status}）`);
  }
  return response;
}

const maxLogoBytes = 8 * 1024 * 1024;

async function downloadLogo(url: string): Promise<Blob> {
  const response = await fetch(url, {
    credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(20000),
  });
  if (!response.ok || !response.body) throw new Error(`无法读取 Logo 图片（HTTP ${response.status}）。`);
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxLogoBytes) {
      await reader.cancel();
      throw new Error('Logo 图片超过 8 MB。');
    }
    chunks.push(value);
  }
  if (!size) throw new Error('Logo 链接返回了空图片。');
  return new Blob(chunks, { type: response.headers.get('Content-Type')?.split(';')[0].trim() });
}

// The library accepts PNG, JPEG, GIF and WebP directly. Favicon links also
// commonly serve ICO or SVG, which Chromium can render to a PNG for storage.
async function logoForLibrary(blob: Blob, url: URL): Promise<File> {
  const name = url.pathname.split('/').pop() || url.hostname;
  const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const signature = String.fromCharCode(...header);
  if (signature.startsWith('\x89PNG\r\n\x1a\n') || signature.startsWith('\xff\xd8\xff') ||
      /^GIF8[79]a/.test(signature) || (signature.startsWith('RIFF') && signature.slice(8) === 'WEBP')) {
    return new File([blob], name, { type: blob.type });
  }

  const svg = blob.type === 'image/svg+xml' || /\.svg$/i.test(name) || /<svg[\s>]/i.test(await blob.slice(0, 2048).text());
  const ico = signature.startsWith('\x00\x00\x01\x00');
  if (!svg && !ico) throw new Error('该链接未返回支持的图标图片。');
  const localURL = URL.createObjectURL(blob.slice(0, blob.size, svg ? 'image/svg+xml' : 'image/x-icon'));
  try {
    const image = new Image();
    image.src = localURL;
    await image.decode().catch(() => { throw new Error('无法解码链接中的图标图片。'); });
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!width || !height) throw new Error('图标图片尺寸无效。');
    const scale = Math.min(1, 1024 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('无法将该图标转换为 PNG。');
    return new File([png], `${name.replace(/\.(svg|ico)$/i, '')}.png`, { type: 'image/png' });
  } finally { URL.revokeObjectURL(localURL); }
}

export async function uploadLogoFromURL(account: string, value: string): Promise<string> {
  const url = safeURL(value.trim());
  if (!url) throw new Error('请先填写有效的 HTTP(S) Logo 链接。');
  // Request only the host in the current field, while the upload click is active.
  if (!await chrome.permissions.request({ origins: [permissionOrigin(url)] })) throw new Error('需要允许读取该图片地址才能上传。');
  let image: Blob;
  try { image = await downloadLogo(url); }
  catch (error) {
    if (error instanceof TypeError || error instanceof DOMException) throw new Error('无法下载 Logo，请检查图片链接和访问权限。');
    throw error;
  }
  const file = await logoForLibrary(image, new URL(url));
  const form = new FormData();
  form.append('file', file);
  const response = await logoRequest(account, '', form);
  const item = await response.json();
  if (typeof item.url !== 'string' || !isMediaPath(item.url)) throw new Error('上传响应缺少有效的图片路径。');
  return item.url as string;
}

export async function loadLogo(account: string, path: string, signal: AbortSignal) {
  if (!isMediaPath(path)) throw new Error('无效的图标路径。');
  return (await logoRequest(account, path.slice('/api/media'.length), undefined, signal)).blob();
}
