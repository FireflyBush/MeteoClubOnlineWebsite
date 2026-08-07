(function() {
    const origGetJSON = $.getJSON;
    const origGetScript = $.getScript;

    // --- 1. 模拟预警数据 ---
    const mockAlarm = {
        subAlarm: [
            { icon: 'taifenglanse', str: '台风蓝色预警信号：24小时内可能或者已经受热带气旋影响，沿海或者陆地平均风力达6级以上，或者阵风8级以上并可能持续。' },
            { icon: 'baoyuhuangse', str: '暴雨黄色预警信号：6小时内降雨量将达50毫米以上，或者已达50毫米以上且降雨可能持续。' },
            { icon: 'baoyuchengse', str: '暴雨橙色预警信号：3小时内降雨量将达50毫米以上，或者已达50毫米以上且降雨可能持续。' },
            { icon: 'leidian', str: '雷电黄色预警信号：6小时内可能发生雷电活动，可能会造成雷电灾害事故。' },
            { icon: 'dizhizaihaihongse', str: '地质灾害红色预警信号：气象因素致地质灾害风险很高。' },
            { icon: 'gaowenhuangse', str: '高温黄色预警信号：连续三天日最高气温将在35℃以上。' },
            { icon: 'leiyudafenghongse', str: '雷雨大风红色预警信号：2小时内受雷雨大风影响，阵风风力达12级以上并伴有强雷电。' }
        ]
    };

    // --- 2. 模拟降雨预报数据 ---
    const now = new Date();
    const pad = n => n.toString().padStart(2, '0');
    const dtStr = `${now.getFullYear()}/${pad(now.getMonth()+1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const mockRain = {
        dataTimeFormat: dtStr,
        rain: "0,1,2,5,8,12,18,25,32,38,35,30,25,20,15,10,6,4,2,1,0,0,0,0,0,0,0,0,0,0"
    };

    // --- 3. 模拟实况数据 ---
    const mockRealtime = {
        result: {
            t: "29.6°C",
            rh: "85%",
            ws: "5m/s",
            describe: "12:00 实况发布"
        }
    };

    // --- 4. 模拟预报数据 ---
    const mockForecast = {
        pubDate: dtStr,
        today: {
            icon: '02',
            minT: '25',
            maxT: '33',
            report: '今天多云间晴天，天气炎热；气温25-33°C；东风3-4级。'
        },
        day10: [
            ['9月1日星期一', '晴天间多云，天气炎热', '26', '33', '01'],
            ['9月2日星期二', '雷阵雨', '24', '30', '05'],
            ['9月3日星期三', '暴雨', '23', '28', '10']
        ]
    };

    // --- 5. 劫持请求并注入数据 ---
    $.getScript = function(url, success) {
        console.log("[模拟] 拦截 getScript:", url);
        if (url.includes('sz10day_new.js')) {
            window.SZ121_10dayWeather = mockForecast;
        } else if (url.includes('szAlarm.js')) {
            window.SZ121_AlarmInfo = mockAlarm;
        }
        if (success) success();
        return { done: function(fn) { fn(); return this; }, fail: function() { return this; } };
    };

    $.getJSON = function(url, success) {
        console.log("[模拟] 拦截 getJSON:", url);
        let mockData = null;
        // 修复点：由于 URL 被编码，包含的是 %2F 而不是 /，所以缩短匹配关键字
        if (url.includes('meteorologicalObt')) {
            mockData = mockRealtime;
        } else if (url.includes('LdService')) {
            mockData = mockRain;
        }
        if (mockData && success) success(mockData);
        return { done: function(fn) { fn(); return this; }, fail: function() { return this; } };
    };

    // --- 6. 触发页面刷新加载模拟数据 ---
    console.log("%c正在注入模拟天气数据...", "color: blue; font-size: 14px;");
    $('#refreshBtn').click();
    
    console.log("%c模拟数据已加载！如需恢复正常请求，请刷新页面。", "color: red; font-size: 14px;");
})();
