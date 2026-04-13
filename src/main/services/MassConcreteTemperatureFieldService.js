/**
 * 大体积混凝土温度场数值解服务
 * 基于 GB 50496-2018《大体积混凝土施工标准》
 * 采用显式差分格式（条件稳定）+ 三角追赶法求解
 */
class MassConcreteTemperatureFieldService {
  // 热工参数默认值
  static DEFAULT_LAMBDA = 2.33    // 导热系数 W/(m·K)
  static DEFAULT_C = 0.92         // 比热容 kJ/(kg·K)
  static DEFAULT_RHO = 2400        // 密度 kg/m³

  // 离散化参数（显式差分用）
  static DT = 0.5                  // 时间步长 (d)
  static MAX_TIME = 28             // 计算时长 (d)
  static SPACE_NODES = 11          // 空间节点数 0%-100% (仅用于generateOutput)
  static TIME_NODES = 29           // 时间节点数 0-28天 (仅用于generateOutput)

  /**
   * 主计算入口
   * @param {Object} params - 输入参数
   * @returns {Object} 计算结果
   */
  static calculate(params) {
    const {
      moldingTemp = 20,            // 入模温度 (°C)
      ambientTemp = 25,           // 环境温度 (°C)
      thickness = 1.5,            // 混凝土厚度 (m)
      lambda = this.DEFAULT_LAMBDA,
      c = this.DEFAULT_C,
      rho = this.DEFAULT_RHO,
      beta = 10,                   // 表面散热系数 W/(m²·K)
      adiabaticParams = { T0: 50, m: 0.3 }
    } = params

    // 生成时间序列 (0-28天，共29个点)
    const times = this._generateTimes()

    // 计算绝热温升曲线
    const adiabaticTemps = this.calculateAdiabaticTemp(
      adiabaticParams.T0,
      adiabaticParams.m,
      times
    )

    // 显式差分求解温度场
    const { temperatureMatrix, n } = this.solveExplicitDifference(
      moldingTemp,
      { thickness, lambda, c, rho, ambientTemp, beta, adiabaticParams },
      adiabaticTemps
    )

    // 生成输出数据
    return this.generateOutput(temperatureMatrix, { moldingTemp, ambientTemp, thickness, n })
  }

  /**
   * 计算绝热温升曲线
   * 公式: T_ad(τ) = T_0 × (1 - exp(-m×τ))
   * @param {number} T0 - 最终绝热温升 (°C)
   * @param {number} m - 热扩散系数 (1/d)
   * @param {number[]} times - 时间序列 (天)
   * @returns {number[]} 绝热温升数组
   */
  static calculateAdiabaticTemp(T0, m, times) {
    return times.map(t => T0 * (1 - Math.exp(-m * t)))
  }

  /**
   * 追赶法求解三对角方程 Ax = d
   * 三对角矩阵:
   * | b0 c0  0  ...   0  |   | x0   |   | d0   |
   * | a1 b1 c1  ...   0  |   | x1   |   | d1   |
   * |  0 a2 b2  ...   0  | × | x2   | = | d2   |
   * |  ...            ...|   | ...  |   | ...  |
   * |  0  0  0  ...  bn  |   | xn   |   | dn   |
   * @param {number[]} a - 下对角元素 (长度n, a[0]不使用)
   * @param {number[]} b - 主对角元素 (长度n+1)
   * @param {number[]} c - 上对角元素 (长度n, c[n-1]不使用)
   * @param {number[]} d - 右端向量 (长度n+1)
   * @returns {number[]} 解向量 x
   */
  static solveTridiagonal(a, b, c, d) {
    const n = d.length
    const x = new Array(n).fill(0)
    const alpha = new Array(n).fill(0)
    const beta = new Array(n).fill(0)

    // 追过程: 消元
    // 第一个方程: b0*x0 + c0*x1 = d0  => x0 = (d0 - c0*x1) / b0
    // 递推公式:
    // alpha[0] = c[0] / b[0]
    // beta[0] = d[0] / b[0]
    // alpha[i] = c[i] / (b[i] - a[i]*alpha[i-1])
    // beta[i] = (d[i] - a[i]*beta[i-1]) / (b[i] - a[i]*alpha[i-1])

    alpha[0] = c[0] / b[0]
    beta[0] = d[0] / b[0]

    for (let i = 1; i < n; i++) {
      const denominator = b[i] - a[i] * alpha[i - 1]
      if (Math.abs(denominator) < 1e-15) {
        throw new Error(`三对角方程求解失败: 主元接近零于第 ${i} 行`)
      }
      alpha[i] = i < n - 1 ? c[i] / denominator : 0
      beta[i] = (d[i] - a[i] * beta[i - 1]) / denominator
    }

    // 赶过程: 回代
    x[n - 1] = beta[n - 1]
    for (let i = n - 2; i >= 0; i--) {
      x[i] = beta[i] - alpha[i] * x[i + 1]
    }

    return x
  }

