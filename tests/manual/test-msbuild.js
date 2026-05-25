const { execSync } = require('child_process');

try {
  // 尝试使用完整路径运行msbuild
  const result = execSync('"C:\\Program Files (x86)\\Microsoft Visual Studio\\18\\BuildTools\\MSBuild\\Current\\Bin\\MSBuild.exe" -version', { encoding: 'utf8' });
  console.log('MSBuild version:', result);
  
  // 尝试直接运行msbuild命令
  try {
    const directResult = execSync('msbuild -version', { encoding: 'utf8' });
    console.log('Direct msbuild version:', directResult);
  } catch (error) {
    console.log('Direct msbuild command failed:', error.message);
  }
  
  // 输出当前PATH
  console.log('Current PATH:', process.env.PATH);
  
} catch (error) {
  console.error('Error running msbuild:', error.message);
}