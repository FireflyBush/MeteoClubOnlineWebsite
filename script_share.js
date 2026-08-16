// ================= 核心状态 =================
const state = {
    gridWidth: 16,
    gridHeight: 16,
    cells: [],
    elements: [],
    selectedBlock: 0,
    currentMode: 'paint', // paint 或 add-var
    pendingBlockType: null,
    appMode: 'edit', // 默认编辑模式
    realData: null,
    author: '',
    
    // 触屏与拖拽追踪
    dragPaintEnabled: false,
    isPointerDown: false,
    hasMoved: false,
    startX: 0,
    startY: 0,
    lastPaintedCell: null,
    
    // 24 色纯色映射
    blocks: [
        { name: '正红', color: '#EB0F0F' }, { name: '朱红', color: '#E84A0C' },
        { name: '橙', color: '#E67E0A' },   { name: '金黄', color: '#E6B80D' },
        { name: '黄', color: '#B8E60D' },   { name: '黄绿', color: '#73E60D' },
        { name: '草绿', color: '#2EE60D' }, { name: '绿', color: '#0DE62E' },
        { name: '青绿', color: '#0DE67A' }, { name: '青', color: '#0DE6C2' },
        { name: '青蓝', color: '#0DB8E6' }, { name: '蓝', color: '#0D73E6' },
        { name: '紫蓝', color: '#0D2EE6' }, { name: '紫', color: '#3B0DE6' },
        { name: '紫红', color: '#860DE6' }, { name: '玫红', color: '#D10DE6' },
        { name: '品红', color: '#E60DA8' }, { name: '深红', color: '#E60D4A' },
        { name: '纯黑', color: '#000000' }, { name: '深灰', color: '#333333' },
        { name: '中深灰', color: '#666666' },{ name: '中灰', color: '#999999' },
        { name: '浅灰', color: '#CCCCCC' }, { name: '纯白', color: '#FFFFFF' }
    ]
};

// ================= 初始化 =================
function init() {
    // 尝试从 URL 加载分享数据
    const hash = window.location.hash.substring(1);
    if (hash) {
        try {
            const decoded = JSON.parse(atob(hash));
            state.realData = decoded;
            state.gridHeight = decoded.height || 16;
            state.cells = decoded.cells || [];
            state.elements = decoded.elements || [];
            state.author = decoded.author || '';
            document.getElementById('authorName').value = state.author;
            document.getElementById('gridHeightInput').value = state.gridHeight;
            state.appMode = 'preview'; // 有数据则默认预览
        } catch (e) {
            console.error("分享数据解析失败", e);
        }
    }

    // 绑定输入框事件
    document.getElementById('gridHeightInput').onchange = function() {
        let val = parseInt(this.value);
        val = Math.max(16, Math.min(64, val));
        this.value = val;
        state.gridHeight = val;
        state.cells = new Array(state.gridWidth * state.gridHeight).fill(0);
        state.elements = [];
        renderGrid();
    };

    document.getElementById('authorName').addEventListener('input', function() {
        state.author = this.value;
    });

    // 绑定开关事件
    document.getElementById('dragPaintSwitch').addEventListener('change', function() {
        state.dragPaintEnabled = this.checked;
        document.getElementById('gridCanvas').classList.toggle('locked-swipe', state.dragPaintEnabled);
    });

    initColorPalette();
    initEventListeners();
    renderGrid();
    updateModeUI();
    
    // 兼容 test_share.js 的模拟数据注入
    if (typeof window.loadRealData === 'function' && state.realData) {
        // 如果有模拟数据机制可以在这里触发
    }
}

// ================= 调色盘与渲染 =================
function initColorPalette() {
    const palette = document.getElementById('colorPalette');
    palette.innerHTML = '';
    state.blocks.forEach((block, index) => {
        const swatch = document.createElement('div');
        swatch.className = 'color-swatch' + (index === 0 ? ' active' : '');
        swatch.style.backgroundColor = block.color;
        swatch.title = block.name;
        swatch.onclick = () => selectColor(index);
        palette.appendChild(swatch);
    });
}

function selectColor(index) {
    state.selectedBlock = index;
    state.currentMode = 'paint';
    document.querySelectorAll('.color-swatch').forEach((el, i) => {
        el.classList.toggle('active', i === index);
    });
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
            cell.style.backgroundColor = block.color;
            cell.classList.add('filled');
        }
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
            cell.style.backgroundImage = 'none';
            cell.classList.add('filled');
        }
    }
}

