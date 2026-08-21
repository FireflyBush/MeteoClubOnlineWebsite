// script_10d.js —— 十天预报逻辑
$(document).ready(function() {
    const CDN_BASE = window.CDN_BASE || "";

    // ==========================================
    // 工具函数
    // ==========================================
    
    // 星期 → 周；今天/明天保持原样
    function convertWeekday(s) {
        if (!s) return '';
        if (s === '今天' || s === '明天') return s;
        return s.replace(/星期([一二三四五六日])/, '周$1');
    }

    // 解析连在一起的日期字符串
    // 例如 "8月8日今天" → {date: "8月8日", week: "今天"}
    // 例如 "8月12日星期三" → {date: "8月12日", week: "周三"}
    function parseDateStr(s) {
        var match = s.match(/(.+?)(今天|明天|星期[一二三四五六日])$/);
        if (match) {
            return {
                date: match[1],
                week: convertWeekday(match[2])
            };
        }
        return { date: s, week: '' };
    }

    // ==========================================
    // 渲染十天预报
    // ==========================================
    function render10Days(forecast) {
        var day10 = forecast.day10 || [];
        if (day10.length === 0) {
            $('#loadingStatus').text('暂无预报数据').show();
            return;
        }

        $('#publishInfo').text((forecast.pubDate || 'N/A') + ' 发布');

        var allTemps = [];
        day10.forEach(function(d) {
            var maxT = parseInt(d[2]);
            var minT = parseInt(d[3]);
            if (!isNaN(maxT)) allTemps.push(maxT);
            if (!isNaN(minT)) allTemps.push(minT);
        });
        var globalMin = Math.min.apply(null, allTemps);
        var globalMax = Math.max.apply(null, allTemps);
        var globalRange = globalMax - globalMin || 1;

        var html = '';
        day10.forEach(function(d) {
            var dateInfo = parseDateStr(d[0]);
            var weather = d[1] || 'N/A';
            var maxT = parseInt(d[2]);
            var minT = parseInt(d[3]);
            var icon = d[4] || '02';

            var maxStr = isNaN(maxT) ? '--' : maxT;
            var minStr = isNaN(minT) ? '--' : minT;

            var barLeft = 0, barWidth = 0;
            if (!isNaN(minT) && !isNaN(maxT)) {
                barLeft = ((minT - globalMin) / globalRange) * 100;
                barWidth = ((maxT - minT) / globalRange) * 100;
                if (barWidth < 6) barWidth = 6;
            }

            html +=
                '<div class="day-row">' +
                    '<div class="day-info-left">' +
                        '<div class="date">' + dateInfo.date + '</div>' +
                        '<div class="weekday">' + dateInfo.week + '</div>' +
                    '</div>' +
                    '<img class="day-icon-10d" src="' + CDN_BASE + '/data/icons/' + icon + '.png" alt="' + weather + '" title="' + weather + '" loading="lazy">' +
                    '<div class="day-weather-text">' + weather + '</div>' +
                    '<div class="day-temp-range">' +
                        '<div class="temp-min">' + minStr + '°</div>' +
                        '<div class="temp-bar-track">' +
                            '<div class="temp-bar-fill" style="left:' + barLeft.toFixed(1) + '%;width:' + barWidth.toFixed(1) + '%;"></div>' +
                        '</div>' +
                        '<div class="temp-max">' + maxStr + '°</div>' +
                    '</div>' +
                '</div>';
        });

        $('#loadingStatus').hide();
        $('#forecast10Days').html(html).show();
    }

    // ==========================================
    // 模态框交互
    // ==========================================
    var modal = $('#infoModal');
    var modalText = $('#modalText');

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

    $(document).on('click', '.day-icon-10d', function() {
        showModal($(this).attr('title'));
    });

    // ==========================================
    // 数据获取
    // ==========================================
    var URL_FORECAST = 'https://weather.121.com.cn/data_cache/szWeather/sz10day_new.js?_=' + Date.now();

    $.getScript(URL_FORECAST)
        .done(function() {
            var data = window.SZ121_10dayWeather;
            if (data && data.day10 && data.day10.length > 0) {
                render10Days(data);
            } else {
                $('#loadingStatus').text('数据格式异常，请稍后重试');
            }
        })
        .fail(function() {
            $('#loadingStatus').text('获取预报数据失败，请检查网络连接');
        });
});