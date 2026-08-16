// 气象深高 - 定制分享构建器脚本
(function() {
    'use strict';

    // ==================== 全局状态 ====================
    const MAX_GRID_HEIGHT = 64;
    const MIN_GRID_HEIGHT = 16;

    // 颜色映射表 (1-32)
    const COLOR_MAP = [
        '#F20C0C', '#F27F0C', '#F2F20C', '#7FF20C', 
        '#0CF20C', '#0CF27F', '#0CF2F2', '#0C7FF2', 
        '#0C0CF2', '#7F0CF2', '#F20CF2', '#F20C7F', 
        '#E0592C', '#E0B32C', '#B3E02C', '#59E02C', 
        '#2CE059', '#2CE0B3', '#2CB3E0', '#2C59E0', 
        '#592CE0', '#B32CE0', '#E02CB3', '#E02C59', 
        '#000000', '#242424', '#484848', '#6D6D6D', 
        '#919191', '#B6B6B6', '#DADADA', '#FFFFFF'
    ];

    const DEFAULT_BLOCK_INDEX = 31; // 纯白

    const state = {
        gridWidth: 16,
        gridHeight: 16,
        cells: [],
        elements: [],
        selectedBlock: DEFAULT_BLOCK_INDEX,
        currentMode: 'select',
        selectedElementId: null,
        pendingBlockType: null, // 'text', 'warning', 'rain'
        appMode: 'preview',
        realData: null,
        author: '',
        isPainting: false,
        paintModeEnabled: false,
        blocks: COLOR_MAP.map((hex, i) => ({
            id: i,
            name: `颜色${i + 1}`,
            color: hex,
            file: ''
        })),
        // 当前选中的文本颜色（索引），默认黑色(索引24)
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
        { key: 'date', label: '日期' },
        { key: 'highTemp', label: '最高温' },
        { key: 'lowTemp', label: '最低温' },
        { key: 'weather', label: '天气描述' }
    ];

    // ==================== API 与数据处理 ====================
    const CDN_BASE = window.CDN_BASE || "";
    const CORS_PROXY = "/api/proxy?url=";
    const BASE_URL_FORECAST = "https://weather.121.com.cn/data_cache/szWeather/sz10day_new.js";
    const BASE_URL_ALARM = "https://weather.121.com.cn/data_cache/szWeather/alarm/szAlarm.js";
    const BASE_URL_RAIN = "https://wx.121.com.cn/Mobile/LdService/position?latitude=22.552188&longitude=114.025106&sign=1e86faea84f8574f155c9e485ed4710e";

    const WARNING_LEVEL_PRIORITY = {
        'hongse': 5, 'chengse': 4, 'huangse': 3, 'leidian': 3, 'ganhan': 3, 'lanse': 2, 'baisse': 1
    };

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
            state.paintModeEnabled = false;
            document.getElementById('paintModeSwitch').checked = false;
            document.getElementById('gridCanvas').classList.remove('locked-swipe');
            renderElements();
        } else if (mode === 'view') {
            editBtn.style.display = 'none';
            exitBtn.style.display = 'none';
            document.getElementById('gridCanvas').classList.add('view-only');
            if (!state.realData) loadRealData();
            renderElements();
        }

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

    // ==================== 颜色面板 ====================
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
        document.querySelectorAll('#colorPalette .color-swatch').forEach((el, i) => {
            el.classList.toggle('active', i === index);
        });
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
        document.querySelectorAll('#textColorPalette .color-swatch').forEach((el, i) => {
            el.classList.toggle('active', i === index);
        });
    }

    // ==================== 网格系统 ====================
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
            if (block) {
                cell.style.backgroundColor = block.color;
            }

            cell.onpointerdown = (e) => {
                if (state.appMode !== 'edit') return;
                if (state.currentMode === 'add-text') {
                    handleCellClick(i);
                } else {
                    if (state.paintModeEnabled) {
                        e.preventDefault();
                        state.isPainting = true;
                        paintCell(i);
                    }
                }
            };

            cell.onpointerenter = () => {
                if (state.paintModeEnabled && state.isPainting) {
                    paintCell(i);
                }
            };

            layerBg.appendChild(cell);
        }
        renderElements();
    }

    function paintCell(index) {
        state.cells[index] = state.selectedBlock;
        const cells = document.querySelectorAll('.grid-cell');
        const cell = cells[index];
        if(cell) {
            const block = state.blocks[state.selectedBlock];
            if (block) {
                cell.style.backgroundColor = block.color;
            }
        }
    }

    function handleCellClick(index) {
        if (state.appMode !== 'edit') return;
        if (state.currentMode === 'add-text') {
            if (state.pendingBlockType && state.pendingBlockType !== 'text') {
                placeElementAtCell(index, state.pendingBlockType);
            } else {
                placeElementAtCell(index, 'text');
            }
        }
    }

    function clearGrid() {
        if (confirm('确定要清空整个画布吗？')) {
            state.cells = new Array(state.gridWidth * state.gridHeight).fill(DEFAULT_BLOCK_INDEX);
            state.elements = [];
            renderGrid();
        }
    }

    // ==================== 特殊板块放置 ====================
    window.placeSpecialBlock = function(type) {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.mode-btn[data-mode="add-text"]').classList.add('active');
        
        state.currentMode = 'add-text';
        state.pendingBlockType = type;
        
        const typeName = type === 'warning' ? '预警信息' : '降雨预报';
        const sizeStr = type === 'warning' ? '建议 4x4' : '建议 8x4';
        alert(`已选择“${typeName}”板块，请点击网格放置。\n推荐尺寸：${sizeStr}。`);
        
        updatePanels();
    };

    // ==================== 元素系统 ====================
    function placeElementAtCell(cellIndex, type) {
        const x = cellIndex % state.gridWidth;
        const y = Math.floor(cellIndex / state.gridWidth);
        let element;

        console.log(`[DEBUG] Placing element type: ${type} at ${x},${y}`);

        if (type === 'text') {
            const content = document.getElementById('textContent').value;
            const size = parseInt(document.getElementById('textSize').value) || 35;
            const align = document.getElementById('textAlign').value;
            const isBold = document.getElementById('textBold').checked;
            const colorHex = state.blocks[state.selectedTextColorIndex]?.color || '#000000';
            
            const w = Math.max(1, parseInt(document.getElementById('textW').value) || 4);
            const h = Math.max(1, parseInt(document.getElementById('textH').value) || 1);

            if (!content.trim()) { return; }

            element = {
                id: Date.now(),
                type: 'text',
                x, y, w, h, content,
                style: {
                    fontSize: size,
                    color: colorHex,
                    textAlign: align,
                    fontWeight: isBold ? 'bold' : 'normal'
                }
            };
        } else if (type === 'warning' || type === 'rain') {
            // 读取输入框值，如果输入框被清空或无效，则使用默认值
            const inputW = document.getElementById('textW');
            const inputH = document.getElementById('textH');
            
            // 即使输入框隐藏，只要DOM存在就能读取
            const w = Math.max(1, parseInt(inputW?.value) || (type === 'warning' ? 4 : 8));
            const h = Math.max(1, parseInt(inputH?.value) || (type === 'warning' ? 4 : 4));

            console.log(`[DEBUG] Block size: ${w}x${h}`);

            element = {
                id: Date.now(),
                type: 'block',
                blockType: type,
                x, y, w, h,
                content: type === 'warning' ? '⚠️ 预警' : '🌧️ 降雨'
            };
        }

        if (element) {
            console.log('[DEBUG] Element object created:', element);
            state.elements.push(element);
            state.currentMode = 'select';
            state.pendingBlockType = null;
            updateModeButtons();
            updatePanels();
            renderElements();
            selectElement(element.id);
        } else {
            console.warn('[DEBUG] Failed to create element.');
        }
    }

    function renderElements() {
        const layer = document.getElementById('layer-elements');
        layer.innerHTML = '';
        
        console.log(`[DEBUG] Rendering ${state.elements.length} elements.`);

        state.elements.forEach(el => {
            const div = document.createElement('div');
            
            div.className = 'placed-element';
            if (el.id === state.selectedElementId && state.appMode === 'edit') {
                div.classList.add('selected');
            }

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
                div.innerHTML = renderElementContent(el);
            }

            div.onmousedown = (e) => startDrag(e, el);
            div.onclick = (e) => {
                e.stopPropagation();
                if (state.appMode === 'edit') selectElement(el.id);
            };
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
                const alarms = deduplicateAlarms(state.realData?.alarm);
                if (alarms && alarms.length > 0) {
                    return alarms.map(a => `<img src="${a.icon || ''}" class="mini-warning-icon" alt="${a.title}">`).join('');
                } else {
                    return '<span style="font-size:10px; color:#999;">无预警</span>';
                }
            } else if (el.blockType === 'rain') {
                const rainData = state.realData?.rain;
                const rainList = rainData && rainData.rain ? rainData.rain : [];
                const data = rainList.length ? rainList : []; 

                let barsHtml = '';
                let timeLabelsHtml = '';
                
                const step = Math.ceil(data.length / 8) || 1;
                const displayData = data.filter((_, i) => i % step === 0).slice(0, 8);

                displayData.forEach((d, idx) => {
                    const height = calcHeight(d.rain || 0); 
                    const hasRain = (d.rain || 0) > 0;
                    const hourStr = d.hour ? (d.hour < 10 ? `0${d.hour}:00` : `${d.hour}:00`) : '';
                    
                    barsHtml += `<div class="mini-rain-bar ${hasRain ? 'has-rain' : ''}" style="height: ${height}%;" title="${d.rain}mm"></div>`;
                    if (idx % 2 === 0) {
                        timeLabelsHtml += `<span>${hourStr}</span>`;
                    } else {
                        timeLabelsHtml += `<span></span>`;
                    }
                });

                return `
                    <div class="rain-chart-container">
                        <div class="rain-bar-row">
                            ${barsHtml}
                        </div>
                        <div class="rain-time-axis">
                            ${timeLabelsHtml}
                        </div>
                    </div>
                    <div class="rain-desc-container">
                        未来降水
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
        
        let propHtml = '';

        let typeName = el.type === 'block' ? (el.blockType === 'warning' ? '⚠️ 预警板块' : '🌧️ 降雨板块') : '📝 文本框';
        propHtml += `<div class="control-group"><label>类型</label><div style="font-size:12px; padding:4px; background:#f0f0f0; border-radius:4px;">${typeName}</div></div>`;
        
        propHtml += `<div class="control-group"><label>位置 (格)</label><div style="display:flex; gap:5px;"><input type="number" value="${el.x}" min="0" max="${state.gridWidth-1}" onchange="updateElementPos(${el.id}, 'x', this.value)"><input type="number" value="${el.y}" min="0" max="${state.gridHeight-1}" onchange="updateElementPos(${el.id}, 'y', this.value)"></div></div>`;
        propHtml += `<div class="control-group"><label>尺寸 (格)</label><div style="display:flex; gap:5px;"><input type="number" value="${el.w}" min="1" max="${state.gridWidth}" onchange="updateElementSize(${el.id}, 'w', this.value)"><input type="number" value="${el.h}" min="1" max="${state.gridHeight}" onchange="updateElementSize(${el.id}, 'h', this.value)"></div></div>`;

        if (el.type === 'text') {
            const safeContent = (el.content || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            
            let selectOptionsHtml = '';
            for(let i=0; i<10; i++) {
                selectOptionsHtml += `<option value="${i}">+${i+1}天</option>`;
            }

            propHtml += `
                <div class="control-group" style="position: relative;">
                    <label>内容 (支持变量)</label>
                    <div style="position: relative;">
                        <textarea id="prop-textarea-${el.id}" rows="3" onchange="updateElementContent(${el.id}, this.value)">${safeContent}</textarea>
                        <div class="input-action-btns">
                            <button type="button" class="insert-var-btn" onclick="togglePropVarMenu(${el.id})" title="插入变量">🧩</button>
                        </div>
                        <div id="prop-var-menu-${el.id}" class="var-menu" style="display: none;">
                            <div class="var-section-title">实况数据</div>
                            <div class="var-list-mini" id="prop-var-realtime-${el.id}"></div>
                            <div class="var-section-title" style="margin-top:10px;">
                                预报数据 
                                <select id="prop-var-day-${el.id}" style="width: auto; font-size: 11px; padding: 2px; margin-left: 5px;" onchange="updatePropVarMenuForecast(${el.id})">
                                    ${selectOptionsHtml}
                                </select>
                            </div>
                            <div class="var-list-mini" id="prop-var-forecast-${el.id}"></div>
                        </div>
                    </div>
                </div>
            `;
            
            const isBold = el.style?.fontWeight === 'bold';
            propHtml += `<div class="control-group" style="display:flex; align-items:center; justify-content:space-between;">
                <label style="margin-bottom:0;">粗体</label>
                <label class="switch">
                    <input type="checkbox" onchange="updateElementStyle(${el.id}, 'fontWeight', this.checked ? 'bold' : 'normal')" ${isBold ? 'checked' : ''}>
                    <span class="slider"></span>
                </label>
            </div>`;

            propHtml += `<div class="control-group"><label>字号</label><input type="number" value="${el.style?.fontSize || 12}" onchange="updateElementStyle(${el.id}, 'fontSize', this.value)"></div>`;
            
            const currentColor = el.style?.color || '#000000';
            let activeColorIndex = state.blocks.findIndex(b => b.color === currentColor);
            if (activeColorIndex === -1) activeColorIndex = 24;

            let colorGridHtml = '<div class="color-palette-mini" style="margin-top:4px;">';
            state.blocks.forEach((block, index) => {
                const isActive = index === activeColorIndex ? 'active' : '';
                colorGridHtml += `<div class="color-swatch ${isActive}" 
                                   style="background-color: ${block.color};" 
                                   onclick="updateElementStyle(${el.id}, 'color', '${block.color}')"
                                   title="${block.name}"></div>`;
            });
            colorGridHtml += '</div>';
            propHtml += `<div class="control-group"><label>颜色</label>${colorGridHtml}</div>`;

            propHtml += `<div class="control-group"><label>对齐方式</label><select onchange="updateElementStyle(${el.id}, 'textAlign', this.value)"> <option value="left" ${el.style?.textAlign === 'left' ? 'selected' : ''}>左对齐</option> <option value="center" ${(!el.style?.textAlign || el.style?.textAlign === 'center') ? 'selected' : ''}>居中</option> <option value="right" ${el.style?.textAlign === 'right' ? 'selected' : ''}>右对齐</option> </select></div>`;
        }
        
        content.innerHTML = propHtml;
        
        if (el.type === 'text') {
            initPropVarMenuContent(id);
        }
    }

    function updateElementPos(id, axis, value) {
        const el = state.elements.find(e => e.id === id);
        if (el) {
            el[axis] = Math.max(0, Math.min(axis === 'x' ? state.gridWidth - 1 : state.gridHeight - 1, parseInt(value) || 0));
            renderElements();
        }
    }

    function updateElementSize(id, dim, value) {
        const el = state.elements.find(e => e.id === id);
        if (el) {
            el[dim] = Math.max(1, Math.min(dim === 'w' ? state.gridWidth : state.gridHeight, parseInt(value) || 1));
            renderElements();
        }
    }

    function updateElementContent(id, value) {
        const el = state.elements.find(e => e.id === id);
        if (el) {
            el.content = value;
            renderElements();
        }
    }

    function updateElementStyle(id, prop, value) {
        const el = state.elements.find(e => e.id === id);
        if (el) {
            if (!el.style) el.style = {};
            el.style[prop] = prop === 'fontSize' ? parseInt(value) : value;
            renderElements();
            
            if (state.selectedElementId === id && document.getElementById('panel-properties').style.display !== 'none') {
                showPropertiesPanel(id);
            }
        }
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
        dragEl.x = newX;
        dragEl.y = newY;
        renderElements();
    }

    function endDrag() {
        dragEl = null;
        document.onmousemove = null;
        document.onmouseup = null;
    }

    // ==================== 模式切换 ====================
    function initModeSwitch() {
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.onclick = () => {
                const mode = btn.dataset.mode;
                
                document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                if (mode === 'palette') {
                    state.currentMode = 'select';
                } else {
                    state.currentMode = mode;
                    state.pendingBlockType = null;
                }
                
                updatePanels();
            };
        });
    }

    function updateModeButtons() {
        document.querySelectorAll('.mode-btn').forEach(btn => {
            if (btn.dataset.mode !== 'palette') {
                btn.classList.toggle('active', btn.dataset.mode === state.currentMode);
            }
        });
    }

    function updatePanels() {
        document.getElementById('panel-paint').style.display = 'none';
        document.getElementById('panel-text').style.display = 'none';
        
        const paletteBtn = document.querySelector('.mode-btn[data-mode="palette"]');
        const isPaletteActive = paletteBtn.classList.contains('active');

        if (isPaletteActive) {
            document.getElementById('panel-paint').style.display = 'block';
        } else if (state.currentMode === 'add-text') {
            document.getElementById('panel-text').style.display = 'block';
        }

        if (state.appMode !== 'edit' || !state.selectedElementId) {
            document.getElementById('panel-properties').style.display = 'none';
        } else {
            if (state.currentMode === 'select' || isPaletteActive) {
                 document.getElementById('panel-properties').style.display = 'block';
            } else {
                 document.getElementById('panel-properties').style.display = 'none';
            }
        }
    }

    // ==================== 变量菜单逻辑 (添加文本面板) ====================
    function toggleVarMenu() {
        const menu = document.getElementById('varMenu');
        if (menu.style.display === 'none') {
            menu.style.display = 'block';
            initVarMenuContent();
        } else {
            menu.style.display = 'none';
        }
    }

    function initVarMenuContent() {
        const realtimeList = document.getElementById('varMenuRealtime');
        if(realtimeList) {
            realtimeList.innerHTML = '';
            realtimeVars.forEach(v => {
                const btn = document.createElement('button');
                btn.textContent = v.label;
                btn.onclick = () => insertText(`{${v.key}}`);
                realtimeList.appendChild(btn);
            });
        }
        
        const daySelect = document.getElementById('varMenuDaySelect');
        if(daySelect) {
            const currentVal = daySelect.value;
            daySelect.innerHTML = '';
            for(let i=0; i<10; i++) {
                const option = document.createElement('option');
                option.value = i;
                option.textContent = `+${i+1}天`;
                daySelect.appendChild(option);
            }
            daySelect.value = currentVal || 0;
        }

        updateVarMenuForecast();
    }

    function updateVarMenuForecast() {
        const daySelect = document.getElementById('varMenuDaySelect');
        if(!daySelect) return;
        
        const day = parseInt(daySelect.value);
        const dayLabel = `+${day+1}天`;
        
        const forecastList = document.getElementById('varMenuForecast');
        if(forecastList) {
            forecastList.innerHTML = '';
            forecastVarDefs.forEach(v => {
                const btn = document.createElement('button');
                btn.textContent = `${dayLabel} ${v.label}`;
                btn.onclick = () => insertText(`{forecast[${day}].${v.key}}`);
                forecastList.appendChild(btn);
            });
        }
    }

    window.insertText = function(text) {
        const textarea = document.getElementById('textContent');
        if (!textarea) return;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const val = textarea.value;
        
        textarea.value = val.substring(0, start) + text + val.substring(end);
        
        textarea.selectionStart = textarea.selectionEnd = start + text.length;
        textarea.focus();
        
        document.getElementById('varMenu').style.display = 'none';
    };

    // ==================== 属性面板专用变量菜单逻辑 ====================
    window.togglePropVarMenu = function(id) {
        const menu = document.getElementById(`prop-var-menu-${id}`);
        if (menu.style.display === 'none') {
            menu.style.display = 'block';
            initPropVarMenuContent(id);
        } else {
            menu.style.display = 'none';
        }
    };

    function initPropVarMenuContent(id) {
        const realtimeList = document.getElementById(`prop-var-realtime-${id}`);
        if(realtimeList) {
            realtimeList.innerHTML = '';
            realtimeVars.forEach(v => {
                const btn = document.createElement('button');
                btn.textContent = v.label;
                btn.onclick = () => insertPropText(id, `{${v.key}}`);
                realtimeList.appendChild(btn);
            });
        }

        const daySelect = document.getElementById(`prop-var-day-${id}`);
        if(daySelect) {
            const currentVal = daySelect.value;
            daySelect.innerHTML = '';
            for(let i=0; i<10; i++) {
                const option = document.createElement('option');
                option.value = i;
                option.textContent = `+${i+1}天`;
                daySelect.appendChild(option);
            }
            daySelect.value = currentVal || 0;
        }
        
        updatePropVarMenuForecast(id);
    }

    window.updatePropVarMenuForecast = function(id) {
        const daySelect = document.getElementById(`prop-var-day-${id}`);
        if(!daySelect) return;
        
        const day = parseInt(daySelect.value);
        const dayLabel = `+${day+1}天`;
        
        const forecastList = document.getElementById(`prop-var-forecast-${id}`);
        
        if(forecastList) {
            forecastList.innerHTML = '';
            forecastVarDefs.forEach(v => {
                const btn = document.createElement('button');
                btn.textContent = `${dayLabel} ${v.label}`;
                btn.onclick = () => insertPropText(id, `{forecast[${day}].${v.key}}`);
                forecastList.appendChild(btn);
            });
        }
    };

    window.insertPropText = function(id, text) {
        const textarea = document.getElementById(`prop-textarea-${id}`);
        if (!textarea) return;
        
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const val = textarea.value;
        
        textarea.value = val.substring(0, start) + text + val.substring(end);
        
        textarea.selectionStart = textarea.selectionEnd = start + text.length;
        textarea.focus();
        
        updateElementContent(id, textarea.value);
        document.getElementById(`prop-var-menu-${id}`).style.display = 'none';
    };

    // ==================== 事件监听 ====================
    function initEventListeners() {
        document.getElementById('gridHeightInput').onchange = function() {
            let val = parseInt(this.value);
            val = Math.max(MIN_GRID_HEIGHT, Math.min(MAX_GRID_HEIGHT, val));
            this.value = val;
            state.gridHeight = val;
            state.cells = new Array(state.gridWidth * state.gridHeight).fill(DEFAULT_BLOCK_INDEX);
            state.elements = [];
            renderGrid();
        };

        document.getElementById('authorName').addEventListener('input', function() {
            state.author = this.value;
        });

        window.addEventListener('pointerup', () => {
            state.isPainting = false;
        });
        window.addEventListener('pointercancel', () => {
            state.isPainting = false;
        });

        const paintSwitch = document.getElementById('paintModeSwitch');
        paintSwitch.addEventListener('change', function() {
            state.paintModeEnabled = this.checked;
            const canvas = document.getElementById('gridCanvas');
            canvas.classList.toggle('locked-swipe', state.paintModeEnabled);
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
    window.deleteSelected = deleteSelected;
    window.updateElementPos = updateElementPos;
    window.updateElementSize = updateElementSize;
    window.updateElementContent = updateElementContent;
    window.updateElementStyle = updateElementStyle;
    window.confirmAddText = function() {
        const centerX = Math.floor(state.gridWidth / 2);
        const centerY = Math.floor(state.gridHeight / 2);
        const centerIndex = centerY * state.gridWidth + centerX;
        placeElementAtCell(centerIndex, 'text');
    };
    
    window.toggleVarMenu = toggleVarMenu;
    window.updateVarMenuForecast = updateVarMenuForecast;

    // 启动
    init();

})();
