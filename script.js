// script.js
$(document).ready(function() {
    const CDN_BASE = window.CDN_BASE || "";

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

    const CORS_PROXY = "/api/proxy?url=";
    const BASE_URL_FORECAST = "https://weather.121.com.cn/data_cache/szWeather/sz10day_new.js";
    const BASE_URL_ALARM = "https://weather.121.com.cn/data_cache/szWeather/alarm/szAlarm.js";
    const BASE_URL_RAIN = "https://wx.121.com.cn/Mobile/LdService/position?latitude=22.552188&longitude=114.025106&sign=1e86faea84f8574f155c9e485ed4710e";

    const WARNING_LEVEL_PRIORITY = { 'hongse': 5, 'chengse': 4, 'huangse': 3, 'leidian': 3, 'ganhan': 3, 'lanse': 2, 'baisse': 1 };

    function stripUnits(value) {
        if (!value) return 'N/A';
        const match = String(value).match(/[\d.]+/);
        return match ? match[0] : 'N/A';
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

    function calcHeight(rain_mm) {
        const MAX_BAR_HEIGHT = 90;
        const MAX_RAIN_VALUE = 40;
        if (rain_mm <= 0) return 0;
        if (rain_mm >= MAX_RAIN_VALUE) return MAX_BAR_HEIGHT;
        return Math.round((rain_mm / MAX_RAIN_VALUE) * MAX_BAR_HEIGHT);
    }

    function renderWeatherData(forecast, rainData) {
        try {
            let pubDate = forecast.pubDate || 'N/A';
            let today = forecast.today || {};
            let day10 = forecast.day10 || [];

            let rawDesc = today.report || 'N/A';
            let cleanedDesc = rawDesc.replace(/气温[^；]*；/, '').replace(/；。/, '。').replace(/；$/, '');
            $('#todayDesc').text(cleanedDesc).attr('title', cleanedDesc);
            $('#todayIcon').attr('src', `${CDN_BASE}/data/icons/${today.icon || '02'}.png`).attr('title', cleanedDesc);
            $('#todayRange').html(`${parseInt(today.minT) || 'N/A'} ~ ${parseInt(today.maxT) || 'N/A'}<span class="unit">°C</span>`);
            $('#publishTime').text(`${pubDate} 发布`);

            let daysHtml = '';
            for (let i = 0; i < 3; i++) {
                if (day10[i]) {
                    let d = day10[i];
                    let dateStr = convertWeekday(d[0]);
                    daysHtml += `
                        <div class="day-item">
                            <div class="day-date">${dateStr}</div>
                            <div class="day-info">
                                <img src="${CDN_BASE}/data/icons/${d[4] || '02'}.png" class="day-icon" title="${d[1]}">
                                <div class="day-temps">
                                    <div class="day-max">${parseInt(d[2]) || 'N/A'}<span class="unit">°C</span></div>
                                    <div class="day-min">${parseInt(d[3]) || 'N/A'}<span class="unit">°C</span></div>
                                </div>
                            </div>
                        </div>
                    `;
                }
            }
            $('#forecastDays').html(daysHtml);

            if (rainData) {
                let temp = rainData.temp;
                let hum = rainData.humidity;
                let wind = rainData.wind;
                $('#realtimeTemp').html(`${temp}<span class="unit">°C</span>`);
                $('#observeTime').text(extractObserveTime(rainData.dataTime));
                let appTemp = apparentTemperature(temp, hum, wind);
                $('#apparentTemp').html(`体感值 ${appTemp}<span class="unit">°C</span>`);
            } else {
                $('#realtimeTemp').html(`N/A<span class="unit">°C</span>`);
                $('#observeTime').text('N/A');
                $('#apparentTemp').html(`体感值 N/A<span class="unit">°C</span>`);
            }
        } catch (e) {
            console.error("渲染主数据出错:", e);
        }
    }

    function renderAlarms(alarmData) {
        let count = 0;
        let iconsHtml = '';
        if (alarmData && alarmData.subAlarm && alarmData.subAlarm.length > 0) {
            let deduped = deduplicateAlarms(alarmData.subAlarm);
            count = deduped.length;
            deduped.forEach((alarm) => {
                iconsHtml += `<img src="${CDN_BASE}/data/warnings/${alarm.icon}.png" title="${alarm.str}">`;
            });
        }
        if (count > 0) {
            $('#warningIcons').html(iconsHtml).show();
            $('#noWarnText').hide();
        } else {
            $('#warningIcons').hide();
            $('#noWarnText').show();
        }
    }

    function renderRain(rainData) {
        $('#rainCard').show();
        $('#rainDesc').hide();
        $('#rainBars').empty();
        $('#rainTimeLabels').empty();

        if (!rainData || !rainData.rain) {
            $('#rainDesc').text("无降雨或未联网").show();
            return;
        }

        let rainArr = rainData.rain.split(',').map(Number);
        let heights = rainArr.map(calcHeight);
        let hasRain = Math.max(...heights) > 3;

        if (!hasRain) {
            $('#rainDesc').text(rainData.wlrain || "无降雨").show();
            return;
        }

        let dtStr = rainData.dataTimeFormat;
        let dt = new Date(dtStr.replace(/\//g, '-'));
        let barsHtml = '';
        let labelsHtml = '';
        let keyTimes = {
            start: formatTime(dt),
            t30: formatTime(new Date(dt.getTime() + 30 * 60000)),
            t1h: formatTime(new Date(dt.getTime() + 60 * 60000)),
            t1h30: formatTime(new Date(dt.getTime() + 90 * 60000)),
            t2h: formatTime(new Date(dt.getTime() + 120 * 60000))
        };

        for (let i = 0; i < 30; i++) {
            let w = heights[i] / 90 * 100;
            barsHtml += `<div class="rain-bar-item"><div class="rain-bar-fill" style="--rain-pct: ${w}%;"></div></div>`;
        }
        $('#rainBars').html(barsHtml);

        labelsHtml = `
            <div>${keyTimes.start}</div>
            <div>${keyTimes.t30}</div>
            <div>${keyTimes.t1h}</div>
            <div>${keyTimes.t1h30}</div>
            <div>${keyTimes.t2h}</div>
        `;
        $('#rainTimeLabels').html(labelsHtml);
    }

    function formatTime(date) {
        let h = date.getHours().toString().padStart(2, '0');
        let m = date.getMinutes().toString().padStart(2, '0');
        return `${h}:${m}`;
    }

    function fetchAllData() {
        const ts = new Date().getTime();
        const URL_FORECAST = `${BASE_URL_FORECAST}?_=${ts}`;
        const URL_ALARM = `${BASE_URL_ALARM}?_=${ts}`;
        // 降雨 API 不再加时间戳，由 Edge 缓存控制新鲜度
        const URL_RAIN = CORS_PROXY + encodeURIComponent(BASE_URL_RAIN);

        $.getScript(URL_FORECAST, function() {
            let forecastData = window.SZ121_10dayWeather;
            
            $.getScript(URL_ALARM, function() {
                let alarmData = window.SZ121_AlarmInfo;
                renderAlarms(alarmData);

                $.getJSON(URL_RAIN, function(rainData) {
                    renderWeatherData(forecastData, rainData);
                    renderRain(rainData);
                }).fail(function() {
                    renderWeatherData(forecastData, null);
                    renderRain(null);
                });
                
            }).fail(function() {
                renderAlarms(null);
            });
            
        }).fail(function() {
            console.warn("预报数据获取失败");
        });
    }

    $('#refreshBtn').on('click', fetchAllData);
    fetchAllData();

    // 模态框
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

    $(document).on('click', '#todayIcon', function() { showModal($(this).attr('title')); });
    $(document).on('click', '.day-icon', function() { showModal($(this).attr('title')); });
    $(document).on('click', '.warning-icons img', function() { showModal($(this).attr('title')); });
    $(document).on('click', '.today-desc', function() { showModal($(this).attr('title')); });
});