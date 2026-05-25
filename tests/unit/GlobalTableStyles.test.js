const assert = require('assert')
const fs = require('fs')
const path = require('path')

const cssPath = path.join(__dirname, '..', '..', 'src', 'renderer', 'index.css')
const css = fs.readFileSync(cssPath, 'utf8')

function getRule(selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`))
  assert.ok(match, `缺少样式规则: ${selector}`)
  return match[1]
}

function assertIncludes(rule, declaration, selector) {
  assert.ok(
    rule.includes(declaration),
    `${selector} 应包含 ${declaration}`
  )
}

const tableRule = getRule('.custom-table')
assertIncludes(tableRule, 'border: none;', '.custom-table')
assertIncludes(tableRule, 'border-radius: 0;', '.custom-table')

const tableCardRule = getRule('.custom-card:has(.custom-table)')
assertIncludes(tableCardRule, 'border: none;', '.custom-card:has(.custom-table)')

const headerCellRule = getRule('.custom-table .ant-table-thead > tr > th')
assertIncludes(headerCellRule, 'padding: 10px 16px;', '.custom-table 表头')

const bodyCellRule = getRule('.custom-table .ant-table-tbody > tr > td')
assertIncludes(bodyCellRule, 'padding: 8px 16px;', '.custom-table 表格行')

const tableButtonRule = getRule('.custom-table .ant-btn')
assertIncludes(tableButtonRule, 'height: 32px !important;', '.custom-table 表格按钮')

console.log('全局表格样式检查通过')
