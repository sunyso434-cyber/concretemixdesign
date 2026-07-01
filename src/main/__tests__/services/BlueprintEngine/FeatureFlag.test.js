const fs = require('fs')
const path = require('path')
const os = require('os')
const FeatureFlag = require('../../../services/BlueprintEngine/FeatureFlag')

describe('FeatureFlag', () => {
  let tmpDir
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-test-'))
  })
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }))

  test('配置文件不存在时返回 true（默认开启）', () => {
    process.env.CONCRETE_CONFIG_DIR = tmpDir
    expect(FeatureFlag.isEnabled()).toBe(true)
  })

  test('blueprint_engine_enabled=false 时返回 false', () => {
    fs.writeFileSync(path.join(tmpDir, 'config.yaml'), 'blueprint_engine_enabled: false\n')
    process.env.CONCRETE_CONFIG_DIR = tmpDir
    expect(FeatureFlag.isEnabled()).toBe(false)
  })

  test('单技能 override', () => {
    fs.writeFileSync(path.join(tmpDir, 'config.yaml'),
      'blueprint_skills_override:\n  自密实混凝土: false\n')
    process.env.CONCRETE_CONFIG_DIR = tmpDir
    expect(FeatureFlag.isSkillEnabled('自密实混凝土')).toBe(false)
    expect(FeatureFlag.isSkillEnabled('其他技能')).toBe(true)
  })
})
