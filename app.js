// ふらここ 同意書署名システム（相談支援事業所ふらここ・心を育てる ふらここラボ 共通の本体）
// 画面はGitHub Pagesに置き、署名したPDFはGoogle Apps Script経由でGoogleドライブに保存する。
// 書類の文章と署名欄は docs-*.js（window.APP_CONFIG）で決める。
'use strict';

// Google Apps Script（保存用）のウェブアプリURL。デプロイし直したときはここを書き換える。
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxkxmKBZKmotlZ1VZzkgJIE3wsmdUoNKnrctFxH4T2y3kWxXSUL9lULzHm0ROl8iy2t/exec';

const C = window.APP_CONFIG;
const N = C.docs.length;
const KEY_CODE = 'furakoko_staff_code';
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥'];
const SIGNER_LABEL = { user: '利用者 署名', guardian: '保護者 署名', staff: '説明者（職員） 署名' };

const FIELDS = C.mode === 'child' ? [
  { id: 'childName', label: '利用児童の氏名', ph: '例：田中　さくら', req: true },
  { id: 'childFurigana', label: '利用児童のフリガナ', ph: '例：タナカ　サクラ', req: true, hint: '※ファイル名に使います（全角カタカナ）' },
  { id: 'guardianName', label: '保護者の氏名', ph: '例：田中　花子', req: true },
  { id: 'guardianRelation', label: '続柄', ph: '例：母', req: true },
  { id: 'address', label: '住所', ph: '例：秋田市○○○', req: true },
  { id: 'contractDate', label: '契約日', type: 'date', req: true },
  { id: 'staffName', label: '説明した職員の氏名', ph: '例：奈良　恵子', req: true, keep: true },
] : [
  { id: 'userName', label: '氏名（漢字）', ph: '例：田中　花子', req: true },
  { id: 'userFurigana', label: 'フリガナ', ph: '例：タナカ　ハナコ', req: true, hint: '※ファイル名に使います（全角カタカナ）' },
  { id: 'userAddress', label: '住所', ph: '例：秋田市○○○', req: true },
  { id: 'contractDate', label: '契約日', type: 'date', req: true },
];
const GUARDIAN_FIELDS = [
  { id: 'gName', label: '保護者氏名', ph: '例：田中　一郎' },
  { id: 'gAddress', label: '保護者住所', ph: '例：秋田市○○○' },
  { id: 'gRelation', label: '続柄', ph: '例：父、母' },
];

let currentStep = 0;               // 0 = 情報入力, 1..N = 書類, N+1 = 完了
let hasGuardian = C.mode === 'child';
let lastPdfBlob = null, lastFileName = '';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const val = id => ($(id) ? $(id).value.trim() : '');

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function jpDate(s) { const p = String(s).split('-'); return p[0] + '年' + Number(p[1]) + '月' + Number(p[2]) + '日'; }
function activeSigners(doc) {
  return doc.signers.filter(s => !s.endsWith('?') || hasGuardian).map(s => s.replace('?', ''));
}
function canvasId(doc, signer) { return 'sig_' + doc.key + '_' + signer; }
function allCanvasIds() {
  const ids = [];
  C.docs.forEach(d => d.signers.forEach(s => ids.push(canvasId(d, s.replace('?', '')))));
  return ids;
}

