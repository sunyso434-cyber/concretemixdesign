// Mock db, 单独 stub VehicleDetail 用于 create 测试
jest.mock('../../db/database', () => {
  const mockVehicleDetail = {
    create: jest.fn(),
    findByPk: jest.fn(),
    findAll: jest.fn(),
    destroy: jest.fn()
  }
  return {
    VehicleDetail: mockVehicleDetail,
    DailyPlan: { findByPk: jest.fn(), findAll: jest.fn() },
    CapacityConfig: { findAll: jest.fn() }
  }
})

const { VehicleDetail } = require('../../db/database')
const VehicleDetailService = require('../../services/VehicleDetailService')
const {
  normalizeStrengthGrade,
  mapRows,
  _validateRow,
  _aggregateMissingPlans
} = VehicleDetailService

describe('VehicleDetailService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  // ===== T1: normalizeStrengthGrade =====
  describe('normalizeStrengthGrade', () => {
    test('T1a "c30" → "C30"', () => {
      expect(normalizeStrengthGrade('c30')).toBe('C30')
    })
    test('T1b "C40" → "C40"', () => {
      expect(normalizeStrengthGrade('C40')).toBe('C40')
    })
    test('T1c null → null', () => {
      expect(normalizeStrengthGrade(null)).toBe(null)
    })
    test('T1d "foo" → "FOO"（兜底 uppercase）', () => {
      expect(normalizeStrengthGrade('foo')).toBe('FOO')
    })
  })

  // ===== T2: mapRows =====
  describe('mapRows', () => {
    test('T2 标准 2D 数组 → 2 个 obj，_rowNum=2/3，field alias 正确', () => {
      const rows = [
        ['发货号', '方量'],
        ['A001', 10],
        ['A002', 12]
      ]
      const result = mapRows(rows)
      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({ shipmentNo: 'A001', volume: 10, _rowNum: 2 })
      expect(result[1]).toMatchObject({ shipmentNo: 'A002', volume: 12, _rowNum: 3 })
    })

    test('T2b 仅 header → 空数组', () => {
      expect(mapRows([['发货号', '方量']])).toEqual([])
    })

    test('T2c 空数组 → 空数组', () => {
      expect(mapRows([])).toEqual([])
    })
  })

  // ===== T3: _validateRow 必填校验 =====
  describe('_validateRow', () => {
    const validRow = {
      mixerTowerNo: 'T1',
      productionDate: '2026-08-11',
      productionTime: '08:00',
      projectName: 'P1',
      pourLocation: 'L1',
      strengthGrade: 'C30',
      volume: 10,
      shipmentNo: 'A001'
    }
    test('T3a 完整有效 → valid=true', () => {
      expect(_validateRow(validRow)).toEqual({ valid: true })
    })

    test('T3b 缺 mixerTowerNo → reason=必填字段 mixerTowerNo 缺失', () => {
      const r = { ...validRow, mixerTowerNo: undefined }
      const res = _validateRow(r)
      expect(res.valid).toBe(false)
      expect(res.reason).toMatch(/mixerTowerNo/)
    })

    test('T3c 方量=0 → reason=方量必须为正数', () => {
      const res = _validateRow({ ...validRow, volume: 0 })
      expect(res.valid).toBe(false)
      expect(res.reason).toBe('方量必须为正数')
    })

    test('T3d 方量="abc" → reason=方量必须为正数', () => {
      const res = _validateRow({ ...validRow, volume: 'abc' })
      expect(res.valid).toBe(false)
      expect(res.reason).toBe('方量必须为正数')
    })
  })

  // ===== T4: _aggregateMissingPlans 4-key 去重 =====
  describe('_aggregateMissingPlans', () => {
    test('T4a 2 row 同 4-key → existing.vehicleCount++ + totalVolume += newVolume', () => {
      const missing = []
      const row1 = { projectName: 'P1', pourLocation: 'L1', strengthGrade: 'C30', productionDate: '2026-08-11', volume: 10 }
      const row2 = { projectName: 'P1', pourLocation: 'L1', strengthGrade: 'C30', productionDate: '2026-08-11', volume: 12 }
      _aggregateMissingPlans(missing, row1, 'NO_PLAN')
      _aggregateMissingPlans(missing, row2, 'NO_PLAN')
      expect(missing).toHaveLength(1)
      expect(missing[0].vehicleCount).toBe(2)
      expect(missing[0].totalVolume).toBe(22)
    })

    test('T4b 2 row 不同 productionDate → 2 条 entry', () => {
      const missing = []
      _aggregateMissingPlans(missing, { projectName: 'P1', pourLocation: 'L1', strengthGrade: 'C30', productionDate: '2026-08-11', volume: 10 }, 'NO_PLAN')
      _aggregateMissingPlans(missing, { projectName: 'P1', pourLocation: 'L1', strengthGrade: 'C30', productionDate: '2026-08-12', volume: 8 }, 'NO_PLAN')
      expect(missing).toHaveLength(2)
      expect(missing[0].vehicleCount).toBe(1)
      expect(missing[1].vehicleCount).toBe(1)
    })

    test('T4c reason=NO_BRANCH_MAPPING → 不进 missingPlans', () => {
      const missing = []
      _aggregateMissingPlans(missing, { projectName: 'P1', pourLocation: 'L1', strengthGrade: 'C30', productionDate: '2026-08-11', volume: 10 }, 'NO_BRANCH_MAPPING')
      expect(missing).toHaveLength(0)
    })
  })

  // ===== T5: create 强制 source='manual' =====
  describe('create', () => {
    test('T5 create 不传 source → 实际传给 VehicleDetail.create 的对象 source="manual"', async () => {
      VehicleDetail.create.mockResolvedValue({
        toJSON: () => ({ id: 1, shipmentNo: 'A001', source: 'manual' })
      })
      const result = await VehicleDetailService.create({
        shipmentNo: 'A001',
        productionDate: '2026-08-11',
        productionTime: '08:00',
        volume: 10
      })
      expect(VehicleDetail.create).toHaveBeenCalledTimes(1)
      const passedArg = VehicleDetail.create.mock.calls[0][0]
      expect(passedArg.source).toBe('manual')
      expect(passedArg.shipmentNo).toBe('A001')
      expect(result).toMatchObject({ id: 1, source: 'manual' })
    })

    test('T5b create 传了 source="import" → 仍被覆盖为 "manual"', async () => {
      VehicleDetail.create.mockResolvedValue({
        toJSON: () => ({ id: 2, shipmentNo: 'A002', source: 'manual' })
      })
      await VehicleDetailService.create({
        shipmentNo: 'A002',
        source: 'import'  // 调用方写错/故意测试覆盖
      })
      const passedArg = VehicleDetail.create.mock.calls[0][0]
      expect(passedArg.source).toBe('manual')
    })
  })
})
