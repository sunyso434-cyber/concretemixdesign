# 版本更新记录

## v3.4.0 (2026-05-08)

### 打包内容
- **安装包**: `混凝土配合比设计软件 Setup 3.4.0.exe` (126.4 MB)
- **便携版**: `混凝土配合比设计软件-3.4.0-x64.exe` (126.2 MB)

### 修复内容
1. 修复 `src/renderer/main.jsx` 中 Redux Provider 的导入路径错误 (`../../store/index` → `./store/index`)
2. 修复 `MixDesignPage.jsx` 中的 store 导入路径 (`../../store/mixDesignSlice` → `../store/mixDesignSlice`)
3. 修复 `OptimizationPage.jsx` 中的 store 导入路径 (`../../store/mixDesignSlice` → `../store/mixDesignSlice`)
4. 重建缺失的 `src/renderer/store/` 目录及相关文件:
   - `store/index.js` - Redux store 配置
   - `store/mixDesignSlice.js` - mixDesign 状态切片

### 文件变更
- 新增: `src/renderer/store/index.js`
- 新增: `src/renderer/store/mixDesignSlice.js`
- 修改: `src/renderer/main.jsx`
- 修改: `src/renderer/pages/MixDesignPage.jsx`
- 修改: `src/renderer/pages/OptimizationPage.jsx`