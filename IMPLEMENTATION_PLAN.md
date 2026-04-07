# 混凝土配合比设计软件 - 双栏精细调控工作台实现计划

> **对于代理工作者:** 推荐使用 superpowers:subagent-driven-development 来逐步实现本计划。每个任务使用复选框 (`- [ ]`) 标记进度。

**目标:** 实现具有Apple设计风格的混凝土配合比设计工作台，支持精细参数调整、实时计算反馈、多方案对比和成本分析。

**架构:** 前端采用React + TypeScript构建，使用Tailwind CSS深色主题实现Apple风格设计。左侧为参数输入面板（固定宽度）, 右侧为标签页结果展示区。所有参数改动触发实时计算引擎，结果通过Redux状态管理同步更新。

**技术栈:**
- React 18 + TypeScript
- Tailwind CSS (深色主题)
- Redux Toolkit (状态管理)
- Recharts (图表/进度条)
- Framer Motion (动画)
- Vite (构建)

---

## 第一部分: 文件结构规划

```
src/
├── components/
│   ├── common/              # 基础UI组件库
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   ├── Select.tsx
│   │   ├── Slider.tsx
│   │   ├── Radio.tsx
│   │   ├── Card.tsx
│   │   ├── Table.tsx
│   │   └── Progress.tsx
│   ├── layout/
│   │   ├── AppShell.tsx     # 应用外壳
│   │   ├── Navbar.tsx       # 顶部导航
│   │   ├── MainLayout.tsx   # 左右双栏布局
│   │   └── Sidebar.tsx      # 左侧参数面板
│   └── mixdesign/
│       ├── DesignPanel.tsx  # 左侧参数输入面板
│       ├── ResultTabs.tsx   # 右侧标签页导航
│       ├── ResultContent.tsx # 右侧结果展示
│       ├── tabs/
│       │   ├── CalculationTab.tsx
│       │   ├── ValidationTab.tsx
│       │   ├── OptimizationTab.tsx
│       │   └── CostAnalysisTab.tsx
│       └── MixDesignPage.tsx # 页面组件
├── store/
│   ├── slices/
│   │   ├── designSlice.ts    # 设计参数状态
│   │   ├── calculateSlice.ts # 计算结果状态
│   │   ├── schemeSlice.ts    # 方案管理状态
│   │   └── uiSlice.ts        # UI状态（选中标签页等）
│   └── store.ts
├── services/
│   ├── calculationService.ts # 配合比计算引擎
│   ├── optimizationService.ts # 优化算法
│   ├── costAnalysisService.ts # 成本分析
│   ├── validationService.ts  # 验证规则
│   └── apiService.ts         # 后端API调用
├── hooks/
│   ├── useDesignParams.ts    # 参数管理hook
│   ├── useCalculation.ts     # 计算hook
│   └── useSchemes.ts         # 方案管理hook
├── styles/
│   ├── globals.css
│   ├── theme.css
│   └── animations.css
├── types/
│   ├── design.ts             # 设计参数类型
│   ├── calculation.ts        # 计算结果类型
│   └── scheme.ts             # 方案类型
├── utils/
│   ├── validators.ts         # 参数验证
│   ├── formatters.ts         # 数据格式化
│   └── constants.ts          # 常量定义
└── App.tsx

tests/
├── components/
├── services/
└── utils/
```

---

## 第二部分: 分阶段实现任务

### 阶段1: 基础UI组件库

#### Task 1.1: 建立Tailwind深色主题配置

**文件:**
- Modify: `tailwind.config.js`
- Create: `src/styles/theme.css`
- Create: `src/styles/globals.css`

- [ ] **Step 1: 配置tailwind深色主题色值**

根据设计规范配置所有色值:
```javascript
// tailwind.config.js
theme: {
  colors: {
    'dark': {
      'bg-primary': '#1a1a1a',
      'bg-secondary': '#0f0f0f',
      'surface': '#2d2d2d',
      'surface-light': '#3a3a3c',
      'text-primary': '#f5f5f7',
      'text-secondary': '#a1a1a6',
      'text-tertiary': '#86868b',
    },
    'accent': {
      'primary': '#0071e3',
      'success': '#34c759',
      'warning': '#ff9500',
      'error': '#ff3b30',
    }
  }
}
```

- [ ] **Step 2: 配置字体系统**

