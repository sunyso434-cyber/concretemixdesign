const fs = require('fs');
const path = require('path');

// 生成时间戳
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupName = `concrete-mixdesign-backup-${timestamp}`;
const backupDir = path.join(__dirname, 'backups');
const backupFilePath = path.join(backupDir, `${backupName}.zip`);

// 创建备份目录
if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
  console.log(`创建备份目录: ${backupDir}`);
}

// 需要备份的文件和目录
const includePaths = [
  'src/',
  'db/',
  'models/',
  'config/',
  'doc/',
  'migrations/',
  'main.js',
  'package.json',
  'package-lock.json',
  'vite.config.js'
];

// 排除的文件和目录
const excludePaths = [
  'build/',
  'dist/',
  'node_modules/',
  'backups/',
  '.trae/'
];

// 检查是否有zlib模块可用
let zlib;
try {
  zlib = require('zlib');
} catch (error) {
  console.error('zlib模块不可用，使用简单的文件复制模式');
  createSimpleBackup();
  process.exit(0);
}

// 检查是否有archiver模块
let archiver;
try {
  archiver = require('archiver');
  createZipBackup();
} catch (error) {
  console.log('archiver模块不可用，使用简单的文件复制模式');
  createSimpleBackup();
}

function createZipBackup() {
  console.log('开始创建ZIP备份...');
  
  const output = fs.createWriteStream(backupFilePath);
  const archive = archiver('zip', {
    zlib: { level: 9 }
  });

  output.on('close', function() {
    console.log(`\n备份完成! 备份文件: ${backupFilePath}`);
    console.log(`备份文件大小: ${(archive.pointer() / (1024 * 1024)).toFixed(2)} MB`);
    cleanOldBackups(backupDir, 5);
  });

  archive.on('error', function(err) {
    console.error('备份失败:', err.message);
    process.exit(1);
  });

  archive.pipe(output);

  // 添加文件和目录
  includePaths.forEach(item => {
    const fullPath = path.join(__dirname, item);
    const stats = fs.statSync(fullPath);
    
    if (stats.isDirectory()) {
      archive.directory(fullPath, item);
    } else {
      archive.file(fullPath, { name: item });
    }
  });

  archive.finalize();
}

function createSimpleBackup() {
  console.log('开始创建简单备份...');
  
  const backupFolderPath = path.join(backupDir, backupName);
  
  // 创建备份文件夹
  if (!fs.existsSync(backupFolderPath)) {
    fs.mkdirSync(backupFolderPath, { recursive: true });
  }

  // 复制文件和目录
  includePaths.forEach(item => {
    const sourcePath = path.join(__dirname, item);
    const destPath = path.join(backupFolderPath, item);
    
    if (fs.statSync(sourcePath).isDirectory()) {
      copyDirectory(sourcePath, destPath);
    } else {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(sourcePath, destPath);
    }
  });

  console.log(`\n备份完成! 备份目录: ${backupFolderPath}`);
  cleanOldBackups(backupDir, 5);
}

function copyDirectory(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const files = fs.readdirSync(src);
  files.forEach(file => {
    const srcPath = path.join(src, file);
    const destPath = path.join(dest, file);
    
    const stats = fs.statSync(srcPath);
    if (stats.isDirectory()) {
      copyDirectory(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  });
}

function cleanOldBackups(dir, keepCount) {
  const items = fs.readdirSync(dir)
    .map(item => {
      const itemPath = path.join(dir, item);
      const stats = fs.statSync(itemPath);
      return {
        name: item,
        path: itemPath,
        mtime: stats.mtime,
        isDirectory: stats.isDirectory()
      };
    })
    .sort((a, b) => b.mtime - a.mtime);
  
  if (items.length > keepCount) {
    const toDelete = items.slice(keepCount);
    console.log(`\n清理旧备份:`);
    toDelete.forEach(item => {
      if (item.isDirectory) {
        deleteDirectory(item.path);
      } else {
        fs.unlinkSync(item.path);
      }
      console.log(`- 删除: ${item.name}`);
    });
  }
}

function deleteDirectory(dir) {
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
      deleteDirectory(filePath);
    } else {
      fs.unlinkSync(filePath);
    }
  });
  fs.rmdirSync(dir);
}
