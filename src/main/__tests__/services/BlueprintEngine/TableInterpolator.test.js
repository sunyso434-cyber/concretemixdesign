const { linearInterpolate, bilinearInterpolate, nearestNeighbor } =
  require('../../../services/BlueprintEngine/TableInterpolator')

describe('TableInterpolator', () => {
  test('linearInterpolate 区间内插值', () => {
    const table = {
      dimensions: [{ name: 'x', values: [0, 10, 20] }],
      data: [[0], [100], [200]]
    }
    expect(linearInterpolate(table, 5)).toBe(50)
  })

  test('linearInterpolate 等值点', () => {
    const table = {
      dimensions: [{ name: 'x', values: [0, 10] }],
      data: [[0], [100]]
    }
    expect(linearInterpolate(table, 0)).toBe(0)
    expect(linearInterpolate(table, 10)).toBe(100)
  })

  test('bilinearInterpolate 四角插值', () => {
    const table = {
      dimensions: [
        { name: 'x', values: [0, 10] },
        { name: 'y', values: [0, 10] }
      ],
      data: [[0, 100], [200, 300]]
    }
    expect(bilinearInterpolate(table, 5, 5)).toBe(150)
  })

  test('nearestNeighbor 边界', () => {
    const table = {
      dimensions: [{ name: 'x', values: [0, 10, 20] }],
      data: [[0], [100], [200]]
    }
    expect(nearestNeighbor(table, 3)).toBe(0)
    expect(nearestNeighbor(table, 18)).toBe(200)
  })
})