// ---------------- 画面を組み立てる ----------------
function fieldHtml(f) {
  return '<div class="form-group"><label class="form-label" for="' + f.id + '">' + esc(f.label) +
    (f.req ? '<span class="required">必須</span>' : '') + '</label>' +
    '<input class="form-input" type="' + (f.type || 'text') + '" id="' + f.id + '"' +
    (f.ph ? ' placeholder="' + esc(f.ph) + '"' : '') + '>' +
    (f.hint ? '<div class="form-hint">' + esc(f.hint) + '</div>' : '') + '</div>';
}
function blocksHtml(blocks) {
  return blocks.map(b => b[0] === 'h' ? '<h2>' + esc(b[1]) + '</h2>' : b[0] === 's' ? '<h3>' + esc(b[1]) + '</h3>' : '<p>' + esc(b[1]) + '</p>').join('');
}
function signatureHtml(doc, signer, optional) {
  const id = canvasId(doc, signer);
  return '<div class="signature-section" id="wrap_' + id + '"' + (optional && !hasGuardian ? ' style="display:none"' : '') + '>' +
    '<div class="signature-label">' + SIGNER_LABEL[signer] + '</div>' +
    '<div class="canvas-wrapper"><canvas class="signature-canvas" id="' + id + '"></canvas>' +
    '<div class="canvas-hint" id="hint_' + id + '">ここに署名してください<br>（指やペンでなぞってください）</div></div>' +
    '<button type="button" class="clear-btn" data-clear="' + id + '">✕ 書き直す</button></div>';
}
function build() {
  document.title = C.name + '　' + C.subtitle;
  let h = '';
  h += '<div class="loading-overlay hidden" id="loading"><div class="spinner"></div><div class="loading-text" id="loadingText">処理中...</div></div>';
  h += '<div class="pending-banner" id="pendingBanner">⚠️ まだ送れていない署名が <span id="pendingCount">0</span> 件あります。通信できるときに自動で送ります。</div>';
  h += '<div class="header"><h1>' + esc(C.name) + '</h1><p>' + esc(C.subtitle) + '</p><div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div></div>';

  // 職員コード
  h += '<div class="step" id="stepCode"><div class="container"><div class="section-title">職員コードの入力</div>' +
    '<p style="font-size:14px;line-height:1.8;margin-bottom:16px">はじめて使う端末では、職員コードを入れてください。次回からは入力不要です。</p>' +
    '<div class="form-group"><input class="form-input" type="password" inputmode="numeric" autocomplete="off" id="staffCode" placeholder="職員コード"></div>' +
    '<div class="error-text" id="codeError"></div>' +
    '<button type="button" class="btn-primary" id="codeBtn">確認する</button></div></div>';

  // ① 情報入力
  h += '<div class="step" id="step0"><div class="container"><div class="section-title">① ' + (C.mode === 'child' ? 'ご利用児童と保護者の情報' : 'ご利用者情報の入力') + '</div>';
  h += FIELDS.map(fieldHtml).join('');
  if (C.mode !== 'child') {
    h += '<label class="toggle"><input type="checkbox" id="hasGuardian">保護者の方も署名が必要（18歳未満など）</label>';
    h += '<div class="sub-section" id="guardianSection" style="display:none">' + GUARDIAN_FIELDS.map(fieldHtml).join('') + '</div>';
  }
  h += '<button type="button" class="btn-primary" id="next0">次へ　→　' + esc(C.docs[0].title) + 'の確認</button>';
  h += '<div class="footer-link"><a href="#" class="resetCode">職員コードを入れ直す</a></div></div></div>';

  // 書類ごと
  C.docs.forEach((doc, i) => {
    const n = i + 1, last = n === N;
    h += '<div class="step" id="step' + n + '"><div class="container">';
    h += '<div class="section-title">' + CIRCLED[n] + ' ' + esc(doc.title) + 'の確認・署名</div>';
    h += '<div class="scroll-hint">↕ スクロールして全文をご確認ください</div>';
    h += '<div class="document-box">' + blocksHtml(doc.blocks) + '</div>';
    h += '<div class="read-confirm">' + esc(doc.note) + '<br>よろしければ、下に署名をお願いします。</div>';
    doc.signers.forEach(s => { h += signatureHtml(doc, s.replace('?', ''), s.endsWith('?')); });
    h += '<button type="button" class="btn-primary" data-next="' + n + '">' + (last ? '署名を完了して保存する' : '次へ　→　' + esc(C.docs[i + 1].title) + 'の確認') + '</button>';
    h += '<button type="button" class="btn-secondary" data-back="' + (n - 1) + '">← 戻る</button>';
    h += '</div></div>';
  });

  // 完了
  h += '<div class="step" id="step' + (N + 1) + '"><div class="container"><div class="complete-screen">' +
    '<div class="complete-icon" id="completeIcon">✅</div><div class="complete-title" id="completeTitle">署名が完了しました</div>' +
    '<div class="status-badge" id="statusBadge"></div><div class="complete-message" id="completeMessage"></div>' +
    '<button type="button" class="btn-share" id="shareBtn" style="display:none">📤 控えのPDFをLINEやメールで送る</button>' +
    '<button type="button" class="btn-primary" id="newBtn" style="margin-top:12px">次の方の署名へ</button>' +
    '<div class="footer-link"><a href="#" class="resetCode">職員コードを入れ直す</a></div></div></div></div>';

  document.body.innerHTML = h;

  // イベント
  $('codeBtn').addEventListener('click', submitCode);
  $('staffCode').addEventListener('keydown', e => { if (e.key === 'Enter') submitCode(); });
  document.querySelectorAll('.resetCode').forEach(a => a.addEventListener('click', e => { e.preventDefault(); if (confirm('職員コードを入れ直しますか？')) { try { localStorage.removeItem(KEY_CODE); } catch (_) { } showStep('stepCode'); } }));
  $('next0').addEventListener('click', nextFromInfo);
  if ($('hasGuardian')) $('hasGuardian').addEventListener('change', e => setGuardian(e.target.checked));
  document.querySelectorAll('[data-next]').forEach(b => b.addEventListener('click', () => nextFromDoc(Number(b.dataset.next))));
  document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => goToStep(Number(b.dataset.back))));
  document.querySelectorAll('[data-clear]').forEach(b => b.addEventListener('click', () => clearCanvas(b.dataset.clear)));
  $('shareBtn').addEventListener('click', sharePDF);
  $('newBtn').addEventListener('click', startNew);
  $('contractDate').value = todayStr();
  try { const s = localStorage.getItem('furakoko_staff_name'); if (s && $('staffName')) $('staffName').value = s; } catch (e) { }
}