```css
/* src/styles/theme.css */
:root {
  --font-display: "SF Pro Display", system-ui, sans-serif;
  --font-body: "SF Pro Text", -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: "SF Mono", "Monaco", monospace;
  
  --text-xl: clamp(1.75rem, 2vw, 2rem);
  --text-lg: 1.125rem;
  --text-base: 0.875rem;
  --text-sm: 0.75rem;
}
```

- [ ] **Step 3: 设置全局样式**

```css
/* src/styles/globals.css */
* {
  @apply border-border;
}

html {
  @apply bg-dark-bg-primary text-dark-text-primary;
}

body {
  @apply font-body antialiased;
}
```

- [ ] **Step 4: 验证主题色加载**

在浏览器开发者工具查看颜色正确应用

- [ ] **Step 5: Commit**

```bash
git add tailwind.config.js src/styles/
git commit -m "feat: setup Tailwind dark theme system"
```

---

#### Task 1.2: 实现基础Button组件

**文件:**
- Create: `src/components/common/Button.tsx`
- Create: `src/components/common/__tests__/Button.test.tsx`
- Modify: `src/components/common/index.ts`

- [ ] **Step 1: 编写Button组件测试**

```typescript
// src/components/common/__tests__/Button.test.tsx
import { render, screen } from '@testing-library/react';
import Button from '../Button';

describe('Button', () => {
  it('renders button with text', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByText('Click me')).toBeInTheDocument();
  });

  it('applies primary variant styles', () => {
    const { container } = render(<Button variant="primary">Click</Button>);
    expect(container.querySelector('button')).toHaveClass('bg-accent-primary');
  });

  it('applies secondary variant styles', () => {
    const { container } = render(<Button variant="secondary">Click</Button>);
    expect(container.querySelector('button')).toHaveClass('border');
  });

  it('disables button when disabled prop is true', () => {
    render(<Button disabled>Click</Button>);
    expect(screen.getByText('Click')).toBeDisabled();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -- Button.test.tsx
```

Expected: FAIL (组件未实现)

- [ ] **Step 3: 实现Button组件**

```typescript
// src/components/common/Button.tsx
import React from 'react';
import { cn } from '@/utils/cn';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, disabled, children, ...props }, ref) => {
    const baseStyles = 'rounded-lg font-medium transition-all duration-200 focus:outline-none';
    
    const variantStyles = {
      primary: 'bg-accent-primary text-white hover:opacity-90 active:scale-98',
      secondary: 'border border-dark-surface-light text-dark-text-primary hover:bg-dark-surface',
      ghost: 'text-accent-primary hover:bg-dark-surface',
      danger: 'bg-accent-error text-white hover:opacity-90',
    };

    const sizeStyles = {
      sm: 'px-3 py-2 text-sm',
      md: 'px-4 py-2.5 text-base',
      lg: 'px-6 py-3 text-lg',
    };

    return (
      <button
        ref={ref}
        className={cn(
          baseStyles,
          variantStyles[variant],
          sizeStyles[size],
          disabled && 'opacity-50 cursor-not-allowed',
          className
        )}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? '加载中...' : children}
      </button>
    );
  }
);

Button.displayName = 'Button';
export default Button;
```

- [ ] **Step 4: 运行测试验证通过**

```bash
npm test -- Button.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/common/Button.tsx
git commit -m "feat: implement Button component with variants"
```

---

#### Task 1.3: 实现Input组件

**文件:**
- Create: `src/components/common/Input.tsx`
- Create: `src/components/common/__tests__/Input.test.tsx`

[类似于Button的TDD流程...]

- [ ] **Step 1: 编写Input测试**
- [ ] **Step 2: 运行测试确认失败**
- [ ] **Step 3: 实现Input组件（支持文字、数字、搜索变体）**
- [ ] **Step 4: 运行测试验证通过**
- [ ] **Step 5: Commit**

---

#### Task 1.4-1.9: 实现其他基础组件

类似步骤实现:
- Select (下拉菜单)
- Slider (滑块)
- Radio (单选按钮)
- Card (卡片容器)
- Table (数据表格)

每个组件完成TDD流程 + Commit

---

### 阶段2: 布局组件

#### Task 2.1: 实现Navbar（顶部导航栏）

**文件:**
- Create: `src/components/layout/Navbar.tsx`
- Create: `src/components/layout/__tests__/Navbar.test.tsx`

- [ ] **Step 1: 编写Navbar测试**

