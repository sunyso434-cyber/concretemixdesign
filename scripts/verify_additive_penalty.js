/**
 * 验证掺合料梯度罚分公式
 * 1%=10, 2%=20, 3%=40, 4%=80, 5%=160
 */
const ConcreteFitness = require('../src/main/services/ConcreteFitness')

const fitness = new ConcreteFitness({}, 45, 210, {})

const cases = [
  { total: 50.00, expect: 0, desc: '临界不罚' },
  { total: 50.50, expect: 10, desc: '超0.5%（第一段）' },
  { total: 51.00, expect: 10, desc: '超1.0%（第一段上限）' },
  { total: 51.01, expect: 20, desc: '超1.01%（第二段）' },
  { total: 52.00, expect: 20, desc: '超2.0%（第二段上限）' },
  { total: 52.13, expect: 40, desc: '超2.13%（对应原#1解）' },
  { total: 52.35, expect: 40, desc: '超2.35%（对应原#8解）' },
  { total: 53.00, expect: 40, desc: '超3.0%（第三段上限）' },
  { total: 54.00, expect: 80, desc: '超4.0%（第四段）' },
  { total: 55.00, expect: 160, desc: '超5.0%（第五段）' },
  { total: 45.00, expect: 0, desc: '远低于上限' },
  { total: 49.99, expect: 0, desc: '略低于上限' }
]

let pass = 0
for (const c of cases) {
  const got = fitness._calcAdditivePenalty(c.total)
  const ok = got === c.expect
  if (ok) pass++
  console.log(`${ok ? '✓' : '✗'} total=${c.total.toFixed(2).padStart(6)}% 期望=${c.expect.toString().padStart(4)} 实际=${got.toString().padStart(4)} ${c.desc}`)
}
console.log(`\n${pass}/${cases.length} 通过`)