  /**
   * 显式差分格式求解温度场
   * 稳定性条件: Fo = α × dt / dx² ≤ 0.5
   * @param {number} T0 - 入模温度 (°C)
   * @param {Object} params - 参数
   * @param {number} params.thickness - 混凝土厚度 (m)
   * @param {number} params.lambda - 导热系数 W/(m·K)
   * @param {number} params.c - 比热容 kJ/(kg·K)
   * @param {number} params.rho - 密度 kg/m³
   * @param {number} params.ambientTemp - 环境温度 (°C)
   * @param {number} params.beta - 表面散热系数 W/(m²·K)
   * @param {number[]} adiabaticTemps - 绝热温升数组（已废弃，仅保持接口兼容）
   * @returns {Object} { temperatureMatrix, n, dx }
   */
  static solveExplicitDifference(T0, params, adiabaticTemps) {
    const { thickness, lambda, c, rho, ambientTemp, beta, adiabaticParams } = params
    const dt = this.DT  // 0.5 天

    // 热扩散系数 α = λ / (ρ × c × 1000) m²/d
    const alpha = (lambda * 86400) / (rho * c * 1000)

    // 动态计算空间节点数 n（最大奇数满足 Fo ≤ 0.5）
    const dx_critical = Math.sqrt(alpha * dt / 0.5)
    const n_raw = Math.floor(thickness / dx_critical + 1)
    const n = (n_raw % 2 === 0) ? n_raw - 1 : n_raw
    const dx = thickness / (n - 1)

    // 傅里叶数和比奥数
    const Fo = alpha * dt / (dx * dx)
    const Bi = beta * dx / lambda

    // 时间节点数 (0 ~ 28d, dt=0.5d)
    const m = Math.floor(this.MAX_TIME / dt) + 1  // 57 个时间点

    // 温度矩阵初始化
    const temperatureMatrix = []
    for (let t = 0; t < m; t++) {
      temperatureMatrix.push(new Array(n).fill(T0))
    }

    // 时间步进
    for (let k = 0; k < m - 1; k++) {
      const T_current = temperatureMatrix[k]
      const T_next = new Array(n).fill(ambientTemp)

      // 当前时刻的绝热温升增量（直接用解析公式计算，避免数组越界）
      // 绝热温升: T_ad(t) = T0 * (1 - exp(-m*t))
      // 差分: dT_ad/dt ≈ (T_ad(t+dt) - T_ad(t)) / dt
      const t_current = k * dt
      const dT_ad = adiabaticParams.T0 * adiabaticParams.m * Math.exp(-adiabaticParams.m * t_current)

      for (let i = 0; i < n; i++) {
        if (i === 0) {
          // 中心对称节点 (i=0): T_{-1} = T_1
          T_next[i] = T_current[i] + 2 * Fo * (T_current[1] - T_current[i]) + dT_ad
        } else if (i === n - 1) {
          // 表面对流边界节点 (i=n-1)
          // 正确的第三类边界条件离散化:
          // T_next = T + 2*Fo/(1+Bi) * [(T[i-1] - T[i]) + Bi*(Ta - T[i])] + dT_ad
          // 其中 Bi = beta * dx / lambda
          const convectionFactor = 2 * Fo / (1 + Bi)
          T_next[i] = T_current[i] + convectionFactor * ((T_current[i - 1] - T_current[i]) + Bi * (ambientTemp - T_current[i])) + dT_ad
        } else {
          // 内部节点
          T_next[i] = T_current[i] + Fo * (T_current[i - 1] - 2 * T_current[i] + T_current[i + 1]) + dT_ad
        }
      }

      temperatureMatrix[k + 1] = T_next
    }

    return { temperatureMatrix, n, dx }
  }