```typescript
describe('Navbar', () => {
  it('renders logo and project name', () => {
    render(<Navbar projectName="项目001" />);
    expect(screen.getByText('项目001')).toBeInTheDocument();
  });

  it('displays save status indicator', () => {
    render(<Navbar saveStatus="saved" />);
    expect(screen.getByText('✓ 已保存')).toBeInTheDocument();
  });

  it('opens user menu on click', () => {
    render(<Navbar />);
    fireEvent.click(screen.getByRole('button', { name: /user/i }));
    expect(screen.getByText('个人资料')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2-5: 实现、测试、Commit**

---

#### Task 2.2: 实现MainLayout（左右双栏布局）

**文件:**
- Create: `src/components/layout/MainLayout.tsx`

在1920x1080分辨率下:
- 左侧固定380px
- 右侧自适应宽度
- 间距16px
- 背景#1a1a1a

---

### 阶段3: 业务组件

#### Task 3.1: 实现DesignPanel（左侧参数输入面板）

**文件:**
- Create: `src/types/design.ts`
- Create: `src/components/mixdesign/DesignPanel.tsx`

**设计参数类型定义:**
```typescript
export interface DesignParams {
  strengthGrade: string; // C30, C40, C50等
  environmentCategory: 'normal' | 'harsh' | 'extreme';
  slump: number; // 坍落度 0-200mm
  cement: string; // 水泥选择
  coarseAggregate: string; // 粗骨料
  fineAggregate: string; // 细骨料
  admixture?: string; // 外加剂
  budgetPrice: number; // 预算¥/m³
  optimizationTrend: 'balance' | 'cost' | 'performance';
}
```

**参数组件:**
- [ ] **Step 1: 创建表单状态管理**

使用Redux管理参数状态

- [ ] **Step 2: 实现设计参数组**

强度等级、环境类别、坍落度等

- [ ] **Step 3: 实现原材料选择组**

水泥、粗骨料、细骨料、外加剂下拉菜单

- [ ] **Step 4: 实现成本目标组**

预算单价、优化倾向、估算成本显示

- [ ] **Step 5: 实现操作按钮**

【立即计算】【保存方案】

- [ ] **Step 6: 集成到页面**
- [ ] **Step 7: Commit**

---

#### Task 3.2: 实现计算引擎

**文件:**
- Create: `src/services/calculationService.ts`
- Create: `src/services/validationService.ts`
- Create: `src/types/calculation.ts`
- Create: `tests/services/calculationService.test.ts`

**计算结果类型:**
```typescript
export interface MixDesignResult {
  water: number;
  cement: number;
  coarseAggregate: number;
  fineAggregate: number;
  admixture?: number;
  waterCementRatio: number; // 水灰比
  sandRatio: number; // 砂率
  unitVolumeWeight: number; // 单位体积质量
  fluidity: string; // 流动性
}
```

**步骤:**
- [ ] **Step 1: 编写计算逻辑测试**

```typescript
describe('calculationService', () => {
  it('calculates mix design correctly', () => {
    const params = {
      strengthGrade: 'C40',
      slump: 150,
      // ...其他参数
    };
    const result = calculateMixDesign(params);
    expect(result.cement).toBeCloseTo(320, -1);
    expect(result.waterCementRatio).toBeCloseTo(0.58, 1);
  });
});
```

- [ ] **Step 2: 根据设计规范实现计算算法**

基于国标GB/T 14902 的配合比计算

- [ ] **Step 3: 实现参数验证规则**

确保计算结果符合规范

- [ ] **Step 4: Commit**

---

#### Task 3.3: 实现结果展示标签页

**文件:**
- Create: `src/components/mixdesign/tabs/CalculationTab.tsx`
- Create: `src/components/mixdesign/tabs/ValidationTab.tsx`
- Create: `src/components/mixdesign/tabs/OptimizationTab.tsx`
- Create: `src/components/mixdesign/tabs/CostAnalysisTab.tsx`

**CalculationTab (计算结果):**
- [ ] 原材料用量表（水、水泥、粗骨料、细骨料、外加剂）
- [ ] 进度条显示百分比
- [ ] 关键性能指标表
- [ ] 实时更新逻辑

**ValidationTab (验证报告):**
- [ ] 强度验证（✓/⚠/✗）
- [ ] 工作性验证
- [ ] 耐久性验证
- [ ] 成本验证
- [ ] 配比可行性
- [ ] 改进建议列表

**OptimizationTab (优化建议):**
- [ ] 生成3个优化方案
- [ ] 显示成本和性能变化
- [ ] 【应用此优化】按钮

**CostAnalysisTab (成本分析):**
- [ ] 成本明细表
- [ ] 成本驱动因素分析
- [ ] 【对比其他方案】功能
- [ ] 【导出成本报告】功能

---

#### Task 3.4: 实现优化建议生成

**文件:**
- Create: `src/services/optimizationService.ts`

根据当前配合比生成3个优化方案:
1. 成本优化：降低水泥用量、增加骨料比例
2. 性能优化：降低水灰比、增加外加剂
3. 平衡优化：最小化成本和性能变化

---

#### Task 3.5: 实现成本分析功能

**文件:**
- Create: `src/services/costAnalysisService.ts`

功能:
- [ ] 根据材料单价计算总成本
- [ ] 识别成本驱动因素
- [ ] 与预算对比
- [ ] 生成成本对比表

---

### 阶段4: 状态管理与集成

#### Task 4.1: 设置Redux状态管理

**文件:**
- Create: `src/store/store.ts`
- Create: `src/store/slices/designSlice.ts`
- Create: `src/store/slices/calculateSlice.ts`
- Create: `src/store/slices/schemeSlice.ts`
- Create: `src/store/slices/uiSlice.ts`

**designSlice:**
```typescript
export interface DesignState {
  params: DesignParams;
  loading: boolean;
  error?: string;
}

