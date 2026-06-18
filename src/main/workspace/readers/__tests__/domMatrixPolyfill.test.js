// src/main/workspace/readers/__tests__/domMatrixPolyfill.test.js
//
// TDD for v4.8.5 - DOMMatrix polyfill
//
// 背景：pdf-parse v2 基于 pdf.js（浏览器库），依赖 DOMMatrix
//   - Node 16.13.2（Electron 18.18.2 内嵌）：无 DOMMatrix → 抛 "DOMMatrix is not defined"
//   - Node 20+：有原生 DOMMatrix，无需 polyfill
// 修复：在 PDF reader 顶部 require 这个 polyfill，缺则补，有则不动
//
// 覆盖方法（pdf.js 文本提取需要的最小集）：
//   - 构造：new DOMMatrix() / new DOMMatrix(other) / new DOMMatrix({a,b,c,d,e,f})
//   - 属性：a, b, c, d, e, f, is2D, m11, m12, m21, m22, m41, m42
//   - 方法（mutating）：invertSelf(), multiplySelf(other), translateSelf(x,y), scaleSelf(sx,sy), rotateSelf(rad)
//   - 方法（pure）：multiply(other) → new matrix, inverse() → new matrix, transformPoint(p)
//   - 静态：DOMMatrix.fromMatrix(other), DOMMatrix.fromFloat32Array(arr)

const { installDOMMatrix, uninstallDOMMatrix } = require('../domMatrixPolyfill')

