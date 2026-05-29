const SharedSchemas = require('./SharedSchemas')

class ToolRegistry {
  constructor() {
    this._tools = new Map()
  }

  register(config) {
    if (!config.name || !config.handler) {
      throw new Error('Tool requires name and handler')
    }
    if (this._tools.has(config.name)) {
      throw new Error(`Tool "${config.name}" is already registered`)
    }

    const schema = {
      type: 'function',
      function: {
        name: config.name,
        description: config.description || '',
        parameters: {
          type: 'object',
          properties: config.parameters || {},
          required: config.required || []
        }
      }
    }

    this._tools.set(config.name, {
      schema,
      handler: config.handler,
      requiresConfirmation: config.requiresConfirmation || false
    })

    return this
  }

  getToolSchemas() {
    return Array.from(this._tools.values()).map(t => t.schema)
  }

  getToolMeta(name) {
    const tool = this._tools.get(name)
    if (!tool) return null
    return { requiresConfirmation: tool.requiresConfirmation }
  }

  async execute(name, args) {
    const tool = this._tools.get(name)
    if (!tool) {
      return { success: false, error: `Unknown tool: ${name}` }
    }
    try {
      const result = await tool.handler(args)
      if (result === undefined || result === null) {
        return { success: true, data: null, warning: 'Tool handler returned no data' }
      }
      if (typeof result !== 'object') {
        return { success: true, data: result, warning: 'Tool handler returned non-object data' }
      }
      return result
    } catch (error) {
      return {
        success: false,
        error: error.message,
        toolName: name
      }
    }
  }

  get toolNames() {
    return Array.from(this._tools.keys())
  }
}

module.exports = ToolRegistry
module.exports.SharedSchemas = SharedSchemas
