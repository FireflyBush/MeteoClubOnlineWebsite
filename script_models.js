/* =====================================================================
 * script_models.js —— 全球模式对比页
 * 数据源：Open-Meteo /v1/forecast，单请求合并三模式
 *   models = gfs_seamless, ecmwf_ifs025, ecmwf_aifs025_single
 * 缓存：服务端 Function 10 分钟边缘缓存（functions/api/models-proxy.js）
 * 依赖：jQuery, ECharts 5, beaufort.js
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
    'sunshine_duration',
  ].join(',');

  const MODELS = {
    gfs:  { suffix: '_gfs_seamless',          label: 'GFS' },
    ifs:  { suffix: '_ecmwf_ifs025',          label: 'IFS' },
    aifs: { suffix: '_ecmwf_aifs025_single',  label: 'AIFS' },
  };
  const MODEL_KEYS = ['gfs', 'ifs', 'aifs'];

  // WMO weathercode → [中文描述, 图标]（后续可替换为国标 SVG）
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
    temperature:   { label: '气温', axisKey: 'temp', type: 'line', color: { gfs: '#f39c12', ifs: '#e74c3c', aifs: '#c0392b' } },
    dew_point:     { label: '露点', axisKey: 'temp', type: 'line', color: { gfs: '#e67e22', ifs: '#f39c12', aifs: '#d35400' } },
    apparent:      { label: '体感', axisKey: 'temp', type: 'line', color: { gfs: '#d35400', ifs: '#c05070', aifs: '#a04060' }, computed: true },
    humidity:      { label: '湿度', axisKey: 'pct',  type: 'line', color: { gfs: '#16a085', ifs: '#5dade2', aifs: '#48c9b0' } },
    wind_speed:    { label: '风速', axisKey: 'wind', type: 'line', color: { gfs: '#8e44ad', ifs: '#7d3c98', aifs: '#6c3483' }, beaufort: true },
    pressure:      { label: '气压', axisKey: 'pres', type: 'line', color: { gfs: '#b070c0', ifs: '#8e44ad', aifs: '#7040a0' } },
    precipitation: { label: '降水', axisKey: 'rain', type: 'bar',  color: { gfs: '#2ecc71', ifs: '#27ae60', aifs: '#1e8449' } },
  };
  const AXIS_META = {
    temp: { name: '温度 (°C)',    side: 'left',  scale: true },
    pres: { name: '气压 (hPa)',   side: 'left',  offset: 44, scale: true },
    pct:  { name: '湿度/云量 (%)', side: 'right', min: 0, max: 100 },
    rain: { name: '降水 (mm)',    side: 'right', offset: 30, min: 0 },
    wind: { name: '风速 (km/h)',  side: 'right', offset: 60, min: 0 },
  };

  // ---------- 状态 ----------
  const state = {
    activeVars: new Set(['temperature', 'humidity', 'precipitation']),
    activeStrips: new Set(['cloud', 'weather']),
    models: { gfs: true, ifs: true, aifs: true },
    days: 10,
    windUnit: 'kmh',
    showBands: false,
    data: null,          // 单份合并响应
    timeAxis: [],
    fetchedAt: 0,
  };

  const chart = echarts.init(document.getElementById('mainChart'));
  $(window).on('resize', () => chart.resize());

  function setStatus(msg, isError) {
    const $b = $('#statusBanner');
    if (!msg) { $b.hide(); return; }
    $b.text(msg).toggleClass('error', !!isError).show();
  }

  // ---------- Steadman 体感温度（与首页公式一致） ----------
  function apparentTemperature(T, RH, v) {  // °C, %, m/s
    if (v > 4.8) return 13.12 + 0.6215 * T - 11.37 * Math.sqrt(v) + 0.3965 * T * Math.sqrt(v);
    return T + 0.33 * RH / 100 * 6.105 * Math.exp(17.27 * T / (237.7 + T)) - 4;
  }

  // ---------- 字段访问（固定后缀 + 全 null 兜底） ----------
  function field(modelKey, base) {
    const h = state.data?.hourly;
    if (!h) return null;
    const arr = h[base + MODELS[modelKey].suffix];
    if (!arr || !arr.some(v => v !== null)) return null;   // 全 null 视为无数据
    return arr;
  }
  function hasModel(modelKey) {
    return state.models[modelKey] && field(modelKey, 'temperature_2m') !== null;
  }

  // ---------- 数据获取（单请求） ----------
  async function fetchData() {
    setStatus('⏳ 正在获取模式数据…');
    const params = new URLSearchParams({
      latitude: LAT, longitude: LON,
      hourly: HOURLY_VARS,
      models: 'gfs_seamless,ecmwf_ifs025,ecmwf_aifs025_single',
      forecast_days: state.days,
      timezone: 'Asia/Shanghai',
    });
    try {
      const res = await fetch(PROXY + encodeURIComponent(
        'https://api.open-meteo.com/v1/forecast?' + params.toString()));
      const json = await res.json();
      if (json.error) throw new Error(json.reason || 'API 返回错误');
      state.data = json;
      state.timeAxis = json.hourly?.time || [];
      state.fetchedAt = Date.now();
      setStatus('');
    } catch (e) {
      setStatus('❌ 数据获取失败：' + e.message, true);
    }
    updateInitTable();
    renderAll();
  }

  // ---------- 序列提取 ----------
  function getSeries(modelKey, varName) {
    const def = UNIFIED_DEFS[varName];
    if (def.computed) {
      const T  = field(modelKey, 'temperature_2m');
      const RH = field(modelKey, 'relative_humidity_2m');
      const W  = field(modelKey, 'wind_speed_10m');
      if (!T || !RH) return null;
      return T.map((t, i) =>
        apparentTemperature(t, RH[i] ?? 50, (W?.[i] ?? 0) / 3.6));
    }
    if (varName === 'precipitation') {
      const rain = field(modelKey, 'rain');
      const snow = field(modelKey, 'snowfall');
      if (rain == null && snow == null) return null;
      const n = state.timeAxis.length;
      const zero = a => a || new Array(n).fill(0);
      return { rain: zero(rain), snow: zero(snow) };
    }
    const base = {
      temperature: 'temperature_2m', dew_point: 'dew_point_2m',
      humidity: 'relative_humidity_2m', wind_speed: 'wind_speed_10m',
      pressure: 'pressure_msl',
    }[varName];
    return field(modelKey, base);
  }

  // ---------- 统合图表渲染 ----------
  function renderAll() {
    // 控件联动可见性
    const hasWind = state.activeVars.has('wind_speed');
    $('#beaufortGroup').toggle(hasWind);
    $('#unitGroup').toggle(hasWind);
    $('#beaufortRef').toggle(hasWind);
    $('#stripCloud').toggle(state.activeStrips.has('cloud'));
    $('#stripWeather').toggle(state.activeStrips.has('weather'));
    $('#stripSunshine').toggle(state.activeStrips.has('sunshine'));

    renderUnifiedChart();
    renderSubStrips();
  }

  function renderUnifiedChart() {
    if (!state.data) return;

    // 1. 动态生成 Y 轴（按固定顺序，位置稳定）
    const axesNeeded = [];
    for (const v of state.activeVars) {
      const k = UNIFIED_DEFS[v].axisKey;
      if (!axesNeeded.includes(k)) axesNeeded.push(k);
    }
    const axisIndex = {};
    const yAxis = axesNeeded.map((key, i) => {
      axisIndex[key] = i;
      const m = AXIS_META[key];
      return {
        type: 'value', name: m.name, position: m.side,
        offset: m.offset || 0, min: m.min, max: m.max, scale: m.scale,
        axisLine: { show: true },
        splitLine: { show: i === 0 },
        nameTextStyle: { align: m.side === 'left' ? 'right' : 'left' },
      };
    });
    const gridRight = 20 + axesNeeded.filter(k => AXIS_META[k].side === 'right').length * 44;
    const gridLeft  = 56 + Math.max(0, axesNeeded.filter(k => AXIS_META[k].side === 'left').length - 1) * 44;

    // 2. 生成 series
    const series = [];
    const seriesAxis = {};   // seriesName → axisKey（tooltip 用）
    const labelFmt = axisKey => ({
      show: true,
      formatter: p => p.dataIndex % 3 === 0 ? defFormat(p.value, axisKey) : '',
      fontSize: 10, position: 'top',
    });

    for (const v of state.activeVars) {
      const def = UNIFIED_DEFS[v];
      for (const key of MODEL_KEYS) {
        if (!hasModel(key)) continue;
        const vals = getSeries(key, v);
        if (!vals) continue;
        const name = `${def.label}·${MODELS[key].label}`;
        seriesAxis[name] = def.axisKey;

        if (def.axisKey === 'rain') {
          // 降水：雨/雪按模式分别堆叠
          series.push({
            name, type: 'bar', stack: 'rain_' + key,
            yAxisIndex: axisIndex.rain, barGap: '20%',
            data: vals.rain, itemStyle: { color: def.color[key] },
            label: {
              show: true, fontSize: 10, position: 'top',
              formatter: p => p.dataIndex % 3 === 0 && p.value > 0
                ? (vals.snow[p.dataIndex] > 0
                    ? (p.value + vals.snow[p.dataIndex]).toFixed(1) : p.value)
                : '',
            },
          });
          series.push({
            name: `雪·${MODELS[key].label}`, type: 'bar', stack: 'rain_' + key,
            yAxisIndex: axisIndex.rain, barGap: '20%',
            data: vals.snow, itemStyle: { color: '#aed6f1' },
          });
        } else {
          series.push({
            name, type: def.type, yAxisIndex: axisIndex[def.axisKey],
            smooth: true, symbol: 'none',
            data: vals, itemStyle: { color: def.color[key] },
            label: labelFmt(def.axisKey),
          });
        }
      }
    }

    if (!series.length) { chart.clear(); return; }

    // 3. 风速 + 色带：markArea + y 轴吸附到风级边界
    if (state.activeVars.has('wind_speed') && state.showBands) {
      const windSeries = series.filter(s => seriesAxis[s.name] === 'wind');
      const maxKmh = Math.max(...windSeries.flatMap(s => s.data.filter(Number.isFinite)));
      if (Number.isFinite(maxKmh)) {
        windSeries[0].markArea = { silent: true, data: beaufortBandsUpTo(maxKmh) };
        const b = beaufortFromKmh(maxKmh);
        const windAxis = yAxis[axisIndex.wind];
        windAxis.max = b.max === Infinity ? maxKmh * 1.05 : b.max;
      }
    }

    chart.setOption({
      animation: false,
      tooltip: {
        trigger: 'axis',
        formatter: p => multiTooltip(p, seriesAxis),
        axisPointer: { type: 'cross' },
      },
      legend: { type: 'scroll', top: 0 },
      grid: { left: gridLeft, right: gridRight, top: 36, bottom: 60 },
      xAxis: {
        type: 'category', data: state.timeAxis,
        axisLabel: { formatter: v => v.slice(5, 16) },
      },
      yAxis,
      dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 8 }],
      series,
    }, { notMerge: true });
  }

  // 数值格式化
  function defFormat(v, axisKey) {
    if (v == null || isNaN(v)) return '';
    if (axisKey === 'temp') return (+v).toFixed(1);
    if (axisKey === 'wind') return (+v).toFixed(1);
    return Math.round(v);
  }
  // 风速单位换算显示
  function windDisplay(kmh) {
    if (state.windUnit === 'ms') return (kmh / 3.6).toFixed(1) + ' m/s';
    if (state.windUnit === 'kn') return (kmh / 1.852).toFixed(1) + ' kn';
    return kmh.toFixed(1) + ' km/h';
  }

  // 多要素 tooltip
  function multiTooltip(params, seriesAxis) {
    let html = params[0].axisValueLabel + '<br/>';
    params.forEach(p => {
      if (p.value == null) return;
      const axis = seriesAxis[p.seriesName];
      let extra = '';
      if (axis === 'wind') {
        const b = beaufortFromKmh(p.value);
        extra = `<b style="color:${b.color}">（${b.level}级 ${b.name}）</b>`;
      }
      const shown = axis === 'wind' ? windDisplay(p.value)
                  : defFormat(p.value, axis) + (AXIS_META[axis].name.match(/\((.+)\)/)?.[1] || '');
      html += `${p.marker}${p.seriesName}：${shown} ${extra}<br/>`;
    });
    return html;
  }

  // ---------- 附属条（每 3 小时一格） ----------
  const STRIP_STEP = 3;
  function stripIndices() {
    return state.timeAxis.map((_, i) => i).filter(i => i % STRIP_STEP === 0);
  }

  function renderSubStrips() {
    const idx = stripIndices();

    // 云量行（取 IFS 为参考，无则取第一个可用模式）
    const $cloud = $('#stripCloud .strip-cells').empty();
    if (state.activeStrips.has('cloud')) {
      const ccModel = ['ifs', 'gfs', 'aifs'].find(hasModel);
      const cc = ccModel ? field(ccModel, 'cloud_cover') : null;
      idx.forEach(i => {
        const pct = cc?.[i] ?? 0;
        $cloud.append(`<div class="cloud-cell" title="${state.timeAxis[i]} 云量 ${Math.round(pct)}%"
          style="background:linear-gradient(180deg,#666 ${100 - pct}%,transparent ${100 - pct}%)"></div>`);
      });
    }

    // 天气行（IFS 为参考模式）
    const $wx = $('#stripWeather .strip-cells').empty();
    if (state.activeStrips.has('weather')) {
      const wxModel = ['ifs', 'gfs', 'aifs'].find(hasModel);
      const codes = wxModel ? field(wxModel, 'weather_code') : null;
      idx.forEach(i => {
        const c = codes?.[i];
        const w = (c != null && WMO[c]) ? WMO[c] : ['无数据', '·'];
        $wx.append(`<div class="weather-cell" title="${state.timeAxis[i]}（${MODELS[wxModel]?.label || '—'}）${w[0]}">${w[1]}</div>`);
      });
    }

    // 日照行（秒 → 分钟迷你柱，高度按 60 分钟满格）
    const $sun = $('#stripSunshine .strip-cells').empty();
    if (state.activeStrips.has('sunshine')) {
      const sunModel = ['ifs', 'gfs', 'aifs'].find(hasModel);
      const sec = sunModel ? field(sunModel, 'sunshine_duration') : null;
      idx.forEach(i => {
        const s = sec?.[i] ?? 0;
        const pct = Math.min(100, (s / 3600) * 100);
        $sun.append(`<div class="sun-cell"><div style="height:${Math.max(2, pct * 0.22)}px"
          title="${state.timeAxis[i]} 日照 ${Math.round(s / 60)} 分钟"></div></div>`);
      });
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
    const t = state.fetchedAt ? new Date(state.fetchedAt).toLocaleTimeString('zh-CN') : '—';
    ['initGfs', 'initIfs', 'initAifs'].forEach(id => $('#' + id).text(t));
  }

  // ---------- 缓存倒计时 ----------
  function tickCountdown() {
    if (!state.fetchedAt) return;
    const left = PROXY_TTL_MS - (Date.now() - state.fetchedAt);
    $('#cacheCountdown').text(left <= 0 ? '已可刷新' : Math.ceil(left / 60000) + ' 分钟后');
  }
  setInterval(tickCountdown, 1000);

  // ---------- 事件绑定 ----------
  $('#varToggles input').on('change', function () {
    const v = $(this).data('var');
    $(this).is(':checked') ? state.activeVars.add(v) : state.activeVars.delete(v);
    // 至少保留一个要素
    if (!state.activeVars.size) { $(this).prop('checked', true); state.activeVars.add(v); return; }
    renderAll();     // 纯前端重绘，不触发请求
  });

  $('#stripToggles input').on('change', function () {
    const s = $(this).data('strip');
    $(this).is(':checked') ? state.activeStrips.add(s) : state.activeStrips.delete(s);
    renderAll();
  });

  ['chkGfs', 'chkIfs', 'chkAifs'].forEach(id => {
    $('#' + id).on('change', function () {
      const key = id.replace('chk', '').toLowerCase();
      state.models[key] = $(this).is(':checked');
      if (!MODEL_KEYS.some(k => state.models[k])) {   // 至少保留一个模式
        $(this).prop('checked', true);
        state.models[key] = true;
        return;
      }
      renderAll();   // 数据已全量在本地，切换模式无需重新请求
    });
  });

  $('#daysSel').on('change', function () {
    state.days = +$(this).val();
    fetchData();     // 时效变化需重新请求
  });

  $('#unitSel').on('change', function () {
    state.windUnit = $(this).val();
    renderAll();     // 单位纯前端换算
  });

  $('#chkBands').on('change', function () {
    state.showBands = $(this).is(':checked');
    renderAll();
  });

  $('#refreshBtn').on('click', () => fetchData());

  // ---------- 首次加载 ----------
  fetchData();
});
