/* =====================================================================
 * script_models.js —— 模式预报查询页
 * 数据源：Open-Meteo /v1/forecast 单请求，一次拉取三模式全部要素
 *   models = gfs_seamless, ecmwf_ifs025, ecmwf_aifs025_single
 * 页面逻辑：三选一展示单个模式；切换模式/要素纯前端重绘，不重新请求
 * 缓存：服务端 Function 10 分钟边缘缓存（functions/api/models-proxy.js）
 * 时间：API 返回 UTC，前端统一转为北京时间（UTC+8）显示
 * 注意：折线序列不使用数据点 label（Canvas 标签过多会拖慢鼠标悬停响应）
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
    'pressure_msl', 'wind_speed_10m', 'wind_gusts_10m',
    'cloud_cover', 'weather_code',
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
    wind_gusts:    { label: '阵风', axisKey: 'wind', type: 'line', color: '#5b2c6f', beaufort: true, dashed: true },
    pressure:      { label: '气压', axisKey: 'pres', type: 'line', color: '#b070c0' },
    precipitation: { label: '降水', axisKey: 'rain', type: 'bar',  color: '#2ecc71' },
  };
  const AXIS_META = {
    temp: { name: '温度 (°C)',   side: 'left' },
    pres: { name: '气压 (hPa)',  side: 'left',  offset: 44 },
    pct:  { name: '湿度 (%)',    side: 'right' },
    rain: { name: '降水 (mm)',   side: 'right', offset: 30 },
    wind: { name: '风速 (km/h)', side: 'right', offset: 60 },
  };
  const RAIN_CAP = 50;        // 降水柱 50mm 满格
  const WIND_DEFAULT_MAX = 75;

  // ---------- 状态 ----------
  const state = {
    activeModel: 'aifs',
    activeVars: new Set(['temperature', 'humidity', 'precipitation']),
    activeStrips: new Set(['cloud']),
    days: 10,
    windUnit: 'kmh',
    showBands: false,
    data: null,
    timeAxis: [],
    fullTime: [],
    initTimeBJT: '—',
    fetchedAt: 0,
  };
  let precipActual = [];      // 各 3h 时次的实际降水量（未封顶，tooltip 用）

  const chart = echarts.init(document.getElementById('mainChart'));
  $(window).on('resize', () => { chart.resize(); layoutBars(); renderSubStrips(); });
  chart.on('dataZoom', () => { layoutBars(); renderSubStrips(); });

  function setStatus(msg, isError) {
    const $b = $('#statusBanner');
    if (!msg) { $b.hide(); return; }
    $b.text(msg).toggleClass('error', !!isError).show();
  }

  // ---------- 时间工具：UTC → 北京时间（与浏览器时区无关） ----------
  function toBJT(iso) {
    const ms = Date.parse(iso + (iso.length === 16 ? ':00' : '') + 'Z');
    const b = new Date(ms + 8 * 3600 * 1000);
    const p = n => String(n).padStart(2, '0');
    return {
      date: `${b.getUTCMonth() + 1}/${b.getUTCDate()}`,
      time: `${p(b.getUTCHours())}:${p(b.getUTCMinutes())}`,
    };
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
      const first = toBJT(json.hourly.time[0]);
      state.initTimeBJT = `${first.date} ${first.time}`;
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
      const rain = field('rain'), snow = field('snowfall');
      if (!rain && !snow) return null;
      const n = state.timeAxis.length;
      return { rain: rain || new Array(n).fill(0), snow: snow || new Array(n).fill(0) };
    }
    const base = {
      temperature: 'temperature_2m', dew_point: 'dew_point_2m',
      humidity: 'relative_humidity_2m',
      wind_speed: 'wind_speed_10m', wind_gusts: 'wind_gusts_10m',
      pressure: 'pressure_msl',
    }[varName];
    return field(base);
  }

  // 降水 3 小时聚合：每 3h 一柱（求和），其余类目为 null
  function aggregate3h(arr) {
    const out = new Array(arr.length).fill(null);
    for (let i = 0; i < arr.length; i += 3) {
      const seg = arr.slice(i, i + 3).filter(v => v != null);
      if (seg.length) out[i] = +seg.reduce((a, b) => a + b, 0).toFixed(1);
    }
    return out;
  }
  // 某时次起未来 3h 降水合计（tooltip 用）
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
    if (axisKey === 'temp' || axisKey === 'rain' || axisKey === 'wind') return (+v).toFixed(1);
    return Math.round(v);
  }
  function windDisplay(kmh) {
    if (state.windUnit === 'ms') return (kmh / 3.6).toFixed(1) + ' m/s';
    if (state.windUnit === 'kn') return (kmh / 1.852).toFixed(1) + ' kn';
    return kmh.toFixed(1) + ' km/h';
  }
  // 云量颜色：0% 天蓝 → 50% 白 → 100% 灰黑
  function cloudColor(pct) {
    pct = Math.max(0, Math.min(100, pct ?? 0));
    const lerp = (a, b, t) => Math.round(a + (b - a) * t);
    const sky = [135, 206, 235], white = [255, 255, 255], dark = [52, 52, 52];
    let rgb;
    if (pct <= 50) { const t = pct / 50; rgb = sky.map((c, i) => lerp(c, white[i], t)); }
    else { const t = (pct - 50) / 50; rgb = white.map((c, i) => lerp(c, dark[i], t)); }
    return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  }

  // ---------- 渲染总入口 ----------
  function renderAll() {
    const hasWindVar = state.activeVars.has('wind_speed') || state.activeVars.has('wind_gusts');
    $('#beaufortGroup').toggle(hasWindVar);
    $('#unitGroup').toggle(hasWindVar);
    $('#beaufortRef').toggle(hasWindVar);
    $('#stripCloud').toggle(state.activeStrips.has('cloud') && !!state.data);
    renderUnifiedChart();
    renderSubStrips();
  }

  // ---------- 统合图表（单模式 × 多要素多轴） ----------
  function renderUnifiedChart() {
    if (!state.data) return;
    const keyLabel = MODELS[state.activeModel].label;

    // 1. 提取所有激活要素的数据
    const dataByVar = {};
    for (const v of state.activeVars) {
      const vals = getSeries(v);
      if (vals) dataByVar[v] = vals;
    }
    if (!Object.keys(dataByVar).length) { chart.clear(); return; }

    // 2. 降水 3h 聚合 + 50mm 封顶
    precipActual = [];
    let rain3hCapped = null, snow3h = null;
    if (dataByVar.precipitation) {
      const rawRain = aggregate3h(dataByVar.precipitation.rain);
      snow3h = aggregate3h(dataByVar.precipitation.snow);
      precipActual = rawRain.map((v, i) => +(((v || 0) + (snow3h[i] || 0)).toFixed(1)));
      rain3hCapped = rawRain.map(v => v == null ? null : Math.min(v, RAIN_CAP));
      const snowCapped = snow3h.map(v => v == null ? null : Math.min(v, RAIN_CAP));
      dataByVar._rain3h = rain3hCapped;
      dataByVar._snow3h = snowCapped;
    }

    // 3. 各轴值域计算
    const statsOf = arrays => {
      const all = arrays.filter(Boolean).flatMap(a => a.filter(Number.isFinite));
      return all.length ? { min: Math.min(...all), max: Math.max(...all) } : null;
    };
    const tempStats = statsOf(['temperature', 'dew_point', 'apparent'].map(v => dataByVar[v]));
    const windStats = statsOf(['wind_speed', 'wind_gusts'].map(v => dataByVar[v]));
    const presStats = statsOf([dataByVar.pressure]);

    const axisRange = {
      temp: tempStats ? { min: Math.floor(tempStats.min - 5), max: Math.ceil(tempStats.max + 5) } : undefined,
      wind: windStats
        ? (windStats.max > WIND_DEFAULT_MAX
            ? { min: 0, max: Math.ceil(windStats.max + 20) }
            : { min: 0, max: WIND_DEFAULT_MAX })
        : { min: 0, max: WIND_DEFAULT_MAX },
      pres: presStats ? { min: Math.floor(presStats.min - 40), max: Math.ceil(presStats.max + 10) } : undefined,
      pct:  { min: 0, max: 100 },
      rain: { min: 0, max: RAIN_CAP },
    };

    // 4. 动态 Y 轴
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
        offset: m.offset || 0, ...axisRange[k],
        axisLine: { show: true }, splitLine: { show: i === 0 },
        nameTextStyle: { align: m.side === 'left' ? 'right' : 'left' },
      };
    });
    const gridRight = 20 + axesNeeded.filter(k => AXIS_META[k].side === 'right').length * 44;
    const gridLeft  = 56 + Math.max(0, axesNeeded.filter(k => AXIS_META[k].side === 'left').length - 1) * 44;

    // 5. series（折线不带数据点 label，避免 Canvas 标签拖慢悬停）
    const series = [];
    const seriesAxis = {};
    for (const v of state.activeVars) {
      const def = UNIFIED_DEFS[v];
      seriesAxis[def.label] = def.axisKey;

      if (v === 'precipitation') {
        series.push({
          id: 'rainbar', name: def.label, type: 'bar', stack: 'rain',
          yAxisIndex: axisIndex.rain, barWidth: 20,
          data: dataByVar._rain3h, itemStyle: { color: def.color },
          // 柱顶雨雪总量标注（如需回退，删除此 label 块即可）
          label: {
            show: true, fontSize: 10, position: 'top',
            formatter: p => {
              const i = p.dataIndex;
              return (precipActual[i] != null && precipActual[i] > 0) ? precipActual[i].toFixed(1) : '';
            },
          },
        });
        series.push({
          id: 'snowbar', name: '降雪', type: 'bar', stack: 'rain',
          yAxisIndex: axisIndex.rain, barWidth: 20,
          data: dataByVar._snow3h, itemStyle: { color: '#aed6f1' },
        });
      } else {
        const vals = dataByVar[v];
        if (!vals) continue;
        series.push({
          name: def.label, type: def.type, yAxisIndex: axisIndex[def.axisKey],
          smooth: true, symbol: 'none',
          lineStyle: def.dashed ? { type: 'dashed' } : undefined,
          data: vals, itemStyle: { color: def.color },
          // 不设 label：数值详情统一走悬停 tooltip
        });
      }
    }

    // 6. 风速色带
    if ((state.activeVars.has('wind_speed') || state.activeVars.has('wind_gusts')) && state.showBands) {
      const windS = series.find(s => seriesAxis[s.name] === 'wind');
      if (windS) {
        const maxKmh = Math.max(...series
          .filter(s => seriesAxis[s.name] === 'wind')
          .flatMap(s => s.data.filter(Number.isFinite)));
        if (Number.isFinite(maxKmh)) {
          windS.markArea = { silent: true, data: beaufortBandsUpTo(maxKmh) };
          const wAxis = yAxis[axisIndex.wind];
          if (maxKmh > wAxis.max) wAxis.max = Math.ceil(maxKmh + 20);
        }
      }
    }

    chart.setOption({
      animation: false,
      title: { text: `${keyLabel} 模式预报`, left: 'center', top: 2, textStyle: { fontSize: 14, fontWeight: 500 } },
      tooltip: {
        trigger: 'axis',
        confine: true,                       // 悬浮层限制在图表内，防止被裁剪
        enterable: false,
        formatter: p => {
          try { return multiTooltip(p, seriesAxis); }
          catch (e) { return p[0]?.axisValueLabel || ''; }   // 容错：任何异常都退回基础提示
        },
        axisPointer: { type: 'cross' },
      },
      legend: { top: 24 },
      grid: { left: gridLeft, right: gridRight, top: 56, bottom: 60 },
      xAxis: { type: 'category', data: state.timeAxis, axisLabel: { hideOverlap: true } },
      yAxis,
      dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 8 }],
      series,
    }, { notMerge: true });

    layoutBars();
  }

  // 降水柱宽：3 个类目宽（随缩放动态调整）
  function layoutBars() {
    if (!state.data || !state.activeVars.has('precipitation')) return;
    const N = state.timeAxis.length;
    if (N < 4) return;
    let xa, xb;
    try {
      xa = chart.convertToPixel({ xAxisIndex: 0 }, 0);
      xb = chart.convertToPixel({ xAxisIndex: 0 }, 3);
    } catch { return; }
    if (!Number.isFinite(xa) || !Number.isFinite(xb) || xb === xa) return;
    const w = Math.abs(xb - xa);
    if (w < 2 || w > 200) return;
    chart.setOption({
      series: [
        { id: 'rainbar', barWidth: w },
        { id: 'snowbar', barWidth: w },
      ],
    });
  }

  // 多要素 tooltip（含该时次天气情况）
  function multiTooltip(params, seriesAxis) {
    const i = params[0].dataIndex;
    const code = field('weather_code')?.[i];
    const w = (code != null && WMO[code]) ? WMO[code] : null;
    let html = `<b>${state.fullTime[i]}</b>（北京时间 · ${MODELS[state.activeModel].label}）`;
    if (w) html += `<br/>${w[1]} ${w[0]}`;
    html += '<br/>';
    params.forEach(p => {
      if (p.value == null || p.seriesName === '降雪') return;
      const axis = seriesAxis[p.seriesName];
      let extra = '';
      if (axis === 'wind') {
        const b = beaufortFromKmh(p.value);
        extra = `<b style="color:${b.color}">（${b.level}级 ${b.name}）</b>`;
      }
      if (axis === 'rain') {
        const actual = precipActual[i];
        html += `${p.marker}未来 3 小时降水：${actual != null ? actual.toFixed(1) : '—'} mm<br/>`;
        return;
      }
      const unit = AXIS_META[axis].name.match(/\((.+)\)/)?.[1] || '';
      const shown = axis === 'wind' ? windDisplay(p.value) : defFormat(p.value, axis) + ' ' + unit;
      html += `${p.marker}${p.seriesName}：${shown} ${extra}<br/>`;
    });
    return html;
  }

  // ---------- 云量条：方形色块，逐小时，与主图 X 轴像素对齐 ----------
  function renderSubStrips() {
    const $cells = $('#cloudCells').empty();
    if (!state.activeStrips.has('cloud') || !state.data) return;
    const N = state.timeAxis.length;
    if (N < 2) return;
    let x0, x1;
    try {
      x0 = chart.convertToPixel({ xAxisIndex: 0 }, 0);
      x1 = chart.convertToPixel({ xAxisIndex: 0 }, 1);
    } catch { return; }
    if (!Number.isFinite(x0) || !Number.isFinite(x1)) return;
    const step = x1 - x0;
    if (!(step > 0)) return;
    const cc = field('cloud_cover');
    const w = Math.max(2, step - 1);
    for (let i = 0; i < N; i++) {
      const pct = cc?.[i] ?? 0;
      const left = x0 + i * step - w / 2;
      $cells.append(`<div class="cloud-block" style="left:${left}px;width:${w}px;
        background:${cloudColor(pct)}" title="${state.fullTime[i]} 云量 ${Math.round(pct)}%"></div>`);
    }
  }

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
    $('#initGfs, #initIfs, #initAifs').text(state.initTimeBJT);
  }

  // ---------- 缓存倒计时 ----------
  function tickCountdown() {
    if (!state.fetchedAt) return;
    const left = PROXY_TTL_MS - (Date.now() - state.fetchedAt);
    $('#cacheCountdown').text(left <= 0 ? '已可刷新' : Math.ceil(left / 60000) + ' 分钟后');
  }
  setInterval(tickCountdown, 1000);

  // ---------- 事件绑定 ----------
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
    fetchData();
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

  fetchData();

  // 控制台调试入口
  window.__models = { state, renderAll };
});
