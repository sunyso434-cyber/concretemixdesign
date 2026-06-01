# 混凝土配合比设计软件 - Skill 系统设计文档

## 概述

为混凝土配合比设计软件添加 Skill 扩展能力，允许用户通过自然语言描述计算规则和检查逻辑，由 DeepSeek LLM 自动生成可复用的 skill 文件，并通过软件内的 Skill 管理器进行管理。

## 设计目标

### 核心目标
- **降低扩展门槛**：混凝土技术人员无需编程背景，通过自然语言描述即可创建新功能
- **支持两类扩展**：配合比计算规则 + 规范合规性检查
- **可复用性**：生成的 skill 可保存、分享、在不同项目中重复使用
- **界面化管理**：在软件内提供完整的 skill 管理界面，无需操作文件系统

### 约束条件
- 信任用户，skill 为自由 JS 代码，无沙箱限制
- 保留原始文件便于调试和版本控制
- 复用已有的 DeepSeek LLM 接口

## 技术架构

### 方案选择：混合模式（文件 + 数据库索引）

**数据库层**：
- 存储 skill 的元数据索引（名称、描述、版本、文件路径等）
- 记录安装时间、启用状态
- 支持快速查询和界面展示

**文件层**：
- 存储实际的 skill 代码和配置文件
- 一个 skill 对应一个文件夹
- 便于调试、版本控制和文件分享

### 目录结构

```
concrete-mixdesign/
├── skills/                          # Skill 根目录
│   ├── self-compacting-concrete/    # 示例：自密实混凝土 skill
│   │   ├── skill.json              # 元数据（必需）
│   │   ├── README.md               # 说明文档（必需）
│   │   ├── calculator.js           # 配合比计算逻辑（可选）
│   │   ├── checker.js              # 规范检查逻辑（可选）
│   │   └── report-template.md      # 报告模板（可选）
│   │
│   ├── high-performance-concrete/   # 示例：高性能混凝土 skill
│   │   ├── skill.json
│   │   ├── README.md
│   │   ├── calculator.js
│   │   └── checker.js
│   │
│   └── lightweight-aggregate/       # 示例：轻骨料混凝土 skill
│       └── ...
│
├── src/
│   ├── main/
│   │   ├── services/
│   │   │   ├── SkillManager.js     # Skill 管理服务
│   │   │   ├── SkillLoader.js      # Skill 动态加载
│   │   │   ├── SkillGenerator.js   # AI 生成 skill
│   │   │   └── SkillExecutor.js    # Skill 执行引擎
│   │   └── ...
│   ├── renderer/
│   │   ├── components/
│   │   │   └── SkillManager/       # Skill 管理界面
│   │   │       ├── SkillList.jsx
│   │   │       ├── SkillEditor.jsx
│   │   │       ├── SkillGenerator.jsx
│   │   │       └── SkillInstaller.jsx
│   │   └── ...
│   └── ...
│
└── data/
    └── skills.db                   # SQLite 数据库
```

## 数据模型

### 数据库表结构

```sql
CREATE TABLE skills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(100) NOT NULL UNIQUE,      -- skill 名称（英文标识）
    display_name VARCHAR(200) NOT NULL,     -- 显示名称（中文）
    description TEXT,                        -- 描述
    version VARCHAR(20) DEFAULT '1.0.0',    -- 版本号
    author VARCHAR(100),                     -- 作者
    category VARCHAR(50),                    -- 分类（计算/检查/综合）
    file_path VARCHAR(500) NOT NULL,        -- 文件夹路径
    entry_point VARCHAR(100) DEFAULT 'calculator.js', -- 入口文件
    enabled BOOLEAN DEFAULT 1,              -- 是否启用
    installed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    metadata JSON                            -- 扩展配置
);
```

### skill.json 格式

```json
{
    "name": "self-compacting-concrete",
    "displayName": "自密实混凝土配合比设计",
    "description": "根据 JGJ/T 283-2012 进行自密实混凝土配合比计算",
    "version": "1.0.0",
    "author": "张工",
    "category": "comprehensive",
    "calculator": "calculator.js",
    "checker": "checker.js",
    "parameters": [
        {
            "name": "targetStrength",
            "type": "number",
            "unit": "MPa",
            "description": "目标强度等级",
            "required": true
        },
        {
            "name": "slumpFlow",
            "type": "number",
            "unit": "mm",
            "description": "坍落扩展度要求",
            "required": true
        }
    ],
    "outputs": [
        {
            "name": "cementContent",
            "type": "number",
            "unit": "kg/m3",
            "description": "胶凝材料用量"
        }
    ]
}
```

## 核心模块设计

### 1. SkillManager（Skill 管理服务）

**职责**：
- 管理 skill 的生命周期（创建、读取、更新、删除）
- 维护数据库索引与文件系统的同步
- 提供查询和过滤功能

