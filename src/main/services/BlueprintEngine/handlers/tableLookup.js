const { linearInterpolate, bilinearInterpolate, nearestNeighbor } =
  require('../TableInterpolator')

async function handleTableLookup(step, context, tables) {
  const table = tables[step.table]
  if (!table) throw new Error(`数据表"${step.table}"不存在`)

  const keys = step.keys
  // 把 keys 中 $xxx 替换成上下文变量值
  const resolvedKeys = {}
  for (const [dim, val] of Object.entries(keys)) {
    resolvedKeys[dim] = typeof val === 'string' && val.startsWith('$')
      ? context.get(val.slice(1))
      : val
  }

  let result
  switch (step.lookup_mode) {
    case 'linear':
      result = linearInterpolate(table, resolvedKeys[Object.keys(resolvedKeys)[0]])
      break
    case 'bilinear':
      result = bilinearInterpolate(
        table,
        resolvedKeys[Object.keys(resolvedKeys)[0]],
        resolvedKeys[Object.keys(resolvedKeys)[1]]
      )
      break
    case 'nearest':
      result = nearestNeighbor(table, resolvedKeys[Object.keys(resolvedKeys)[0]])
      break
    default:
      throw new Error(`不支持的插值模式: ${step.lookup_mode}`)
  }

  context.set(step.var, result)
}

module.exports = handleTableLookup
