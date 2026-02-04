// 配置常量：可直接修改，单位【秒】
const WINDOW_DURATION = 40 * 60;    // 滑动时间窗口
const TOTAL_USAGE_LIMIT = 30 * 60; // 窗口内累计使用上限
const REST_DURATION = 10 * 60;     // 强制休息时长

// 样式常量：防沉迷休息样式
const REST_CSS = `
  body::before {
    content: "40分钟内累计使用30分钟，强制休息10分钟！";
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0,0,0,0.95);
    color: #fff;
    font-size: 24px;
    text-align: center;
    line-height: 100vh;
    z-index: 2147483647;
    font-weight: bold;
    display: block !important;
    pointer-events: auto;
  }
  body > * { display: none !important; }
`;

// 样式常量：每日黑屏样式
const BLACKOUT_CSS = `
  body::before {
    content: "当前处于每日黑屏屏蔽时段，请专注于生活！";
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: #000 !important;
    color: #f56c6c;
    font-size: 24px;
    text-align: center;
    line-height: 100vh;
    z-index: 2147483647;
    font-weight: bold;
    display: block !important;
    pointer-events: auto;
  }
  body > * { display: none !important; }
  html { background: #000 !important; }
`;

// 初始化插件状态
chrome.storage.local.get(['monitorStatus', 'remainingSeconds', 'targetSites', 'usageLogs', 'blackoutTimeList'], (result) => {
  const initData = {};
  if (result.monitorStatus === undefined) initData.monitorStatus = 'idle';
  if (result.remainingSeconds === undefined) initData.remainingSeconds = 0;
  if (result.usageLogs === undefined) initData.usageLogs = [];
  chrome.storage.local.set(initData);
});

// 辅助工具：判断当前时间是否在 "HH:mm-HH:mm" 范围内
function isTimeInRange(rangeStr) {
  if (!rangeStr || !rangeStr.includes('-')) return false;
  
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  
  const [startStr, endStr] = rangeStr.split('-');
  const [startH, startM] = startStr.split(':').map(Number);
  const [endH, endM] = endStr.split(':').map(Number);
  
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes <= endMinutes) {
    // 当日时段（如 09:00-12:00）
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  } else {
    // 跨天时段（如 23:00-07:00）
    return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
  }
}

// 核心方法：检测是否处于任何一个黑屏时段
async function checkIsBlackout() {
  const { blackoutTimeList } = await chrome.storage.local.get(['blackoutTimeList']);
  if (!blackoutTimeList || blackoutTimeList.length === 0) return false;
  
  // 只要有一个时段匹配，就返回 true
  return blackoutTimeList.some(range => isTimeInRange(range));
}

// 核心方法：检测是否有目标网站打开
function hasTargetSiteOpen() {
  return new Promise((resolve) => {
    //  修复点：添加 isInBlackout 依赖
    chrome.storage.local.get(['targetSites', 'isInBlackout'], (result) => {
      //  修复点：如果处于黑屏状态，不需要检测目标网站，直接返回 false
      // 这可以避免黑屏时还在后台计算 target
      // 不过，这里其实可以保留检测，关键是 updateTimer 里的逻辑
      const targetSites = result.targetSites || [];
      if (targetSites.length === 0) return resolve(false);

      chrome.tabs.query({}, (tabs) => {
        let hasTarget = false;
        tabs.forEach(tab => {
          if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('about:')) return;
          try {
            const tabDomain = new URL(tab.url).host;
            if (targetSites.includes(tabDomain)) hasTarget = true;
          } catch (e) { /* ignore */ }
        });
        resolve(hasTarget);
      });
    });
  });
}

// 通用样式注入/移除工具
async function updateTabStyles(action, cssContent) {
  // 修改：无论是黑屏模式还是休息模式，现在都只对目标网站（targetSites）生效
  
  const { targetSites } = await chrome.storage.local.get(['targetSites']);
  if (!targetSites || targetSites.length === 0) return;
  
  const allTabs = await chrome.tabs.query({});
  const targetTabs = allTabs.filter(tab => {
    if (!tab.url || tab.id === undefined) return false;
    try {
        const tabDomain = new URL(tab.url).host;
        return targetSites.includes(tabDomain);
    } catch (e) { return false; }
  });

  targetTabs.forEach(async (tab) => {
    try {
        if (action === 'inject') {
          chrome.scripting.insertCSS({
            target: { tabId: tab.id },
            css: cssContent
          }).catch(() => {});
        } else if (action === 'remove') {
          chrome.scripting.removeCSS({
            target: { tabId: tab.id },
            css: cssContent
          }).catch(() => {});
        }
    } catch (e) { /* ignore */ }
  });
}

