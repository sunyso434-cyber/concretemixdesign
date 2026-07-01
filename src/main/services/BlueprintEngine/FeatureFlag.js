const fs = require('fs')
const path = require('path')
const os = require('os')
const yaml = require('js-yaml')

function getConfigPath() {
  const dir = process.env.CONCRETE_CONFIG_DIR ||
    path.join(os.homedir(), '.concrete-mixdesign')
  return path.join(dir, 'config.yaml')
}

function loadConfig() {
  try {
    return yaml.load(fs.readFileSync(getConfigPath(), 'utf8')) || {}
  } catch (e) {
    return {}
  }
}

module.exports = {
  isEnabled() {
    const cfg = loadConfig()
    return cfg.blueprint_engine_enabled !== false
  },
  isSkillEnabled(skillName) {
    if (!this.isEnabled()) return false
    const cfg = loadConfig()
    const overrides = cfg.blueprint_skills_override || {}
    return overrides[skillName] !== false
  }
}
