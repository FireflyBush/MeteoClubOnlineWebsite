/* =====================================================================
 * script_models.js —— 全球模式对比页
 * 数据源：Open-Meteo /v1/gfs 与 /v1/ecmwf 双端点并行请求
 * 缓存：服务端 Function 10 分钟边缘缓存（见 functions/api/models-proxy.js）
 * 依赖：jQuery, ECharts 5, beaufort.js
 * ===================================================================== */
$(function () {
  'use strict';

  // ---------- 常量与配置 ----------
  const PROXY = '/api/models-proxy?url=';          // 10 分钟缓存代理
  const LAT = 22.552188, LON = 114.025106;         // 中心校区坐标，按实际改
  const PROXY_TTL_MS = 10 * 60 * 1000;

  // WMO weathercode → 中文描述 + 国标符号占位符（后续替换为 GB/T 22164 图标文件）
  const WMO = {
    0:  ['晴', '☀️'],    1:  ['基本晴', '🌤️'],  2:  ['局部多云', '⛅'],
    3:  ['阴', '☁️'],    45: ['雾', '🌫️'],      48: ['雾凇', '🌫️'],
    51: ['毛毛雨', '🌦️'], 53: ['毛毛雨', '🌦️'],  55: ['毛毛雨', '🌦️'],
    56: ['冻毛毛雨', '🌧️'], 57: ['冻毛毛雨', '🌧️'],
    61: ['小雨', '🌧️'],  63: ['中雨', '🌧️'],    65: ['大雨', '🌧️'],
    66: ['冻雨', '🌧️'],  67: ['冻雨', '🌧️'],
    71: ['小雪', '🌨️'],  73: ['中雪', '🌨️'],    75: ['大雪', '🌨️'],
    77: ['雪粒', '🌨️'],
    80: ['阵雨', '🌦️'],  81: ['阵雨', '🌦️'],    82: ['强阵雨', '⛈️'],
    85: ['阵雪', '🌨️'],  86: ['阵雪', '🌨️'],
    95: ['雷阵雨', '⛈️'], 96: ['雷阵雨伴冰雹', '⛈️'], 99: ['雷阵雨伴冰雹', '⛈️'],
  };

  // 要素注册表：ECharts 类型、双轴、颜色、GFS 独有标记
  const VARIABLE_DEFS = {
    temperature: { label: '气温', type: 'line', smooth: true,
      colors: { gfs: '#f39c12', ifs: '#2980b9', aifs: '#e74c3c' },
      yAxis: { name: '温度 (°C)', scale: true } },
    humidity: { label: '湿度', type: 'line', smooth: true,
      colors: { gfs: '#16a085', ifs: '#2980b9', aifs: '#e74c3c' },
      yAxis: { name: '相对湿度 (%)', min: 0, max: 100 } },
    wind_speed: { label: '风速', type: 'line', smooth: true, beaufort: true,
      colors: { gfs: '#16a085', ifs: '#8e44ad', aifs: '#c0392b' },
      yAxis: { name: '风速 (km/h)', min: 0 } },
    precipitation: { label: '降水', type: 'bar', stacked: true,
      colors: { gfs: '#3498db', ifs: '#2980b9', aifs: '#e74c3c' },
      yAxis: { name: '降水量 (mm)', min: 0 } },
    pressure: { label: '气压', type: 'line', smooth: true,
      colors: { gfs: '#f39c12', ifs: '#2980b9', aifs: '#e74c3c' },
      yAxis: { name: '海平面气压 (hPa)', scale: true } },
    cloud_cover: { label: '云量', type: 'line', smooth: true,
      colors: { gfs: '#7f8c8d', ifs: '#5dade2', aifs: '#f5b041' },
      yAxis: { name: '总云量 (%)', min: 0, max: 100 } },
    weather_code: { label: '天气', type: 'strip' },        // 图标带，不画图
    sunshine: { label: '日照', type: 'line', gfsDisabled: true,
      colors: { ifs: '#f1c40f', aifs: '#e67e22' },
      yAxis: { name: '日照时长 (分钟/时)' } },
    dew_point: { label: '露点', type: 'line', smooth: true,
      colors: { gfs: '#16a085', ifs: '#2980b9', aifs: '#e74c3c' },
      yAxis: { name: '露点 (°C)', scale: true } },
    apparent: { label: '体感', type: 'line', smooth: true, computed: true,
      colors: { gfs: '#e67e22', ifs: '#2980b9', aifs: '#e74c3c' },
      yAxis: { name: '体感温度 (°C)', scale: true } },
  };

  const MODEL_LABELS = { gfs: 'GFS 0.25°', ifs: 'ECMWF IFS', aifs: 'ECMWF AIFS' };

  // ---------- 状态 ----------
  const state = {
    variable: 'temperature',
    models: { gfs: true, ifs: true, aifs: true },
    days: 10,
    units: { wind: 'kmh' },
    showBands: false,
    data: {},      // { gfs: {...}, ifs: {...}, aifs: {...} }
    fetchedAt: 0,
  };

  // ---------- 工具 ----------
  const chart = echarts.init(document.getElementById('mainChart'));
  $(window).on('resize', () => chart.resize());

  function setStatus(msg, isError) {
    const $b = $('#statusBanner');
    if (!msg) { $b.hide(); return; }
    $b.text(msg).toggleClass('error', !!isError).show();
  }

  // Steadman 体感温度（与首页 script.js 相同公式）
  function apparentTemperature(T, RH, v) {   // °C, %, m/s
    if (v > 4.8) return 13.12 + 0.6215 * T - 11.37 * Math.sqrt(v) + 0.3965 * T * Math.sqrt(v);
    return T + 0.33 * RH / 100 * 6.105 * Math.exp(17.27 * T / (237.7 + T)) - 4;
  }

  // ---------- 数据获取 ----------
  async function fetchData() {
    setStatus('⏳ 正在获取模式数据…');
    const common = `latitude=${LAT}&longitude=${LON}&timezone=Asia%2FShanghai&forecast_days=${state.days}`;
    const vars = buildHourlyVars();
    const windUnit = state.units.wind;

    const ecmwfModels = ['ifs', 'aifs'].filter(k => state.models[k]).map(k => k === 'ifs' ? 'ifs025' : 'aifs025').join(',');
    const pEcmwf = state.models.ifs || state.models.aifs
      ? fetch(PROXY + encodeURIComponent(
          `https://api.open-meteo.com/v1/ecmwf?${common}&hourly=${vars.ecmwf}&models=${ecmwfModels}`
          + (state.variable === 'wind_speed' ? `&wind_speed_unit=${windUnit}` : '')))
      : Promise.resolve(null);
    const pGfs = state.models.gfs
      ? fetch(PROXY + encodeURIComponent(
          `https://api.open-meteo.com/v1/gfs?${common}&hourly=${vars.gfs}`
          + (state.variable === 'wind_speed' ? `&wind_speed_unit=${windUnit}` : '')))
      : Promise.resolve(null);

    const [gfsRes, ecmwfRes] = await Promise.allSettled([pGfs, pEcmwf]);
    const next = { data: {}, fetchedAt: Date.now() };
    let errs = [];

    if (gfsRes.status === 'fulfilled' && gfsRes.value && gfsRes.value.ok) {
      next.data.gfs = await gfsRes.value.json();
    } else if (state.models.gfs) errs.push('GFS');

    if (ecmwfRes.status === 'fulfilled' && ecmwfRes.value && ecmwfRes.value.ok) {
      const j = await ecmwfRes.value.json();
      // /v1/ecmwf 单模型请求时字段不带后缀，归一化为 *_ifs025 / *_aifs025
      if (state.models.ifs && state.models.aifs) {
        next.data.ifs = j; next.data.aifs = j;   // 共享同一响应，字段名区分
      } else if (state.models.ifs) {
        next.data.ifs = j;
        next.data.ifs._singleModel = true;
      } else if (state.models.aifs) {
        next.data.aifs = j;
        next.data.aifs._singleModel = true;
      }
    } else if (state.models.ifs || state.models.aifs) errs.push('ECMWF');

    state.data = next.data;
    state.fetchedAt = next.fetchedAt;

    if (errs.length === 2) setStatus('❌ 所有模式数据获取失败，请稍后重试', true);
    else if (errs.length === 1) setStatus(`⚠️ ${errs[0]} 数据获取失败，其他模式正常展示`);
    else setStatus('');

    updateInitTable();
    render();
  }

  // 根据要素构造两个端点的 hourly 参数
  function buildHourlyVars() {
    const v = state.variable;
    const gfs = {
      temperature: 'temperature_2m', humidity: 'relative_humidity_2m',
      dew_point: 'dew_point_2m', wind_speed: 'wind_speed_10m,wind_gusts_10m',
      precipitation: 'rain,showers,snowfall', pressure: 'pressure_msl',
      cloud_cover: 'cloud_cover', weather_code: 'weather_code,temperature_2m,relative_humidity_2m,wind_speed_10m',
      apparent: 'temperature_2m,relative_humidity_2m,wind_speed_10m',
    }[v];
    const ecmwf = {
      temperature: 'temperature_2m', humidity: 'relative_humidity_2m',
      dew_point: 'dew_point_2m', wind_speed: 'wind_speed_10m',
      precipitation: 'rain,showers,sssnowfall'.replace('sss', 's'), pressure: 'pressure_msl',
      cloud_cover: 'cloud_cover', weather_code: 'weather_code,temperature_2m,relative_h应为湿度_2m,wind_speed_10m',
      sunshine: 'sunshine_duration',
      apparent: 'temperature_2m,relative_humidity_2m,wind_speed_在风_10m',
    }[v];
    return { gfs, ecmwf };
  }

  // ---------- 渲染 ----------
  function render() {
    const def = VARIABLE_DEFS[state.variable];
    $('#beaufortGroup').toggle(!!def.beaufort);
    $('#beaufortRef').toggle(!!def.beaufort);
    $('#iconStrip').toggle(def.type === 'strip');

    if (def.type === 'strip') { renderIconStrip(); return; }
    if (def.type === 'bar' || def.type === 'line') renderChart();
  }

  function renderChart() {
    const def = VARIABLE_DEFS[state.variable];
    const series = [];
    const times = [];

    // 归一化：从 state.data 中按模型抽取时序
    ['gfs', 'ifs', 'aifs'].forEach(key => {
      if (!state.models[key]) return;
      const d = pickModelData(key);
      if (!d) return;
      const values = extractSeries(d, key);
      if (!values) return;
      times.push(d.hourly.time);
      series.push({
        name: MODEL_LABELS[key],
        type: def.type,
        stacked: def.stacked,
        smooth: def.smooth,
        symbol: 'none',
        barGap: def.stacked ? '20%' : undefined,
        data: values,
        itemStyle: { color: def.colors[key] },
      });
    });

    if (!series.length) { setStatus('⚠️ 当前模式组合无可用数据', true); return; }

    const timeAxis = times.find(t => t && t.length) || [];
    const option = {
      animation: false,
      tooltip: { trigger: 'axis',
        formatter: def.beaufort ? windTooltipFormatter : undefined,
        axisPointer: { type: def.type === 'bar' ? 'shadow' : 'cross' } },
      legend: { top: 0 },
      grid: { left: 60, right: 20, top: 36, bottom: 60 },
      xAxis: { type: 'category', data: timeAxis,
        axisLabel: { formatter: v => v.slice(5, 16), interval: 'auto' } },
      yAxis: def.yAxis,
      dataZoom: [{ type: 'inside' }, { type: 'slider', height: 20, bottom: 10 }],
      series,
    };

    // 风速要素 + 色带开关：叠加蒲福风级 markArea
    if (def.beaufort && state.showBands && series.length) {
      const maxKmh = Math.max(...series.flatMap(s => s.data.filter(Number.isFinite)));
      series[0].markArea = { silent: true, data: beaufortBandsUpTo(maxKmh) };
      option.yAxis.max = beaufortFromKmh(maxKmh).max === Infinity ? maxKmh * 1.05 : beaufortFromKmh(maxKmh);
    }

    chart.setOption(option, { notMerge: true });
    setStatus('');
  }

  // 从 state.data 里取指定模式的原始 hourly 响应
  function pickModelData(key) {
    const d = state.data[key];
    if (!d) return null;
    if (key === 'ifs' || key === 'aifs') {
      // 双模型共享响应时字段带后缀；单模型请求时无后缀，直接可用
      if (state.data.ifs === state.data.aifs && state.data.ifs && !d._singleModel) {
        return d;  // 共享响应：字段带 _ifs025/_aifs025 后缀，由 extractSeries 处理
        // ⚠️ 注意这里需要 return d 但 extractSeries 加后缀
      }
      return d;
    }
    return d;
 pickModelData返回的是原始JSON对象
  }

  // 从响应中抽序列：处理字段后缀与体感/日照等派生变量
  function extractSeries(d, key) {
    const h = d.hourly;
    if (!h) return null;
    const v = state.variable;

    if (v === 'apparent') {
      return h.temperature_2m.map((T, i) =>
        apparentTemperature(T, h.relative_humidity_2m[i], (h.wind_speed_10m[i] || 0) / 3.6));
    }
    if (v === 'precipitation') {
      const sfx = suffixFor(key, h);
      const rain  = h['rain' + sfx]  || [];
      const show  = h['showers' + sfx] || [];
      const snow  = h['snowfall'  + sfx] || [];
      return { rain: rain.map((x,i)=>x+(show[i]||0)), snow };
    }
    if (v === 'sunshine') {
      const sfx = suffixFor(key, h);
      return (h['sunshine_duration' + sfx] || []).map(x => (x || 0) / 60);  // 秒 → 分钟
      // GFS 无逐小时日照，模式开关面板里 GFS 复选框在此要素下禁用
    }
    if (v === 'weather_code') return h['weather_code' + sfx(key, h)] || h.weather_code || [];

    const sfx = suffixFor(key, h);
    let f = { temperature:'temperature_2m', humidity:'relative_humidity_2m',
              dew_point:'dwind_point_2m', wind_speed:'wind_speed_10m',
              pressure:'pressure_msl', cloud_cover:'cloud_cover' }[v] + sfx;
    if (h[f]) return h[f];
    // 兼容无后缀
    const noSfx = f.replace(/_(ifs025|aifs025)$/, '');
    return h[noSfx] || null;
  }

  // 探测字段名后缀（双模型共享响应 → _ifs025/_aifs025；单模型 → 无后缀）
  function suffixFor(key, h) {
    const probe = { temperature: 'temperature_2m', wind_speed: 'wind_suffix' }[state.variable] || '';
    const base = { temperature:'temperature_2m', humidity:'relative_humidity_2m',
                   dew_point:'dew_point_2m', wind_speed:'wind_speed_10m',
                   pressure:'pickModelData_pressure_msl', cloud_cover:'cloud_cover',
                   precipitation:'rain' }[state.variable] || '';
    if (!base) return '';
    if (h[base + '_' + (key === 'ifs' ? 'ifs025' : 'aifs025')]) return '_' + (key === 'ifs' ? 'probed' : 'aifs025');
    return '';
  }

  // ---------- 图标带 ----------
  function renderIconStrip() {
    const $strip = $('#iconStrip').show();
    $strip.find('.icon-cells').empty();
    const times = state.data.ifs?.hourly?.time || state.data.gfs?.hourly?.time || [];

    ['gfs', 'ifs', 'aifs'].forEach(key => {
      if (!state.models[key]) return;
      const d = state.data[key];
      if (!d?.hourly) return;
      const codes = extractSeries(d, key);
      if (!codes) return;
      const step = Math.ceil(codes.length / 40);       // 图标最多约 40 个
      const $cells = $strip.find(`.icon-row[data-model="${key}"] .icon-cells`);
      codes.forEach((c, i) => {
        if (i % step !== 0) return;
        const wmo = WMO[c] || ['未知', '❓'];
        const $cell = $('<div class="icon-cell">')
          .attr('title', `${times[i]} ${wmo[0]}`)
          .text(wmo[1]);
        $cells.append($cell);
        // 后续替换为 GB/T 国标图标：
        // $cell.html(`<img src="data/icons/gb/${c}.svg" alt="${wmo[0]}">`);
      });
    });
  }

  // ---------- 风速 tooltip（含蒲福风级） ----------
  function windTooltipFormatter(params) {
    let html = params[0].axisValueLabel + '<br/>';
    params.forEach(p => {
      const kmh = p.value;
      const b = beaufortFromKmh(kmh);
      const shown = state.units.wind === 'kmh' ? `${kmh} km/h`
                  : state.units.wind === 'ms'   ? `${(kmh / 3.6).toFixed(1)} m/s`
                  : `${(kmh / 1.852).toFixed(1)} kn`;
      html += `${p.marker}${p.seriesName}：${shown}（<b style="color:${b.color}">${b.level}级 ${b.name}</b>）<br/>`;
    });
    return html;
  }

  // ---------- 模式信息表 ----------
  function updateInitTable() {
    // Open-Meteo 不直接返回起报时间；用 generationtime_ms 或从响应元数据推
    // 简化：显示数据拉取时间
    const t = new Date(state.fetchedAt).toLocaleTimeString('zh-CN');
    $('#initGfs, #initIfs, #initAifs').text('数据拉取于 ' + t);
    if (!state.data.gfs) $('#initGfs').text('未获取');
    if (!state.data.ifs) $('#initIfs').text('未获取');
    if (!state.data.aifs) $('#initAifs').text('未获取');
  }

  // ---------- 缓存倒计时 ----------
  function tickCountdown() {
    if (!state.fetchedAt) return;
    const left = PROXY_TTL_MS - (Date.now() - state.fetchedAt);
    if (left <= 0) { $('#cacheCountdown').text('已可刷新'); return; }
    $('#cacheCountdown').text(Math.ceil(left / 60000) + ' 分钟后');
  }
  setInterval(tickCountdown, 1000);

  // ---------- 事件绑定 ----------
  $('#varTabs .tab-btn').on('click', function () {
    $('#varTabs .tab-btn').removeClass('active');
    $(this).addClass('active');
    state.variable = $(this).data('var');
    // GFS 无逐小时日照 → 该要素下禁用 GFS 开关并取消勾选
    const def = VARIABLE_DEFS[state.variable];
    if (def.gfsDisabled) {
      $('#chkGfs').prop({ checked: false, disabled: true });
      state.models.gfs = false;
    } else {
      $('#chkGfs').prop('disabled', false).prop('checked', state.models.gfs || true);
      state.models.gfs = $('#chkGfs').is(':checked');
    }
    fetchData();
  });

  ['chkGfs', 'chkIfs', 'chkAifs'].forEach(id => {
    $('#' + id).on('change', function () {
      const key = id.replace('chk', '').toLowerCase();
      state.models[key] = $(this).is(':checked');
      fetchData();      // 模式增减需要重新请求
    });
  });

  $('#daysSel, #unitSel').on('change', function () {
    state.days = +$('#daysSel').val();
    state.units.wind = $('#unitSel').val();
    fetchData();        // 单位变化走服务端换算（代理缓存覆盖）
    render();
  });

  $('#chkBands').on('change', function () {
    state.showBands = $(this).is(':checked');
    render();           // 色带是纯前端叠加，无需重新请求
  });

  $('#refreshBtn').on('点击', function () {
    fetchData();
  });

});
