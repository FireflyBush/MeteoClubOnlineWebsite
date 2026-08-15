// script_share.js - 定制分享编辑器功能脚本

$(document).ready(function() {
    const CDN_BASE = window.CDN_BASE || "";
    const CORS_PROXY = "/api/proxy?url=";
    const BASE_URL_FORECAST = "https://weather.121.com.cn/data_cache/szWeather/sz10day_new.js";
    const BASE_URL_ALARM = "https://weather.121.com.cn/data_cache/szWeather/alarm/szAlarm.js";
    const BASE_URL_RAIN = "https://wx.121.com.cn/Mobile/LdService/position?latitude=22.552188&longitude=114.025106&sign=1e86faea84f8574f155c9e485ed4710e";

    let currentWeatherData = { forecast: null, rain: null, alarm: null };
    const urlParams = new URLSearchParams(window.location.search);
    const isViewMode = urlParams.has('share');

    if (isViewMode) { initFromURL(); return; }
    initEditor();

    function initEditor() {
        $('.toolbar-btn').on('click', function() { insertMarkdownAction($(this).data('insert')); });
        $('#markdownEditor').on('input', debounce(updatePreview, 300));
        $('#customCardTitle').on('input', debounce(updatePreview, 300));
        $('#themeSelect, #layoutSelect').on('change', updatePreview);
        $('#generateLinkBtn').on('click', generateShareLink);
        $('#copyLinkBtn, #quickCopyBtn').on('click', copyShareLink);
        $('#refreshPreviewBtn').on('click', fetchAllData);
        fetchAllData();
    }

    function initFromURL() {
        try {
            const encodedConfig = urlParams.get('share');
            if (!encodedConfig) throw new Error('无配置参数');
            // 处理 URL 安全的 Base64（替换 - 和 _）
            let base64 = encodedConfig.replace(/-/g, '+').replace(/_/g, '/');
            // 添加 padding
            while (base64.length % 4) base64 += '=';
            const configStr = decodeURIComponent(escape(atob(base64)));
            const config = JSON.parse(configStr);
            $('#themeSelect').val(config.theme || 'light');
            $('#layoutSelect').val(config.layout || 'vertical');
            $('#customCardTitle').val(config.customTitle || '');
            $('#markdownEditor').val(config.content || '');
            $('.editor-panel, .preview-actions, .link-output-section').hide();
            $('.guide-grid, .markdown-syntax-help').closest('section').hide();
            $('.preview-title').text('定制天气卡片');
            $('body').addClass('view-mode');
            fetchAllData(true);
        } catch (e) {
            console.error('解析分享配置失败:', e);
            alert('分享链接无效或已过期');
            window.location.href = '/index.html';
        }
    }

    function insertMarkdownAction(action) {
        const editor = $('#markdownEditor')[0];
        const start = editor.selectionStart, end = editor.selectionEnd;
        const text = $(editor).val();
        let insertText = '', cursorOffset = 0;
        switch(action) {
            case 'heading': insertText = '\n# 标题\n'; cursorOffset = 3; break;
            case 'bold': insertText = '**加粗文本**'; cursorOffset = 2; break;
            case 'italic': insertText = '*斜体文本*'; cursorOffset = 1; break;
            case 'link': insertText = '[链接文字](https://example.com)'; cursorOffset = 1; break;
            case 'image': insertText = '![图片描述](https://example.com/image.jpg)'; cursorOffset = 2; break;
            case 'realtime': insertText = '\n{{WEATHER_REALTIME}}\n'; break;
            case 'forecast': insertText = '\n{{WEATHER_FORECAST}}\n'; break;
            case 'forecast10': insertText = '\n{{WEATHER_FORECAST10}}\n'; break;
            case 'warning': insertText = '\n{{WEATHER_WARNING}}\n'; break;
            case 'rain': insertText = '\n{{WEATHER_RAIN}}\n'; break;
        }
        $(editor).val(text.substring(0, start) + insertText + text.substring(end));
        editor.selectionStart = editor.selectionEnd = start + cursorOffset;
        $(editor).focus();
        updatePreview();
    }

    function debounce(func, wait) {
        let timeout;
        return function(...args) { clearTimeout(timeout); timeout = setTimeout(() => func(...args), wait); };
    }

    function fetchAllData(isViewMode = false) {
        const ts = new Date().getTime();
        $.getScript(`${BASE_URL_FORECAST}?_=${ts}`, function() {
            currentWeatherData.forecast = window.SZ121_10dayWeather;
            $.getScript(`${BASE_URL_ALARM}?_=${ts}`, function() {
                currentWeatherData.alarm = window.SZ121_AlarmInfo;
                $.getJSON(CORS_PROXY + encodeURIComponent(BASE_URL_RAIN + "&_=" + ts), function(rainData) {
                    currentWeatherData.rain = rainData;
                    isViewMode ? renderViewMode() : updatePreview();
                }).fail(function() { currentWeatherData.rain = null; isViewMode ? renderViewMode() : updatePreview(); });
            }).fail(function() { currentWeatherData.alarm = null; isViewMode ? renderViewMode() : updatePreview(); });
        }).fail(function() { console.warn("预报数据获取失败"); });
    }

    function updatePreview() {
        if (!currentWeatherData.forecast) {
            $('#previewContainer').html('<div class="preview-placeholder"><p>数据加载中...</p></div>');
            return;
        }
        const content = $('#markdownEditor').val();
        const customTitle = $('#customCardTitle').val().trim();
        const theme = $('#themeSelect').val();
        const layout = $('#layoutSelect').val();
        applyTheme(theme);
        applyLayout(layout);
        let html = '';
        if (customTitle) {
            const today = new Date();
            const dateStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;
            html += `<div class="preview-card-header"><span class="preview-card-title">${escapeHtml(customTitle)}</span><span style="font-size:12px;color:var(--dim-color);">${dateStr}</span></div>`;
        }
        html += parseMarkdownContent(content);
        $('#previewContainer').html(html);
    }

    function parseMarkdownContent(content) {
        let html = '';
        const lines = content.split('\n');
        let inList = false, listItems = [];
        for (let line of lines) {
            if (line.includes('{{WEATHER_REALTIME}}')) { html += renderRealtimeCard(); continue; }
            if (line.includes('{{WEATHER_FORECAST}}')) { html += renderForecastCard(); continue; }
            if (line.includes('{{WEATHER_FORECAST10}}')) { html += renderForecast10Card(); continue; }
            if (line.includes('{{WEATHER_WARNING}}')) { html += renderWarningCard(); continue; }
            if (line.includes('{{WEATHER_RAIN}}')) { html += renderRainCard(); continue; }
            if (line.trim().startsWith('- ')) {
                if (!inList) { inList = true; listItems = []; }
                listItems.push(line.trim().substring(2));
                continue;
            } else if (inList) {
                html += '<ul style="margin:8px 0;padding-left:20px;">';
                listItems.forEach(item => html += `<li style="color:var(--dim-color);">${parseInlineMarkdown(item)}</li>`);
                html += '</ul>';
                inList = false; listItems = [];
            }
            if (line.startsWith('### ')) html += `<h3 style="font-size:16px;margin:12px 0 8px 0;color:var(--title-color);">${parseInlineMarkdown(line.substring(4))}</h3>`;
            else if (line.startsWith('## ')) html += `<h2 style="font-size:18px;margin:12px 0 8px 0;color:var(--title-color);">${parseInlineMarkdown(line.substring(3))}</h2>`;
            else if (line.startsWith('# ')) html += `<h1 style="font-size:20px;margin:12px 0 8px 0;color:var(--title-color);">${parseInlineMarkdown(line.substring(2))}</h1>`;
            else if (line.trim() === '') continue;
            else html += `<p style="margin:8px 0;color:var(--text-color);line-height:1.6;">${parseInlineMarkdown(line)}</p>`;
        }
        if (inList) {
            html += '<ul style="margin:8px 0;padding-left:20px;">';
            listItems.forEach(item => html += `<li style="color:var(--dim-color);">${parseInlineMarkdown(item)}</li>`);
            html += '</ul>';
        }
        return html;
    }

    function parseInlineMarkdown(text) {
        // 先处理图片和链接（在转义前，因为 URL 中包含特殊字符）
        let result = text;
        // 处理图片：![alt](url) - 先保护起来
        const images = [];
        result = result.replace(/!\[(.*?)\]\((.*?)\)/g, (match, alt, url) => {
            images.push(`<img src="${url}" alt="${alt}" style="max-width:100%;height:auto;border-radius:8px;margin:8px 0;">`);
            return `__IMG_${images.length - 1}__`;
        });
        // 处理链接：[text](url)
        const links = [];
        result = result.replace(/\[(.*?)\]\((.*?)\)/g, (match, text, url) => {
            links.push(`<a href="${url}" target="_blank" rel="noopener" style="color:var(--rain-blue);text-decoration:none;">${text}</a>`);
            return `__LINK_${links.length - 1}__`;
        });
        // 现在转义 HTML 特殊字符
        result = escapeHtml(result);
        // 处理加粗：**text**
        result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        // 处理斜体：*text*
        result = result.replace(/\*(.+?)\*/g, '<em>$1</em>');
        // 处理行内代码：`code`
        result = result.replace(/`(.+?)`/g, '<code style="padding:2px 6px;background:rgba(0,0,0,0.05);border-radius:4px;font-family:monospace;font-size:0.9em;">$1</code>');
        // 恢复图片和链接
        images.forEach((img, i) => result = result.replace(`__IMG_${i}__`, img));
        links.forEach((link, i) => result = result.replace(`__LINK_${i}__`, link));
        return result;
    }

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function applyTheme(theme) {
        $('#previewContainer').removeClass('theme-dark theme-blue');
        if (theme === 'dark') $('#previewContainer').addClass('theme-dark');
        else if (theme === 'blue') $('#previewContainer').addClass('theme-blue');
    }

    function applyLayout(layout) {
        $('#previewContainer').removeClass('layout-horizontal');
        if (layout === 'horizontal') $('#previewContainer').addClass('layout-horizontal');
    }

    function renderRealtimeCard() {
        const forecast = currentWeatherData.forecast, rain = currentWeatherData.rain;
        if (!forecast || !forecast.today) return '';
        const today = forecast.today, temp = rain ? rain.temp : '--', desc = today.report || 'N/A', icon = today.icon || '02';
        return `<div class="preview-card"><div class="preview-card-header"><span class="preview-card-title">实时天气</span></div><div class="realtime-preview"><div><div class="realtime-temp-large">${temp !== 'N/A' ? temp : '--'}<span class="unit">°C</span></div><div class="realtime-desc">${cleanDesc(desc)}</div></div><img src="${CDN_BASE}/data/icons/${icon}.png" alt="天气" class="realtime-icon"></div></div>`;
    }

    function renderForecastCard() {
        const forecast = currentWeatherData.forecast;
        if (!forecast || !forecast.day10 || forecast.day10.length === 0) return '';
        let daysHtml = '';
        for (let i = 0; i < 3 && i < forecast.day10.length; i++) {
            const day = forecast.day10[i], dateStr = convertWeekday(day[0]), icon = day[4] || '02';
            const maxT = parseInt(day[2]) || '--', minT = parseInt(day[3]) || '--';
            daysHtml += `<div class="forecast-day-preview"><div class="forecast-date-preview">${dateStr}</div><img src="${CDN_BASE}/data/icons/${icon}.png" alt="天气" class="forecast-icon-preview"><div class="forecast-temps-preview">${maxT}° / ${minT}°</div></div>`;
        }
        return `<div class="preview-card"><div class="preview-card-header"><span class="preview-card-title">三日预报</span></div><div class="forecast-preview">${daysHtml}</div></div>`;
    }

    function renderForecast10Card() {
        const forecast = currentWeatherData.forecast;
        if (!forecast || !forecast.day10 || forecast.day10.length === 0) return '';
        let daysHtml = '';
        // 十天预报使用竖版卡片横向排列
        for (let i = 0; i < 10 && i < forecast.day10.length; i++) {
            const day = forecast.day10[i], dateStr = convertWeekday(day[0]), icon = day[4] || '02';
            const maxT = parseInt(day[2]) || '--', minT = parseInt(day[3]) || '--';
            daysHtml += `<div class="forecast10-day-card"><div class="f10-date">${dateStr}</div><img src="${CDN_BASE}/data/icons/${icon}.png" alt="天气" class="f10-icon"><div class="f10-temps"><span class="f10-max">${maxT}°</span><span class="f10-min">${minT}°</span></div></div>`;
        }
        return `<div class="preview-card preview-card-wide"><div class="preview-card-header"><span class="preview-card-title">十天预报</span></div><div class="forecast10-preview">${daysHtml}</div></div>`;
    }

    function renderWarningCard() {
        const alarm = currentWeatherData.alarm;
        if (!alarm || !alarm.subAlarm || alarm.subAlarm.length === 0) {
            return `<div class="preview-card"><div class="preview-card-header"><span class="preview-card-title">预警信息</span></div><div class="warning-preview"><span class="no-warning-text">当前无预警信号</span></div></div>`;
        }
        const WARNING_LEVEL_PRIORITY = { 'hongse': 5, 'chengse': 4, 'huangse': 3, 'leidian': 3, 'ganhan': 3, 'lanse': 2, 'baisse': 1 };
        let typeBestAlarm = {};
        alarm.subAlarm.forEach(alarmItem => {
            let icon = alarmItem.icon || '', level = 0, alarmType = 'unknown';
            for (let key in WARNING_LEVEL_PRIORITY) {
                if (icon.includes(key)) { level = WARNING_LEVEL_PRIORITY[key]; alarmType = icon.replace(key, ''); break; }
            }
            alarmItem._level = level; alarmItem._type = alarmType;
            if (!typeBestAlarm[alarmType] || level > typeBestAlarm[alarmType]._level) typeBestAlarm[alarmType] = alarmItem;
        });
        let deduped = Object.values(typeBestAlarm).sort((a, b) => b._level - a._level).slice(0, 6);
        let iconsHtml = '';
        deduped.forEach(alarmItem => iconsHtml += `<img src="${CDN_BASE}/data/warnings/${alarmItem.icon}.png" title="${escapeHtml(alarmItem.str)}" class="warning-icon-preview">`);
        return `<div class="preview-card"><div class="preview-card-header"><span class="preview-card-title">预警信息</span></div><div class="warning-preview">${iconsHtml}</div></div>`;
    }

    function renderRainCard() {
        const rain = currentWeatherData.rain;
        if (!rain || !rain.rain) {
            return `<div class="preview-card"><div class="preview-card-header"><span class="preview-card-title">未来 2 小时降雨</span></div><div style="text-align:center;color:var(--dim-color);padding:20px;">无降雨数据</div></div>`;
        }
        const rainArr = rain.rain.split(',').map(Number), MAX_BAR_HEIGHT = 90, MAX_RAIN_VALUE = 40;
        let barsHtml = '';
        for (let i = 0; i < Math.min(10, rainArr.length); i++) {
            const rainMm = rainArr[i];
            let height = rainMm > 0 ? (rainMm >= MAX_RAIN_VALUE ? MAX_BAR_HEIGHT : Math.round((rainMm / MAX_RAIN_VALUE) * MAX_BAR_HEIGHT)) : 0;
            const pct = (height / MAX_BAR_HEIGHT) * 100;
            barsHtml += `<div class="rain-bar-preview"><div class="rain-bar-fill-preview" style="height:${pct}%;"></div></div>`;
        }
        return `<div class="preview-card"><div class="preview-card-header"><span class="preview-card-title">未来 2 小时降雨</span></div><div class="rain-preview">${barsHtml}</div></div>`;
    }

    function cleanDesc(desc) {
        if (!desc || desc === 'N/A') return 'N/A';
        return desc.replace(/气温[^；]*；/, '').replace(/；。/, '。').replace(/；$/, '').substring(0, 20);
    }

    function convertWeekday(s) {
        if (!s || s === 'N/A') return s;
        return s.replace(/星期 ([一二三四五六日])/, '周$1');
    }

    function generateShareLink() {
        const content = $('#markdownEditor').val(), customTitle = $('#customCardTitle').val().trim();
        const theme = $('#themeSelect').val(), layout = $('#layoutSelect').val();
        if (!content.trim() && !customTitle) { alert('请输入一些内容或设置卡片标题'); return; }
        const config = { content, customTitle, theme, layout };
        const configStr = JSON.stringify(config);
        // 使用 URL 安全的 Base64 编码
        const encodedConfig = btoa(unescape(encodeURIComponent(configStr)))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');
        // 构建绝对路径，确保在 Cloudflare Pages 上正确工作
        const shareUrl = `/share.html?share=${encodedConfig}`;
        $('#shareLinkInput').val(window.location.origin + shareUrl);
        $('#linkOutputSection').slideDown();
        $('#copyLinkBtn').prop('disabled', false);
        $('html, body').animate({ scrollTop: $('#linkOutputSection').offset().top - 100 }, 300);
    }

    function copyShareLink() {
        const linkInput = $('#shareLinkInput');
        linkInput.select();
        document.execCommand('copy');
        showToast('链接已复制！');
    }

    function showToast(message) {
        const toast = $('#toast');
        toast.text(message).addClass('show');
        setTimeout(() => toast.removeClass('show'), 2000);
    }

    function renderViewMode() { updatePreview(); }

    const modal = $('#infoModal'), modalText = $('#modalText');
    function showModal(text) { if (!text || text === 'N/A') return; modalText.text(text); modal.css('display', 'flex'); }
    function hideModal() { modal.css('display', 'none'); }
    $('.close-btn').on('click', hideModal);
    $(window).on('click', function(event) { if ($(event.target).is(modal)) hideModal(); });

    if (CDN_BASE) {
        $('img').each(function() {
            var src = $(this).attr('src');
            if (!src) return;
            if (src.startsWith('/data/')) $(this).attr('src', CDN_BASE + src);
            else if (src.startsWith('data/') && !src.startsWith('data:')) $(this).attr('src', CDN_BASE + '/' + src);
        });
    }
});
