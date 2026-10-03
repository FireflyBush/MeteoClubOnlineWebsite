/* =====================================================================
 * script_models.js —— 模式预报查询页
 * 数据源：Open-Meteo /v1/forecast 单请求，一次拉取三模式全部要素
 *   models = gfs_seamless, ecmwf_ifs025, ecmwf_aifs025_single
 * 页面逻辑：三选一展示单个模式；切换模式/要素纯前端重绘，不重新请求
 * 缓存：服务端 Function 10 分钟边缘缓存（functions/api/models-proxy.js）
 * 时间：API 返回 UTC，前端统一转为北京时间（UTC+8）显示
 * ===================================================================== */
$(function () {
  'use strict';

  // ---------- 配置 ----------
  const PROXY = '/api/models-proxy?url=';
  const PROXY_TTL_MS = 10 * 60 * 1000;
  const LAT = 22.552188, LON = 114.025106;   // 中心校区坐标，按实际改

  const HOURLY_VARS = [
    'temperature_2m', 'relative_humidity_2m', 'dew_point_2m',
    'precipitation', 'rain', 'snowfall',
    'pressure_msl', 'wind_speed_10m', 'cloud_cover', 'weather_code',
  ].join(',');

  const MODELS = {
    gfs:  { suffix: '_gfs_seamless',         label: 'GFS' },
    ifs:  { suffix: '_ecmwf_ifs025',         label: 'IFS' },
    aifs: { suffix: '_ecmwf_aifs025_single', label: 'AIFS' },
  };

  // WMO weathercode → [中文描述, 图标]（待替换为 GB/T 22164-2017 国标 SVG）
  const WMO = {
    0: ['晴', '☀️'],       1: ['基本晴', '🌤️'],  2: ['局部多云', '⛅'],  3: ['阴', '☁️'],
    45: ['雾', '🌫️'],     48: ['雾凇', '🌫️'],
    51: ['毛毛雨', '🌦️'], 53: ['毛毛雨', '🌦️'],  55: ['毛毛雨', '🌦️'],
    56: ['冻毛毛雨', '🌧️'], 57: ['冻毛毛雨', '🌧️'],
    61: ['小雨', '🌧️'],   63: ['中雨', '🌧️'],    65: ['大雨', '🌧️'],
    66: ['冻雨', '🌧️'],   67: ['冻雨', '🌧️'],
    71: ['小雪', '🌨️'],   73: ['中雪', '🌨️'],    75: ['大雪', '🌨️'],   77: ['雪粒', '🌨️'],
    80: ['阵雨', '🌦️'],   81: ['阵雨', '🌦️'],    82: ['强阵雨', '⛈️'],
    85: ['阵雪', '🌨️'],   86: ['阵雪', '🌨️'],
    95: ['雷阵雨', '⛈️'], 96: ['雷阵雨伴冰雹', '⛈️'], 99: ['雷阵雨伴冰雹', '⛈️'],
  };

  // 要素注册表：axisKey = 同单位共轴分组
  const UNIFIED_DEFS = {
    temperature:   { label: '气温', axisKey: 'temp', type: 'line', color: '#e74c3c' },
    dew_point:     { label: '露点', axisKey: 'temp', type: 'line', color: '#f39c12' },
    apparent:      { label: '体感', axisKey: 'temp', type: 'line', color: '#c05070', computed: true },
    humidity:      { label: '湿度', axisKey: 'pct',  type: 'line', color: '#16a085' },
    wind_speed:    { label: '风速', axisKey: 'wind', type: 'line', color: '#8e44ad', beaufort: true },
    pressure:      { label: '气压', axisKey: 'pres', type: 'line', color: '#b070c0' },
    precipitation: { label: '降水', axisKey: 'rain', type: 'bar',  color: '#2ecc71' },
  };
  const AXIS_META = {
    temp: { name: '温度 (°C)',   side: 'left',  scale: true },
    pres: { name: '气压 (hPa)',  side: 'left',  offset: 44, scale: true },
    pct:  { name: '湿度 (%)',    side: 'right', min: 0, max: 100 },
    rain: { name: '降水 (mm)',   side: 'right', offset: 30, min: 0 },
    wind: { name: '风速 (km/h)', side: 'right', offset: 60, min: 0 },
  };

  // ---------- 状态 ----------
  const state = {
    activeModel: 'aifs',                                   // 默认 AIFS，三选一
    activeVars: new Set(['temperature', 'humidity', 'precipitation']),
    activeStrips: new Set(['cloud']),
    days: 10,
    windUnit: 'kmh',
    showBands: false,
    data: null,
    timeAxis: [],    // 北京时间 x 轴标签 '10/03 14时'
    fullTime: [],    // 北京时间完整 '10/03 14:00'（详情卡片用）
    fetchedAt: 0,
  };

  const chart = echarts.init(document.getElementById('mainChart'));
  $(window).on('resize', () => { chart.resize(); renderSubStrips(); });

  function setStatus(msg, isError) {
    const $b = $('#statusBanner');
    if (!msg) { $b.hide(); return; }
    $b.text(msg).toggleClass('error', !!isError).show();
  }

  // ---------- 时间工具：UTC → 北京时间（浏览器时区无关） ----------
  function toBJT(iso) {
    const ms = Date.parse(iso + (iso.length === 16 ? ':00' : '') + 'Z');
    const b = new Date(ms + 8 * 3600 * 1000);
    const p = n => String(n).padStart(2, '0');
    return {
      date: `${b.getUTCMonth() + 1}/${b.getUTCDate()}`,
      time: `${p(b.getUTCHours())}:${p(b.getUTCMinutes())}`,
    };
  }
  // 起报时间推算：当前 UTC 向下取整至最近 6h，再转北京时间
  function estimateInitBJT() {
    const sixH = 6 * 3600 * 1000;
    const runUTC = new Date(Math.floor(Date.now() / sixH) * sixH);
    const b = new Date(runUTC.getTime() + 8 * 3600 * 1000);
    const p = n => String(n).padStart(2, '0');
    return `${b.getUTCMonth() + 1}/${b.getUTCDate()} ${p(b.getUTCHours())}:00`;
  }

  // ---------- Steadman 体感温度（与首页公式一致） ----------
  function apparentTemperature(T, RH, v) {  // °C, %, m/s
    if (v > 4.8) return 13.12 + 0.6215 * T - 11.37 * Math.sqrt(v) + 0.3965 * T * Math.sqrt(v);
    return T + 0.33 * RH / 100 * 6.105 * Math.exp(17.27 * T / (237.7 + T)) - 4;
  }

  // ---------- 字段访问（按当前模式后缀 + 全 null 兜底） ----------
  function field(base) {
    const h = state.data?.hourly;
    if (!h) return null;
    const arr = h[base + MODELS[state.activeModel].suffix];
    if (!arr || !arr.some(v => v !== null)) return null;
    return arr;
  }

  // ---------- 数据获取（单请求三模式全要素，切换不重取） ----------
  async function fetchData() {
    setStatus('⏳ 正在获取模式数据…');
    const params = new URLSearchParams({
      latitude: LAT, longitude: LON,
      hourly: HOURLY_VARS,
      models: 'gfs_seamless,ecmwf_ifs025,ecmwf_aifs025_single',
      forecast_days: state.days,
      // 不传 timezone：返回 UTC，前端统一转北京时间
    });
    try {
      const res = await fetch(PROXY + encodeURIComponent(
        'https://api.open-meteo.com/v1/forecast?' + params.toString()));
      const json = await res.json();
      if (json.error) throw new Error(json.reason || 'API 返回错误');
      state.data = json;
      state.timeAxis = json.hourly.time.map(t => {
        const r = toBJT(t);
        return `${r.date} ${r.time.split(':')[0]}时`;
      });
      state.fullTime = json.hourly.time.map(t => {
        const r = toBJT(t);
        return `${r.date} ${r.time}`;
      });
      state.fetchedAt = Date.now();
      setStatus('');
    } catch (e) {
      setStatus('❌ 数据获取失败：' + e.message, true);
    }
    updateInitTable();
    renderAll();
  }

  // ---------- 序列提取 ----------
  function getSeries(varName) {
    const def = UNIFIED_DEFS[varName];
    if (def.computed) {
      const T  = field('temperature_2m');
      const RH = field('relative_humidity_2m');
      const W  = field('wind_speed_10m');
      if (!T || !RH) return null;
      return T.map((t, i) => apparentTemperature(t, RH[i] ?? 50, (W?.[i] ?? 0) / 3.6));
    }
    if (varName === 'precipitation') {
      const rain = field('rain')  || new Array(state.timeAxis.length).fill(0);
      const snow = field('snowfall') || new Array(state.timeAxis.length).fill(0);
      if (!field('rain') && !field('snowfall')) return null;
      return { rain, snow };
    }
    const base = {
      temperature: 'temperature_2m', dew_point: 'dew_point_2m',
      humidity: 'relative_humidity_2m', wind_speed: 'wind_speed_10m',
      pressure: 'pressure_msl',
    }[varName];
    return field(base);
  }

  // 降水 3 小时聚合：每 3h 一柱（求和），其余类目为 null 不画
  function aggregate3h(arr) {
    const out = new Array(arr.length).fill(null);
    for (let i = 0; i < arr.length; i += 3) {
      const seg = arr.slice(i, i + 3).filter(v => v != null);
      if (seg.length) out[i] = +seg.reduce((a, b) => a + b, 0).toFixed(1);
    }
    return out;
  }
  // 某时次起未来 3h 降水合计（详情卡片用）
  function precip3hAt(i) {
    const rain = field('rain'), snow = field('snowfall');
    if (!rain && !snow) return null;
    let sum = 0;
    for (let j = i; j < Math.min(i + 3, state.timeAxis.length); j++) {
      sum += (rain?.[j] || 0) + (snow?.[j] || 0);
    }
    return +sum.toFixed(1);
  }

  // ---------- 数值格式化 ----------
  function defFormat(v, axisKey) {
    if (v == null || isNaN(v)) return '';
    if (axisKey === 'temp' || axisKey === 'rain') return (+v).toFixed(1);  // 体感/降水保留 1 位小数
    if (axisKey === 'wind') return (+v).toFixed(1);
    return Math.round(v);
  }
  function windDisplay(kmh) {
    if (state.windUnit === 'ms') return (kmh / 3.6).toFixed(1) + ' m/s';
    if (state.windUnit === 'kn') return (kmh / 1.852).toFixed(1) + ' kn';
    return kmh.toFixed(1) + ' km/h';
  }

  // ---------- 渲染总入口 ----------
  function renderAll() {
    const hasWind = state.activeVars.has('wind_speed');
    $('#beaufortGroup').toggle(hasWind);
    $('#unitGroup').toggle(hasWind);
    $('#beaufortRef').toggle(hasWind);
    $('#stripCloud').toggle(state.activeStrips.has('cloud') && !!state.data);
    renderUnifiedChart();
    renderSubStrips();
  }

  // ---------- 统合图表（单模式 × 多要素多轴） ----------
  function renderUnifiedChart() {
    if (!state.data) return;
    const key = state.activeModel;
    const keyLabel = MODELS[key].label;

    // 1. 动态 Y 轴
    const axesNeeded = [];
    for (const v of state.activeVars) {
      const k = UNIFIED_DEFS[v].axisKey;
      if (!axesNeeded.includes(k)) axesNeeded.push(k);
    }
    const axisIndex = {};
    const yAxis = axesNeeded.map((k, i) => {
      axisIndex[k] = i;
      const m = AXIS_META[k];
      return {
        type: 'value', name: m.name, position: m.side,
        offset: m.offset || 0, min: m.min, max: m.max, scale: m.scale,
        axisLine: { show: true }, splitLine: { show: i === 0 },
        nameTextStyle: { align: m.side === 'left' ? 'right' : 'left' },
      };
    });
    const gridRight = 20 + axesNeeded.filter(k => AXIS_META[k].side === 'right').length * 44;
    const gridLeft  = 56 + Math.max(0, axesNeeded.filter(k => AXIS_META[k].side === 'left').length - 1) * 44;

    // 2. series：当前模式 × 激活要素
    const series = [];
    const seriesAxis = {};
    for (const v of state.activeVars) {
      const def = UNIFIED_DEFS[v];
      const vals = getSeries(v);
      if (!vals) continue;
      seriesAxis[def.label] = def.axisKey;

      if (def.axisKey === 'rain') {
        // 降水：3h 一柱，雪堆叠在雨上方
        const rain3h = aggregate3h(vals.rain);
        const snow3h = aggregate3h(vals.snow);
        series.push({
          name: def.label, type: 'bar', stack: 'rain',
          yAxisIndex: axisIndex.rain,
          barWidth: 14,                          // 固定像素宽，避免逐小时类目过密
          data: rain3h, itemStyle: { color: def.color },
          label: {
            show: true, fontSize: 10, position: 'top',
            formatter: p => (p.value != null && p.value > 0)
              ? (p.value + (snow3h[p.dataIndex] || 0)).toFixed(1) : '',
          },
        });
        series.push({
          name: '降雪', type: 'bar', stack: 'rain',
          yAxisIndex: axisIndex.rain, barWidth: 14,
          data: snow3h, itemStyle: { color: '#aed6f1' },
        });
      } else {
        series.push({
          name: def.label, type: def.type, yAxisIndex: axisIndex[def.axisKey],
          smooth: true, symbol: 'none',
          data: vals, itemStyle: { color: def.color },
          label: {
            show: true, fontSize: 10, position: 'top',
            formatter: p => p.dataIndex % 3 === 0 ? defFormat(p.value, def.axisKey) : '',
          },
        });
      }
    }

    if (!series.length) { chart.clear(); return; }

    // 3. 风速色带
    if (state.activeVars.has('wind_speed') && state.showBands) {
      const windS = series.find(s => seriesAxis[s.name] === 'wind');
      const maxKmh = Math.max(...windS.data.filter(Number.isFinite));
      if (Number.isFinite(maxKmh)) {
        windS.markArea = { silent: true, data: beaufortBandsUpTo(maxKmh) };
        const b = beaufortFromKmh(maxKmh);
        yAxis[axisIndex.wind].max = b.max === Infinity ? maxKmh * 1.05 : b.max;
      }
    }

    chart.setOption({
      animation: false,
      title: { text: `${keyLabel} 模式预报`, left: 'center', top: 2, textStyle: { fontSize: 14, fontWeight: 500 } },
      tooltip: {
        trigger: 'axis',
        formatter: p => multiTooltip(p, seriesAxis),
        axisPointer: { type: 'cross' },
      },
      legend: { top: 24 },
      grid: { left: gridLeft, right: gridRight, top: 56, bottom: 60 },
      xAxis: { type: 'category', data: state.timeAxis,
        axisLabel: { hideOverlap: true } },
      yAxis,
      dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 8 }],
      series,
    }, { notMerge: true });
  }

  // 多要素 tooltip
  function multiTooltip(params, seriesAxis) {
    let html = `<b>${state.fullTime[params[0].dataIndex]}</b>（北京时间，${MODELS[state.activeModel].label}）<br/>`;
    params.forEach(p => {
      if (p.value == null || p.seriesName === '降雪') return;
      const axis = seriesAxis[p.seriesName];
      let extra = '';
      if (axis === 'wind') {
        const b = beaufortFromKmh(p.value);
        extra = `<b style="color:${b.color}">（${b.level}级 ${b.name}）</b>`;
      }
      const unit = AXIS_META[axis].name.match(/\((.+)\)/)?.[1] || '';
      html += `${p.marker}${p.seriesName}：${defFormat(p.value, axis)} ${unit} ${extra}<br/>`;
    });
    return html;
  }

  // ---------- 云量条：convertToPixel 与主图 X 轴像素对齐，3h 一格 ----------
  function renderSubStrips() {
    const $cells = $('#cloudCells').empty();
    if (!state.activeStrips.has('cloud') || !state.data) return;
    const N = state.timeAxis.length;
    if (!N) return;
    let x0, x1;
    try {
      x0 = chart.convertToPixel({ xAxisIndex: 0 }, 0);
      x1 = chart.convertToPixel({ xAxisIndex: 0 }, N - 1);
    } catch { return; }
    if (!Number.isFinite(x0) || !Number.isFinite(x1)) return;
    const step = N > 1 ? (x1 - x0) / (N - 1) : 0;

    const cc = field('cloud_cover');
    for (let i = 0; i < N; i += 3) {
      const pct = cc?.[i] ?? 0;
      const left = x0 + i * step;
      $cells.append(`<div class="cloud-cell" style="left:${left}px;
        background:linear-gradient(180deg,#666 ${100 - pct}%,transparent ${100 - pct}%);"
        title="${state.fullTime[i]} 云量 ${Math.round(pct)}%"></div>`);
    }
  }

  // ---------- 天气详情卡片：点击图表任意时次弹出 ----------
  chart.getZr().on('click', function (e) {
    if (!state.data || !state.timeAxis.length) return;
    const pt = [e.offsetX, e.offsetY];
    let idx;
    try { idx = Math.round(chart.convertFromPixel({ xAxisIndex: 0 }, pt)[0]); } catch { return; }
    if (idx == null || idx < 0 || idx >= state.timeAxis.length) return;
    showWeatherCard(idx);
  });

  function showWeatherCard(i) {
    const code = field('weather_code')?.[i];
    const w = (code != null && WMO[code]) ? WMO[code] : ['无数据', '·'];
    const T  = field('temperature_2m')?.[i];
    const RH = field('relative_humidity_2m')?.[i];
    const WS = field('wind_speed_10m')?.[i];
    const pp = precip3hAt(i);
    let windTxt = '—';
    if (WS != null) {
      const b = beaufortFromKmh(WS);
      windTxt = `${windDisplay(WS)}（${b.level}级 ${b.name}）`;
    }
    $('#modalText').html(`
      <div class="wx-card">
        <div class="wx-head">
          <span class="wx-icon">${w[1]}</span>
          <div>
            <div class="wx-time">${state.fullTime[i]}</div>
            <div class="wx-desc">${w[0]} · ${MODELS[state.activeModel].label} 模式 · 北京时间</div>
          </div>
        </div>
        <table class="wx-table">
          <tr><td>气温</td><td>${T != null ? T.toFixed(1) + ' °C' : '—'}</td></tr>
          <tr><td>相对湿度</td><td>${RH != null ? Math.round(RH) + ' %' : '—'}</td></tr>
          <tr><td>风速</td><td>${windTxt}</td></tr>
          <tr><td>未来 3 小时降水</td><td>${pp != null ? pp.toFixed(1) + ' mm' : '—'}</td></tr>
        </table>
      </div>`);
    $('#myModal').show();
  }
  $('.modal-close').on('click', () => $('#myModal').hide());
  $('#myModal').on('click', function (e) { if (e.target === this) $(this).hide(); });

  // ---------- 蒲福参考表（一次生成） ----------
  (function buildBeaufortRef() {
    BEAUFORT_SCALE.forEach(b => {
      $('#beaufortGrid').append(`
        <div class="beaufort-item" style="border-left:3px solid ${b.color}">
          <strong>${b.level}级 ${b.name}</strong>
          <span>${b.max === Infinity ? '≥203' : b.min + '–' + b.max} km/h</span>
          <small>${b.desc}</small>
        </div>`);
    });
  })();

  // ---------- 模式信息表 ----------
  function updateInitTable() {
    const runTime = estimateInitBJT();
    $('#initGfs, #initIfs, #initAifs').text(runTime);
  }

  // ---------- 缓存倒计时 ----------
  function tickCountdown() {
    if (!state.fetchedAt) return;
    const left = PROXY_TTL_MS - (Date.now() - state.fetchedAt);
    $('#cacheCountdown').text(left <= 0 ? '已可刷新' : Math.ceil(left / 60000) + ' 分钟后');
  }
  setInterval(tickCountdown, 1000);

  // ---------- 事件绑定 ----------
  // 模式三选一：纯前端切换（数据已全量在本地），不重新请求
  $('#modeSelect .mode-btn').on('click', function () {
    $('#modeSelect .mode-btn').removeClass('active');
    $(this).addClass('active');
    state.activeModel = $(this).data('model');
    renderAll();
  });

  $('#varToggles input').on('change', function () {
    const v = $(this).data('var');
    $(this).is(':checked') ? state.activeVars.add(v) : state.activeVars.delete(v);
    if (!state.activeVars.size) { $(this).prop('checked', true); state.activeVars.add(v); return; }
    renderAll();
  });

  $('#stripToggles input').on('change', function () {
    const s = $(this).data('strip');
    $(this).is(':checked') ? state.activeStrips.add(s) : state.activeStrips.delete(s);
    renderAll();
  });

  $('#daysSel').on('change', function () {
    state.days = +$(this).val();
    fetchData();   // 仅时效变化时重新请求
  });

  $('#unitSel').on('change', function () {
    state.windUnit = $(this).val();
    renderAll();
  });

  $('#chkBands').on('change', function () {
    state.showBands = $(this).is(':checked');
    renderAll();
  });

  $('#refreshBtn').on('click', () => fetchData());

  // ---------- 首次加载 ----------
  fetchData();

  // 暴露给控制台调试（雨雪注入用）
  window.__models = { state, renderAll };
});