  /**
   * 隐式差分格式求解温度场
   * 采用全隐式格式（无条件稳定）
   * @param {number} T0 - 入模温度 (°C)
   * @param {Object} params - 参数
   * @param {number} params.thickness - 混凝土厚度 (m)
   * @param {number} params.lambda - 导热系数 W/(m·K)
   * @param {number} params.c - 比热容 kJ/(kg·K)
   * @param {number} params.rho - 密度 kg/m³
   * @param {number} params.ambientTemp - 环境温度 (°C)
   * @param {number[]} adiabaticTemps - 绝热温升数组
   * @returns {number[][]} 温度矩阵 [time][node]
   */
  static solveImplicitDifference(T0, params, adiabaticTemps) {
    const { thickness, lambda, c, rho, ambientTemp } = params
    const n = this.SPACE_NODES    // 11个空间节点
    const m = this.TIME_NODES    // 29个时间节点

    // 离散化参数
    const dx = thickness / (n - 1)  // 空间步长 (m)
    const dt = 1                     // 时间步长 (d, 1天)

    // 热扩散系数 α = λ / (ρ × c)
    // 注意: λ单位 W/(m·K) = J/(s·m·K), c单位 kJ/(kg·K) = J/(g·K)
    // 统一单位后: α = λ / (ρ × c × 1000) m²/d
    const alpha = (lambda * 86400) / (rho * c * 1000)  // m²/d

    // 傅里叶数 Fo = α × Δt / Δx²
    const Fo = alpha * dt / (dx * dx)

    // 比奥数 (表面散热特征数)
    // Bi = β × Δx / λ, 这里简化处理取经验值
    const Bi = 2.0  // 经验值，表征表面散热强度

    // 温度矩阵初始化
    const temperatureMatrix = []
    for (let t = 0; t < m; t++) {
      temperatureMatrix.push(new Array(n).fill(T0))
    }

    // 设置初始时刻 (t=0) 温度 = 入模温度
    temperatureMatrix[0] = new Array(n).fill(T0)

    // 时间步进
    for (let k = 0; k < m - 1; k++) {
      const T_current = temperatureMatrix[k]
      const T_next = new Array(n).fill(ambientTemp)

      // 当前时刻的绝热温升
      const T_ad_current = adiabaticTemps[k]
      const T_ad_next = adiabaticTemps[k + 1]

      // 单位时间内的绝热温升增量
      const dT_ad = (T_ad_next - T_ad_current) / dt

      // 构建三对角方程组: A × T^{k+1} = d
      // 方程形式: -Fo×T_{i-1} + (1+2Fo)×T_i - Fo×T_{i+1} = T_i^k + dT_ad×Δt
      const a = new Array(n).fill(0)   // 下对角
      const b = new Array(n).fill(0)   // 主对角
      const c_diag = new Array(n).fill(0) // 上对角
      const d = new Array(n).fill(0)   // 右端项

      for (let i = 0; i < n; i++) {
        if (i === 0) {
          // 中心节点 (i=0): 对称边界条件
          // 由于对称性 T_{-1} = T_1，差分方程为:
          // (1+2Fo)×T_0 - 2Fo×T_1 = T_0^k + dT_ad×Δt
          b[i] = 1 + 2 * Fo
          c_diag[i] = -2 * Fo
          d[i] = T_current[i] + dT_ad * dt
        } else if (i === n - 1) {
          // 表面节点 (i=n-1): 散热边界条件
          // 第三类边界条件: -λ × ∂T/∂x = β(T_s - T_a)
          // 离散形式 (隐式):
          // Fo×(2T_{n-2} + (2Bi×dx + 2Fo - 1)×T_{n-1}) / (Fo + Bi×dx + 0.5)
          // 为简化采用近似处理
          const gamma = 1 + 2 * Fo + 2 * Bi * dx
          a[i] = 2 * Fo / gamma
          b[i] = (1 + 2 * Bi * dx) / gamma
          d[i] = (T_current[i] + 2 * Fo * (ambientTemp / (Bi * dx + 1)) + dT_ad * dt * (1 + 2 * Bi * dx) / gamma)
        } else {
          // 内部节点
          a[i] = -Fo
          b[i] = 1 + 2 * Fo
          c_diag[i] = -Fo
          d[i] = T_current[i] + dT_ad * dt
        }
      }

      // 特殊处理中心节点和表面节点的边界条件
      // 重新构建更精确的边界处理

      // 中心对称边界: i=0
      // T_{-1} = T_1 => 中心点采用半步长或特殊处理
      // 这里用: (T_1 - T_{-1})/(2dx) = 0 => T_{-1} = T_1
      // 差分: (T_1 - T_{-1})/(2dx) = 0 => T_{-1} = T_1
      // 隐式格式下中心点: (1+2Fo)×T_0 - 2Fo×T_1 = T_0^k + dT_ad×Δt

      // 表面散热边界: i=n-1
      // 第三类边界条件: -λ(T_n - T_{n-1})/dx = β(T_n - T_a)
      // 整理得: T_n = (T_{n-1} + (βλ/dx)T_a) / (1 + βλ/dx)
      // 代入差分方程求解

      // 重新构建方程组（改进的边界处理）
      const a_new = new Array(n).fill(0)
      const b_new = new Array(n).fill(0)
      const c_new = new Array(n).fill(0)
      const d_new = new Array(n).fill(0)

      for (let i = 0; i < n; i++) {
        if (i === 0) {
          // 中心对称边界: (1+2Fo)×T_0 - 2Fo×T_1 = T_0^k + dT_ad×Δt
          a_new[i] = 0
          b_new[i] = 1 + 2 * Fo
          c_new[i] = -2 * Fo
          d_new[i] = T_current[i] + dT_ad * dt
        } else if (i === n - 1) {
          // ============================================================
          // 表面散热边界条件（第三类边界）
          // 物理意义: -λ × ∂T/∂x|ₓ₌L = β × (T(L, t) - T_a)
          // 左边是混凝土内部导热通量，右边是表面对流散热通量
          // ============================================================
          // 散热系数 β (W/(m²·K))
          const beta = Bi * lambda / dx

          // 边界条件离散化推导:
          // 隐式差分方程在表面: -Fo×T_{n-2} + (1+2Fo)×T_{n-1} - Fo×T_n = T_{n-1}^k + dT_ad×dt
          // 第三类边界: -λ × (T_n - T_{n-1})/dx = β × (T_{n-1} - T_a)
          // 联立求解得:
          // 表面散热边界条件（第三类边界）
          // -λ × (T_n - T_{n-1})/dx = β × (T_a - T_n)
          // 离散化: -Fo×T_{n-2} + (1+Fo)×T_{n-1} = T^n + Fo×Bi×T_a
          const Bi_surface = beta * dx / lambda
          const gamma = 1 + Bi_surface

          a_new[i] = -Fo / gamma
          b_new[i] = (1 + Fo) / gamma
          c_new[i] = 0
          d_new[i] = T_current[i] + dT_ad * dt + Fo * Bi_surface * ambientTemp / gamma
        } else {
          // 内部节点
          a_new[i] = -Fo
          b_new[i] = 1 + 2 * Fo
          c_new[i] = -Fo
          d_new[i] = T_current[i] + dT_ad * dt
        }
      }

      // 使用追赶法求解
      // 注意: a[0]不使用，c[n-1]不使用
      try {
        const solution = this.solveTridiagonal(a_new, b_new, c_new, d_new)
        for (let i = 0; i < n; i++) {
          T_next[i] = solution[i]
        }
      } catch (error) {
        console.error(`时间步 ${k} 求解失败:`, error.message)
        // 求解失败时使用上一时刻温度
        for (let i = 0; i < n; i++) {
          T_next[i] = T_current[i]
        }
      }

      temperatureMatrix[k + 1] = T_next
    }

    return temperatureMatrix
  }