describe('domMatrixPolyfill', () => {
  afterEach(() => {
    uninstallDOMMatrix()
  })

  describe('installDOMMatrix / uninstallDOMMatrix', () => {
    test('installDOMMatrix 注入 global.DOMMatrix', () => {
      delete global.DOMMatrix
      installDOMMatrix()
      expect(typeof global.DOMMatrix).toBe('function')
    })

    test('installDOMMatrix 不覆盖已有的 DOMMatrix（Node 20+）', () => {
      const OriginalDOMMatrix = class OriginalDOMMatrix {}
      global.DOMMatrix = OriginalDOMMatrix
      installDOMMatrix()
      expect(global.DOMMatrix).toBe(OriginalDOMMatrix)
      delete global.DOMMatrix
    })

    test('uninstallDOMMatrix 只移除自己注入的，不动原生的', () => {
      const OriginalDOMMatrix = class OriginalDOMMatrix {}
      global.DOMMatrix = OriginalDOMMatrix
      installDOMMatrix() // 已有原生，不动
      uninstallDOMMatrix() // 没注入过，不动
      expect(global.DOMMatrix).toBe(OriginalDOMMatrix)
      delete global.DOMMatrix
    })
  })

  describe('构造与属性', () => {
    test('无参构造：单位矩阵', () => {
      installDOMMatrix()
      const m = new global.DOMMatrix()
      expect(m.a).toBe(1)
      expect(m.b).toBe(0)
      expect(m.c).toBe(0)
      expect(m.d).toBe(1)
      expect(m.e).toBe(0)
      expect(m.f).toBe(0)
      expect(m.is2D).toBe(true)
    })

    test('拷贝构造：另一矩阵的值', () => {
      installDOMMatrix()
      const m1 = new global.DOMMatrix()
      m1.a = 2; m1.e = 10
      const m2 = new global.DOMMatrix(m1)
      expect(m2.a).toBe(2)
      expect(m2.e).toBe(10)
    })

    test('init dict 构造：{a, b, c, d, e, f}', () => {
      installDOMMatrix()
      const m = new global.DOMMatrix({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 })
      expect(m.a).toBe(1)
      expect(m.b).toBe(2)
      expect(m.c).toBe(3)
      expect(m.d).toBe(4)
      expect(m.e).toBe(5)
      expect(m.f).toBe(6)
    })

    test('3D 矩阵属性 m11..m44 默认值', () => {
      installDOMMatrix()
      const m = new global.DOMMatrix()
      // 2D 单位矩阵的 3D 视图
      expect(m.m11).toBe(1)
      expect(m.m22).toBe(1)
      expect(m.m33).toBe(1)
      expect(m.m44).toBe(1)
      expect(m.m12).toBe(0)
      expect(m.m13).toBe(0)
    })
  })

  describe('mutating 方法', () => {
    test('multiplySelf：DOM 约定 = 先 m2 后 m1', () => {
      installDOMMatrix()
      const m1 = new global.DOMMatrix({ a: 1, b: 0, c: 0, d: 1, e: 5, f: 10 }) // 平移 (5,10)
      const m2 = new global.DOMMatrix({ a: 2, b: 0, c: 0, d: 3, e: 0, f: 0 }) // 缩放 (2,3)
      m1.multiplySelf(m2)
      // 等价于先缩放 (2,3) 再平移 (5,10)：
      //   点 P → m2(P) = (2Px, 3Py) → m1(2Px, 3Py) = (2Px+5, 3Py+10)
      // 所以 e=5, f=10
      expect(m1.a).toBe(2)
      expect(m1.d).toBe(3)
      expect(m1.e).toBe(5)
      expect(m1.f).toBe(10)
    })

    test('translateSelf', () => {
      installDOMMatrix()
      const m = new global.DOMMatrix()
      m.translateSelf(5, 10)
      expect(m.e).toBe(5)
      expect(m.f).toBe(10)
    })

    test('scaleSelf', () => {
      installDOMMatrix()
      const m = new global.DOMMatrix()
      m.scaleSelf(2, 3)
      expect(m.a).toBe(2)
      expect(m.d).toBe(3)
    })

    test('invertSelf：单位矩阵逆矩阵仍是单位矩阵', () => {
      installDOMMatrix()
      const m = new global.DOMMatrix()
      m.invertSelf()
      expect(m.a).toBe(1)
      expect(m.d).toBe(1)
    })

    test('invertSelf：缩放 (2,3) 逆矩阵是 (0.5, 1/3)', () => {
      installDOMMatrix()
      const m = new global.DOMMatrix({ a: 2, d: 3, b: 0, c: 0, e: 0, f: 0 })
      m.invertSelf()
      expect(m.a).toBeCloseTo(0.5)
      expect(m.d).toBeCloseTo(1/3)
    })
  })

  describe('pure 方法', () => {
    test('multiply：返回新矩阵，不修改原矩阵', () => {
      installDOMMatrix()
      const m1 = new global.DOMMatrix()
      const m2 = new global.DOMMatrix({ a: 2, b: 0, c: 0, d: 3, e: 0, f: 0 })
      const m3 = m1.multiply(m2)
      expect(m3).not.toBe(m1)
      expect(m1.a).toBe(1)  // 原矩阵未变
      expect(m3.a).toBe(2)
    })

    test('transformPoint：变换点坐标', () => {
      installDOMMatrix()
      const m = new global.DOMMatrix({ a: 1, b: 0, c: 0, d: 1, e: 5, f: 10 })
      const p = m.transformPoint({ x: 1, y: 1 })
      expect(p.x).toBe(6)
      expect(p.y).toBe(11)
    })
  })

  describe('静态方法', () => {
    test('fromMatrix：等价于拷贝构造', () => {
      installDOMMatrix()
      const m1 = new global.DOMMatrix({ a: 2, b: 0, c: 0, d: 3, e: 5, f: 6 })
      const m2 = global.DOMMatrix.fromMatrix(m1)
      expect(m2.a).toBe(2)
      expect(m2.d).toBe(3)
      expect(m2.e).toBe(5)
      expect(m2.f).toBe(6)
    })

    test('fromFloat32Array：前 6 元素作为 a,b,c,d,e,f', () => {
      installDOMMatrix()
      const arr = new Float32Array([1, 0, 0, 1, 5, 10])
      const m = global.DOMMatrix.fromFloat32Array(arr)
      expect(m.a).toBe(1)
      expect(m.b).toBe(0)
      expect(m.c).toBe(0)
      expect(m.d).toBe(1)
      expect(m.e).toBe(5)
      expect(m.f).toBe(10)
    })
  })

  describe('实际场景：pdf-parse v2 能用 polyfill 解析 PDF', () => {
    test('Node 16 模拟：delete global.DOMMatrix 后注入 polyfill，能解析 13MB PDF', async () => {
      // 模拟 Node 16.13.2 环境
      delete global.DOMMatrix
      installDOMMatrix()
      expect(typeof global.DOMMatrix).toBe('function')

      const fsp = require('fs').promises
      const { PDFParse } = require('pdf-parse')
      const buf = await fsp.readFile('D:/C-c/newplan/1-s2.0-S095894652200302X-main.pdf')
      const parser = new PDFParse({ data: buf, useWorker: false })
      const result = await parser.getText()
      expect(result.text).toContain('Cement and Concrete Composites')
      parser.destroy()
    }, 30000)
  })
})