// ---------------- 画面の切り替え ----------------
function showStep(id) {
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
  window.scrollTo(0, 0);
}
function goToStep(n) {
  showStep('step' + n);
  currentStep = n;
  $('progressFill').style.width = Math.round(n / (N + 1) * 100) + '%';
  if (n >= 1 && n <= N) activeSigners(C.docs[n - 1]).forEach(s => initCanvas(canvasId(C.docs[n - 1], s)));
}
function setGuardian(on) {
  hasGuardian = on;
  $('guardianSection').style.display = on ? 'block' : 'none';
  C.docs.forEach(d => d.signers.filter(s => s.endsWith('?')).forEach(s => {
    const w = $('wrap_' + canvasId(d, s.replace('?', '')));
    if (w) w.style.display = on ? 'block' : 'none';
  }));
}
function nextFromInfo() {
  const missing = FIELDS.filter(f => f.req && !val(f.id)).map(f => f.label);
  if (C.mode !== 'child' && hasGuardian && !val('gName')) missing.push('保護者氏名');
  if (missing.length) { alert('次の項目を入力してください。\n・' + missing.join('\n・')); return; }
  try { if ($('staffName')) localStorage.setItem('furakoko_staff_name', val('staffName')); } catch (e) { }
  goToStep(1);
}
function nextFromDoc(n) {
  const doc = C.docs[n - 1];
  for (const s of activeSigners(doc)) {
    if (isCanvasEmpty(canvasId(doc, s))) { alert(doc.title + 'の「' + SIGNER_LABEL[s] + '」が必要です。'); return; }
  }
  if (n < N) goToStep(n + 1); else submitAll();
}

// ---------------- 署名欄（canvas） ----------------
// iPhoneは指を動かすとページを動かそうとするため、署名中だけそれを止める。
let SIGNING = false;
document.addEventListener('touchmove', e => { if (SIGNING) e.preventDefault(); }, { passive: false });

