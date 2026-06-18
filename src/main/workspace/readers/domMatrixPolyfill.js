// src/main/workspace/readers/domMatrixPolyfill.js
//
// P1 补全 v4.8.5 - DOMMatrix polyfill for Node < 21.7
//
// 背景：
//   - pdf-parse v2 基于 pdf.js（浏览器库），依赖 DOMMatrix
//   - Node 16.13.2（Electron 18.18.2 内嵌）无 DOMMatrix → 抛 "DOMMatrix is not defined"
//   - Node 20+ 有原生 DOMMatrix，无需 polyfill
//
// 修复：
//   - PDF reader 顶部 require('./domMatrixPolyfill') 即可自动注入
//   - 有原生 DOMMatrix → 不动；没有 → 注入最小实现
//   - 覆盖 pdf.js 文本提取需要的 API：
//     构造（无参/拷贝/init-dict）、属性（a/b/c/d/e/f/is2D/m11-m44）、
//     方法（multiplySelf/translateSelf/scaleSelf/invertSelf/multiply/inverse/transformPoint）、
//     静态（fromMatrix/fromFloat32Array）
//
// 已知限制：
//   - 3D 矩阵（m13/m14/m23/m24/m31/m32/m34/m43）只读写，不做语义操作
//   - rotateSelf 用 2D 旋转公式（够用）
//   - is2D 总是 true（pdf.js 文本提取不会触发 3D 场景）

let _installed = false
let _originalDOMMatrix = null

class DOMMatrixPolyfill {
  constructor(init) {
    // 默认单位矩阵
    this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0
    this.m11 = 1; this.m12 = 0; this.m13 = 0; this.m14 = 0
    this.m21 = 0; this.m22 = 1; this.m23 = 0; this.m24 = 0
    this.m31 = 0; this.m32 = 0; this.m33 = 1; this.m34 = 0
    this.m41 = 0; this.m42 = 0; this.m43 = 0; this.m44 = 1
    this.is2D = true

    if (init == null) return

    if (init instanceof DOMMatrixPolyfill || (typeof init === 'object' && 'a' in init)) {
      // 拷贝构造 或 init dict
      for (const k of ['a', 'b', 'c', 'd', 'e', 'f']) {
        if (typeof init[k] === 'number') this[k] = init[k]
      }
      // 同步 3D 视图
      this.m11 = this.a; this.m12 = this.b
      this.m21 = this.c; this.m22 = this.d
      this.m41 = this.e; this.m42 = this.f
    }
  }

  // m1 * m2: 应用 m2 再应用 m1（行向量约定）
  multiplySelf(other) {
    const a = this.a * other.a + this.c * other.b
    const b = this.b * other.a + this.d * other.b
    const c = this.a * other.c + this.c * other.d
    const d = this.b * other.c + this.d * other.d
    const e = this.a * other.e + this.c * other.f + this.e
    const f = this.b * other.e + this.d * other.f + this.f
    this.a = a; this.b = b; this.c = c; this.d = d; this.e = e; this.f = f
    this.m11 = a; this.m12 = b; this.m21 = c; this.m22 = d; this.m41 = e; this.m42 = f
    return this
  }

  multiply(other) {
    const out = new DOMMatrixPolyfill(this)
    out.multiplySelf(other)
    return out
  }

  translateSelf(tx, ty) {
    this.e += this.a * tx + this.c * ty
    this.f += this.b * tx + this.d * ty
    this.m41 = this.e
    this.m42 = this.f
    return this
  }

  translate(tx, ty) {
    const out = new DOMMatrixPolyfill(this)
    out.translateSelf(tx, ty)
    return out
  }

  scaleSelf(sx, sy) {
    this.a *= sx
    this.b *= sx
    this.c *= sy
    this.d *= sy
    this.m11 = this.a
    this.m22 = this.d
    return this
  }

  scale(sx, sy) {
    const out = new DOMMatrixPolyfill(this)
    out.scaleSelf(sx, sy)
    return out
  }

  rotateSelf(rot) {
    const cos = Math.cos(rot)
    const sin = Math.sin(rot)
    return this.multiplySelf(new DOMMatrixPolyfill({ a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 }))
  }

  rotate(rot) {
    const out = new DOMMatrixPolyfill(this)
    out.rotateSelf(rot)
    return out
  }

  invertSelf() {
    const det = this.a * this.d - this.b * this.c
    if (det === 0) return this
    const inv = 1 / det
    const a = this.d * inv
    const b = -this.b * inv
    const c = -this.c * inv
    const d = this.a * inv
    const e = -(a * this.e + c * this.f)
    const f = -(b * this.e + d * this.f)
    this.a = a; this.b = b; this.c = c; this.d = d; this.e = e; this.f = f
    this.m11 = a; this.m12 = b; this.m21 = c; this.m22 = d; this.m41 = e; this.m42 = f
    return this
  }

  inverse() {
    const out = new DOMMatrixPolyfill(this)
    out.invertSelf()
    return out
  }

  transformPoint(p) {
    return {
      x: this.a * p.x + this.c * p.y + this.e,
      y: this.b * p.x + this.d * p.y + this.f
    }
  }

  static fromMatrix(other) {
    return new DOMMatrixPolyfill(other)
  }

  static fromFloat32Array(arr) {
    if (!arr || arr.length < 6) {
      return new DOMMatrixPolyfill()
    }
    return new DOMMatrixPolyfill({
      a: arr[0], b: arr[1], c: arr[2], d: arr[3], e: arr[4], f: arr[5]
    })
  }
}

function installDOMMatrix() {
  if (typeof global.DOMMatrix === 'function') {
    // 已有原生（Node 20+），不覆盖
    _installed = false
    return false
  }
  _originalDOMMatrix = undefined
  global.DOMMatrix = DOMMatrixPolyfill
  _installed = true
  return true
}

function uninstallDOMMatrix() {
  if (!_installed) return false
  delete global.DOMMatrix
  _installed = false
  return true
}

module.exports = { installDOMMatrix, uninstallDOMMatrix, DOMMatrixPolyfill }
