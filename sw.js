// 画面のファイルを端末に保存し、電波が弱いときでもアプリを開けるようにする。
// ファイルを更新したら VERSION を上げる。
const VERSION = 'v1';
const FILES = ['./', 'index.html', 'soudan.html', 'lab.html', 'app.css', 'app.js', 'docs-soudan.js', 'docs-lab.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.url.includes('script.google')) return;   // 保存の通信は端末に残さない
  // まずネットから最新を取り、だめなら端末に保存した物を使う
  e.respondWith(fetch(req).then(res => {
    const copy = res.clone();
    caches.open(VERSION).then(c => c.put(req, copy)).catch(() => { });
    return res;
  }).catch(() => caches.match(req)));
});
