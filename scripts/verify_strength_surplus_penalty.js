/**
 * 验证强度余量罚分公式（新方案）
 * 5-10: 4元/MPa；>10: 5×4 + (surplus-10)×6
 */
const ConcreteFitness = require('../src/main/services/ConcreteFitness')

const fitness = new ConcreteFitness({}, 45, 210, {})

const cases = [
  { surplus: 0,    expect: 0,   desc: '刚好达标' },
  { surplus: 3,    expect: 0,   desc: '安全余量内' },
  { surplus: 5,    expect: 0,   desc: '安全余量上限' },
  { surplus: 5.01, expect: 0.04, desc: '刚超安全段' },
  { surplus: 6,    expect: 4,    desc: '轻罚段+1' },
  { surplus: 10,   expect: 20,   desc: '轻罚段上限' },
  { surplus: 10.01,expect: 20.06,desc: '刚进重罚段' },
  { surplus: 11,   expect: 26,   desc: '重罚段+1' },
  { surplus: 15,   expect: 50,   desc: '重罚段+5' },
  { surplus: 20,   expect: 80,   desc: '重罚段+10' },
  { surplus: -2,   expect: 0,    desc: '强度不足不罚（由strengthPenalty处理）' }
]

let pass = 0
for (const c of cases) {
  const got = fitness._calcStrengthSurplusPenalty(c.surplus)
  const ok = Math.abs(got - c.expect) < 0.01
  if (ok) pass++
  console.log(`${ok ? '✓' : '✗'} surplus=${c.surplus.toFixed(2).padStart(6)} 期望=${c.expect.toString().padStart(6)} 实际=${got.toFixed(2).padStart(6)} ${c.desc}`)
}
console.log(`\n${pass}/${cases.length} 通过`)