// ================= 数据元素渲染 =================
function renderElements() {
    const overlay = document.getElementById('layer-overlay');
    overlay.innerHTML = '';
    
    state.elements.forEach(elData => {
        const el = document.createElement('div');
        el.className = 'placed-element';
        el.style.left = `${elData.x}px`;
        el.style.top = `${elData.y}px`;
        
        if (elData.type === 'text') {
            // 修复：应用对齐方式到内部 div 和外层 flex
            const align = elData.textAlign || 'left';
            el.style.alignItems = align === 'center' ? 'center' : (align === 'right' ? 'flex-end' : 'flex-start');
            
            const textEl = document.createElement('div');
            textEl.className = 'element-text-content';
            textEl.innerText = elData.text || '文本';
            textEl.style.textAlign = align;
            textEl.style.width = '100%';
            el.appendChild(textEl);
        } else if (elData.type === 'rain') {
            el.innerText = '🌧️ 降雨量';
        } else if (elData.type === 'warning') {
            el.innerText = '⚠️ 预警';
        }
        
        // 点击已放置元素：切换对齐方式 (演示)
        el.onclick = (e) => {
            e.stopPropagation();
            if (state.appMode === 'edit') {
                if (elData.type === 'text') {
                    elData.textAlign = elData.textAlign === 'left' ? 'center' : (elData.textAlign === 'center' ? 'right' : 'left');
                    renderElements();
                }
            }
        };
        
        overlay.appendChild(el);
    });
}

// ================= 事件监听 (完美解决触屏冲突) =================
function initEventListeners() {
    const layerBg = document.getElementById('layer-bg');
    const canvas = document.getElementById('gridCanvas');
    
    // 画布点击：用于放置数据元素
    canvas.addEventListener('click', (e) => {
        if (state.appMode !== 'edit') return;
        if (state.currentMode === 'add-var' && !state.hasMoved) {
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            state.elements.push({
                id: Date.now(),
                type: state.pendingBlockType,
                x: x, y: y,
                text: state.pendingBlockType === 'text' ? '文本' : '',
                textAlign: 'left'
            });
            renderElements();
            state.currentMode = 'paint'; // 放置后恢复涂色模式
        }
    });

    // 指针按下：记录起点，决定是否锁定滑动
    layerBg.addEventListener('pointerdown', (e) => {
        if (state.appMode !== 'edit' || state.currentMode !== 'paint') return;
        state.isPointerDown = true;
        state.hasMoved = false;
        state.startX = e.clientX;
        state.startY = e.clientY;
        
        if (state.dragPaintEnabled) {
            e.preventDefault();
            const cell = e.target.closest('.grid-cell');
            if (cell) {
                paintCell(cell.dataset.index);
                state.lastPaintedCell = cell;
            }
        }
    });

    // 指针移动：全局监听，根据开关决定是滑动页面还是连续涂色
    window.addEventListener('pointermove', (e) => {
        if (!state.isPointerDown) return;
        
        const dx = Math.abs(e.clientX - state.startX);
        const dy = Math.abs(e.clientY - state.startY);
        if (dx > 5 || dy > 5) state.hasMoved = true;

        if (state.dragPaintEnabled && state.currentMode === 'paint') {
            e.preventDefault(); // 阻止手机端页面滚动
            const el = document.elementFromPoint(e.clientX, e.clientY);
            const cell = el ? el.closest('.grid-cell') : null;
            if (cell && cell !== state.lastPaintedCell) {
                paintCell(cell.dataset.index);
                state.lastPaintedCell = cell;
            }
        }
    });

    // 指针抬起：如果未滑动且未开启拖拽，执行单击涂色
    window.addEventListener('pointerup', (e) => {
        if (!state.isPointerDown) return;
        
        if (!state.hasMoved && !state.dragPaintEnabled && state.currentMode === 'paint') {
            const el = document.elementFromPoint(e.clientX, e.clientY);
            const cell = el ? el.closest('.grid-cell') : null;
            if (cell) paintCell(cell.dataset.index);
        }
        
        state.isPointerDown = false;
        state.hasMoved = false;
        state.lastPaintedCell = null;
    });

    window.addEventListener('pointercancel', () => {
        state.isPointerDown = false;
        state.hasMoved = false;
        state.lastPaintedCell = null;
    });
}

// ================= UI 控制与工具函数 =================
function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    document.querySelectorAll('.tool-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === `panel-${tab}`);
    });
}

function setPendingBlock(type) {
    state.pendingBlockType = type;
    state.currentMode = 'add-var';
}

function clearGrid() {
    state.cells = new Array(state.gridWidth * state.gridHeight).fill(0);
    state.elements = [];
    renderGrid();
}

function toggleEditMode() {
    state.appMode = state.appMode === 'edit' ? 'preview' : 'edit';
    updateModeUI();
}

function updateModeUI() {
    const btn = document.getElementById('modeToggleBtn');
    const canvas = document.getElementById('gridCanvas');
    if (state.appMode === 'edit') {
        btn.innerText = '👁️ 预览模式';
        canvas.style.cursor = 'crosshair';
        document.body.classList.remove('view-only');
    } else {
        btn.innerText = '✏️ 编辑模式';
        canvas.style.cursor = 'default';
        document.body.classList.add('view-only');
    }
}

function generateShareLink() {
    const data = {
        height: state.gridHeight,
        cells: state.cells,
        elements: state.elements,
        author: state.author
    };
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
    const link = `${window.location.origin}${window.location.pathname}#${encoded}`;
    
    const tempInput = document.createElement('input');
    document.body.appendChild(tempInput);
    tempInput.value = link;
    tempInput.select();
    document.execCommand('copy');
    document.body.removeChild(tempInput);
    alert('分享链接已复制到剪贴板！');
}

window.onload = init;