function initCanvas(id) {
  const canvas = $(id);
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;            // 見えていないときは初期化しない
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
  const ctx = canvas.getContext('2d');
  if (canvas.width !== w || canvas.height !== h) {
    let prev = null;
    if (canvas.width > 0 && canvas.height > 0 && !isCanvasEmpty(id)) prev = canvas.toDataURL('image/png');
    canvas.width = w; canvas.height = h;
    if (prev) {
      const img = new Image();
      img.onload = () => { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.drawImage(img, 0, 0, rect.width, rect.height); };
      img.src = prev;
    }
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.strokeStyle = '#1a1a2e'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (canvas.dataset.bound) return;                              // 二重登録しない
  canvas.dataset.bound = '1';
  let drawing = false;
  const pos = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const OPT = { passive: false };                                // iPhoneのSafariはこれがないとスクロールしてしまう
  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { }
    drawing = true; SIGNING = true;
    const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 0.01, p.y); ctx.stroke();
    const hint = $('hint_' + id); if (hint) hint.style.display = 'none';
  }, OPT);
  canvas.addEventListener('pointermove', e => {
    if (!drawing) return;
    e.preventDefault();
    const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke();
  }, OPT);
  const end = e => { drawing = false; SIGNING = false; try { canvas.releasePointerCapture(e.pointerId); } catch (_) { } };
  canvas.addEventListener('pointerup', end, OPT);
  canvas.addEventListener('pointercancel', end, OPT);
  canvas.addEventListener('pointerleave', end, OPT);
}
function clearCanvas(id) {
  const c = $(id); if (!c) return;
  const ctx = c.getContext('2d');
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height); ctx.restore();
  const h = $('hint_' + id); if (h) h.style.display = '';
}
function isCanvasEmpty(id) {
  const c = $(id);
  if (!c || !c.width || !c.height) return true;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) { if (d[i] !== 0) return false; }
  return true;
}
function getCanvasImage(id) {
  const c = $(id);
  if (!c) return null;
  const maxW = 800;
  if (c.width <= maxW) return c.toDataURL('image/png');
  const t = document.createElement('canvas');
  t.width = maxW; t.height = Math.round(c.height * maxW / c.width);
  t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
  return t.toDataURL('image/png');
}

