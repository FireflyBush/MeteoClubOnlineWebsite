// 气象深高 - 定制分享构建器脚本
(function() {
    'use strict';

    // ==================== 全局状态 ====================
    const MAX_GRID_HEIGHT = 64;
    const MIN_GRID_HEIGHT = 16;

    const state = {
        gridWidth: 16,
        gridHeight: 16,
        cells: [],
        elements: [],
        selectedBlock: 0,
        currentMode: 'paint',
        selectedElementId: null,
        pendingBlockType: null,
        appMode: 'preview',
        realData: null,
        author: '',
        // 将 12 改为 32，从 01 开始计数，后缀改为 .png
        blocks: Array.from({length: 32}, (_, i) => ({
            name: `方块${i + 1}`,
            file: `${(i + 1).toString().padStart(2, '0')}.png`
        }))
    };


    const realtimeVars = [
        { key: 'realtime.temp', label: '温度 (°C)' },
        { key: 'realtime.feelsLike', label: '体感温度' },
        { key: 'realtime.humidity', label: '湿度 (%)' },
        { key: 'realtime.wind', label: '风速' },
        { key: 'realtime.updateTime', label: '更新时间' }
    ];

    const forecastVarDefs = [
        { key: 'date', label: '日期' },
        { key: 'highTemp', label: '最高温 (°C)' },
        { key: 'lowTemp', label: '最低温 (°C)' },
        { key: 'weather', label: '天气描述' }
    ];

    const blockVars = [
        { key: 'rainBlock', label: '🌧️ 降雨预报板块' },
        { key: 'alertBlock', label: '⚠️ 预警信息板块' }
    ];

    // ==================== API 与数据处理 ====================
    const CDN_BASE = window.CDN_BASE || "";
    const CORS_PROXY = "/api/proxy?url=";
    const BASE_URL_FORECAST = "https://weather.121.com.cn/data_cache/szWeather/sz10day_new.js";
    const BASE_URL_ALARM = "https://weather.121.com.cn/data_cache/szWeather/alarm/szAlarm.js";
    const BASE_URL_RAIN = "https://wx.121.com.cn/Mobile/LdService/position?latitude=22.552188&longitude=114.025106&sign=1e86faea84f8574f155c9e485ed4710e";

    const WARNING_LEVEL_PRIORITY = { 'hongse': 5, 'chengse': 4, 'huangse': 3, 'leidian': 3, 'ganhan': 3, 'lanse': 2, 'baisse': 1 };

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
            let level = 0, alarmType = 'unknown';
            for (let key in WARNING_LEVEL_PRIORITY) {
                if (icon.includes(key)) {
                    level = WARNING_LEVEL_PRIORITY[key];
                    alarmType = icon.replace(key, '');
                    break;
                }
            }
            alarm._level = level; alarm._type = alarmType;
            if (!typeBestAlarm[alarmType] || level > typeBestAlarm[alarmType]._level) {
                typeBestAlarm[alarmType] = alarm;
            }
        });
        let result = Object.values(typeBestAlarm).sort((a, b) => b._level - a._level);
        result.forEach(a => { delete a._level; delete a._type; });
        return result.slice(0, 6);
    }

    function calcHeight(rain_mm) {
        const MAX_BAR_HEIGHT = 90;
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
                        date: convertWeekday(d[0]),
                        highTemp: parseInt(d[2]) || 'N/A',
                        lowTemp: parseInt(d[3]) || 'N/A',
                        weather: d[1] || 'N/A'
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
            let temp = rainData.temp;
            let hum = rainData.humidity;
            let wind = rainData.wind;
            state.realData.realtime = {
                temp: temp || 'N/A',
                feelsLike: apparentTemperature(temp, hum, wind),
                humidity: hum || 'N/A',
                wind: wind || 'N/A',
                updateTime: extractObserveTime(rainData.dataTime)
            };
            state.realData.rain = rainData;
            renderElements();
        }).fail(function() { console.warn("实况数据获取失败"); });
    }

    // ==================== 初始化 ====================
    function init() {
        initColorPalette();
        initModeSwitch();
        initVarLists();
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

    // ==================== 模式控制 ====================
    function setAppMode(mode) {
        state.appMode = mode;
        document.body.classList.remove('app-mode-preview', 'app-mode-edit', 'app-mode-view');
        document.body.classList.add(`app-mode-${mode}`);

        const editBtn = document.getElementById('btn-enter-edit');
        const exitBtn = document.getElementById('btn-exit-edit');
        const authorDisplay = document.getElementById('authorDisplay');

        if (mode === 'preview') {
            editBtn.style.display = 'flex';
            exitBtn.style.display = 'none';
            document.getElementById('gridCanvas').classList.add('view-only');
            if (!state.realData) loadRealData();
            renderElements();
        } else if (mode === 'edit') {
            editBtn.style.display = 'none';
            exitBtn.style.display = 'flex';
            document.getElementById('gridCanvas').classList.remove('view-only');
            renderElements();
        } else if (mode === 'view') {
            editBtn.style.display = 'none';
            exitBtn.style.display = 'none';
            document.getElementById('gridCanvas').classList.add('view-only');
            if (!state.realData) loadRealData();
            renderElements();
        }

        // 控制作者署名的显示
        if (mode === 'edit') {
            authorDisplay.style.display = 'none';
        } else {
            const author = state.author || document.getElementById('authorName').value || '';
            if (author) {
                authorDisplay.textContent = `✍️ 作者：${author}`;
                authorDisplay.style.display = 'block';
            } else {
                authorDisplay.style.display = 'none';
            }
        }
    }

    // ==================== 方块面板 ====================
    function initColorPalette() {
        const palette = document.getElementById('colorPalette');
        palette.innerHTML = '';
        state.blocks.forEach((block, index) => {
            const swatch = document.createElement('div');
            swatch.className = 'color-swatch' + (index === 0 ? ' active' : '');
            // 这里的 block.svg 改为 block.file
            swatch.style.backgroundImage = `url(${CDN_BASE}/data/blocks/${block.file})`;
            swatch.title = block.name;
            swatch.onclick = () => selectBlock(index);
            palette.appendChild(swatch);
        });
    }


    function selectBlock(index) {
        state.selectedBlock = index;
        document.querySelectorAll('.color-swatch').forEach((el, i) => {
            el.classList.toggle('active', i === index);
        });
    }

    // ==================== 网格系统 ====================
    function initGrid() { 
        // 初始化全为 0 号方块
        if (state.cells.length !== state.gridWidth * state.gridHeight) {
            state.cells = new Array(state.gridWidth * state.gridHeight).fill(0);
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
            const blockIndex = state.cells[i] !== undefined ? state.cells[i] : 0;
            const block = state.blocks[blockIndex];
            if (block) {
                // 这里的 block.svg 改为 block.file
                cell.style.backgroundImage = `url(${CDN_BASE}/data/blocks/${block.file})`;
                cell.style.backgroundSize = 'cover';
                cell.classList.add('filled');
            }
            cell.onclick = () => handleCellClick(i);
            layerBg.appendChild(cell);
        }
        renderElements();
    }

    function handleCellClick(index) {
        if (state.appMode !== 'edit') return;
        if (state.currentMode === 'paint') {
            state.cells[index] = state.selectedBlock;
            // 局部更新提升性能
            const cells = document.querySelectorAll('.grid-cell');
            const cell = cells[index];
            if(cell) {
                const block = state.blocks[state.selectedBlock];
                if (block) {
                    // 这里的 block.svg 改为 block.file
                    cell.style.backgroundImage = `url(${CDN_BASE}/data/blocks/${block.file})`;
                    cell.style.backgroundSize = 'cover';
                    cell.classList.add('filled');
                }
            }
        }
 else if (state.currentMode === 'add-text') placeElementAtCell(index, 'text');
        else if (state.currentMode === 'add-var') {
            if (window.pendingVarKey) placeElementAtCell(index, 'var');
            else if (state.pendingBlockType) placeElementAtCell(index, 'block');
        }
    }

    function clearGrid() {
        if (confirm('确定要清空整个画布吗？')) {
            state.cells = new Array(state.gridWidth * state.gridHeight).fill(0);
            state.elements = [];
            renderGrid();
        }
    }

    // ==================== 元素系统 ====================
    function placeElementAtCell(cellIndex, type) {
        const x = cellIndex % state.gridWidth;
        const y = Math.floor(cellIndex / state.gridWidth);
        let element;

        if (type === 'text') {
            const content = document.getElementById('textContent').value;
            const size = parseInt(document.getElementById('textSize').value) || 14;
            const color = document.getElementById('textColor').value;
            const textAlign = document.getElementById('textAlign').value;
            const w = parseInt(document.getElementById('textW').value) || 4;
            const h = parseInt(document.getElementById('textH').value) || 1;
            if (!content.trim()) { return; }
            element = { id: Date.now(), type: 'text', x, y, w, h, content, style: { fontSize: size, color, textAlign } };
        } else if (type === 'var') {
            const varKey = window.pendingVarKey;
            if (!varKey) { return; }
            element = { id: Date.now(), type: 'var', x, y, w: 3, h: 1, content: `{${varKey}}`, style: { fontSize: 12, color: '#0d47a1', textAlign: 'center' } };
            window.pendingVarKey = null;
        } else if (type === 'block') {
            const blockType = state.pendingBlockType;
            if (!blockType) { return; }
            element = { id: Date.now(), type: 'block', blockType, x, y, w: 8, h: 4, scale: 1.0, style: {} };
            state.pendingBlockType = null;
        }

        if (element) {
            state.elements.push(element);
            state.currentMode = 'select';
            updateModeButtons();
            updatePanels();
            document.querySelectorAll('.var-list button.active').forEach(btn => btn.classList.remove('active'));
            renderElements();
            selectElement(element.id);
        }
    }

    function renderElements() {
        const layer = document.getElementById('layer-elements');
        layer.innerHTML = '';
        state.elements.forEach(el => {
            const div = document.createElement('div');
            div.className = 'placed-element' + (el.id === state.selectedElementId && state.appMode === 'edit' ? ' selected' : '');
            div.style.left = `calc(${el.x} * var(--grid-cell-size))`;
            div.style.top = `calc(${el.y} * var(--grid-cell-size))`;
            div.style.width = `calc(${el.w} * var(--grid-cell-size))`;
            div.style.height = `calc(${el.h} * var(--grid-cell-size))`;
            div.style.fontSize = `${el.style?.fontSize || 12}px`;
            div.style.color = el.style?.color || '#000';
            div.style.textAlign = el.style?.textAlign || 'center';

            div.innerHTML = renderElementContent(el);

            div.onmousedown = (e) => startDrag(e, el);
            div.onclick = (e) => {
                e.stopPropagation();
                if (state.appMode === 'edit') selectElement(el.id);
            };
            layer.appendChild(div);

            if (el.type === 'block' && state.appMode !== 'edit' && state.realData) {
                renderBlockIntoElement(div, el);
            }
        });
    }

    function renderElementContent(el) {
        if (el.type === 'text' || el.type === 'var') {
            let content = el.content || '';
            if (state.appMode !== 'edit') {
                content = replaceVarsWithRealData(content);
                return content;
            } else {
                return content.replace(/\{([^}]+)\}/g, '<span class="var-tag">{$1}</span>');
            }
        } else if (el.type === 'block') {
            if (state.appMode === 'edit') {
                const blockName = el.blockType === 'rainBlock' ? '🌧️ 降雨预报' : '⚠️ 预警信息';
                return `<div style="font-size:11px; color:#666;">${blockName}<br><small>缩放：${el.scale}x</small></div>`;
            }
            return '';
        }
        return el.content || '';
    }

    function replaceVarsWithRealData(content) {
        content = content.replace(/\{realtime\.(\w+)\}/g, (match, key) => state.realData?.realtime?.[key] || 'N/A');
        content = content.replace(/\{forecast\[(\d+)\]\.(\w+)\}/g, (match, day, key) => {
            const d = state.realData?.forecast?.[parseInt(day)];
            return d ? (d[key] || 'N/A') : 'N/A';
        });
        return content;
    }

    function renderBlockIntoElement(container, el) {
        if (!state.realData) return;
        container.innerHTML = '';
        const innerDiv = document.createElement('div');
        innerDiv.style.width = '100%';
        innerDiv.style.height = '100%';
        innerDiv.style.transform = `scale(${el.scale || 1})`;
        innerDiv.style.transformOrigin = 'center center';
        innerDiv.style.display = 'flex';
        innerDiv.style.alignItems = 'center';
        innerDiv.style.justifyContent = 'center';

        if (el.blockType === 'alertBlock') {
            let iconsHtml = '';
            if (state.realData.alarm && state.realData.alarm.subAlarm && state.realData.alarm.subAlarm.length > 0) {
                const deduped = deduplicateAlarms(state.realData.alarm.subAlarm);
                deduped.forEach((alarm) => {
                    iconsHtml += `<img src="${CDN_BASE}/data/warnings/${alarm.icon}.png" title="${alarm.str}" style="height:30px;margin:2px;">`;
                });
            }
            innerDiv.innerHTML = iconsHtml ? `<div style="display:flex;flex-wrap:wrap;justify-content:center;">${iconsHtml}</div>` : `<div style="color:#666;font-size:12px;">暂无预警</div>`;
        } else if (el.blockType === 'rainBlock') {
            if (state.realData.rain && state.realData.rain.rain) {
                const rainArr = state.realData.rain.rain.split(',').map(Number);
                const heights = rainArr.map(calcHeight);
                const hasRain = Math.max(...heights) > 3;
                if (hasRain) {
                    let barsHtml = '<div style="display:flex;align-items:flex-end;height:90%;gap:2px;width:100%;">';
                    for (let i = 0; i < 30; i++) {
                        const h = heights[i] / 90 * 100;
                        barsHtml += `<div style="flex:1;background-color:var(--rain-blue);border-radius:2px 2px 0 0;height:${h}%;max-width:8px;"></div>`;
                    }
                    barsHtml += '</div>';
                    innerDiv.innerHTML = barsHtml;
                } else {
                    innerDiv.innerHTML = `<div style="color:#666;font-size:12px;">无降雨</div>`;
                }
            } else {
                innerDiv.innerHTML = `<div style="color:#666;font-size:12px;">无降雨数据</div>`;
            }
        }
        container.appendChild(innerDiv);
    }

    function selectElement(id) {
        state.selectedElementId = id;
        renderElements();
        showPropertiesPanel(id);
    }

    function showPropertiesPanel(id) {
        const el = state.elements.find(e => e.id === id);
        if (!el) return;
        const panel = document.getElementById('panel-properties');
        const content = document.getElementById('propContent');
        panel.style.display = 'block';
        
        let propHtml = `<div class="control-group"><label>类型</label><div style="font-size:12px; padding:4px; background:#f0f0f0; border-radius:4px;">${el.type === 'text' ? '📝 文本框' : (el.type === 'var' ? '📊 数据变量' : '📦 数据板块')}</div></div>`;
        propHtml += `<div class="control-group"><label>位置 (格)</label><div style="display:flex; gap:5px;"><input type="number" value="${el.x}" min="0" max="${state.gridWidth-1}" onchange="updateElementPos(${el.id}, 'x', this.value)"><input type="number" value="${el.y}" min="0" max="${state.gridHeight-1}" onchange="updateElementPos(${el.id}, 'y', this.value)"></div></div>`;
        
        if (el.type === 'block') {
            propHtml += `<div class="control-group"><label>缩放比例 (0.5x - 2x)</label><input type="range" min="0.5" max="2" step="0.1" value="${el.scale || 1}" oninput="updateBlockScale(${el.id}, this.value)"><div style="font-size:11px; color:#666; margin-top:2px;">当前：${(el.scale || 1).toFixed(1)}x</div></div>`;
        } else {
            propHtml += `<div class="control-group"><label>尺寸 (格)</label><div style="display:flex; gap:5px;"><input type="number" value="${el.w}" min="1" max="${state.gridWidth}" onchange="updateElementSize(${el.id}, 'w', this.value)"><input type="number" value="${el.h}" min="1" max="${state.gridHeight}" onchange="updateElementSize(${el.id}, 'h', this.value)"></div></div>`;
            if (el.type === 'text') {
                propHtml += `<div class="control-group"><label>内容</label><textarea rows="3" onchange="updateElementContent(${el.id}, this.value)">${el.content}</textarea></div>`;
            }
            propHtml += `<div class="control-group"><label>字号</label><input type="number" value="${el.style?.fontSize || 12}" onchange="updateElementStyle(${el.id}, 'fontSize', this.value)"></div>`;
            propHtml += `<div class="control-group"><label>颜色</label><input type="color" value="${el.style?.color || '#000000'}" onchange="updateElementStyle(${el.id}, 'color', this.value)"></div>`;
            propHtml += `<div class="control-group"><label>对齐方式</label><select onchange="updateElementStyle(${el.id}, 'textAlign', this.value)">
                <option value="left" ${el.style?.textAlign === 'left' ? 'selected' : ''}>左对齐</option>
                <option value="center" ${(!el.style?.textAlign || el.style?.textAlign === 'center') ? 'selected' : ''}>居中</option>
                <option value="right" ${el.style?.textAlign === 'right' ? 'selected' : ''}>右对齐</option>
            </select></div>`;
        }
        content.innerHTML = propHtml;
    }

    function updateElementPos(id, axis, value) {
        const el = state.elements.find(e => e.id === id);
        if (el) { el[axis] = Math.max(0, Math.min(axis === 'x' ? state.gridWidth - 1 : state.gridHeight - 1, parseInt(value) || 0)); renderElements(); }
    }

    function updateElementSize(id, dim, value) {
        const el = state.elements.find(e => e.id === id);
        if (el && el.type !== 'block') { el[dim] = Math.max(1, Math.min(dim === 'w' ? state.gridWidth : state.gridHeight, parseInt(value) || 1)); renderElements(); }
    }

    function updateElementContent(id, value) {
        const el = state.elements.find(e => e.id === id);
        if (el) { el.content = value; renderElements(); }
    }

    function updateElementStyle(id, prop, value) {
        const el = state.elements.find(e => e.id === id);
        if (el) { if (!el.style) el.style = {}; el.style[prop] = prop === 'fontSize' ? parseInt(value) : value; renderElements(); }
    }

    function updateBlockScale(id, scaleValue) {
        const el = state.elements.find(e => e.id === id);
        if (el && el.type === 'block') { el.scale = parseFloat(scaleValue); renderElements(); showPropertiesPanel(id); }
    }

    function deleteSelected() {
        if (state.selectedElementId) {
            state.elements = state.elements.filter(e => e.id !== state.selectedElementId);
            state.selectedElementId = null;
            document.getElementById('panel-properties').style.display = 'none';
            renderElements();
        }
    }

    let dragEl = null, dragOffsetX = 0, dragOffsetY = 0;
    function startDrag(e, el) {
        if (state.appMode !== 'edit' || state.currentMode !== 'select') return;
        dragEl = el;
        const rect = e.target.getBoundingClientRect();
        dragOffsetX = e.clientX - rect.left;
        dragOffsetY = e.clientY - rect.top;
        document.onmousemove = onDrag;
        document.onmouseup = endDrag;
    }

    function onDrag(e) {
        if (!dragEl) return;
        const canvas = document.getElementById('gridCanvas');
        const rect = canvas.getBoundingClientRect();
        const cellSize = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--grid-cell-size'));
        let newX = Math.round((e.clientX - rect.left - dragOffsetX) / cellSize);
        let newY = Math.round((e.clientY - rect.top - dragOffsetY) / cellSize);
        newX = Math.max(0, Math.min(state.gridWidth - dragEl.w, newX));
        newY = Math.max(0, Math.min(state.gridHeight - dragEl.h, newY));
        dragEl.x = newX; dragEl.y = newY;
        renderElements();
    }

    function endDrag() { dragEl = null; document.onmousemove = null; document.onmouseup = null; }

    // ==================== 模式切换 ====================
    function initModeSwitch() {
        document.querySelectorAll('.mode-btn[data-mode]').forEach(btn => {
            btn.onclick = () => {
                state.currentMode = btn.dataset.mode;
                updateModeButtons();
                updatePanels();
            };
        });
    }

    function updateModeButtons() {
        document.querySelectorAll('.mode-btn[data-mode]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === state.currentMode);
        });
    }

    function updatePanels() {
        document.getElementById('panel-paint').style.display = state.currentMode === 'paint' ? 'block' : 'none';
        document.getElementById('panel-text').style.display = state.currentMode === 'add-text' ? 'block' : 'none';
        document.getElementById('panel-var').style.display = state.currentMode === 'add-var' ? 'block' : 'none';
        if (state.currentMode !== 'select') document.getElementById('panel-properties').style.display = 'none';
    }

    // ==================== 变量列表 ====================
    function initVarLists() {
        const realtimeList = document.getElementById('varListRealtime');
        realtimeList.innerHTML = '';
        realtimeVars.forEach(v => {
            const btn = document.createElement('button');
            btn.textContent = v.label;
            btn.onclick = (e) => selectVar(v.key, e);
            realtimeList.appendChild(btn);
        });

        const blockList = document.getElementById('varListBlock');
        blockList.innerHTML = '';
        blockVars.forEach(v => {
            const btn = document.createElement('button');
            btn.textContent = v.label;
            btn.onclick = (e) => selectBlock(v.key, e);
            blockList.appendChild(btn);
        });
        updateForecastVars();
    }

    function updateForecastVars() {
        const day = parseInt(document.getElementById('forecastDayRange').value);
        const labels = ['今天', '明天', '后天', 'D+3', 'D+4', 'D+5', 'D+6', 'D+7', 'D+8', 'D+9'];
        document.getElementById('forecastDayLabel').textContent = labels[day];
        const forecastList = document.getElementById('varListForecast');
        forecastList.innerHTML = '';
        forecastVarDefs.forEach(v => {
            const btn = document.createElement('button');
            btn.textContent = `${v.label} (D+${day})`;
            btn.onclick = (e) => selectVar(`forecast[${day}].${v.key}`, e);
            forecastList.appendChild(btn);
        });
    }

    function selectVar(key, event) {
        window.pendingVarKey = key;
        state.pendingBlockType = null;
        state.currentMode = 'add-var';
        updateModeButtons();
        updatePanels();
        document.querySelectorAll('.var-list button').forEach(btn => btn.classList.remove('active'));
        if(event && event.target) event.target.classList.add('active');
    }

    function selectBlock(blockType, event) {
        state.pendingBlockType = blockType;
        window.pendingVarKey = null;
        state.currentMode = 'add-var';
        updateModeButtons();
        updatePanels();
        document.querySelectorAll('.var-list button').forEach(btn => btn.classList.remove('active'));
        if(event && event.target) event.target.classList.add('active');
    }

    // ==================== 事件监听 ====================
    function initEventListeners() {
        document.getElementById('gridHeightInput').onchange = function() {
            let val = parseInt(this.value);
            val = Math.max(MIN_GRID_HEIGHT, Math.min(MAX_GRID_HEIGHT, val));
            this.value = val;
            state.gridHeight = val;
            state.cells = new Array(state.gridWidth * state.gridHeight).fill(0);
            state.elements = [];
            renderGrid();
        };

        document.getElementById('authorName').addEventListener('input', function() {
            state.author = this.value;
        });
    }

    // ==================== 分享链接生成 ====================
    function generateShareLink() {
        const config = { 
            w: state.gridWidth, 
            h: state.gridHeight, 
            c: state.cells, 
            e: state.elements, 
            a: state.author || '' 
        };
        const jsonStr = JSON.stringify(config);
        const compressed = pako.gzip(jsonStr);
        let binary = '';
        for (let i = 0; i < compressed.length; i++) binary += String.fromCharCode(compressed[i]);
        const base64 = btoa(binary);
        const urlSafeBase64 = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
        
        const shareUrl = `${location.origin}${location.pathname}?share=${urlSafeBase64}`;
        
        navigator.clipboard.writeText(shareUrl).then(() => {
            alert('分享链接已复制到剪贴板！');
        }).catch(() => {
            prompt('请手动复制以下链接:', shareUrl);
        });
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
            state.elements = config.e || [];
            state.author = config.a || '';
            
            // 回填到输入框（虽然查看模式看不到，但逻辑保持一致）
            document.getElementById('authorName').value = state.author;
            
            initGrid();
        } catch (e) {
            console.error('加载分享配置失败:', e);
            alert('无效的分享链接');
        }
    }

    // ==================== 暴露接口 ====================
    window.setAppMode = setAppMode;
    window.clearGrid = clearGrid;
    window.generateShareLink = generateShareLink;
    window.updateBlockScale = updateBlockScale;
    window.deleteSelected = deleteSelected;
    window.updateElementPos = updateElementPos;
    window.updateElementSize = updateElementSize;
    window.updateElementContent = updateElementContent;
    window.updateElementStyle = updateElementStyle;
    window.updateForecastVars = updateForecastVars;
    window.loadRealData = loadRealData;
    
    window.confirmAddText = function() {
        const centerX = Math.floor(state.gridWidth / 2);
        const centerY = Math.floor(state.gridHeight / 2);
        const centerIndex = centerY * state.gridWidth + centerX;
        placeElementAtCell(centerIndex, 'text');
    };

    // 启动
    init();
})();