  /**
   * 生成输出数据
   * @param {number[][]} temperatureMatrix - 温度矩阵 [time][node]
   * @param {Object} params - 参数
   * @returns {Object} 输出结果
   */
  static generateOutput(temperatureMatrix, params) {
    const { moldingTemp, ambientTemp, thickness, n: actualN } = params
    // 使用实际的节点数，如果没传则用 SPACE_NODES
    const n = actualN || this.SPACE_NODES

    // 根据温度矩阵行数生成正确的时间序列 (dt=0.5)
    const dt = 0.5
    const times = temperatureMatrix.map((_, k) => Math.round(k * dt * 10) / 10)

    // 空间节点位置 (0% - 100%)，按实际节点数均匀分布
    const nodes = Array.from({ length: n }, (_, i) => Math.round((i / (n - 1)) * 100))

    // 中心点 (i=0) 和表面点 (i=n-1) 的温度历程
    const centerHistory = {
      time: times,
      temp: temperatureMatrix.map(row => row[0])
    }

    const surfaceHistory = {
      time: times,
      temp: temperatureMatrix.map(row => row[n - 1])
    }

    // 里表温差历程
    const tempDiffHistory = {
      time: times,
      tempDiff: temperatureMatrix.map(row => row[0] - row[n - 1])
    }

    // 计算关键指标
    let maxTemp = -Infinity
    let maxTempTime = 0
    let maxTempDiff = -Infinity
    let maxTempDiffTime = 0

    for (let k = 0; k < temperatureMatrix.length; k++) {
      const centerTemp = temperatureMatrix[k][0]
      const surfaceTemp = temperatureMatrix[k][n - 1]
      const tempDiff = centerTemp - surfaceTemp

      if (centerTemp > maxTemp) {
        maxTemp = centerTemp
        maxTempTime = times[k]
      }

      if (tempDiff > maxTempDiff) {
        maxTempDiff = tempDiff
        maxTempDiffTime = times[k]
      }
    }

    return {
      temperatureField: {
        nodes,
        times,
        temperatures: temperatureMatrix
      },
      centerHistory,
      surfaceHistory,
      tempDiffHistory,
      summary: {
        maxTemp: Math.round(maxTemp * 100) / 100,
        maxTempTime,
        maxTempDiff: Math.round(maxTempDiff * 100) / 100,
        maxTempDiffTime,
        initialTemp: moldingTemp,
        ambientTemp,
        thickness
      }
    }
  }

  /**
   * 生成时间序列
   * @returns {number[]} 时间序列 [0, 1, 2, ..., 28]
   */
  static _generateTimes() {
    return Array.from({ length: this.TIME_NODES }, (_, i) => i)
  }
}

module.exports = MassConcreteTemperatureFieldService
