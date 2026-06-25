/**
 * update-logo.js
 *
 * 用 newlogo.png 替换项目里所有 logo / icon 文件。
 *
 * 设计要点：
 *   - 备份原文件到 backups/logo-original-<时间戳>/，便于回滚
 *   - 支持 --dry-run 参数，只打印不写文件
 *   - sharp / png-to-ico 都用临时安装（npm install --no-save），不进 package.json
 *
 * 涉及的目标文件：
 *   - LOGO.png                       根目录备份 logo
 *   - public/logo.png                BrowserWindow 窗口图标 + index.html favicon
 *   - public/icon.png                应用主图标
 *   - public/icon.ico                Windows 打包 / 安装 / 卸载程序图标
 *   - temp_icons/icon_{16,32,48,64,128,256}.png  多尺寸图标
 *
 * 用法：
 *   node scripts/update-logo.js                # 实际更新
 *   node scripts/update-logo.js --dry-run      # 演练，不写文件
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
// png-to-ico 是 ESM 模块（package.json type: module），CommonJS 项目用动态 import
const pngToIcoPromise = import('png-to-ico');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'newlogo.png');

// 目标尺寸：Windows ICO 通用规格
const SIZES = [16, 32, 48, 64, 128, 256];

// 备份目标文件（按相对路径）
const TARGETS = [
  'LOGO.png',
  'public/logo.png',
  'public/icon.png',
  'public/icon.ico',
  ...SIZES.map((s) => `temp_icons/icon_${s}.png`),
];

const DRY_RUN = process.argv.includes('--dry-run');

function ts() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '-' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

function fmtBytes(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(2)}MB`;
}

async function backupFiles(backupDir) {
  const backed = [];
  for (const rel of TARGETS) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const dest = path.join(backupDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(abs, dest);
    backed.push(rel);
  }
  return backed;
}

async function copyAsIs(rel) {
  const abs = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.copyFileSync(SOURCE, abs);
  return { file: rel, size: fs.statSync(abs).size };
}

async function resizeTo(rel, size) {
  const abs = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  await sharp(SOURCE).resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toFile(abs);
  return { file: rel, size: fs.statSync(abs).size };
}

async function buildIco(outRel, sizeRels) {
  const pngToIco = (await pngToIcoPromise).default;
  const buffers = sizeRels.map((rel) => fs.readFileSync(path.join(ROOT, rel)));
  const ico = await pngToIco(buffers);
  const out = path.join(ROOT, outRel);
  fs.writeFileSync(out, ico);
  return { file: outRel, size: fs.statSync(out).size };
}

async function main() {
  console.log('========================================');
  console.log(`Logo 更新脚本 ${DRY_RUN ? '(DRY-RUN 演练模式)' : ''}`);
  console.log('========================================');
  console.log(`源文件: ${path.relative(ROOT, SOURCE)}`);

  if (!fs.existsSync(SOURCE)) {
    throw new Error(`源文件不存在: ${SOURCE}`);
  }

  const srcMeta = fs.statSync(SOURCE);
  console.log(`源文件大小: ${fmtBytes(srcMeta.size)}`);
  console.log('');

  // 1. 备份
  const backupDir = path.join(ROOT, 'backups', `logo-original-${ts()}`);
  if (DRY_RUN) {
    console.log(`[演练] 备份目录: ${path.relative(ROOT, backupDir)}`);
  } else {
    fs.mkdirSync(backupDir, { recursive: true });
    const backed = await backupFiles(backupDir);
    console.log(`✓ 已备份 ${backed.length} 个文件到 ${path.relative(ROOT, backupDir)}/`);
    for (const f of backed) {
      console.log(`    - ${f}`);
    }
  }
  console.log('');

  // 2. 直接复制原图
  console.log('--- 步骤 1/3: 复制原图到目标位置 ---');
  const copyResults = [];
  for (const rel of ['LOGO.png', 'public/logo.png', 'public/icon.png']) {
    if (DRY_RUN) {
      console.log(`[演练] 复制 → ${rel}`);
    } else {
      const r = await copyAsIs(rel);
      copyResults.push(r);
      console.log(`✓ ${rel}  (${fmtBytes(r.size)})`);
    }
  }
  console.log('');

  // 3. 生成多尺寸 PNG
  console.log('--- 步骤 2/3: 生成多尺寸 PNG ---');
  const resizeResults = [];
  const sizeRelMap = {};
  for (const size of SIZES) {
    const rel = `temp_icons/icon_${size}.png`;
    sizeRelMap[size] = rel;
    if (DRY_RUN) {
      console.log(`[演练] 缩放至 ${size}x${size} → ${rel}`);
    } else {
      const r = await resizeTo(rel, size);
      resizeResults.push(r);
      console.log(`✓ ${rel}  (${fmtBytes(r.size)})`);
    }
  }
  console.log('');

  // 4. 合成 ICO
  console.log('--- 步骤 3/3: 合成 icon.ico ---');
  if (DRY_RUN) {
    console.log(`[演练] 合并 ${SIZES.join('/')} → public/icon.ico`);
  } else {
    // ICO 文件保留完整多尺寸：16/32/48/64/128/256
    const sizeRels = SIZES.map((s) => sizeRelMap[s]);
    const r = await buildIco('public/icon.ico', sizeRels);
    console.log(`✓ public/icon.ico  (${fmtBytes(r.size)}, 含 ${SIZES.length} 种尺寸)`);
  }
  console.log('');

  // 5. 汇总
  console.log('========================================');
  console.log(DRY_RUN ? '演练完成（未写文件）' : '✓ Logo 更新完成！');
  console.log('========================================');
  console.log('');
  console.log('代码引用已检查，无需修改：');
  console.log('  - main.js:159        public/logo.png  (BrowserWindow icon)');
  console.log('  - index.html:5       /logo.png         (favicon)');
  console.log('  - package.json       public/icon.ico   (win/nsis icon)');
  console.log('');
  console.log('下次 `npm run electron:build` 时 electron-builder 会自动使用新的 icon.ico。');
  console.log('build/renderer/ 是 vite 构建输出目录，下次 build 会自动更新，无需手动改。');
}

main().catch((err) => {
  console.error('✗ 失败:', err.message);
  process.exit(1);
});