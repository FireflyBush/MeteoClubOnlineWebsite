(function() {
    const origGetJSON = $.getJSON;
    const origGetScript = $.getScript;

    // --- 1. 模拟预警数据 ---
    const mockAlarm = {
        subAlarm: [
            { icon: 'taifenglanse', str: '台风蓝色预警信号：24小时内可能或者已经受热带气旋影响。' },
            { icon: 'baoyuhuangse', str: '暴雨黄色预警信号：6小时内降雨量将达50毫米以上。' },
            { icon: 'baoyuchengse', str: '暴雨橙色预警信号：3小时内降雨量将达50毫米以上。' },
            { icon: 'leidian', str: '雷电黄色预警信号：6小时内可能发生雷电活动。' },
            { icon: 'dizhizaihaihongse', str: '地质灾害红色预警信号：气象因素致地质灾害风险很高。' },
            { icon: 'gaowenhuangse', str: '高温黄色预警信号：连续三天日最高气温将在35℃以上。' },
            { icon: 'leiyudafenghongse', str: '雷雨大风红色预警信号：2小时内受雷雨大风影响，阵风风力达12级以上。' }
        ]
    };

    // --- 2. 模拟降雨与实况数据 (包含 temp, humidity, wind) ---
    const now = new Date();
    const pad = n => n.toString().padStart(2, '0');
    const dtStr = `${now.getFullYear()}/${pad(now.getMonth()+1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const mockRain = {
        dataTimeFormat: dtStr,
        rain: "0,1,2,5,8,12,18,25,32,38,35,30,25,20,15,10,6,4,2,1,0,0,0,0,0,0,0,0,0,0",
        temp: "29.6",
        humidity: "85",
        wind: "5",
        dataTime: dtStr
    };

    // --- 3. 模拟预报数据 ---
    const mockForecast = {
        pubDate: dtStr,
        today: { icon: '02', minT: '25', maxT: '33', report: '今天多云间晴天，天气炎热；气温25-33°C；东风3-4级。' },
        day10: [
            ['9月1日星期一', '晴天间多云', '26', '33', '01'],
            ['9月2日星期二', '雷阵雨', '24', '30', '05'],
            ['9月3日星期三', '暴雨', '23', '28', '10'],
            ['9月4日星期四', '多云', '24', '31', '02'],
            ['9月5日星期五', '阴', '23', '29', '09'],
            ['9月6日星期六', '晴', '25', '34', '01'],
            ['9月7日星期日', '雷阵雨', '24', '31', '05'],
            ['9月8日星期一', '大雨', '22', '27', '10'],
            ['9月9日星期二', '阴', '23', '28', '09'],
            ['9月10日星期三', '多云', '24', '30', '02']
        ]
    };

    // --- 4. 劫持请求并注入数据 ---
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
        if (url.includes('LdService')) {
            mockData = mockRain;
        }
        if (mockData && success) success(mockData);
        return { done: function(fn) { fn(); return this; }, fail: function() { return this; } };
    };

    // --- 5. 触发分享页重新加载数据 ---
    console.log("%c正在注入模拟天气数据...", "color: blue; font-size: 14px;");
    if (typeof window.loadRealData === 'function') {
        window.loadRealData();
        console.log("%c模拟数据已加载！请查看画布预览。", "color: green; font-size: 14px;");
    } else {
        console.error("未找到 loadRealData 函数，请确保已进入预览或查看模式。");
    }
})();
