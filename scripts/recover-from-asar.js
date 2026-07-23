// 从 dist-11.8.4 的 app.asar 解压后端真源码到暂存目录 .recovered-11.8.4/
// 只救后端：main.js / package.json / src / migrations / resources/models
// 不碰：build(前端压缩产物) / node_modules
const asar = require('@electron/asar');
const fs = require('fs');
const path = require('path');

const A = 'dist-11.8.4/win-unpacked/resources/app.asar';
const OUT = '.recovered-11.8.4';
const wantTop = new Set(['main.js', 'package.json']);
const wantDirs = new Set(['src', 'migrations', 'resources']);

const entries = asar.listPackage(A);
let files = 0;
for (const raw of entries) {
  const rel = raw.replace(/^[\\/]+/, '').split('\\').join('/'); // 去头部分隔符, \ -> /
  const top = rel.split('/')[0];
  if (top === 'resources' && !rel.startsWith('resources/models')) continue; // resources 只要 models
  if (!(wantTop.has(rel) || wantDirs.has(top))) continue;
  // extractFile 对 key 格式敏感,依次尝试几种变体
  const keys = [raw.replace(/^[\\/]+/, ''), raw, rel];
  let buf = null;
  for (const k of keys) { try { buf = asar.extractFile(A, k); break; } catch (e) {} }
  if (buf === null) continue; // 目录或取不到 -> 跳过
  const dest = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  files++;
}
console.log('已解压后端文件数:', files);
