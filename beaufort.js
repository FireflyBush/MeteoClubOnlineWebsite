/* beaufort.js —— 蒲福风级换算模块（GB/T 28591-2012，0-17 级） */
const BEAUFORT_SCALE = [
  { level: 0,  name: '无风',     min: 0,   max: 1,        color: '#f0f9ff', desc: '孤烟直上' },
  { level: 1,  name: '软风',     min: 1,   max: 5,        color: '#e0f2fe', desc: '烟示风向' },
  { level: 2,  name: '轻风',     min: 6,   max: 11,       color: '#bae6fd', desc: '树叶微响' },
  { level: 3,  name: '微风',     min: 12,  max: 19,       color: '#7dd3fc', desc: '旗帜展开' },
  { level: 4,  name: '和风',     min: 20,  max: 28,       color: '#38bdf8', desc: '吹起灰尘' },
  { level: 5,  name: '清劲风',   min: 29,  max: 38,       color: '#0ea5e9', desc: '小树摇摆' },
  { level: 6,  name: '强风',     min: 39,  max: 49,       color: '#fbbf24', desc: '举伞困难' },
  { level: 7,  name: '疾风',     min: 50,  max: 61,       color: '#f59e0b', desc: '整树摇动' },
  { level: 8,  name: '大风',     min: 62,  max: 74,       color: '#f97316', desc: '细枝折断' },
  { level: 9,  name: '烈风',     min: 75,  max: 88,       color: '#ef4444', desc: '砖瓦损伤' },
  { level: 10, name: '狂风',     min: 89,  max: 102,      color: '#dc2626', desc: '拔起树木' },
  { level: 11, name: '暴风',     min: 103, max: 117,      color: '#b91c1c', desc: '倒树成排' },
  { level: 12, name: '飓风',     min: 118, max: 133,      color: '#9333ea', desc: '掀翻屋顶' },
  { level: 13, name: '——',     min: 134, max: 149,      color: '#7e22ce', desc: '损毁船只' },
  { level: 14, name: '——',   min: 150, max: 166,      color: '#a21caf', desc: '损毁房屋' },
  { level: 15, name: '——',   min: 167, max: 183,      color: '#86198f', desc: '重创城镇' },
  { level: 16, name: '——', min: 184, max: 202,      color: '#701a75', desc: '————' },
  { level: 17, name: '——', min: 203, max: Infinity, color: '#4a044e', desc: '————' },
];

/** km/h → 风级对象 */
function beaufortFromKmh(kmh) {
  if (kmh == null || isNaN(kmh)) return null;
  for (const b of BEAUFORT_SCALE) {
    if (kmh < b.max || b.max === Infinity) return b;
  }
  return BEAUFORT_SCALE[BEAUFORT_SCALE.length - 1];
}

/** 生成 ECharts markArea 色带数据（画到数据最大值所在级为止） */
function beaufortBandsUpTo(maxKmh) {
  const stop = beaufortFromKmh(maxKmh);
  return BEAUFORT_SCALE.slice(0, stop.level + 1).map(b => ([
    { yAxis: b.min, itemStyle: { color: b.color + '55' } },
    { yAxis: b.max === Infinity ? maxKmh * 1.05 : b.max },
  ]));
}
