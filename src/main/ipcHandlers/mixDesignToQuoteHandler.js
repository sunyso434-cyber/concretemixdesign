const { ipcMain } = require('electron')
const MixDesignToQuoteService = require('../services/MixDesignToQuoteService')

class MixDesignToQuoteHandler {
  constructor() {
    this.registerHandlers()
  }

  registerHandlers() {
    /**
     * 从配合比设计直接生成报价
     * 确保配合比和报价使用完全相同的数据
     */
    ipcMain.handle('mixDesignToQuote:generate', async (_, { mixDesignResult, pricing }) => {
      try {
        if (!mixDesignResult) {
          return { success: false, error: '缺少配合比设计结果' }
        }

        if (!pricing) {
          return { success: false, error: '缺少定价参数' }
        }

        const result = await MixDesignToQuoteService.generateQuoteFromMixDesign(
          mixDesignResult,
          pricing
        )

        return { success: true, data: result }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    /**
     * 验证报价数据与配合比的一致性
     */
    ipcMain.handle('mixDesignToQuote:validate', async (_, { basicMix, quoteResult }) => {
      try {
        const validation = MixDesignToQuoteService.validateQuoteConsistency(basicMix, quoteResult)
        return { success: true, data: validation }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    /**
     * 仅保存配合比为基础配合比（不生成报价）
     */
    ipcMain.handle('mixDesignToQuote:saveBasicMix', async (_, { mixDesignResult }) => {
      try {
        if (!mixDesignResult) {
          return { success: false, error: '缺少配合比设计结果' }
        }

        const saved = await MixDesignToQuoteService.saveMixDesignAsBasicMix(mixDesignResult)
        return { success: true, data: saved.toJSON() }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })
  }
}

module.exports = new MixDesignToQuoteHandler()
