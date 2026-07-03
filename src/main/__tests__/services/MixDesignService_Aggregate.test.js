const MixDesignService_Aggregate = require('../../../main/services/MixDesignService/MixDesignService_Aggregate')

describe('preselectCoarseAggregate', () => {
  test('选最大粒径', () => {
    const result = MixDesignService_Aggregate.preselectCoarseAggregate([
      { id: 1, specification: '5-10mm', price: 100 },
      { id: 2, specification: '5-20mm', price: 120 },
      { id: 3, specification: '5-16mm', price: 110 }
    ])
    expect(result.id).toBe(2)  // 5-20mm 最大
  })

  test('同粒径选最便宜', () => {
    const result = MixDesignService_Aggregate.preselectCoarseAggregate([
      { id: 1, specification: '5-20mm', price: 150 },
      { id: 2, specification: '5-20mm', price: 120 }
    ])
    expect(result.id).toBe(2)  // 同粒径选便宜的
  })

  test('空候选抛错', () => {
    expect(() => MixDesignService_Aggregate.preselectCoarseAggregate([]))
      .toThrow('粗骨料候选为空')
  })
})

describe('targetFinenessModulusByStrength', () => {
  test('C25 → 2.6', () => {
    expect(MixDesignService_Aggregate.targetFinenessModulusByStrength('C25')).toBe(2.6)
  })
  test('C30 → 2.8', () => {
    expect(MixDesignService_Aggregate.targetFinenessModulusByStrength('C30')).toBe(2.8)
  })
  test('C50 → 3.0', () => {
    expect(MixDesignService_Aggregate.targetFinenessModulusByStrength('C50')).toBe(3.0)
  })
  test('C65 → 3.4', () => {
    expect(MixDesignService_Aggregate.targetFinenessModulusByStrength('C65')).toBe(3.4)
  })
})