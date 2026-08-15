// 气象深高 - 定制分享构建器脚本
// 仿 Minecraft 方块编辑模式，支持三数据源变量系统

(function() {
    'use strict';

    // ==================== 全局状态 ====================
    const state = {
        gridWidth: 16,
        gridHeight: 16,
        cells: [], // 每个单元格的颜色索引
        elements: [], // 放置的元素 [{id, type, x, y, w, h, content, style, blockType, scale}]
        selectedColor: 0,
        currentMode: 'paint',
        selectedElementId: null,
        pendingBlockType: null, // 待放置的板块类型
        // 12 色调色板：涵盖色环常用颜色 + 黑白灰 (索引 0 为透明)
        colors: [
            { name: '透明', value: 'transparent' },
            { name: '白色', value: '#ffffff' },
            { name: '浅灰', value: '#d3d3d3' },
            { name: '灰色', value: '#808080' },
            { name: '深灰', value: '#404040' },
            { name: '黑色', value: '#000000' },
            { name: '红色', value: '#ff0000' },
            { name: '橙色', value: '#ffa500' },
            { name: '黄色', value: '#ffff00' },
            { name: '绿色', value: '#008000' },
            { name: '青色', value: '#00ffff' },
            { name: '蓝色', value: '#0000ff' },
            { name: '紫色', value: '#800080' }
        ]
    };

    // 变量定义 - 三数据源系统
    // 实况数据源
    const realtimeVars = [
        { key: 'realtime.temp', label: '温度 (°C)' },
        { key: 'realtime.feelsLike', label: '体感温度' },
        { key: 'realtime.humidity', label: '湿度 (%)' },
        { key: 'realtime.windDir', label: '风向' },
        { key: 'realtime.windScale', label: '风力等级' },
        { key: 'realtime.windSpeed', label: '风速 (km/h)' },
        { key: 'realtime.pressure', label: '气压 (hPa)' },
        { key: 'realtime.visibility', label: '能见度 (km)' },
        { key: 'realtime.updateTime', label: '更新时间' }
    ];

    // 预报数据源 (相对日期 D+0~D+9)
    const forecastVarDefs = [
        { key: 'date', label: '日期' },
        { key: 'highTemp', label: '最高温 (°C)' },
        { key: 'lowTemp', label: '最低温 (°C)' },
        { key: 'weather', label: '天气描述' },
        { key: 'windDir', label: '风向' },
        { key: 'windScale', label: '风力' }
    ];

    // 板块数据源
    const blockVars = [
        { key: 'rainBlock', label: '🌧️ 降雨预报板块' },
        { key: 'alertBlock', label: '⚠️ 预警信息板块' }
    ];

    // ==================== 初始化 ====================
    function init() {
        initColorPalette();
        initGrid();
        initModeSwitch();
        initVarLists();
        initEventListeners();
        
        // 检查 URL 参数是否为预览模式
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('share')) {
            loadFromShareLink(urlParams.get('share'));
        }
    }

    // ==================== 颜色面板 ====================
    function initColorPalette() {
        const palette = document.getElementById('colorPalette');
        palette.innerHTML = '';
        
        state.colors.forEach((color, index) => {
            const swatch = document.createElement('div');
            swatch.className = 'color-swatch' + (index === 0 ? ' active' : '');
            swatch.style.background = color.value;
            if (color.value === 'transparent') {
                swatch.style.backgroundImage = 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)';
                swatch.style.backgroundSize = '8px 8px';
                swatch.style.backgroundPosition = '0 0, 0 4px, 4px -4px, -4px 0px';
            }
            swatch.title = color.name;
            swatch.onclick = () => selectColor(index);
            palette.appendChild(swatch);
        });
    }

    function selectColor(index) {
        state.selectedColor = index;
        document.querySelectorAll('.color-swatch').forEach((el, i) => {
            el.classList.toggle('active', i === index);
        });
    }

    // ==================== 网格系统 ====================
    function initGrid() {
        renderGrid();
    }

    function renderGrid() {
        const layerBg = document.getElementById('layer-bg');
        const canvas = document.getElementById('gridCanvas');
        
        // 更新 CSS 变量
        document.documentElement.style.setProperty('--grid-h', state.gridHeight);
        canvas.style.width = `calc(${state.gridWidth} * var(--grid-cell-size))`;
        canvas.style.height = `calc(${state.gridHeight} * var(--grid-cell-size))`;
        
        // 重新生成背景层
        layerBg.style.gridTemplateColumns = `repeat(${state.gridWidth}, var(--grid-cell-size))`;
        layerBg.style.gridTemplateRows = `repeat(${state.gridHeight}, var(--grid-cell-size))`;
        
        layerBg.innerHTML = '';
        
        for (let i = 0; i < state.gridWidth * state.gridHeight; i++) {
            const cell = document.createElement('div');
            cell.className = 'grid-cell';
            cell.dataset.index = i;
            
            const colorIndex = state.cells[i] || 0;
            const color = state.colors[colorIndex]?.value || 'transparent';
            
            if (color !== 'transparent') {
                cell.style.background = color;
                cell.classList.add('filled');
            }
            
            cell.onclick = () => handleCellClick(i);
            layerBg.appendChild(cell);
        }
        
        renderElements();
    }

    function handleCellClick(index) {
        if (state.currentMode === 'paint') {
            state.cells[index] = state.selectedColor;
            renderGrid();
        } else if (state.currentMode === 'add-text') {
            placeElementAtCell(index, 'text');
        } else if (state.currentMode === 'add-var') {
            placeElementAtCell(index, 'var');
        } else if (state.currentMode === 'add-block') {
            placeElementAtCell(index, 'block');
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
            const w = parseInt(document.getElementById('textW').value) || 4;
            const h = parseInt(document.getElementById('textH').value) || 1;
            
            if (!content.trim()) {
                alert('请输入文本内容');
                return;
            }
            
            element = {
                id: Date.now(),
                type: 'text',
                x: x,
                y: y,
                w: w,
                h: h,
                content: content,
                style: { fontSize: size, color: color }
            };
        } else if (type === 'var') {
            const varKey = window.pendingVarKey;
            if (!varKey) {
                alert('请先选择一个数据变量');
                return;
            }
            
            element = {
                id: Date.now(),
                type: 'var',
                x: x,
                y: y,
                w: 3,
                h: 1,
                content: `{${varKey}}`,
                style: { fontSize: 12, color: '#0d47a1' }
            };
            window.pendingVarKey = null;
        } else if (type === 'block') {
            const blockType = state.pendingBlockType;
            if (!blockType) {
                alert('请先选择一个数据板块');
                return;
            }
            
            element = {
                id: Date.now(),
                type: 'block',
                blockType: blockType,
                x: x,
                y: y,
                w: 8,
                h: 4,
                scale: 1.0,
                style: {}
            };
            state.pendingBlockType = null;
        }
        
        if (element) {
            state.elements.push(element);
            state.currentMode = 'select';
            updateModeButtons();
            renderElements();
        }
    }

    function renderElements() {
        const layer = document.getElementById('layer-elements');
        layer.innerHTML = '';
        
        state.elements.forEach(el => {
            const div = document.createElement('div');
            div.className = 'placed-element' + (el.id === state.selectedElementId ? ' selected' : '');
            div.style.left = `calc(${el.x} * var(--grid-cell-size))`;
            div.style.top = `calc(${el.y} * var(--grid-cell-size))`;
            div.style.width = `calc(${el.w} * var(--grid-cell-size))`;
            div.style.height = `calc(${el.h} * var(--grid-cell-size))`;
            div.style.fontSize = `${el.style?.fontSize || 12}px`;
            div.style.color = el.style?.color || '#000';
            
            // 渲染内容
            div.innerHTML = renderElementContent(el);
            
            // 拖拽逻辑
            div.onmousedown = (e) => startDrag(e, el);
            div.onclick = (e) => {
                e.stopPropagation();
                selectElement(el.id);
            };
            
            layer.appendChild(div);
        });
    }

    function renderElementContent(el) {
        if (el.type === 'text' || el.type === 'var') {
            // 解析变量标记
            return el.content.replace(/\{([^}]+)\}/g, '<span class="var-tag">{$1}</span>');
        } else if (el.type === 'block') {
            const blockName = el.blockType === 'rainBlock' ? '🌧️ 降雨预报' : '⚠️ 预警信息';
            return `<div style="font-size:11px; color:#666;">${blockName}<br><small>缩放：${el.scale}x</small></div>`;
        }
        return el.content || '';
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
        
        let propHtml = `
            <div class="control-group">
                <label>类型</label>
                <div style="font-size:12px; padding:4px; background:#f0f0f0; border-radius:4px;">
                    ${el.type === 'text' ? '📝 文本框' : (el.type === 'var' ? '📊 数据变量' : '📦 数据板块')}
                </div>
            </div>
            <div class="control-group">
                <label>位置 (格)</label>
                <div style="display:flex; gap:5px;">
                    <input type="number" value="${el.x}" min="0" max="${state.gridWidth-1}" onchange="updateElementPos(${el.id}, 'x', this.value)">
                    <input type="number" value="${el.y}" min="0" max="${state.gridHeight-1}" onchange="updateElementPos(${el.id}, 'y', this.value)">
                </div>
            </div>
        `;
        
        if (el.type === 'block') {
            propHtml += `
                <div class="control-group">
                    <label>缩放比例 (0.5x - 2x)</label>
                    <input type="range" min="0.5" max="2" step="0.1" value="${el.scale || 1}" oninput="updateBlockScale(${el.id}, this.value)">
                    <div style="font-size:11px; color:#666; margin-top:2px;">当前：${(el.scale || 1).toFixed(1)}x</div>
                </div>
            `;
        } else if (el.type === 'text') {
            propHtml += `
                <div class="control-group">
                    <label>尺寸 (格)</label>
                    <div style="display:flex; gap:5px;">
                        <input type="number" value="${el.w}" min="1" max="${state.gridWidth}" onchange="updateElementSize(${el.id}, 'w', this.value)">
                        <input type="number" value="${el.h}" min="1" max="${state.gridHeight}" onchange="updateElementSize(${el.id}, 'h', this.value)">
                    </div>
                </div>
                <div class="control-group">
                    <label>内容</label>
                    <textarea rows="3" onchange="updateElementContent(${el.id}, this.value)">${el.content}</textarea>
                </div>
                <div class="control-group">
                    <label>字号</label>
                    <input type="number" value="${el.style?.fontSize || 12}" onchange="updateElementStyle(${el.id}, 'fontSize', this.value)">
                </div>
                <div class="control-group">
                    <label>颜色</label>
                    <input type="color" value="${el.style?.color || '#000000'}" onchange="updateElementStyle(${el.id}, 'color', this.value)">
                </div>
            `;
        } else if (el.type === 'var') {
            propHtml += `
                <div class="control-group">
                    <label>尺寸 (格)</label>
                    <div style="display:flex; gap:5px;">
                        <input type="number" value="${el.w}" min="1" max="${state.gridWidth}" onchange="updateElementSize(${el.id}, 'w', this.value)">
                        <input type="number" value="${el.h}" min="1" max="${state.gridHeight}" onchange="updateElementSize(${el.id}, 'h', this.value)">
                    </div>
                </div>
                <div class="control-group">
                    <label>字号</label>
                    <input type="number" value="${el.style?.fontSize || 12}" onchange="updateElementStyle(${el.id}, 'fontSize', this.value)">
                </div>
                <div class="control-group">
                    <label>颜色</label>
                    <input type="color" value="${el.style?.color || '#0d47a1'}" onchange="updateElementStyle(${el.id}, 'color', this.value)">
                </div>
            `;
        }
        
        content.innerHTML = propHtml;
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
        if (el && el.type === 'text') {
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
        }
    }

    function updateBlockScale(id, scaleValue) {
        const el = state.elements.find(e => e.id === id);
        if (el && el.type === 'block') {
            el.scale = parseFloat(scaleValue);
            renderElements();
            // 更新面板显示
            showPropertiesPanel(id);
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

    // 拖拽功能
    let dragEl = null;
    let dragOffsetX = 0;
    let dragOffsetY = 0;

    function startDrag(e, el) {
        if (state.currentMode !== 'select') return;
        
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
        document.getElementById('panel-var').style.display = 
            (state.currentMode === 'add-var' || state.currentMode === 'add-block') ? 'block' : 'none';
        if (state.currentMode !== 'select') {
            document.getElementById('panel-properties').style.display = 'none';
        }
    }

    // ==================== 变量列表 ====================
    function initVarLists() {
        // 实况变量
        const realtimeList = document.getElementById('varListRealtime');
        if (realtimeList) {
            realtimeList.innerHTML = '';
            realtimeVars.forEach(v => {
                const btn = document.createElement('button');
                btn.textContent = v.label;
                btn.onclick = () => selectVar(v.key);
                realtimeList.appendChild(btn);
            });
        }
        
        // 板块变量
        const blockList = document.getElementById('varListBlock');
        if (blockList) {
            blockList.innerHTML = '';
            blockVars.forEach(v => {
                const btn = document.createElement('button');
                btn.textContent = v.label;
                btn.onclick = () => selectBlock(v.key);
                blockList.appendChild(btn);
            });
        }
        
        updateForecastVars();
    }

    function updateForecastVars() {
        const day = parseInt(document.getElementById('forecastDayRange').value);
        const labels = ['今天', '明天', '后天', 'D+3', 'D+4', 'D+5', 'D+6', 'D+7', 'D+8', 'D+9'];
        document.getElementById('forecastDayLabel').textContent = labels[day];
        
        const forecastList = document.getElementById('varListForecast');
        if (forecastList) {
            forecastList.innerHTML = '';
            
            forecastVarDefs.forEach(v => {
                const btn = document.createElement('button');
                btn.textContent = `${v.label} (D+${day})`;
                btn.onclick = () => selectVar(`forecast[${day}].${v.key}`);
                forecastList.appendChild(btn);
            });
        }
    }

    function selectVar(key) {
        window.pendingVarKey = key;
        state.currentMode = 'add-var';
        updateModeButtons();
        updatePanels();
        alert(`已选择变量 {${key}}，请点击网格放置`);
    }

    function selectBlock(blockType) {
        state.pendingBlockType = blockType;
        state.currentMode = 'add-block';
        updateModeButtons();
        updatePanels();
        alert(`已选择${blockType === 'rainBlock' ? '降雨预报' : '预警信息'}板块，请点击网格放置`);
    }

    // ==================== 事件监听 ====================
    function initEventListeners() {
        // 网格高度调整
        document.getElementById('gridHeightInput').onchange = function() {
            let val = parseInt(this.value);
            val = Math.max(4, Math.min(128, val));
            state.gridHeight = val;
            state.cells = new Array(state.gridWidth * state.gridHeight).fill(0);
            state.elements = [];
            renderGrid();
        };
    }

    // ==================== 预览功能 ====================
    function togglePreview() {
        const modal = document.getElementById('previewModal');
        const content = document.getElementById('previewContent');
        
        if (modal.classList.contains('show')) {
            modal.classList.remove('show');
        } else {
            // 渲染预览
            content.innerHTML = generatePreviewHTML();
            modal.classList.add('show');
        }
    }

    function generatePreviewHTML() {
        const cellSize = 30;
        const width = state.gridWidth * cellSize;
        const height = state.gridHeight * cellSize;
        
        let html = `<div style="position:relative; width:${width}px; height:${height}px; background:#fff; box-shadow:0 4px 20px rgba(0,0,0,0.15);">`;
        
        // 背景层
        state.cells.forEach((colorIndex, i) => {
            const color = state.colors[colorIndex]?.value || 'transparent';
            if (color !== 'transparent') {
                const x = (i % state.gridWidth) * cellSize;
                const y = Math.floor(i / state.gridWidth) * cellSize;
                html += `<div style="position:absolute; left:${x}px; top:${y}px; width:${cellSize}px; height:${cellSize}px; background:${color};"></div>`;
            }
        });
        
        // 元素层 (实时数据渲染)
        state.elements.forEach(el => {
            const renderedContent = renderElementWithRealData(el);
            html += `
                <div style="
                    position:absolute;
                    left:${el.x * cellSize}px;
                    top:${el.y * cellSize}px;
                    width:${el.w * cellSize}px;
                    height:${el.h * cellSize}px;
                    display:flex;
                    align-items:center;
                    justify-content:center;
                    text-align:center;
                    font-size:${el.style?.fontSize || 12}px;
                    color:${el.style?.color || '#000'};
                    white-space:pre-wrap;
                    word-break:break-word;
                    line-height:1.3;
                    padding:4px;
                ">${renderedContent}</div>
            `;
        });
        
        html += '</div>';
        return html;
    }

    function renderElementWithRealData(el, useRealData = false) {
        // 板块类型渲染
        if (el.type === 'block') {
            if (useRealData) {
                // 实际分享页面会调用真实 API 渲染板块
                return `<div data-block-type="${el.blockType}" data-scale="${el.scale || 1}"></div>`;
            } else {
                // 预览模式显示模拟板块
                const blockName = el.blockType === 'rainBlock' ? '🌧️ 降雨预报' : '⚠️ 预警信息';
                return `<div style="font-size:11px; color:#666; padding:8px; background:#f5f5f5; border-radius:4px;">
                    ${blockName}<br><small>缩放：${(el.scale || 1).toFixed(1)}x<br>(预览模式)</small></div>`;
            }
        }
        
        let content = el.content || '';
        
        // 替换变量为实际数据
        const mockData = {
            realtime: {
                temp: '25',
                feelsLike: '27',
                humidity: '65',
                windDir: '东南风',
                windScale: '3',
                windSpeed: '12',
                pressure: '1013',
                visibility: '10',
                updateTime: new Date().toLocaleTimeString()
            },
            forecast: []
        };
        
        for (let i = 0; i < 10; i++) {
            mockData.forecast.push({
                date: new Date(Date.now() + i * 86400000).toLocaleDateString(),
                highTemp: 28 - i,
                lowTemp: 22 - i,
                weather: ['晴', '多云', '阴', '小雨'][Math.floor(Math.random() * 4)],
                windDir: '东风',
                windScale: '2-3'
            });
        }
        
        content = content.replace(/\{realtime\.(\w+)\}/g, (match, key) => {
            return mockData.realtime[key] || match;
        });
        
        content = content.replace(/\{forecast\[(\d+)\]\.(\w+)\}/g, (match, day, key) => {
            const d = mockData.forecast[parseInt(day)];
            return d ? (d[key] || match) : match;
        });
        
        return content;
    }

    // ==================== 分享链接生成 (使用 Pako Gzip 压缩) ====================
    function generateShareLink() {
        const config = {
            w: state.gridWidth,
            h: state.gridHeight,
            c: state.cells,
            e: state.elements
        };
        
        const jsonStr = JSON.stringify(config);
        
        // 使用 Pako 进行 Gzip 压缩
        const compressed = pako.gzip(jsonStr);
        
        // 转为 Base64
        let binary = '';
        for (let i = 0; i < compressed.length; i++) {
            binary += String.fromCharCode(compressed[i]);
        }
        const base64 = btoa(binary);
        
        // URL 安全的 Base64
        const urlSafeBase64 = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
        
        const shareUrl = `${window.location.origin}/share.html?share=${urlSafeBase64}`;
        
        // 复制链接
        navigator.clipboard.writeText(shareUrl).then(() => {
            alert('分享链接已复制到剪贴板！\n\n链接长度：' + shareUrl.length + ' 字符\n(使用 Gzip 压缩，可支持复杂场景)');
        }).catch(() => {
            prompt('请手动复制以下链接:', shareUrl);
        });
    }

    function loadFromShareLink(base64Str) {
        try {
            // 恢复 URL 安全的 Base64
            let base64 = base64Str.replace(/-/g, '+').replace(/_/g, '/');
            // 补齐等号
            while (base64.length % 4) {
                base64 += '=';
            }
            
            const binary = atob(base64);
            const compressed = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                compressed[i] = binary.charCodeAt(i);
            }
            
            // 使用 Pako 解压
            const jsonStr = pako.inflate(compressed, { to: 'string' });
            const config = JSON.parse(jsonStr);
            
            state.gridWidth = config.w || 16;
            state.gridHeight = config.h || 16;
            state.cells = config.c || [];
            state.elements = config.e || [];
            
            // 进入预览模式
            state.currentMode = 'select';
            updateModeButtons();
            updatePanels();
            renderGrid();
            
            // 自动显示预览
            setTimeout(togglePreview, 500);
            
        } catch (e) {
            console.error('加载分享配置失败:', e);
            alert('无效的分享链接');
        }
    }

    // 暴露到全局作用域供 HTML onclick 调用
    window.togglePreview = togglePreview;
    window.generateShareLink = generateShareLink;
    window.updateBlockScale = updateBlockScale;
    window.confirmAddText = function() {
        const centerX = Math.floor(state.gridWidth / 2);
        const centerY = Math.floor(state.gridHeight / 2);
        const centerIndex = centerY * state.gridWidth + centerX;
        placeElementAtCell(centerIndex, 'text');
    };

    // 启动
    init();

})();
