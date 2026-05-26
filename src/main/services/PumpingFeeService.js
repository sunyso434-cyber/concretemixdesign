const { PumpingFeeItem } = require('../db/database')

async function listItems() {
  return (await PumpingFeeItem.findAll({ order: [['sortOrder', 'ASC']] }))
    .map(row => row.toJSON())
}

async function createItem(data) {
  const name = String(data.name || '').trim()
  if (!name) throw new Error('泵送方式名称不能为空')
  const maxOrder = await PumpingFeeItem.max('sortOrder') || 0
  return (await PumpingFeeItem.create({
    name,
    unitPrice: Number(data.unitPrice) || 0,
    sortOrder: data.sortOrder != null ? data.sortOrder : maxOrder + 1,
    enabled: data.enabled !== false
  })).toJSON()
}

async function updateItem(id, data) {
  const item = await PumpingFeeItem.findByPk(id)
  if (!item) throw new Error('泵送方式不存在')
  await item.update(data)
  return item.toJSON()
}

async function deleteItem(id) {
  const item = await PumpingFeeItem.findByPk(id)
  if (!item) throw new Error('泵送方式不存在')
  await item.destroy()
}

async function listEnabled() {
  return (await PumpingFeeItem.findAll({
    where: { enabled: true },
    order: [['sortOrder', 'ASC']]
  })).map(row => row.toJSON())
}

module.exports = { listItems, createItem, updateItem, deleteItem, listEnabled }