const designSlice = createSlice({
  name: 'design',
  initialState,
  reducers: {
    setDesignParams: (state, action) => { /* ... */ },
    updateParam: (state, action) => { /* ... */ },
  },
});
```

类似地创建其他slices...

---

#### Task 4.2: 创建自定义Hooks

**文件:**
- Create: `src/hooks/useDesignParams.ts`
- Create: `src/hooks/useCalculation.ts`
- Create: `src/hooks/useSchemes.ts`

```typescript
export function useDesignParams() {
  const dispatch = useDispatch();
  const params = useSelector(state => state.design.params);
  
  return {
    params,
    updateParam: (key: string, value: any) => {
      dispatch(updateParam({ key, value }));
    },
  };
}
```

---

#### Task 4.3: 集成MixDesignPage

**文件:**
- Create: `src/components/mixdesign/MixDesignPage.tsx`

- [ ] **Step 1: 组合左侧DesignPanel和右侧ResultTabs**
- [ ] **Step 2: 实现参数改动→计算→结果更新的数据流**
- [ ] **Step 3: 集成Redux-DevTools调试**
- [ ] **Step 4: Commit**

---

### 阶段5: 高级功能

#### Task 5.1: 实现参数链接智能推荐

- [ ] 选择强度等级后，自动推荐水灰比
- [ ] 改变环境类别后，更新验证规则
- [ ] 实时成本计算和颜色变化

#### Task 5.2: 实现方案保存和对比

**文件:**
- Create: `src/services/apiService.ts` (连接后端)

- [ ] 保存当前方案到数据库
- [ ] 加载历史方案列表
- [ ] 方案对比表生成

#### Task 5.3: 实现导出功能

- [ ] 导出成本报告为PDF
- [ ] 导出配合比方案为PDF
- [ ] 导出试验报告

---

### 阶段6: 动画与交互

#### Task 6.1: 添加动画效果

**文件:**
- Create: `src/styles/animations.css`

- [ ] 结果区标签页切换淡入淡出 (200ms)
- [ ] 计算结果更新时缩放+淡入 (300ms)
- [ ] 参数改变通知底部滑入 (200ms)
- [ ] 进度条平滑增长

#### Task 6.2: 微交互细节

- [ ] 按钮hover/active状态
- [ ] 数据表格行hover背景变浅
- [ ] 浮窗工具提示延迟显示
- [ ] 加载骨架屏实现

---

### 阶段7: 测试与质量保证

#### Task 7.1: 单元测试覆盖

- [ ] 所有组件单元测试 ≥80% 覆盖率
- [ ] 计算服务测试 ≥95% 覆盖率
- [ ] 验证规则边界测试

运行:
```bash
npm test -- --coverage
```

#### Task 7.2: 集成测试

- [ ] 完整的配合比设计工作流测试
- [ ] 参数改动→计算→结果的数据流测试

#### Task 7.3: E2E测试 (可选)

使用Playwright或Cypress测试:
- [ ] 用户点击【立即计算】→等待结果显示
- [ ] 标签页切换正确显示不同内容
- [ ] 【保存方案】功能

---

### 阶段8: 构建与部署

#### Task 8.1: 构建优化

- [ ] Vite构建配置
- [ ] 代码分割优化
- [ ] 图片/字体加载优化

#### Task 8.2: 性能检查

- [ ] Lighthouse审计 (目标: 90+)
- [ ] 首屏加载时间 <3s
- [ ] 计算响应时间 <2s

#### Task 8.3: 浏览器兼容性

- [ ] Chrome 最新版本 ✓
- [ ] Firefox 最新版本 ✓
- [ ] Safari 最新版本 ✓
- [ ] Edge 最新版本 ✓

---

## 第三部分: 实现顺序建议

**强烈推荐的顺序** (最小化依赖):

1. **基础UI组件库** (Task 1.1-1.9)
   - 所有后续组件都依赖这些

2. **布局组件** (Task 2.1-2.2)
   - 为业务组件提供容器

3. **计算引擎** (Task 3.2)
   - 核心业务逻辑，其他功能依赖它

4. **业务组件** (Task 3.1, 3.3-3.5)
   - 可以逐个实现，相对独立

5. **状态管理** (Task 4.1-4.3)
   - 集成所有组件和服务

6. **高级功能** (Task 5.1-5.3)
   - 可选特性，不影响核心功能

7. **动画与交互** (Task 6.1-6.2)
   - 最后阶段的打磨

8. **测试与部署** (Task 7-8)
   - 最终验证与发布

---

## 第四部分: 关键集成点

### 参数改动触发计算的数据流

```
用户修改参数
  ↓
