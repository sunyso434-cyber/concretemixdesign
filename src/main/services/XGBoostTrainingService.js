/**
 * XGBoostTrainingService.js
 * 主进程侧：管理 Worker Thread 生命周期
 *
 * 职责：
 *   1. 创建 Worker 子线程执行训练
 *   2. 通过 onProgress 回调传递进度信息
 *   3. 处理 Worker 异常和退出
 *   4. 返回训练完成的模型数据
 */

const { Worker } = require('worker_threads')
const path = require('path')
const fs = require('fs')

class XGBoostTrainingService {
  constructor() {
    this._activeWorkers = new Map()
    this._workerIdCounter = 0
  }

  /**
   * 在工作线程中执行 XGBoost 训练
   *
   * @param {Object} options - 训练参数
   * @param {string} options.csvPath - 训练数据 CSV 文件路径（必须）
   * @param {number} [options.nTrials=50] - TPE 调参试验次数（设为 0 跳过调参）
   * @param {string} [options.outputDir] - 模型输出目录（不传则不写文件）
   * @param {Function} [onProgress] - 进度回调 (message: string) => void
   * @returns {Promise<Object>} 训练结果 { models, reports, summary }
   */
  async trainWithWorker(options, onProgress) {
    const { csvPath } = options

    // 验证参数
    if (!csvPath) {
      throw new Error('缺少训练数据路径 (csvPath)')
    }
    if (!fs.existsSync(csvPath)) {
      throw new Error(`训练数据文件不存在: ${csvPath}`)
    }

    // 验证 outputDir
    if (options.outputDir) {
      const dir = path.resolve(options.outputDir)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      options.outputDir = dir
    }

    const workerId = ++this._workerIdCounter

    return new Promise((resolve, reject) => {
      const worker = new Worker(
        path.join(__dirname, 'training', 'trainingWorker.js'),
        {
          workerData: {
            csvPath: path.resolve(csvPath),
            options: {
              nTrials: options.nTrials ?? 50,
              outputDir: options.outputDir || null
            }
          }
        }
      )

      this._activeWorkers.set(workerId, worker)

      worker.on('message', (msg) => {
        if (msg.type === 'progress') {
          onProgress?.(msg.payload)
        } else if (msg.type === 'done') {
          this._activeWorkers.delete(workerId)
          resolve(msg.payload)
        } else if (msg.type === 'error') {
          this._activeWorkers.delete(workerId)
          reject(new Error(msg.message))
        }
      })

      worker.on('error', (err) => {
        this._activeWorkers.delete(workerId)
        reject(err)
      })

      worker.on('exit', (code) => {
        this._activeWorkers.delete(workerId)
        if (code !== 0) {
          reject(new Error(`Worker 异常退出，退出码: ${code}`))
        }
      })
    })
  }

  /**
   * 取消正在运行的训练任务
   * @param {number} [workerId] - 不传则终止所有活跃 Worker
   */
  cancelTraining(workerId) {
    if (workerId !== undefined) {
      const worker = this._activeWorkers.get(workerId)
      if (worker) {
        worker.terminate()
        this._activeWorkers.delete(workerId)
      }
    } else {
      for (const [id, worker] of this._activeWorkers) {
        worker.terminate()
      }
      this._activeWorkers.clear()
    }
  }

  /**
   * 获取当前活跃的训练任务数
   * @returns {number}
   */
  get activeCount() {
    return this._activeWorkers.size
  }
}

module.exports = new XGBoostTrainingService()
