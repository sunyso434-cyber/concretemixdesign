// report-styles.js（Task 5）
// 硬编码默认公文样式 + mergeStyle 合并函数
//
// 用途：workspace_writeFile 的可选 style 参数未传时用默认公文样式；
//       Agent 解析用户格式要求后，mergeStyle 把 userStyle 合并到默认上。
//
// 合并规则：
//   - 不传 userStyle → 返回默认（深拷贝，不污染原常量）
//   - 浅合并 page（userStyle.page 覆盖默认 page 的同名字段）
//   - 浅合并 color
//   - 深合并 typography.titleSize（H1/H2/H3 各自独立合并）
//   - 浅合并 typography 其他字段
//
// 实现说明：用通用 deepMerge 递归合并对象即可同时满足上述规则——
//   page/color 是单层对象 → deepMerge 退化为浅合并；
//   typography 是多层对象 → deepMerge 对 titleSize 子对象继续递归（深合并），
//   对 bodySize/titleFont 等标量字段直接覆盖（浅合并）。

const DEFAULT_REPORT_STYLE = {
  page: {
    paperSize: 'A4',
    orientation: 'portrait',
    margins: { top: 3.7, bottom: 3.5, left: 2.8, right: 2.6 }  // cm，公文标准
  },
  typography: {
    titleFont: '黑体',
    bodyFont: '仿宋',
    titleSize: { H1: 22, H2: 16, H3: 14 },   // pt
    bodySize: 16,                              // pt（三号）
    lineSpacing: 1.5
  },
  color: {
    primary: 'black',
    tableBorder: 'single'
  }
}

/**
 * 深合并 userStyle 到 DEFAULT_REPORT_STYLE，不修改原默认对象
 * @param {object} [userStyle] - 用户传入的样式覆盖（可选）
 * @returns {object} 合并后的样式（新对象，不污染 DEFAULT_REPORT_STYLE）
 */
function mergeStyle(userStyle) {
  // 深拷贝默认，避免后续 deepMerge 修改原常量
  const base = JSON.parse(JSON.stringify(DEFAULT_REPORT_STYLE))
  if (!userStyle || typeof userStyle !== 'object') {
    return base
  }
  return deepMerge(base, userStyle)
}

/**
 * 递归深合并：source 的字段合并进 target，对象字段递归，标量直接覆盖
 * 仅当 target[key] 和 source[key] 都是普通对象（非数组）时才递归；
 * 否则 source[key] 覆盖 target[key]（含数组、标量、null 等）
 */
function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    const sv = source[key]
    const tv = target[key]
    if (sv && typeof sv === 'object' && !Array.isArray(sv)
        && tv && typeof tv === 'object' && !Array.isArray(tv)) {
      deepMerge(tv, sv)
    } else {
      target[key] = sv
    }
  }
  return target
}

module.exports = { DEFAULT_REPORT_STYLE, mergeStyle }