**主要方法**：

```javascript
class SkillManager {
    // 创建新 skill
    async createSkill(skillData) {}
    
    // 获取所有已安装的 skill
    async getInstalledSkills(filters) {}
    
    // 获取单个 skill 详情
    async getSkillByName(name) {}
    
    // 更新 skill
    async updateSkill(name, updates) {}
    
    // 删除 skill
    async deleteSkill(name) {}
    
    // 启用/禁用 skill
    async toggleSkill(name, enabled) {}
    
    // 导入 skill（从文件夹）
    async importSkill(folderPath) {}
    
    // 导出 skill
    async exportSkill(name, outputPath) {}
    
    // 同步数据库与文件系统
    async syncWithFileSystem() {}
}
```

### 2. SkillLoader（Skill 动态加载）

**职责**：
- 扫描 skills 目录，加载所有 skill
- 动态 require() skill 文件
- 缓存已加载的 skill 实例

**主要方法**：

```javascript
class SkillLoader {
    // 加载单个 skill
    loadSkill(skillPath) {}
    
    // 加载所有 skill
    loadAllSkills() {}
    
    // 重新加载指定 skill（热更新）
    reloadSkill(name) {}
    
    // 获取 skill 的计算器
    getCalculator(name) {}
    
    // 获取 skill 的检查器
    getChecker(name) {}
}
```

### 3. SkillGenerator（AI 生成服务）

**职责**：
- 接收用户的自然语言描述
- 调用 DeepSeek LLM 生成 skill 代码
- 格式化输出并保存到文件

**AI 提示词模板**：

```
你是一个混凝土配合比设计专家和 JavaScript 开发者。
用户将描述一种混凝土类型的配合比计算规则或规范检查要求。
你需要生成一个完整的 skill 文件夹结构，包括：

1. skill.json - 元数据配置
2. README.md - 使用说明（中文）
3. calculator.js - 配合比计算逻辑（如果用户描述了计算规则）
4. checker.js - 规范检查逻辑（如果用户描述了检查要求）

代码要求：
- 使用 CommonJS 模块格式（module.exports）
- 每个函数都要有 JSDoc 注释
- 输入输出要清晰定义
- 包含错误处理
- 单位使用国际标准单位

用户描述：
{user_description}

请生成完整的 skill 代码：
```

**主要方法**：

```javascript
class SkillGenerator {
    // 从自然语言生成 skill
    async generateFromDescription(description) {}
    
    // 生成 calculator.js
    async generateCalculator(requirements) {}
    
    // 生成 checker.js
    async generateChecker(requirements) {}
    
    // 生成 skill.json
    async generateMetadata(description) {}
    
    // 生成 README.md
    async generateReadme(skillInfo) {}
    
    // 优化已有的 skill 代码
    async optimizeSkill(name, feedback) {}
}
```

### 4. SkillExecutor（Skill 执行引擎）

**职责**：
- 执行 skill 的计算逻辑
- 执行 skill 的检查逻辑
- 整合到主计算流程中

**主要方法**：

```javascript
class SkillExecutor {
    // 执行配合比计算
    async executeCalculator(skillName, inputs) {}
    
    // 执行规范检查
    async executeChecker(skillName, mixData) {}
    
    // 验证 skill 代码的语法
    validateSkillCode(code) {}
    
    // 捕获执行错误
    wrapWithErrorHandling(func) {}
}
```

## 用户界面设计

### 1. Skill 列表页面

**功能**：
- 显示所有已安装的 skill
- 支持按分类、名称搜索
- 显示启用/禁用状态
- 快捷操作（编辑、删除、导出）

**UI 元素**：
- 搜索框
- 分类筛选下拉框
- Skill 卡片列表（显示名称、描述、版本、作者）
- 新建 Skill 按钮

### 2. Skill 生成页面（AI 辅助）

**功能**：
- 自然语言输入框
- AI 生成进度显示
- 预览生成的代码
- 一键保存安装

**交互流程**：
1. 用户输入描述（如"自密实混凝土配合比计算，根据 JGJ/T 283-2012..."）
2. 点击"生成 Skill"
3. 显示加载动画（AI 处理中）
4. 预览生成的文件列表和代码
5. 用户确认后保存到 skills 目录
6. 自动注册到数据库

### 3. Skill 编辑页面

**功能**：
- 编辑 skill.json 元数据
- 编辑 calculator.js 代码（带语法高亮）
- 编辑 checker.js 代码
- 编辑 README.md 文档
- 实时验证代码语法

### 4. Skill 安装页面

**功能**：
- 从本地文件夹导入
- 从压缩包导入
- 从其他用户分享的 skill 包导入

## 工作流程

### 流程 1：用户创建新 Skill

