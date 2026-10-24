// 通用源码扫描器:适配压缩代码(避免超长行问题),按正则提取匹配并去重。
// usage: node scan.js <file> <outFile>
const fs = require('fs');

const file = process.argv[2];
const outFile = process.argv[3];
const src = fs.readFileSync(file, 'utf8');

const PATTERNS = [
  { name: 'URL', re: /https?:\/\/[A-Za-z0-9\-._~:\/?#\[\]@!$&'()*+,;=%]+/g },
  { name: 'WAPI', re: /\/wapi\/[A-Za-z0-9_\/.\-]+/g },
  { name: 'SELECTOR', re: /["'`](\.[A-Za-z][A-Za-z0-9_\-]*(?:\s*[>+~]\s*[.#]?[A-Za-z][A-Za-z0-9_\-]*)*)["'`]/g },
  { name: 'CN', re: /["'`]([^"'`\n]{1,60}[\u4e00-\u9fa5][^"'`\n]{0,60})["'`]/g }
];

const out = [];
for (const p of PATTERNS) {
  const seen = new Set();
  let m;
  while ((m = p.re.exec(src)) !== null) {
    const v = (m[1] !== undefined ? m[1] : m[0]).trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(`[${p.name}] ${v}`);
  }
}
out.sort();
fs.writeFileSync(outFile, `# total=${out.length}\n` + out.join('\n'), 'utf8');
console.log('scanned ' + out.length + ' unique matches');
