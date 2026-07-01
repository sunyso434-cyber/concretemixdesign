function findIndex(arr, value) {
  for (let i = 0; i < arr.length - 1; i++) {
    if (value >= arr[i] && value <= arr[i + 1]) return i
  }
  throw new Error(`值 ${value} 超出表范围 [${arr[0]}, ${arr[arr.length - 1]}]`)
}

function linearInterpolate(table, x) {
  const xs = table.dimensions[0].values
  const data = table.data
  if (x === xs[0]) return data[0][0]
  if (x === xs[xs.length - 1]) return data[data.length - 1][0]
  const i = findIndex(xs, x)
  const ratio = (x - xs[i]) / (xs[i + 1] - xs[i])
  return data[i][0] + ratio * (data[i + 1][0] - data[i][0])
}

function bilinearInterpolate(table, x, y) {
  const xs = table.dimensions[0].values
  const ys = table.dimensions[1].values
  const data = table.data
  const i = findIndex(xs, x)
  const j = findIndex(ys, y)
  const tx = (x - xs[i]) / (xs[i + 1] - xs[i])
  const ty = (y - ys[j]) / (ys[j + 1] - ys[j])
  const Q11 = data[i][j]
  const Q21 = data[i + 1][j]
  const Q12 = data[i][j + 1]
  const Q22 = data[i + 1][j + 1]
  const R1 = Q11 + tx * (Q21 - Q11)
  const R2 = Q12 + tx * (Q22 - Q12)
  return R1 + ty * (R2 - R1)
}

function nearestNeighbor(table, x) {
  const xs = table.dimensions[0].values
  const data = table.data
  let minDist = Infinity
  let nearest = 0
  for (let i = 0; i < xs.length; i++) {
    const dist = Math.abs(xs[i] - x)
    if (dist < minDist) { minDist = dist; nearest = i }
  }
  return data[nearest][0]
}

module.exports = { linearInterpolate, bilinearInterpolate, nearestNeighbor }