```
用户输入自然语言描述
    ↓
调用 DeepSeek LLM 生成代码
    ↓
预览生成的文件
    ↓
用户确认/修改
    ↓
保存到 skills/ 目录
    ↓
注册到数据库
    ↓
加载到内存
    ↓
可在配合比计算中使用
```

### 流程 2：用户使用 Skill

```
用户选择混凝土类型（如"自密实混凝土"）
    ↓
系统查找对应的 skill
    ↓
加载 skill 的 calculator.js
    ↓
执行计算，输入参数
    ↓
输出配合比结果
    ↓
（可选）加载 checker.js 进行合规性检查
    ↓
显示检查结果
```

### 流程 3：用户分享 Skill

```
用户选择要导出的 skill
    ↓
打包为 .zip 文件（包含所有文件）
    ↓
其他用户导入 .zip
    ↓
解压到 skills/ 目录
    ↓
注册到数据库
    ↓
可直接使用
```

## 集成方案

### 与现有系统的集成点

1. **配合比计算模块**
   - 在现有的计算流程中添加 skill 执行点
   - 用户可以选择使用内置算法或 skill 算法

2. **规范检查模块**
   - 现有的 ComplianceRuleEngine 可以调用 skill 的 checker
   - skill 的检查结果与内置检查结果合并显示

3. **UI 层**
   - 在侧边栏添加"Skill 管理"入口
   - 在配合比计算页面添加"选择计算方式"下拉框

4. **报告生成**
   - skill 可以自定义报告模板
   - 报告生成时读取 skill 的模板文件

## 实施计划

### 阶段 1：基础框架（1-2 周）
- [ ] 创建 skills 目录结构
- [ ] 实现 SkillManager 基础功能（CRUD）
- [ ] 实现 SkillLoader 动态加载
- [ ] 创建数据库表结构

### 阶段 2：AI 生成能力（1 周）
- [ ] 实现 SkillGenerator
- [ ] 设计 AI 提示词模板
- [ ] 集成 DeepSeek API
- [ ] 实现代码预览和确认流程

### 阶段 3：执行引擎（1 周）
- [ ] 实现 SkillExecutor
- [ ] 集成到配合比计算流程
- [ ] 集成到规范检查流程
- [ ] 错误处理和日志记录

### 阶段 4：用户界面（2 周）
- [ ] Skill 列表页面
- [ ] Skill 生成页面（AI 辅助）
- [ ] Skill 编辑页面
- [ ] Skill 安装/导出功能

### 阶段 5：测试和优化（1 周）
- [ ] 单元测试
- [ ] 集成测试
- [ ] 用户测试
- [ ] 性能优化

## 技术栈

- **后端**：Node.js + Electron
- **数据库**：SQLite（已有）
- **AI 服务**：DeepSeek API（已集成）
- **前端**：React + Ant Design（假设现有技术栈）
- **代码编辑器**：Monaco Editor（用于 skill 代码编辑）

## 风险和缓解措施

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| AI 生成的代码有 bug | 计算结果错误 | 用户确认流程 + 代码预览 + 人工审核 |
| 用户描述不清晰 | 生成不符合预期 | 多轮对话优化 + 示例参考 |
| skill 代码恶意行为 | 安全风险 | 信任用户 + 代码审查 + 备份机制 |
| 性能问题 | 加载慢 | 按需加载 + 缓存机制 |
| 兼容性问题 | 无法运行 | 版本管理 + 向后兼容 |

## 附录

### 示例 Skill：自密实混凝土

**用户描述**：
"根据 JGJ/T 283-2012《自密实混凝土应用技术规程》进行配合比设计。
主要参数：
- 胶凝材料总量：450-550 kg/m3
- 水胶比：0.28-0.35
- 砂率：45%-55%
- 坍落扩展度要求：≥600mm（SF1）或 ≥700mm（SF2）
- V 漏斗时间：≤20s
- T500 时间：5-15s

计算步骤：
1. 根据强度等级确定水胶比
2. 根据坍落扩展度要求确定用水量
3. 计算胶凝材料用量
4. 确定砂率
5. 计算骨料用量
6. 验证工作性指标"

**AI 生成的 skill.json**：
```json
{
    "name": "self-compacting-concrete",
    "displayName": "自密实混凝土配合比设计",
    "description": "根据 JGJ/T 283-2012 进行自密实混凝土配合比计算",
    "version": "1.0.0",
    "author": "AI 生成",
    "category": "comprehensive",
    "parameters": [
        {"name": "targetStrength", "type": "number", "unit": "MPa", "required": true},
        {"name": "slumpFlowClass", "type": "string", "enum": ["SF1", "SF2"], "required": true},
        {"name": "maxAggregateSize", "type": "number", "unit": "mm", "required": true}
    ]
}
```

---

**文档版本**：1.0  
**最后更新**：2026-05-31  
**作者**：AI Office Hours Session
