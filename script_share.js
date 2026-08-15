// script_share.js - 定制分享功能脚本

$(document).ready(function() {
    const CDN_BASE = window.CDN_BASE || "";
    const CORS_PROXY = "/api/proxy?url=";
    const BASE_URL_FORECAST = "https://weather.121.com.cn/data_cache/szWeather/sz10day_new.js";
    const BASE_URL_ALARM = "https://weather.121.com.cn/data_cache/szWeather/alarm/szAlarm.js";
    const BASE_URL_RAIN = "https://wx.121.com.cn/Mobile/LdService/position?latitude=22.552188&longitude=114.025106&sign=1e86faea84f8574f155c9e485ed4710e";

    // 当前天气数据
    let currentWeatherData = {
        forecast: null,
        rain: null,
        alarm: null
    };

    // URL 参数解析
    const urlParams = new URLSearchParams(window.location.search);
    const isViewMode = urlParams.has('share');

    // 如果是查看模式，直接渲染
    if (isViewMode) {
        initFromURL();
        return;
    }

    // 初始化构建器模式
    initBuilder();

    // 初始化构建器
    function initBuilder() {
        // 绑定事件
        $('#generateLinkBtn').on('click', generateShareLink);
        $('#copyLinkBtn').on('click', copyShareLink);
        $('#previewRefreshBtn').on('click', fetchAllData);
        
        // 监听配置变化
        $('input[type="checkbox"], select').on('change', updatePreview);
        
        // 初始获取数据
        fetchAllData();
    }

    // 从 URL 初始化（查看分享链接模式）
    function initFromURL() {
        try {
            const config = JSON.parse(atob(urlParams.get('share')));
            
            // 应用配置
            $('#themeSelect').val(config.theme || 'light');
            $('#layoutSelect').val(config.layout || 'vertical');
            $('#showTitle').prop('checked', config.showTitle !== false);
            $('#selectRealtime').prop('checked', config.modules.realtime !== false);
            $('#selectForecast').prop('checked', config.modules.forecast !== false);
            $('#selectWarning').prop('checked', config.modules.warning !== false);
            $('#selectRain').prop('checked', config.modules.rain !== false);
            
            // 隐藏生成按钮，显示提示
            $('.config-panel').hide();
            $('.preview-title').text('定制天气卡片');
            
            // 获取数据并渲染
            fetchAllData(true);
        } catch (e) {
            console.error('解析分享配置失败:', e);
            alert('分享链接无效或已过期');
            window.location.href = '/index.html';
        }
    }

    // 获取所有天气数据
    function fetchAllData(isViewMode = false) {
        const ts = new Date().getTime();
        const URL_FORECAST = `${BASE_URL_FORECAST}?_=${ts}`;
        const URL_ALARM = `${BASE_URL_ALARM}?_=${ts}`;
        const URL_RAIN = CORS_PROXY + encodeURIComponent(BASE_URL_RAIN + "&_=" + ts);

        $.getScript(URL_FORECAST, function() {
            currentWeatherData.forecast = window.SZ121_10dayWeather;
            
            $.getScript(URL_ALARM, function() {
                currentWeatherData.alarm = window.SZ121_AlarmInfo;

                $.getJSON(URL_RAIN, function(rainData) {
                    currentWeatherData.rain = rainData;
                    if (isViewMode) {
                        renderViewMode();
                    } else {
                        updatePreview();
                    }
                }).fail(function() {
                    currentWeatherData.rain = null;
                    if (isViewMode) {
                        renderViewMode();
                    } else {
                        updatePreview();
                    }
                });
            }).fail(function() {
                currentWeatherData.alarm = null;
                if (isViewMode) {
                    renderViewMode();
                } else {
                    updatePreview();
                }
            });
        }).fail(function() {
            console.warn("预报数据获取失败");
        });
    }

    // 更新预览
    function updatePreview() {
        if (!currentWeatherData.forecast) {
            $('#previewContainer').html(`
                <div class="preview-placeholder">
                    <p>数据加载中...</p>
                    <p>请稍候或点击"刷新预览"</p>
                </div>
            `);
            return;
        }

        const config = getConfig();
        applyTheme(config.theme);
        applyLayout(config.layout);
        
        let html = '';
        
        if (config.showTitle) {
            html += `
                <div class="preview-card-header">
                    <span class="preview-card-title">气象深高 · 定制天气</span>
                    <span style="font-size: 12px; color: var(--dim-color);">${new Date().toLocaleDateString('zh-CN')}</span>
                </div>
            `;
        }

        if (config.modules.realtime) {
            html += renderRealtimePreview();
        }

        if (config.modules.forecast) {
            html += renderForecastPreview();
        }

        if (config.modules.warning) {
            html += renderWarningPreview();
        }

        if (config.modules.rain) {
            html += renderRainPreview();
        }

        $('#previewContainer').html(html);
    }

    // 获取当前配置
    function getConfig() {
        return {
            modules: {
                realtime: $('#selectRealtime').is(':checked'),
                forecast: $('#selectForecast').is(':checked'),
                warning: $('#selectWarning').is(':checked'),
                rain: $('#selectRain').is(':checked')
            },
            theme: $('#themeSelect').val(),
            layout: $('#layoutSelect').val(),
            showTitle: $('#showTitle').is(':checked')
        };
    }

    // 应用主题
    function applyTheme(theme) {
        $('#previewContainer').removeClass('theme-dark theme-blue');
        if (theme === 'dark') {
            $('#previewContainer').addClass('theme-dark');
        } else if (theme === 'blue') {
            $('#previewContainer').addClass('theme-blue');
        }
    }

    // 应用布局
    function applyLayout(layout) {
        $('#previewContainer').removeClass('layout-horizontal');
        if (layout === 'horizontal') {
            $('#previewContainer').addClass('layout-horizontal');
        }
    }

    // 渲染实时天气预览
    function renderRealtimePreview() {
        const forecast = currentWeatherData.forecast;
        const rain = currentWeatherData.rain;
        
        if (!forecast || !forecast.today) return '';
        
        const today = forecast.today;
        const temp = rain ? rain.temp : 'N/A';
        const desc = today.report || 'N/A';
        const icon = today.icon || '02';
        
        return `
            <div class="preview-card">
                <div class="preview-card-header">
                    <span class="preview-card-title">实时天气</span>
                </div>
                <div class="realtime-preview">
                    <div>
                        <div class="realtime-temp-large">${temp !== 'N/A' ? temp : '--'}<span class="unit">°C</span></div>
                        <div class="realtime-desc">${cleanDesc(desc)}</div>
                    </div>
                    <img src="${CDN_BASE}/data/icons/${icon}.png" alt="天气" class="realtime-icon">
                </div>
            </div>
        `;
    }

    // 渲染三日预报预览
    function renderForecastPreview() {
        const forecast = currentWeatherData.forecast;
        
        if (!forecast || !forecast.day10 || forecast.day10.length === 0) return '';
        
        let daysHtml = '';
        for (let i = 0; i < 3 && i < forecast.day10.length; i++) {
            const day = forecast.day10[i];
            const dateStr = convertWeekday(day[0]);
            const icon = day[4] || '02';
            const maxT = parseInt(day[2]) || '--';
            const minT = parseInt(day[3]) || '--';
            
            daysHtml += `
                <div class="forecast-day-preview">
                    <div class="forecast-date-preview">${dateStr}</div>
                    <img src="${CDN_BASE}/data/icons/${icon}.png" alt="天气" class="forecast-icon-preview">
                    <div class="forecast-temps-preview">${maxT}° / ${minT}°</div>
                </div>
            `;
        }
        
        return `
            <div class="preview-card">
                <div class="preview-card-header">
                    <span class="preview-card-title">三日预报</span>
                </div>
                <div class="forecast-preview">
                    ${daysHtml}
                </div>
            </div>
        `;
    }

    // 渲染预警信息预览
    function renderWarningPreview() {
        const alarm = currentWeatherData.alarm;
        
        if (!alarm || !alarm.subAlarm || alarm.subAlarm.length === 0) {
            return `
                <div class="preview-card">
                    <div class="preview-card-header">
                        <span class="preview-card-title">预警信息</span>
                    </div>
                    <div class="warning-preview">
                        <span class="no-warning-text">当前无预警信号</span>
                    </div>
                </div>
            `;
        }
        
        const WARNING_LEVEL_PRIORITY = { 'hongse': 5, 'chengse': 4, 'huangse': 3, 'leidian': 3, 'ganhan': 3, 'lanse': 2, 'baisse': 1 };
        let typeBestAlarm = {};
        
        alarm.subAlarm.forEach(alarmItem => {
            let icon = alarmItem.icon || '';
            let level = 0;
            let alarmType = 'unknown';
            for (let key in WARNING_LEVEL_PRIORITY) {
                if (icon.includes(key)) {
                    level = WARNING_LEVEL_PRIORITY[key];
                    alarmType = icon.replace(key, '');
                    break;
                }
            }
            alarmItem._level = level;
            alarmItem._type = alarmType;
            if (!typeBestAlarm[alarmType] || level > typeBestAlarm[alarmType]._level) {
                typeBestAlarm[alarmType] = alarmItem;
            }
        });
        
        let deduped = Object.values(typeBestAlarm).sort((a, b) => b._level - a._level).slice(0, 6);
        
        let iconsHtml = '';
        deduped.forEach(alarmItem => {
            iconsHtml += `<img src="${CDN_BASE}/data/warnings/${alarmItem.icon}.png" title="${alarmItem.str}" class="warning-icon-preview">`;
        });
        
        return `
            <div class="preview-card">
                <div class="preview-card-header">
                    <span class="preview-card-title">预警信息</span>
                </div>
                <div class="warning-preview">
                    ${iconsHtml}
                </div>
            </div>
        `;
    }

    // 渲染降雨预报预览
    function renderRainPreview() {
        const rain = currentWeatherData.rain;
        
        if (!rain || !rain.rain) {
            return `
                <div class="preview-card">
                    <div class="preview-card-header">
                        <span class="preview-card-title">降雨预报</span>
                    </div>
                    <div style="text-align: center; color: var(--dim-color); padding: 20px;">
                        无降雨数据
                    </div>
                </div>
            `;
        }
        
        const rainArr = rain.rain.split(',').map(Number);
        const MAX_BAR_HEIGHT = 90;
        const MAX_RAIN_VALUE = 40;
        
        let barsHtml = '';
        for (let i = 0; i < Math.min(10, rainArr.length); i++) {
            const rainMm = rainArr[i];
            let height = 0;
            if (rainMm > 0) {
                if (rainMm >= MAX_RAIN_VALUE) {
                    height = MAX_BAR_HEIGHT;
                } else {
                    height = Math.round((rainMm / MAX_RAIN_VALUE) * MAX_BAR_HEIGHT);
                }
            }
            const pct = (height / MAX_BAR_HEIGHT) * 100;
            barsHtml += `
                <div class="rain-bar-preview">
                    <div class="rain-bar-fill-preview" style="height: ${pct}%;"></div>
                </div>
            `;
        }
        
        return `
            <div class="preview-card">
                <div class="preview-card-header">
                    <span class="preview-card-title">未来 2 小时降雨</span>
                </div>
                <div class="rain-preview">
                    ${barsHtml}
                </div>
            </div>
        `;
    }

    // 清理天气描述
    function cleanDesc(desc) {
        if (!desc || desc === 'N/A') return 'N/A';
        return desc.replace(/气温[^；]*；/, '').replace(/；。/, '。').replace(/；$/, '').substring(0, 20);
    }

    // 转换星期
    function convertWeekday(s) {
        if (!s || s === 'N/A') return s;
        return s.replace(/星期 ([一二三四五六日])/, '周$1');
    }

    // 生成分享链接
    function generateShareLink() {
        const config = getConfig();
        
        // 验证至少选择一个模块
        if (!Object.values(config.modules).some(v => v)) {
            alert('请至少选择一个数据模块');
            return;
        }
        
        // 编码配置
        const configStr = JSON.stringify(config);
        const encodedConfig = btoa(unescape(encodeURIComponent(configStr)));
        
        // 生成完整 URL
        const baseUrl = window.location.origin + window.location.pathname;
        const shareUrl = `${baseUrl}?share=${encodedConfig}`;
        
        // 显示链接
        $('#shareLinkInput').val(shareUrl);
        $('#linkOutputGroup').slideDown();
        $('#copyLinkBtn').prop('disabled', false);
        
        // 滚动到链接区域
        $('html, body').animate({
            scrollTop: $('#linkOutputGroup').offset().top - 100
        }, 300);
    }

    // 复制链接
    function copyShareLink() {
        const linkInput = $('#shareLinkInput');
        linkInput.select();
        document.execCommand('copy');
        
        // 显示成功提示
        showToast('链接已复制！');
    }

    // 显示 Toast 提示
    function showToast(message) {
        const toast = $('#toast');
        toast.text(message).addClass('show');
        setTimeout(() => {
            toast.removeClass('show');
        }, 2000);
    }

    // 查看模式渲染
    function renderViewMode() {
        updatePreview();
    }

    // 模态框功能（复用主页逻辑）
    const modal = $('#infoModal');
    const modalText = $('#modalText');

    function showModal(text) {
        if (!text || text === 'N/A') return;
        modalText.text(text);
        modal.css('display', 'flex');
    }

    function hideModal() {
        modal.css('display', 'none');
    }

    $('.close-btn').on('click', hideModal);
    $(window).on('click', function(event) {
        if ($(event.target).is(modal)) hideModal();
    });

    // CDN 路径处理
    if (CDN_BASE) {
        $('img').each(function() {
            var src = $(this).attr('src');
            if (!src) return;
            if (src.startsWith('/data/')) {
                $(this).attr('src', CDN_BASE + src);
            } else if (src.startsWith('data/') && !src.startsWith('data:')) {
                $(this).attr('src', CDN_BASE + '/' + src);
            }
        });
    }
});