// ---------------- PDF ----------------
// jsPDFの標準フォントは日本語に対応していないため、文字をcanvasに描いて画像として貼る。
const FONT_FAMILY = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic","Noto Sans JP",sans-serif';
function addJaText(doc, text, x, y, h, opt) {
  opt = opt || {};
  if (text === undefined || text === null || text === '') return 0;
  text = String(text);
  const PX = opt.px || 28;                                       // 文字画像の細かさ（30で印刷にも十分。大きいほどPDFが重くなる）
  const font = (opt.bold ? 'bold ' : '') + PX + 'px ' + FONT_FAMILY;
  const meas = document.createElement('canvas').getContext('2d');
  meas.font = font;
  const wPx = Math.ceil(meas.measureText(text).width) + 4;
  const hPx = Math.ceil(PX * 1.35);
  const c = document.createElement('canvas');
  c.width = wPx; c.height = hPx;
  const ctx = c.getContext('2d');
  // 白地に描いてJPEGにする（透明のPNGより大幅に軽い）。見出しの帯（ピンク）の上だけは帯の色で塗る。
  ctx.fillStyle = opt.bg || '#ffffff'; ctx.fillRect(0, 0, wPx, hPx);
  ctx.font = font; ctx.fillStyle = opt.color || '#000000'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 2, hPx / 2);
  const w = h * (wPx / hPx);
  doc.addImage(c.toDataURL('image/jpeg', 0.85), 'JPEG', x, y, w, h, undefined, 'FAST');
  return w;
}
function wrapJaText(text, fontPx, maxWidthPx, bold) {
  const meas = document.createElement('canvas').getContext('2d');
  meas.font = (bold ? 'bold ' : '') + fontPx + 'px ' + FONT_FAMILY;
  const lines = []; let cur = '';
  for (const ch of String(text)) {
    if (ch === '\n') { lines.push(cur); cur = ''; continue; }
    const test = cur + ch;
    if (meas.measureText(test).width > maxWidthPx && cur !== '') { lines.push(cur); cur = ch; } else { cur = test; }
  }
  if (cur !== '') lines.push(cur);
  return lines;
}
function addPdfHeader(doc, title) {
  doc.setFillColor(235, 163, 154); doc.rect(0, 0, 210, 12, 'F');
  addJaText(doc, title, 15, 3.5, 5, { bold: true, color: '#ffffff', bg: '#eba39a' });
}
function addJaBlocks(doc, blocks, title, startY) {
  const margin = 15, contentW = 180, bottom = 268, contentTop = 20, PPM = 8;
  const widthPx = Math.round(contentW * PPM);
  const styles = {
    h: { size: 5, bold: true, lh: 8.5, before: 0, after: 4 },
    s: { size: 4, bold: true, lh: 6.2, before: 3, after: 1.5 },
    p: { size: 3.5, bold: false, lh: 5.4, before: 0, after: 2.2 }
  };
  let y = startY;
  for (const b of blocks) {
    const st = styles[b[0]] || styles.p;
    const lines = wrapJaText(b[1], Math.round(st.size * PPM), widthPx, st.bold);
    y += st.before;
    for (const line of lines) {
      if (y + st.lh > bottom) { doc.addPage(); addPdfHeader(doc, title); y = contentTop; }
      addJaText(doc, line, margin, y, st.size, { bold: st.bold, color: '#333333' });
      y += st.lh;
    }
    y += st.after;
  }
  return y;
}
async function generatePDF(data) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const margin = 15, pageW = 210, contentW = pageW - margin * 2;
  const gray = { color: '#333333' };

  addPdfHeader(doc, C.name);
  let y = 45;
  addJaText(doc, '同 意 書 類 一 式', margin, y, 10, { bold: true, color: '#333333' }); y += 22;
  data.coverLines.forEach(l => { addJaText(doc, l, margin, y, 5, gray); y += 10; });
  y += 8;
  addJaText(doc, '本書類は、上記の方が端末の画面で全文を確認し、電子的に署名したものです。', margin, y, 4, { color: '#777777' }); y += 8;
  addJaText(doc, '本書には、署名の対象となった書類の全文を収録しています。', margin, y, 4, { color: '#777777' });

  C.docs.forEach(d => {
    doc.addPage(); addPdfHeader(doc, d.title);
    let y = 20;
    addJaText(doc, data.headLine, margin, y, 4.2, gray);
    addJaText(doc, '契約日：' + jpDate(data.date), pageW - margin - 42, y, 4, gray);
    y += 9;
    y = addJaBlocks(doc, d.blocks, d.title, y);
    y += 6;
    if (y + 20 > 268) { doc.addPage(); addPdfHeader(doc, d.title); y = 20; }
    addJaText(doc, d.note, margin, y, 4.2, { color: '#8a5548' }); y += 9;
    activeSigners(d).forEach(s => {
      if (y + 46 > 268) { doc.addPage(); addPdfHeader(doc, d.title); y = 20; }
      let label = SIGNER_LABEL[s];
      if (s === 'guardian' && data.guardianLabel) label += '（' + data.guardianLabel + '）';
      if (s === 'staff' && data.staffName) label += '（' + data.staffName + '）';
      addJaText(doc, label, margin, y, 4.2, { bold: true, color: '#333333' }); y += 6;
      doc.setDrawColor(235, 163, 154); doc.setLineWidth(0.5); doc.rect(margin, y, contentW * 0.7, 32);
      const img = data.signatures[d.key + '_' + s];
      if (img) doc.addImage(img, 'PNG', margin + 2, y + 2, contentW * 0.7 - 4, 28, undefined, 'FAST');
      y += 40;
    });
  });

  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    addJaText(doc, C.footer, margin, 278, 3.4, { color: '#999999' });
    addJaText(doc, i + ' / ' + total, pageW - margin - 12, 278, 3.4, { color: '#999999' });
  }
  const uri = doc.output('datauristring');
  return uri.substring(uri.indexOf(',') + 1);
}

