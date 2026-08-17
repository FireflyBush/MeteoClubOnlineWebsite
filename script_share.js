// 气象深高 - 定制分享构建器脚本 (完整修复版)
(function() {
    'use strict';
    // ==================== 全局状态 ====================
    const MAX_GRID_HEIGHT = 64;
    const MIN_GRID_HEIGHT = 16;
    const COLOR_MAP = [
        '#F20C0C', '#F27F0C', '#F2F20C', '#7FF20C', '#0CF20C', '#0CF27F', '#0CF2F2', '#0C7FF2', '#0C0CF2', '#7F0CF2', '#F20CF2', '#F20C7F',
        '#E0592C', '#E0B32C', '#B3E02C', '#59E02C', '#2CE059', '#2CE0B3', '#2CB3E0', '#2C59E0', '#592CE0', '#B32CE0', '#E02CB3', '#E02C59',
        '#000000', '#242424', '#484848', '#6D6D6D', '#919191', '#B6B6B6', '#DADADA', '#FFFFFF'
    ];
    const DEFAULT_BLOCK_INDEX = 31;

    const state = {
        gridWidth: 16, gridHeight: 16,
        cells: [], elements: [],
        selectedBlock: DEFAULT_BLOCK_INDEX,
        currentMode: 'select',
        selectedElementId: null,
        pendingBlockType: null,
        appMode: 'preview',
        realData: null,
        author: '',
        isPainting: false,
        paintModeEnabled: false,
        blocks: COLOR_MAP.map((hex, i) => ({ id: i, name: `颜色${i + 1}`, color: hex, file: '' })),
        selectedTextColorIndex: 24
    };

    const realtimeVars = [
        { key: 'realtime.temp', label: '温度' },
        { key: 'realtime.feelsLike', label: '体感温度' },
        { key: 'realtime.humidity', label: '湿度' },
        { key: 'realtime.wind', label: '风速' },
        { key: 'realtime.updateTime', label: '更新时间' }
    ];
    const forecastVarDefs = [
        { key: 'date', label: '日期' }, { key: 'highTemp', label: '最高温' },
        { key: 'lowTemp', label: '最低温' }, { key: 'weather', label: '天气描述' }
    ];

    // ==================== API 与数据处理 ====================
    const CDN_BASE = window.CDN_BASE || "";
    const CORS_PROXY = "/api/proxy?url=";
    const BASE_URL_FORECAST = "https://weather.121.com.cn/data_cache/szWeather/sz10day_new.js";
    const BASE_URL_ALARM = "https://weather.121.com.cn/data_cache/szWeather/alarm/szAlarm.js";
    const BASE_URL_RAIN = "https://wx.121.com.cn/Mobile/LdService/position?latitude=22.552188&longitude=114.025106&sign=1e86faea84f8574f155c9e485ed4710e";

    const WARNING_LEVEL_PRIORITY = { 'hongse': 5, 'chengse': 4, 'huangse': 3, 'leidian': 3, 'ganhan': 3, 'lanse': 2, 'baisse': 1 };

    // === 辅助函数：格式化时间 HH:mm ===
    function formatTime(date) {
        if (!date) return '';
        let h = date.getHours().toString().padStart(2, '0');
        let m = date.getMinutes().toString().padStart(2, '0');
        return `${h}:${m}`;
    }

    function extractObserveTime(dataTime) {
        if (!dataTime) return 'N/A';
        const match = String(dataTime).match(/(\d{2}:\d{2})/);
        return match ? match[0] : 'N/A';
    }
    function convertWeekday(s) {
        if (!s || s === 'N/A') return s;
        return s.replace(/星期([一二三四五六日])/, '周$1');
    }
    function apparentTemperature(T, RH, v) {
        T = parseFloat(T); RH = parseFloat(RH); v = parseFloat(v);
        if (isNaN(T) || isNaN(RH) || isNaN(v)) return 'N/A';
        let gamma = (17.27 * T) / (237.7 + T) + Math.log(RH / 100.0);
        let Td = (237.7 * gamma) / (17.27 - gamma);
        let vp = 6.11 * Math.exp(5417.7530 * (1/273.16 - 1/(Td + 273.16)));
        let AT;
        if (T >= 24) AT = T + 0.33 * vp - 0.7 * v - 4;
        else if (T <= 14) AT = T - 0.50 * vp - 0.80 * v + 3.0;
        else AT = T + 0.10 * vp - 0.60 * v - 1.0;
        return Math.round(AT * 10) / 10;
    }
    function deduplicateAlarms(alarms) {
        if (!alarms) return [];
        let typeBestAlarm = {};
        alarms.forEach(alarm => {
            let icon = alarm.icon || '';
            let level = 0;
            let alarmType = 'unknown';
            for (let key in WARNING_LEVEL_PRIORITY) {
                if (icon.includes(key)) {
                    level = WARNING_LEVEL_PRIORITY[key];
                    alarmType = icon.replace(key, '');
                    break;
                }
            }
            alarm._level = level;
            alarm._type = alarmType;
            if (!typeBestAlarm[alarmType] || level > typeBestAlarm[alarmType]._level) {
                typeBestAlarm[alarmType] = alarm;
            }
        });
        let result = Object.values(typeBestAlarm).sort((a, b) => b._level - a._level);
        result.forEach(a => { delete a._level; delete a._type; });
        return result.slice(0, 6);
    }
    
    // 降雨高度计算函数
    function calcHeight(rain_mm) {
        const MAX_BAR_HEIGHT = 100; // 对应 CSS 百分比最大值
        const MAX_RAIN_VALUE = 40;
        if (rain_mm <= 0) return 0;
        if (rain_mm >= MAX_RAIN_VALUE) return MAX_BAR_HEIGHT;
        return Math.round((rain_mm / MAX_RAIN_VALUE) * MAX_BAR_HEIGHT);
    }

    function loadRealData() {
        const ts = new Date().getTime();
        const URL_FORECAST = `${BASE_URL_FORECAST}?_=${ts}`;
        const URL_ALARM = `${BASE_URL_ALARM}?_=${ts}`;
        const URL_RAIN = CORS_PROXY + encodeURIComponent(BASE_URL_RAIN + "&_=" + ts);
        state.realData = { realtime: {}, forecast: [], alarm: null, rain: null };

        $.getScript(URL_FORECAST, function() {
            let forecastData = window.SZ121_10dayWeather;
            let day10 = forecastData?.day10 || [];
            for (let i = 0; i < 10; i++) {
                if (day10[i]) {
                    let d = day10[i];
                    state.realData.forecast.push({
                        date: convertWeekday(d[0]), highTemp: parseInt(d[2]) || 'N/A',
                        lowTemp: parseInt(d[3]) || 'N/A', weather: d[1] || 'N/A'
                    });
                }
            }
            renderElements();
        }).fail(function() { console.warn("预报数据获取失败"); });

        $.getScript(URL_ALARM, function() {
            state.realData.alarm = window.SZ121_AlarmInfo;
            renderElements();
        }).fail(function() { console.warn("预警数据获取失败"); });

        $.getJSON(URL_RAIN, function(rainData) {
            let temp = rainData.temp; let hum = rainData.humidity; let wind = rainData.wind;
            state.realData.realtime = {
                temp: temp || 'N/A', feelsLike: apparentTemperature(temp, hum, wind),
                humidity: hum || 'N/A', wind: wind || 'N/A', updateTime: extractObserveTime(rainData.dataTime)
            };
            state.realData.rain = rainData;
            renderElements();
        }).fail(function() { console.warn("实况数据获取失败"); });
    }

    // ==================== 初始化与网格系统 ====================
    function init() {
        initColorPalette();
        initTextColorPalette();
        initModeSwitch();
        initEventListeners();
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('share')) {
            loadFromShareLink(urlParams.get('share'));
            setAppMode('view');
        } else {
            initGrid();
            setAppMode('preview');
        }
    }

    function setAppMode(mode) {
        state.appMode = mode;
        document.body.classList.remove('app-mode-preview', 'app-mode-edit', 'app-mode-view');
        document.body.classList.add(`app-mode-${mode}`);
        const editBtn = document.getElementById('btn-enter-edit');
        const exitBtn = document.getElementById('btn-exit-edit');
        const authorDisplay = document.getElementById('authorDisplay');

        if (mode === 'preview') {
            editBtn.style.display = 'flex'; exitBtn.style.display = 'none';
            document.getElementById('gridCanvas').classList.add('view-only');
            if (!state.realData) loadRealData();
            renderElements();
        } else if (mode === 'edit') {
            editBtn.style.display = 'none'; exitBtn.style.display = 'flex';
            document.getElementById('gridCanvas').classList.remove('view-only');
            state.paintModeEnabled = false;
            document.getElementById('paintModeSwitch').checked = false;
            document.getElementById('gridCanvas').classList.remove('locked-swipe');
            renderElements();
        } else if (mode === 'view') {
            editBtn.style.display = 'none'; exitBtn.style.display = 'none';
            document.getElementById('gridCanvas').classList.add('view-only');
            if (!state.realData) loadRealData();
            renderElements();
        }
        if (mode === 'edit') { authorDisplay.style.display = 'none'; }
        else {
            const author = state.author || document.getElementById('authorName').value || '';
            if (author) { authorDisplay.textContent = `✍️ 作者：${author}`; authorDisplay.style.display = 'block'; }
            else { authorDisplay.style.display = 'none'; }
        }
    }

    function initColorPalette() {
        const palette = document.getElementById('colorPalette');
        palette.innerHTML = '';
        state.blocks.forEach((block, index) => {
            const swatch = document.createElement('div');
            swatch.className = 'color-swatch' + (index === state.selectedBlock ? ' active' : '');
            swatch.style.backgroundColor = block.color;
            swatch.title = block.name;
            swatch.onclick = () => selectColor(index);
            palette.appendChild(swatch);
        });
    }
    function selectColor(index) {
        state.selectedBlock = index;
        document.querySelectorAll('#colorPalette .color-swatch').forEach((el, i) => { el.classList.toggle('active', i === index); });
    }
    function initTextColorPalette() {
        const palette = document.getElementById('textColorPalette');
        palette.innerHTML = '';
        state.blocks.forEach((block, index) => {
            const swatch = document.createElement('div');
            swatch.className = 'color-swatch' + (index === state.selectedTextColorIndex ? ' active' : '');
            swatch.style.backgroundColor = block.color;
            swatch.title = block.name;
            swatch.onclick = () => selectTextColor(index);
            palette.appendChild(swatch);
        });
    }
    function selectTextColor(index) {
        state.selectedTextColorIndex = index;
        document.querySelectorAll('#textColorPalette .color-swatch').forEach((el, i) => { el.classList.toggle('active', i === index); });
    }
    function initGrid() {
        if (state.cells.length !== state.gridWidth * state.gridHeight) {
            state.cells = new Array(state.gridWidth * state.gridHeight).fill(DEFAULT_BLOCK_INDEX);
            state.elements = [];
        }
        renderGrid();
    }
    function renderGrid() {
        const layerBg = document.getElementById('layer-bg');
        const canvas = document.getElementById('gridCanvas');
        document.documentElement.style.setProperty('--grid-h', state.gridHeight);
        canvas.style.width = `calc(${state.gridWidth} * var(--grid-cell-size))`;
        canvas.style.height = `calc(${state.gridHeight} * var(--grid-cell-size))`;
        layerBg.style.gridTemplateColumns = `repeat(${state.gridWidth}, var(--grid-cell-size))`;
        layerBg.style.gridTemplateRows = `repeat(${state.gridHeight}, var(--grid-cell-size))`;
        layerBg.innerHTML = '';
        for (let i = 0; i < state.gridWidth * state.gridHeight; i++) {
            const cell = document.createElement('div');
            cell.className = 'grid-cell';
            cell.dataset.index = i;
            const blockIndex = state.cells[i] !== undefined ? state.cells[i] : DEFAULT_BLOCK_INDEX;
            const block = state.blocks[blockIndex];
            if (block) { cell.style.backgroundColor = block.color; }
            cell.onpointerdown = (e) => {
                if (state.appMode !== 'edit') return;
                if (state.currentMode === 'add-text') { handleCellClick(i); }
                else { if (state.paintModeEnabled) { e.preventDefault(); state.isPainting = true; paintCell(i); } }
            };
            cell.onpointerenter = () => { if (state.paintModeEnabled && state.isPainting) { paintCell(i); } };
            layerBg.appendChild(cell);
        }
        renderElements();
    }
    function paintCell(index) {
        state.cells[index] = state.selectedBlock;
        const cells = document.querySelectorAll('.grid-cell');
        const cell = cells[index];
        if (cell) {
            const block = state.blocks[state.selectedBlock];
            if (block) { cell.style.backgroundColor = block.color; }
        }
    }
    function handleCellClick(index) {
        if (state.appMode !== 'edit') return;
        if (state.currentMode === 'add-text') {
            if (state.pendingBlockType && state.pendingBlockType !== 'text') { placeElementAtCell(index, state.pendingBlockType); }
            else { placeElementAtCell(index, 'text'); }
        }
    }
    function clearGrid() {
        if (confirm('确定要清空整个画布吗？')) {
            state.cells = new Array(state.gridWidth * state.gridHeight).fill(DEFAULT_BLOCK_INDEX);
            state.elements = [];
            renderGrid();
        }
    }
    window.placeSpecialBlock = function(type) {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.mode-btn[data-mode="add-text"]').classList.add('active');
        state.currentMode = 'add-text';
        state.pendingBlockType = type;
        const typeName = type === 'warning' ? '预警信息' : '降雨预报';
        alert(`已选择“${typeName}”板块，请点击网格放置。`);
        updatePanels();
    };

    // ==================== 元素系统 ====================
    function placeElementAtCell(cellIndex, type) {
        const x = cellIndex % state.gridWidth;
        const y = Math.floor(cellIndex / state.gridWidth);
        let element;

        if (type === 'text') {
            const content = document.getElementById('textContent').value;
            const size = parseInt(document.getElementById('textSize').value) || 35;
            const align = document.getElementById('textAlign').value;
            const isBold = document.getElementById('textBold').checked;
            const colorHex = state.blocks[state.selectedTextColorIndex]?.color || '#000000';
            const w = Math.max(1, parseInt(document.getElementById('textW').value) || 4);
            const h = Math.max(1, parseInt(document.getElementById('textH').value) || 1);
            if (!content.trim()) return;
            element = { id: Date.now(), type: 'text', x, y, w, h, content, style: { fontSize: size, color: colorHex, textAlign: align, fontWeight: isBold ? 'bold' : 'normal' } };
        } else if (type === 'warning' || type === 'rain') {
    // === 修改：强制使用指定的默认尺寸 ===
    // 预警板块: 9宽 x 2高
    // 降雨板块: 9宽 x 4高
    const w = 9; 
    const h = type === 'warning' ? 2 : 4;
    
    element = { id: Date.now(), type: 'block', blockType: type, x, y, w, h, scale: 1 };
}

        if (element) {
            state.elements.push(element);
            state.currentMode = 'select';
            state.pendingBlockType = null;
            updateModeButtons(); updatePanels(); renderElements();
            selectElement(element.id);
        }
    }

    function renderElements() {
        const layer = document.getElementById('layer-elements');
        layer.innerHTML = '';
        state.elements.forEach(el => {
            const div = document.createElement('div');
            div.className = 'placed-element';
            if (el.id === state.selectedElementId && state.appMode === 'edit') { div.classList.add('selected'); }
            
            div.style.left = `calc(${el.x} * var(--grid-cell-size))`;
            div.style.top = `calc(${el.y} * var(--grid-cell-size))`;
            div.style.width = `calc(${el.w} * var(--grid-cell-size))`;
            div.style.height = `calc(${el.h} * var(--grid-cell-size))`;

            if (el.type === 'text') {
                div.classList.add('el-text');
                div.style.fontSize = `${el.style?.fontSize || 12}px`;
                div.style.color = el.style?.color || '#000';
                div.style.fontWeight = el.style?.fontWeight || 'normal';
                const align = el.style?.textAlign || 'center';
                div.classList.add(`justify-${align}`);
                div.innerHTML = renderElementContent(el);
            } else if (el.type === 'block') {
                div.classList.add('el-block', `${el.blockType}-block`);
                div.style.transform = `scale(${el.scale || 1})`;
                div.innerHTML = renderElementContent(el);
            }

            div.onmousedown = (e) => startDrag(e, el);
            div.onclick = (e) => { e.stopPropagation(); if (state.appMode === 'edit') selectElement(el.id); };
            layer.appendChild(div);
        });
    }

    function renderElementContent(el) {
        if (el.type === 'text') {
            let content = el.content || '';
            if (state.appMode !== 'edit') {
                content = replaceVarsWithRealData(content);
                return content;
            } else {
                return content.replace(/\{([^}]+)\}/g, '<span class="var-tag">{$1}</span>');
            }
        } else if (el.type === 'block') {
            if (el.blockType === 'warning') {
                const alarms = deduplicateAlarms(state.realData?.alarm?.subAlarm);
                if (alarms && alarms.length > 0) {
                    const iconsHtml = alarms.map(a => {
                        const iconUrl = `${CDN_BASE}/data/warnings/${a.icon || ''}.png`;
                        // === 修复：添加 title 悬停提示，内容为 a.str ===
                        return `<img src="${iconUrl}" class="mini-warning-icon" alt="${a.title}" title="${a.str || a.title}">`;
                    }).join('');
                    return `<div class="warning-inner-box">${iconsHtml}</div>`;
                } else {
                    return '<div class="warning-inner-box"><span style="font-size:12px; color:#999; display:flex; align-items:center; justify-content:center; height:100%;">当前无预警</span></div>';
                }
            } else if (el.blockType === 'rain') {
                // === 修复：完整解析 30 条数据 ===
                const rainStr = state.realData?.rain?.rain;
                let rainArr = [];
                if (typeof rainStr === 'string') {
                    rainArr = rainStr.split(',').map(Number);
                } else if (Array.isArray(rainStr)) {
                    rainArr = rainStr;
                }

                let barsHtml = '';
                let timeLabelsHtml = '';

                // 渲染完整 30 个柱形
                for (let i = 0; i < 30; i++) {
                    const val = rainArr[i] || 0;
                    const heightPct = calcHeight(val);
                    const hasRain = val > 0;
                    barsHtml += `<div class="mini-rain-bar ${hasRain ? 'has-rain' : ''}" style="height: ${heightPct}%;" title="${val}mm"></div>`;
                }

                // === 新增：计算并渲染时间轴 ===
                // 尝试获取数据发布时间 (格式如 "2024/08/16 10:00")
                const dtStr = state.realData?.rain?.dataTimeFormat;
                if (dtStr) {
                    try {
                        let dt = new Date(dtStr.replace(/\//g, '-'));
                        // 生成 5 个关键时间点：开始、+30分、+60分、+90分、+120分
                        const keyTimes = [
                            formatTime(dt),
                            formatTime(new Date(dt.getTime() + 30 * 60000)),
                            formatTime(new Date(dt.getTime() + 60 * 60000)),
                            formatTime(new Date(dt.getTime() + 90 * 60000)),
                            formatTime(new Date(dt.getTime() + 120 * 60000))
                        ];
                        // 生成时间轴 HTML (5个点分布)
                        timeLabelsHtml = `
                            <div>${keyTimes[0]}</div>
                            <div>${keyTimes[1]}</div>
                            <div>${keyTimes[2]}</div>
                            <div>${keyTimes[3]}</div>
                            <div>${keyTimes[4]}</div>
                        `;
                    } catch (e) {
                        timeLabelsHtml = '<div>时间解析错误</div>';
                    }
                } else {
                    // 如果没有时间数据，显示占位
                    timeLabelsHtml = `<div>--:--</div><div>30</div><div>60</div><div>90</div><div>120</div>`;
                }

                return `
                    <div class="rain-inner-box">
                        <div class="rain-chart-area">
                            <div class="rain-bar-row">${barsHtml}</div>
                            <div class="rain-time-axis">${timeLabelsHtml}</div>
                        </div>
                        <div class="rain-desc-area">
                            <span style="font-size:14px; font-weight:bold;">降雨预报</span>
                            <span style="font-size:10px; opacity:0.8;">未来2小时</span>
                        </div>
                    </div>
                `;
            }
        }
        return '';
    }

    function replaceVarsWithRealData(content) {
        content = content.replace(/\{realtime\.(\w+)\}/g, (match, key) => state.realData?.realtime?.[key] || 'N/A');
        content = content.replace(/\{forecast\[(\d+)\]\.(\w+)\}/g, (match, day, key) => {
            const d = state.realData?.forecast?.[parseInt(day)];
            return d ? (d[key] || 'N/A') : 'N/A';
        });
        return content;
    }

    function selectElement(id) { state.selectedElementId = id; renderElements(); showPropertiesPanel(id); }
    function showPropertiesPanel(id) {
        const el = state.elements.find(e => e.id === id);
        if (!el) return;
        const panel = document.getElementById('panel-properties');
        const content = document.getElementById('propContent');
        panel.style.display = 'block';
        let propHtml = '';

        let typeName = el.type === 'block' ? (el.blockType === 'warning' ? '⚠️ 预警板块' : '🌧️ 降雨板块') : '📝 文本框';
        propHtml += `<div class="control-group"><label>类型</label><div style="font-size:12px; padding:4px; background:#f0f0f0; border-radius:4px;">${typeName}</div></div>`;
        propHtml += `<div class="control-group"><label>位置 (格)</label><div style="display:flex; gap:5px;"><input type="number" value="${el.x}" min="0" max="${state.gridWidth-1}" onchange="updateElementPos(${el.id}, 'x', this.value)"><input type="number" value="${el.y}" min="0" max="${state.gridHeight-1}" onchange="updateElementPos(${el.id}, 'y', this.value)"></div></div>`;
        propHtml += `<div class="control-group"><label>尺寸 (格)</label><div style="display:flex; gap:5px;"><input type="number" value="${el.w}" min="1" max="${state.gridWidth}" onchange="updateElementSize(${el.id}, 'w', this.value)"><input type="number" value="${el.h}" min="1" max="${state.gridHeight}" onchange="updateElementSize(${el.id}, 'h', this.value)"></div></div>`;

        if (el.type === 'block') {
            const currentScale = el.scale || 1;
            propHtml += `
                <div class="control-group">
                    <label>缩放比例</label>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <input type="range" min="0.5" max="2" step="0.1" value="${currentScale}" onchange="updateElementScale(${el.id}, this.value)" style="flex:1;">
                        <span style="font-size:12px; width:40px; text-align:right;">${Math.round(currentScale * 100)}%</span>
                    </div>
                </div>
            `;
        }

        if (el.type === 'text') {
            const safeContent = (el.content || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            
            // --- 文本内容 ---
            propHtml += `<div class="control-group"><label>内容</label><textarea id="prop-textarea-${el.id}" rows="2" onchange="updateElementContent(${el.id}, this.value)">${safeContent}</textarea></div>`;
            
            // === 新增：插入变量功能 ===
            propHtml += `
            <div class="control-group">
                <div style="display:flex; gap:5px; flex-wrap:wrap;">
                    <button class="insert-var-btn" onclick="togglePropVarMenu()">🔍 插入变量</button>
                </div>
                <!-- 嵌入变量菜单，默认隐藏 -->
                <div id="propVarMenu" class="var-menu-popup" style="display:none; position:relative; margin-top:5px;">
                    <div class="var-menu-section">
                        <div class="var-menu-title">实况数据</div>
                        <div id="propVarMenuRealtime" class="var-menu-grid"></div>
                    </div>
                    <div class="var-menu-section">
                        <div class="var-menu-title">预报数据</div>
                        <select id="propVarMenuDaySelect" onchange="updatePropVarMenuForecast()" style="width:100%; margin-bottom:5px; font-size:11px;">
                            <option value="0">+1天</option><option value="1">+2天</option><option value="2">+3天</option>
                            <option value="3">+4天</option><option value="4">+5天</option><option value="5">+6天</option>
                            <option value="6">+7天</option><option value="7">+8天</option><option value="8">+9天</option><option value="9">+10天</option>
                        </select>
                        <div id="propVarMenuForecast" class="var-menu-grid"></div>
                    </div>
                </div>
            </div>
            `;

            propHtml += `<div class="control-group"><label>字号</label><input type="number" value="${el.style?.fontSize || 12}" onchange="updateElementStyle(${el.id}, 'fontSize', this.value)"></div>`;
            
            // --- 样式设置（粗体 + 对齐） ---
            const isBold = el.style?.fontWeight === 'bold';
            const currentAlign = el.style?.textAlign || 'center';
            
            propHtml += `<div class="control-group">
                <label>样式</label>
                <div style="display:flex; gap:10px; align-items:center;">
                    <label style="cursor:pointer; display:flex; align-items:center; gap:4px; width:50%;">
                        <input type="checkbox" ${isBold ? 'checked' : ''} onchange="updateElementStyle(${el.id}, 'fontWeight', this.checked ? 'bold' : 'normal')"> 
                        <span style="font-size:12px;">粗体</span>
                    </label>
                    <select style="padding:2px; font-size:12px; border:1px solid #ccc; border-radius:3px;" onchange="updateElementStyle(${el.id}, 'textAlign', this.value)">
                        <option value="left" ${currentAlign === 'left' ? 'selected' : ''}>左对齐</option>
                        <option value="center" ${currentAlign === 'center' ? 'selected' : ''}>居中</option>
                        <option value="right" ${currentAlign === 'right' ? 'selected' : ''}>右对齐</option>
                    </select>
                </div>
            </div>`;

            // --- 颜色选择 ---
            const currentColor = el.style?.color || '#000000';
            let activeColorIndex = state.blocks.findIndex(b => b.color === currentColor);
            if (activeColorIndex === -1) activeColorIndex = 24;
            let colorGridHtml = '<div class="color-palette-mini" style="margin-top:4px;">';
            state.blocks.forEach((block, index) => {
                const isActive = index === activeColorIndex ? 'active' : '';
                colorGridHtml += `<div class="color-swatch ${isActive}" style="background-color: ${block.color};" onclick="updateElementStyle(${el.id}, 'color', '${block.color}')" title="${block.name}"></div>`;
            });
            colorGridHtml += '</div>';
            propHtml += `<div class="control-group"><label>颜色</label>${colorGridHtml}</div>`;
        }
        content.innerHTML = propHtml;

        // 如果是文本元素，初始化一下变量菜单内容（数据填充）
        if (el.type === 'text') {
            initPropVarMenuContent();
        }
    }



    window.updateElementScale = function(id, value) {
        const el = state.elements.find(e => e.id === id);
        if (el) { el.scale = parseFloat(value); renderElements(); showPropertiesPanel(id); }
    };
    function updateElementPos(id, axis, value) { const el = state.elements.find(e => e.id === id); if (el) { el[axis] = Math.max(0, Math.min(axis === 'x' ? state.gridWidth - 1 : state.gridHeight - 1, parseInt(value) || 0)); renderElements(); } }
    function updateElementSize(id, dim, value) { const el = state.elements.find(e => e.id === id); if (el) { el[dim] = Math.max(1, Math.min(dim === 'w' ? state.gridWidth : state.gridHeight, parseInt(value) || 1)); renderElements(); } }
    function updateElementContent(id, value) { const el = state.elements.find(e => e.id === id); if (el) { el.content = value; renderElements(); } }
    function updateElementStyle(id, prop, value) { const el = state.elements.find(e => e.id === id); if (el) { if (!el.style) el.style = {}; el.style[prop] = prop === 'fontSize' ? parseInt(value) : value; renderElements(); if (state.selectedElementId === id && document.getElementById('panel-properties').style.display !== 'none') showPropertiesPanel(id); } }
    function deleteSelected() { if (state.selectedElementId) { state.elements = state.elements.filter(e => e.id !== state.selectedElementId); state.selectedElementId = null; document.getElementById('panel-properties').style.display = 'none'; renderElements(); } }

    let dragEl = null, dragOffsetX = 0, dragOffsetY = 0;
    function startDrag(e, el) { if (state.appMode !== 'edit' || state.currentMode !== 'select') return; dragEl = el; const rect = e.target.getBoundingClientRect(); dragOffsetX = e.clientX - rect.left; dragOffsetY = e.clientY - rect.top; document.onmousemove = onDrag; document.onmouseup = endDrag; }
    function onDrag(e) { if (!dragEl) return; const canvas = document.getElementById('gridCanvas'); const rect = canvas.getBoundingClientRect(); const cellSize = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--grid-cell-size')); let newX = Math.round((e.clientX - rect.left - dragOffsetX) / cellSize); let newY = Math.round((e.clientY - rect.top - dragOffsetY) / cellSize); newX = Math.max(0, Math.min(state.gridWidth - dragEl.w, newX)); newY = Math.max(0, Math.min(state.gridHeight - dragEl.h, newY)); dragEl.x = newX; dragEl.y = newY; renderElements(); }
    function endDrag() { dragEl = null; document.onmousemove = null; document.onmouseup = null; }

    // ==================== 模式切换 ====================
    function initModeSwitch() { document.querySelectorAll('.mode-btn').forEach(btn => { btn.onclick = () => { const mode = btn.dataset.mode; document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); if (mode === 'palette') { state.currentMode = 'select'; } else { state.currentMode = mode; state.pendingBlockType = null; } updatePanels(); }; }); }
    function updateModeButtons() { document.querySelectorAll('.mode-btn').forEach(btn => { if (btn.dataset.mode !== 'palette') { btn.classList.toggle('active', btn.dataset.mode === state.currentMode); } }); }
    function updatePanels() { document.getElementById('panel-paint').style.display = 'none'; document.getElementById('panel-text').style.display = 'none'; const paletteBtn = document.querySelector('.mode-btn[data-mode="palette"]'); const isPaletteActive = paletteBtn.classList.contains('active'); if (isPaletteActive) { document.getElementById('panel-paint').style.display = 'block'; } else if (state.currentMode === 'add-text') { document.getElementById('panel-text').style.display = 'block'; } if (state.appMode !== 'edit' || !state.selectedElementId) { document.getElementById('panel-properties').style.display = 'none'; } else { if (state.currentMode === 'select' || isPaletteActive) { document.getElementById('panel-properties').style.display = 'block'; } else { document.getElementById('panel-properties').style.display = 'none'; } } }

    // ==================== 变量菜单逻辑 ====================
    window.toggleVarMenu = function() { const menu = document.getElementById('varMenu'); if (menu.style.display === 'none') { menu.style.display = 'block'; initVarMenuContent(); } else { menu.style.display = 'none'; } };
    function initVarMenuContent() { const realtimeList = document.getElementById('varMenuRealtime'); if(realtimeList) { realtimeList.innerHTML = ''; realtimeVars.forEach(v => { const btn = document.createElement('button'); btn.textContent = v.label; btn.onclick = () => insertText(`{${v.key}}`); realtimeList.appendChild(btn); }); } updateVarMenuForecast(); }
    function updateVarMenuForecast() { const daySelect = document.getElementById('varMenuDaySelect'); if(!daySelect) return; const day = parseInt(daySelect.value); const dayLabel = `+${day+1}天`; const forecastList = document.getElementById('varMenuForecast'); if(forecastList) { forecastList.innerHTML = ''; forecastVarDefs.forEach(v => { const btn = document.createElement('button'); btn.textContent = `${dayLabel} ${v.label}`; btn.onclick = () => insertText(`{forecast[${day}].${v.key}}`); forecastList.appendChild(btn); }); } }
    window.insertText = function(text) { const textarea = document.getElementById('textContent'); if (!textarea) return; const start = textarea.selectionStart; const end = textarea.selectionEnd; const val = textarea.value; textarea.value = val.substring(0, start) + text + val.substring(end); textarea.selectionStart = textarea.selectionEnd = start + text.length; textarea.focus(); document.getElementById('varMenu').style.display = 'none'; };
	    // === 属性面板专用的变量菜单逻辑 ===
    window.togglePropVarMenu = function() {
        const menu = document.getElementById('propVarMenu');
        if (menu) {
            const isHidden = menu.style.display === 'none';
            menu.style.display = isHidden ? 'block' : 'none';
            if (isHidden) initPropVarMenuContent(); // 每次打开时刷新
        }
    };

    function initPropVarMenuContent() {
        const realtimeList = document.getElementById('propVarMenuRealtime');
        if (realtimeList) {
            realtimeList.innerHTML = '';
            realtimeVars.forEach(v => {
                const btn = document.createElement('button');
                btn.textContent = v.label;
                btn.onclick = () => insertPropText(`{${v.key}}`);
                realtimeList.appendChild(btn);
            });
        }
        updatePropVarMenuForecast();
    }

    window.updatePropVarMenuForecast = function() {
        const daySelect = document.getElementById('propVarMenuDaySelect');
        if(!daySelect) return;
        const day = parseInt(daySelect.value);
        const dayLabel = `+${day+1}天`;
        const forecastList = document.getElementById('propVarMenuForecast');
        if(forecastList) {
            forecastList.innerHTML = '';
            forecastVarDefs.forEach(v => {
                const btn = document.createElement('button');
                btn.textContent = `${dayLabel} ${v.label}`;
                btn.onclick = () => insertPropText(`{forecast[${day}].${v.key}}`);
                forecastList.appendChild(btn);
            });
        }
    };

    // 将文本插入到属性面板的 textarea 中
    function insertPropText(text) {
        // 获取当前选中文本框的 ID
        if (!state.selectedElementId) return;
        const textareaId = `prop-textarea-${state.selectedElementId}`;
        const textarea = document.getElementById(textareaId);
        if (!textarea) return;

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const val = textarea.value;
        textarea.value = val.substring(0, start) + text + val.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + text.length;
        textarea.focus();

        // 触发更新
        updateElementContent(state.selectedElementId, textarea.value);
        
        // 关闭菜单
        const menu = document.getElementById('propVarMenu');
        if (menu) menu.style.display = 'none';
    }

    // ==================== 事件监听 ====================
    function initEventListeners() {
        document.getElementById('gridHeightInput').onchange = function() { let val = parseInt(this.value); val = Math.max(MIN_GRID_HEIGHT, Math.min(MAX_GRID_HEIGHT, val)); this.value = val; state.gridHeight = val; state.cells = new Array(state.gridWidth * state.gridHeight).fill(DEFAULT_BLOCK_INDEX); state.elements = []; renderGrid(); };
        document.getElementById('authorName').addEventListener('input', function() { state.author = this.value; });
        window.addEventListener('pointerup', () => { state.isPainting = false; });
        window.addEventListener('pointercancel', () => { state.isPainting = false; });
        const paintSwitch = document.getElementById('paintModeSwitch');
        paintSwitch.addEventListener('change', function() { state.paintModeEnabled = this.checked; const canvas = document.getElementById('gridCanvas'); canvas.classList.toggle('locked-swipe', state.paintModeEnabled); });
    }

    // ==================== 分享链接生成 ====================
    function generateShareLink() {
        const config = { w: state.gridWidth, h: state.gridHeight, c: state.cells, e: state.elements, a: state.author || '' };
        const jsonStr = JSON.stringify(config);
        const compressed = pako.gzip(jsonStr);
        let binary = '';
        for (let i = 0; i < compressed.length; i++) binary += String.fromCharCode(compressed[i]);
        const base64 = btoa(binary);
        const urlSafeBase64 = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
        const shareUrl = `${location.origin}${location.pathname}?share=${urlSafeBase64}`;
        navigator.clipboard.writeText(shareUrl).then(() => { alert('分享链接已复制到剪贴板！'); }).catch(() => { prompt('请手动复制以下链接:', shareUrl); });
    }
    function loadFromShareLink(base64Str) {
        try {
            let base64 = base64Str.replace(/-/g, '+').replace(/_/g, '/');
            while (base64.length % 4) base64 += '=';
            const binary = atob(base64);
            const compressed = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) compressed[i] = binary.charCodeAt(i);
            const jsonStr = pako.inflate(compressed, { to: 'string' });
            const config = JSON.parse(jsonStr);
            state.gridWidth = config.w || 16;
            state.gridHeight = config.h || 16;
            state.cells = config.c || [];
            state.elements = (config.e || []).map(el => ({...el, scale: el.scale || 1}));
            state.author = config.a || '';
            document.getElementById('authorName').value = state.author;
            initGrid();
        } catch (e) { console.error('加载分享配置失败:', e); alert('无效的分享链接'); }
    }


    // ==================== 暴露接口 ====================
    window.setAppMode = setAppMode;
    window.clearGrid = clearGrid;
    window.generateShareLink = generateShareLink;
    window.deleteSelected = deleteSelected;
    window.updateElementPos = updateElementPos;
    window.updateElementSize = updateElementSize;
    window.updateElementContent = updateElementContent;
    window.updateElementStyle = updateElementStyle;
    window.confirmAddText = function() { const centerX = Math.floor(state.gridWidth / 2); const centerY = Math.floor(state.gridHeight / 2); const centerIndex = centerY * state.gridWidth + centerX; placeElementAtCell(centerIndex, 'text'); };
    window.toggleVarMenu = toggleVarMenu;
    window.updateVarMenuForecast = updateVarMenuForecast;

    init();
})();