dispatch(updateParam)
  ↓
Redux状态更新
  ↓
useCalculation hook 监听 params 变化
  ↓
调用 calculateMixDesign()
  ↓
dispatch(setCalculateResult)
  ↓
组件订阅状态，重新渲染
  ↓
ResultTabs显示新的计算结果
```

### 【立即计算】按钮的工作流

```
用户点击【立即计算】
  ↓
禁用按钮，显示进度条
  ↓
执行计算 + 验证 + 优化建议生成
  ↓
dispatch 所有结果
  ↓
按钮恢复可交互
  ↓
右侧标签页显示计算结果
```

---

## 第五部分: 测试策略

### 单元测试 (UT)
- 每个组件一个 `.test.tsx` 文件
- 每个服务一个 `.test.ts` 文件
- 最小化mock，优先测试实际行为

### 集成测试 (IT)
- 完整工作流 (参数→计算→显示)
- Redux与组件的状态同步

### E2E测试
- 用户操作场景 (可选，不强制)

---

## 第六部分: 开发环境与工具

### 开发命令

```bash
# 启动开发服务器
npm run dev

# 运行测试
npm test

# 覆盖率检查
npm test -- --coverage

# 构建生产版
npm run build

# 预览生产构建
npm run preview

# 代码检查
npm run lint

# 代码格式化
npm run format
```

### VS Code推荐扩展
- ES7+ React/Redux snippets
- Tailwind CSS IntelliSense
- TypeScript Vue Plugin (语言智能)

---

## 第七部分: 依赖列表

```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "redux": "^4.2.0",
    "@reduxjs/toolkit": "^1.9.5",
    "react-redux": "^8.1.1",
    "recharts": "^2.10.0",
    "framer-motion": "^10.12.0",
    "clsx": "^1.2.1",
    "tailwind-merge": "^1.14.0"
  },
  "devDependencies": {
    "typescript": "^5.1.0",
    "@types/react": "^18.2.0",
    "@types/node": "^20.0.0",
    "@testing-library/react": "^14.0.0",
    "@testing-library/jest-dom": "^5.16.5",
    "vite": "^4.4.0",
    "@vitejs/plugin-react": "^4.0.0",
    "tailwindcss": "^3.3.0",
    "postcss": "^8.4.24",
    "autoprefixer": "^10.4.14",
    "eslint": "^8.42.0",
    "prettier": "^2.8.8"
  }
}
```

---

## 完成条件

项目完成需满足:
- ✓ 所有8个阶段任务完成
- ✓ ≥80% 单元测试覆盖率
- ✓ Lighthouse审计 ≥90
- ✓ 1920x1080分辨率下视觉完美对齐
- ✓ 所有交互流畅无卡顿
- ✓ 代码通过eslint和prettier检查
- ✓ 所有代码提交到git

---

**下一步:** 开始实现Task 1.1，建立Tailwind深色主题配置。

