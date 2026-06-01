# 自定义 Skill 开发指南

## 概述

混凝土配合比设计软件支持用户创建自定义 Skill（技能），扩展 AI Agent 的能力。

## 目录位置

用户自定义 Skill 放在以下目录：

```
Windows: C:\Users\<你的用户名>\.concrete-mixdesign\skills\
macOS:   ~/.concrete-mixdesign/skills/
Linux:   ~/.concrete-mixdesign/skills/
```

首次运行时，系统会自动创建此目录并生成一个示例文件 `example-skill.js`。

## Skill 文件格式

每个 Skill 是一个独立的 JavaScript 文件，导出一个对象：

```javascript
module.exports = {
  // ===== 元数据 =====
  name: 'my_tool',                    // 工具名称（必须唯一）
  description: '工具描述',             // AI 会看到这段描述来决定何时调用
  version: '1.0.0',                   // 版本号
  category: 'custom',                 // 分类（可选）

  // ===== 参数定义 =====
  parameters: {
    param1: {
      type: 'string',                 // 类型：string/number/integer/boolean/array/object
      description: '参数说明',         // AI 会看到这段说明
      required: true,                 // 是否必填
      // 可选约束：
      min: 0,                         // 最小值（数值类型）
      max: 100,                       // 最大值（数值类型）
      enum: ['选项1', '选项2'],       // 枚举值
      minItems: 1,                    // 数组最小长度
      maxItems: 10                    // 数组最大长度
    },
    param2: {
      type: 'number',
      description: '可选参数',
      required: false
    }
  },

  // ===== 执行逻辑 =====
  async execute(args, context) {
    const { param1, param2 } = args
    const { logger, materialService } = context

    // 记录日志
    logger.info(`执行: param1=${param1}`)

    // 在这里实现你的业务逻辑
    const result = {
      // ...
    }

    // 返回结果
    return {
      success: true,
      data: result,
      // 可选：给 AI 的后续建议
      suggestions: ['是否需要进一步分析？']
    }
  }
}
```

## 可用的上下文 (context)

`execute` 函数的第二个参数 `context` 提供以下服务：

| 服务 | 说明 |
|:-----|:-----|
| `context.logger` | 日志器（info/warn/error） |
| `context.materialService` | 材料库服务 |
| `context.mixDesignService` | 配合比计算服务 |
| `context.basicMixDesignService` | 基准配合比服务 |
| `context.mixDesignOptimizer` | 成本优化服务 |
| `context.complianceService` | 规范审查服务 |
| `context.knowledgeService` | 规范知识库服务 |
| `context.salesQuoteCalculation` | 销售报价服务 |
| `context.salesQuoteHistory` | 报价历史服务 |

## 示例 1：简单查询工具

```javascript
// query-project-info.js
module.exports = {
  name: 'query_project_info',
  description: '查询项目信息。当用户询问某个项目的情况时调用。',
  version: '1.0.0',

  parameters: {
    projectName: {
      type: 'string',
      description: '项目名称',
      required: true
    }
  },

  async execute(args, context) {
    const { projectName } = args
    const { logger } = context

    logger.info(`查询项目: ${projectName}`)

    // 这里可以连接数据库或调用外部 API
    // 示例：返回模拟数据
    return {
      success: true,
      data: {
        name: projectName,
        status: '进行中',
        mixDesignCount: 5
      }
    }
  }
}
```

## 示例 2：调用外部 API

```javascript
// weather-query.js
const axios = require('axios')

module.exports = {
  name: 'query_weather',
  description: '查询天气信息，用于判断施工条件。',
  version: '1.0.0',

  parameters: {
    city: {
      type: 'string',
      description: '城市名称',
      required: true
    }
  },

  async execute(args, context) {
    const { city } = args
    const { logger } = context

    logger.info(`查询天气: ${city}`)

    try {
      // 调用天气 API（示例）
      const response = await axios.get(`https://api.weather.com/${city}`)
      return {
        success: true,
        data: {
          city,
          temperature: response.data.temp,
          humidity: response.data.humidity,
          suitable: response.data.temp > 5 && response.data.temp < 35
        }
      }
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'API_ERROR',
          message: `查询天气失败: ${error.message}`,
          hint: '请检查城市名称是否正确'
        }
      }
    }
  }
}
```

## 示例 3：带确认的保存工具

```javascript
// save-to-external.js
module.exports = {
  name: 'save_to_external',
  description: '保存数据到外部系统。',
  version: '1.0.0',
  requiresConfirmation: true,  // 执行前需要用户确认

  parameters: {
    data: {
      type: 'object',
      description: '要保存的数据',
      required: true
    },
    target: {
      type: 'string',
      description: '目标系统',
      required: true,
      enum: ['ERP', 'MES', 'OA']
    }
  },

  async execute(args, context) {
    const { data, target } = args
    const { logger } = context

    logger.info(`保存到 ${target}:`, data)

    // 这里实现保存逻辑
    // ...

    return {
      success: true,
      data: { message: `已保存到 ${target}` }
    }
  }
}
```

## 错误处理

返回标准错误格式：

```javascript
return {
  success: false,
  error: {
    code: 'MY_ERROR_CODE',
    message: '错误描述',
    hint: '给用户的恢复建议'
  }
}
```

## 加载和调试

1. 将 `.js` 文件放入 `~/.concrete-mixdesign/skills/` 目录
2. 重启应用，或在设置中点击"重新加载 Skills"
3. 在 AI 对话中测试你的工具

查看加载日志：
- 打开开发者工具（F12）
- 查看控制台输出：`[SkillRegistry] 已加载 X 个 skills: ...`

## 注意事项

1. **工具名必须唯一**：不能与内置工具或其他自定义工具重名
2. **description 很重要**：AI 根据描述决定何时调用你的工具
3. **参数验证自动完成**：只需定义 schema，系统会自动验证
4. **错误要友好**：返回 hint 字段告诉用户如何修复
5. **异步支持**：execute 函数支持 async/await

## 常见问题

**Q: 如何查看我的工具是否加载成功？**
A: 查看控制台日志，或调用 `skill:listAll` 接口。

**Q: 修改后需要重启吗？**
A: 是的，修改 skill 文件后需要重启应用，或调用 `skill:reload` 接口。

**Q: 可以使用 npm 包吗？**
A: 可以，但需要将包安装到应用的 node_modules 目录。
