const {
  extractAnalysisPayload,
  removeContrastData,
  createToolSummary,
  mergeToolEvent,
  materialMatchesSlotType,
  getUnfilledMaterialSlotsForMix,
  buildPerMixMaterialQueue,
} = require('../SmartDesignChat.core')

describe('SmartDesignChat.core', () => {
  test('extractAnalysisPayload 识别新报告对象和旧 reply 形态', () => {
    const report = { comprehensiveEvaluation: '可用' }
    const reply = `\`\`\`json\n${JSON.stringify(report)}\n\`\`\``

    expect(extractAnalysisPayload(report)).toEqual({ report, textualReply: null })
    expect(extractAnalysisPayload({ reply })).toEqual({ report, textualReply: reply })
  })

  test('extractAnalysisPayload 保留无法解析的文本', () => {
    expect(extractAnalysisPayload({ reply: '普通文字' })).toEqual({
      report: null,
      textualReply: '普通文字'
    })
  })

  test('removeContrastData 不修改原对象', () => {
    const input = { contrast: { cement: true }, rows: [1] }
    expect(removeContrastData(input)).toEqual({ rows: [1] })
    expect(input.contrast).toEqual({ cement: true })
  })

  test('createToolSummary 输出工具的关键参数', () => {
    expect(createToolSummary('calculate_mix_design', { strength: 'C40', slump: 180 }))
      .toBe('C40|坍落度 180mm')
    expect(createToolSummary('optimize_mix_cost', { strength: 'C30', gridStep: 5 }))
      .toBe('C30|步长 5')
  })

  test('mergeToolEvent 新增事件并按 id 更新已有事件', () => {
    const started = mergeToolEvent([], { id: 'tool-1', toolName: 'search', status: 'running' })
    expect(started).toEqual([{ id: 'tool-1', toolName: 'search', status: 'running' }])
    expect(mergeToolEvent(started, { id: 'tool-1', status: 'done' })).toEqual([
      { id: 'tool-1', toolName: 'search', status: 'done' }
    ])
  })

  test('materialMatchesSlotType 兼容减水剂和外加剂命名', () => {
    expect(materialMatchesSlotType({ type: '减水剂' }, '外加剂')).toBe(true)
    expect(materialMatchesSlotType({ type: '外加剂' }, '外加剂')).toBe(true)
    expect(materialMatchesSlotType({ type: '水泥' }, '外加剂')).toBe(false)
  })

  test('getUnfilledMaterialSlotsForMix 只返回尚未匹配的有效槽位', () => {
    const mix = {
      id: 'mix-1',
      materials: { cement: 'P.O 42.5', flyAsh: '二级灰', unknown: '忽略' }
    }
    const slots = getUnfilledMaterialSlotsForMix(mix, { cement: { id: 1, type: '水泥' } })
    expect(slots).toEqual([
      { mixId: 'mix-1', key: 'flyAsh', type: '粉煤灰', token: '二级灰(粉煤灰)' }
    ])
  })

  test('buildPerMixMaterialQueue 保持配合比顺序并过滤已填满项', () => {
    const mixes = [
      { id: 'mix-1', strengthGrade: 'C30', materials: { cement: 'A' } },
      { id: 'mix-2', strengthGrade: 'C40', materials: { cement: 'B' } }
    ]
    const queue = buildPerMixMaterialQueue(mixes, {
      'mix-1': { cement: { id: 1 } },
      'mix-2': {}
    })
    expect(queue).toHaveLength(1)
    expect(queue[0]).toMatchObject({ mixId: 'mix-2', strengthGrade: 'C40' })
  })
})