// 计算窗口内累计使用时间
function calculateTotalUsageInWindow(usageLogs) {
  const now = Date.now(); 
  const windowStart = now - WINDOW_DURATION * 1000; 
  let totalUsage = 0;
  let lastStart = null;

  for (const log of usageLogs) {
    if (log.time < windowStart) continue; 
    if (log.type === 'start' && !lastStart) {
      lastStart = log.time; 
    } else if (log.type === 'stop' && lastStart) {
      totalUsage += Math.floor((log.time - lastStart) / 1000);
      lastStart = null; 
    }
  }

  if (lastStart) {
    totalUsage += Math.floor((now - lastStart) / 1000);
  }
  return totalUsage;
}

// 更新日志
async function updateUsageLog(isTargetOpen) {
  const { usageLogs } = await chrome.storage.local.get(['usageLogs']);
  const now = Date.now();
  const newLogs = [...(usageLogs || [])];
  const lastLog = newLogs[newLogs.length - 1];

  if (isTargetOpen) {
    if (!lastLog || lastLog.type !== 'start') {
      newLogs.push({ type: 'start', time: now });
    }
  } else {
    if (lastLog && lastLog.type === 'start') {
      newLogs.push({ type: 'stop', time: now });
    }
  }
  await chrome.storage.local.set({ usageLogs: newLogs });
  return newLogs;
}

// =======================
// 主逻辑 Loop
// =======================
async function updateTimer() {
  const isBlackout = await checkIsBlackout();
  
  // 同步状态给 popup 
  await chrome.storage.local.set({ isInBlackout: isBlackout });

  // === 分支 A: 处于黑屏时段 ===
  if (isBlackout) {
    // 注入黑屏样式（对所有网站）
    await updateTabStyles('inject', BLACKOUT_CSS);
    // 确保移除休息样式
    await updateTabStyles('remove', REST_CSS);
    
    await chrome.storage.local.set({ 
      monitorStatus: 'blackout',
      remainingSeconds: 0 
    });
    return; 
  }

  // === 分支 B: 非黑屏时段 ===
  // 确保移除黑屏样式（从所有网站）
  await updateTabStyles('remove', BLACKOUT_CSS);

  const storageData = await chrome.storage.local.get([
    'monitorStatus', 'remainingSeconds', 'targetSites', 'usageLogs'
  ]);
  
  let { monitorStatus = 'idle', remainingSeconds = 0, usageLogs = [] } = storageData;
  const { targetSites = [] } = storageData;

  // 如果刚从 blackout 恢复，重置状态为 idle
  if (monitorStatus === 'blackout') {
    monitorStatus = 'idle';
  }

  if (targetSites.length === 0) {
    await chrome.storage.local.set({ monitorStatus: 'idle', remainingSeconds: 0 });
    return;
  }

  // 正常的防沉迷逻辑
  const isTargetOpen = await hasTargetSiteOpen();

  if (monitorStatus === 'idle') {
    // 仍在正常使用配额中
    let newLogs = await updateUsageLog(isTargetOpen);
    const totalUsage = calculateTotalUsageInWindow(newLogs);

    if (totalUsage >= TOTAL_USAGE_LIMIT) {
      // 触发休息
      monitorStatus = 'rest';
      remainingSeconds = REST_DURATION;
      await updateTabStyles('inject', REST_CSS);
    } else {
      // 更新剩余可用时间
      remainingSeconds = TOTAL_USAGE_LIMIT - totalUsage;
    }
  } 
  else if (monitorStatus === 'rest') {
    // 正在被迫休息中
    await updateTabStyles('inject', REST_CSS); 
    
    remainingSeconds--;
    if (remainingSeconds <= 0) {
      // 休息结束
      monitorStatus = 'idle';
      remainingSeconds = 0;
      await chrome.storage.local.set({ usageLogs: [] }); 
      await updateTabStyles('remove', REST_CSS);
    }
  }

  // 保存状态
  await chrome.storage.local.set({
    monitorStatus,
    remainingSeconds
  });
}

// 初始化闹钟
chrome.alarms.clearAll(() => {
  chrome.alarms.create('timerUpdate', { periodInMinutes: 1/60 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'timerUpdate') {
    updateTimer();
  }
});

// 监听消息
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SITES_UPDATED') {
    chrome.storage.local.set({ monitorStatus: 'idle', remainingSeconds: 0, usageLogs: [] });
  } else if (message.type === 'BLACKOUT_UPDATED') {
    updateTimer();
  }
});

// 监听标签页事件
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') updateTimer();
});
chrome.tabs.onActivated.addListener(() => updateTimer());
chrome.tabs.onRemoved.addListener(() => updateTimer());