// ---------------- 保存 ----------------
function collectData() {
  const date = val('contractDate');
  const sig = {};
  C.docs.forEach(d => activeSigners(d).forEach(s => { sig[d.key + '_' + s] = getCanvasImage(canvasId(d, s)); }));
  if (C.mode === 'child') {
    const g = val('guardianName') + '（続柄：' + val('guardianRelation') + '）';
    return {
      name: val('childName'), furigana: val('childFurigana'), date,
      headLine: '利用児童：' + val('childName') + '（' + val('childFurigana') + '）',
      coverLines: ['利用児童（フリガナ）：' + val('childFurigana'), '利用児童の氏名：' + val('childName'),
        '保護者：' + g, '住所：' + val('address'), '契約日：' + jpDate(date), '説明した職員：' + val('staffName')],
      guardianLabel: g, staffName: val('staffName'), signatures: sig
    };
  }
  const lines = ['氏名（フリガナ）：' + val('userFurigana'), '氏名：' + val('userName'), '住所：' + val('userAddress'), '契約日：' + jpDate(date)];
  let gl = '';
  if (hasGuardian && val('gName')) {
    gl = val('gName') + (val('gRelation') ? '（続柄：' + val('gRelation') + '）' : '');
    lines.push('保護者：' + gl);
    if (val('gAddress')) lines.push('保護者住所：' + val('gAddress'));
  }
  return {
    name: val('userName'), furigana: val('userFurigana'), date,
    headLine: '氏名：' + val('userName') + '（' + val('userFurigana') + '）',
    coverLines: lines, guardianLabel: gl, staffName: '', signatures: sig
  };
}
function safeName(s) { return String(s).replace(/[\\/:*?"<>|\s]+/g, ''); }

async function submitAll() {
  showLoading('PDFを作成しています...');
  try {
    const d = collectData();
    const pdfBase64 = await generatePDF(d);
    const fileName = safeName(d.furigana) + '_' + safeName(d.name) + '_' + d.date.replace(/-/g, '') + '.pdf';
    const bin = atob(pdfBase64);
    const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    lastPdfBlob = new Blob([bytes], { type: 'application/pdf' }); lastFileName = fileName;
    updateLoading('Googleドライブに保存しています...');
    const item = { office: C.office, fileName: fileName, pdfBase64: pdfBase64 };
    const r = await upload(item);
    if (!r.ok) await savePending(item);
    hideLoading(); showComplete(r, fileName);
  } catch (e) { hideLoading(); alert('エラーが起きました：' + e.message); }
}
function getCode() { try { return localStorage.getItem(KEY_CODE) || ''; } catch (e) { return ''; } }
async function post(body) {
  const res = await fetch(GAS_URL, {
    method: 'POST', redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // text/plainにすると事前確認（CORS）が不要になる
    body: JSON.stringify(body)
  });
  return res.json();
}
async function upload(item) {
  if (!navigator.onLine) return { ok: false, reason: 'offline' };
  try {
    const j = await post(Object.assign({ action: 'save', code: getCode() }, item));
    if (j && j.success) return { ok: true };
    if (j && j.error === 'code') return { ok: false, reason: 'code' };
    return { ok: false, reason: 'server' };
  } catch (e) { return { ok: false, reason: 'network' }; }
}
// 送れなかったPDFは、端末のIndexedDB（容量の大きい保存場所）に入れておき、あとで自動で送る。
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('furakoko-sign', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('pending', { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbAll() {
  const db = await idb();
  return new Promise((res, rej) => {
    const q = db.transaction('pending').objectStore('pending').getAll();
    q.onsuccess = () => res(q.result.filter(x => x.office === C.office));
    q.onerror = () => rej(q.error);
  });
}
async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('pending', mode);
    fn(tx.objectStore('pending'));
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function savePending(item) {
  try { await idbDo('readwrite', st => st.add(item)); }
  catch (e) { alert('端末に一時保存できませんでした。完了画面の「控えのPDFを送る」で、PDFを必ず残してください。'); }
  updatePendingBanner();
}
let checking = false;
async function checkPendingUploads() {
  if (checking || !navigator.onLine || !getCode()) return;
  checking = true;
  try {
    const pending = await idbAll();
    for (const item of pending) {
      const r = await upload(item);
      if (r.ok) await idbDo('readwrite', st => st.delete(item.id));
    }
  } catch (e) { }
  checking = false;
  updatePendingBanner();
}
async function updatePendingBanner() {
  let n = 0;
  try { n = (await idbAll()).length; } catch (e) { }
  if (!$('pendingCount')) return;
  $('pendingCount').textContent = n;
  $('pendingBanner').style.display = n > 0 ? 'block' : 'none';
}
function showComplete(r, fileName) {
  goToStep(N + 1);
  if (r.ok) {
    $('completeIcon').textContent = '✅';
    $('completeTitle').textContent = '署名が完了しました';
    $('statusBadge').textContent = 'Googleドライブに保存しました';
    $('statusBadge').className = 'status-badge status-saved';
    $('completeMessage').textContent = fileName + '\n\nGoogleドライブの「' + C.folderLabel + '」フォルダに保存しました。';
  } else {
    $('completeIcon').textContent = '📥';
    $('completeTitle').textContent = '署名を端末に一時保存しました';
    $('statusBadge').textContent = '通信できるときに自動で送ります';
    $('statusBadge').className = 'status-badge status-pending';
    $('completeMessage').textContent = r.reason === 'code'
      ? '職員コードが違うため、保存できませんでした。\n下の「職員コードを入れ直す」から正しいコードを入れると、自動で送ります。'
      : 'いまは保存できなかったため、この端末に一時保存しました。\n通信できる状態でこのアプリを開くと、自動で送ります。';
  }
  $('shareBtn').style.display = lastPdfBlob ? 'block' : 'none';
}
async function sharePDF() {
  if (!lastPdfBlob || !lastFileName) return;
  try {
    const file = new File([lastPdfBlob], lastFileName, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: '同意書', text: C.name + '　同意書類' });
    } else {
      const url = URL.createObjectURL(lastPdfBlob);
      const a = document.createElement('a'); a.href = url; a.download = lastFileName; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  } catch (e) { if (e.name !== 'AbortError') alert('送れませんでした：' + e.message); }
}
function startNew() {
  FIELDS.concat(GUARDIAN_FIELDS).forEach(f => { if (!f.keep && $(f.id)) $(f.id).value = ''; });
  $('contractDate').value = todayStr();
  if (C.mode !== 'child') { $('hasGuardian').checked = false; setGuardian(false); }
  allCanvasIds().forEach(clearCanvas);
  lastPdfBlob = null; lastFileName = '';
  goToStep(0);
  checkPendingUploads();
}

// ---------------- 職員コード ----------------
async function submitCode() {
  const code = $('staffCode').value.trim();
  $('codeError').textContent = '';
  if (!code) { $('codeError').textContent = '職員コードを入れてください。'; return; }
  showLoading('確認しています...');
  try {
    const j = await post({ action: 'check', code: code });
    hideLoading();
    if (j && j.success) { saveCode(code); return; }
    $('codeError').textContent = '職員コードが違います。もう一度入れてください。';
  } catch (e) {
    hideLoading();
    // 通信できないときは、いったん保存しておき、送信のときに確かめる
    saveCode(code);
    alert('いま通信できないため、職員コードの確認はあとで行います。');
  }
}
function saveCode(code) {
  try { localStorage.setItem(KEY_CODE, code); } catch (e) { }
  $('staffCode').value = '';
  goToStep(0);
  checkPendingUploads();
}

function showLoading(t) { $('loadingText').textContent = t; $('loading').classList.remove('hidden'); }
function updateLoading(t) { $('loadingText').textContent = t; }
function hideLoading() { $('loading').classList.add('hidden'); }

// ---------------- 起動 ----------------
window.addEventListener('load', () => {
  build();
  updatePendingBanner();
  if (getCode()) goToStep(0); else showStep('stepCode');
  checkPendingUploads();
  window.addEventListener('online', checkPendingUploads);
  let rt = null;
  const onResize = () => {
    clearTimeout(rt);
    rt = setTimeout(() => { if (currentStep >= 1 && currentStep <= N) activeSigners(C.docs[currentStep - 1]).forEach(s => initCanvas(canvasId(C.docs[currentStep - 1], s))); }, 200);
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
});
