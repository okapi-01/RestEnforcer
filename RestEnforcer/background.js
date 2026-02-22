// 配置常量：可直接修改，单位【秒】
const WINDOW_DURATION = 50 * 60;    // 滑动时间窗口
const TOTAL_USAGE_LIMIT = 40 * 60; // 窗口内累计使用上限
const REST_DURATION = 10 * 60;     // 强制休息时长

// 样式常量：防沉迷休息样式
const REST_CSS = `
  body::before {
    content: "屏幕使用时间过长，强制休息10分钟！";
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
chrome.storage.local.get(['monitorStatus', 'remainingSeconds', 'targetSites', 'usageLogs', 'blackoutTimeList', 'currentSession'], (result) => {
  const initData = {};
  if (result.monitorStatus === undefined) initData.monitorStatus = 'idle';
  if (result.remainingSeconds === undefined) initData.remainingSeconds = 0;
  if (result.usageLogs === undefined) initData.usageLogs = [];
  if (result.currentSession === undefined) initData.currentSession = null;
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
async function hasTargetSiteOpen() {
  const result = await chrome.storage.local.get(['targetSites', 'isInBlackout']);
  const targetSites = result.targetSites || [];
  
  if (targetSites.length === 0) return { hasTarget: false, targetTabs: [] };

  // 检查窗口是否聚焦，并在聚焦窗口中查找激活的标签页
  const windows = await chrome.windows.getAll({ populate: true });
  let hasTarget = false;
  const targetTabs = [];

  for (const win of windows) {
    // 必须是当前聚焦的窗口
    if (!win.focused) continue;
    
    // 找到该窗口中的激活标签页
    const activeTab = win.tabs.find(t => t.active);
    if (!activeTab) continue;

    if (!activeTab.url || activeTab.url.startsWith('chrome://') || activeTab.url.startsWith('about:')) continue;
    try {
      const tabDomain = new URL(activeTab.url).host;
      if (targetSites.includes(tabDomain)) {
        hasTarget = true;
        targetTabs.push(activeTab);
      }
    } catch (e) { /* ignore */ }
  }
  
  return { hasTarget, targetTabs };
}

// 注入 Intent Prompt
async function injectSessionPrompt(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content_script.js']
    });
  } catch (e) { console.error("Failed to inject prompt", e); }
}

// 移除 Intent Prompt
async function removeSessionPrompt(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const overlay = document.getElementById('rest-enforcer-prompt-overlay');
        const style = document.getElementById('rest-enforcer-styles');
        if (overlay) overlay.remove();
        if (style) style.remove();
        document.body.style.overflow = '';
      }
    });
  } catch (e) { console.error("Failed to remove prompt", e); }
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
      remainingSeconds: 0,
      currentSession: null
    });
    return; 
  }

  // === 分支 B: 非黑屏时段 ===
  // 确保移除黑屏样式（从所有网站）
  await updateTabStyles('remove', BLACKOUT_CSS);

  const storageData = await chrome.storage.local.get([
    'monitorStatus', 'remainingSeconds', 'targetSites', 'usageLogs', 'currentSession'
  ]);
  
  let { monitorStatus = 'idle', remainingSeconds = 0, usageLogs = [], currentSession } = storageData;
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
  const { hasTarget, targetTabs } = await hasTargetSiteOpen();

  // --- 优先级调整：如果由于防沉迷（Usage Limit）或 Session 耗尽导致处于 REST 状态，
  // 应优先执行 Rest 逻辑，而不是先检查 Session 是否存在。
  if (monitorStatus === 'rest') {
    let { restEndTime } = storageData;
    // 如果没有 restEndTime，说明是刚进入休息或者旧数据，初始化它
    if (!restEndTime) {
      restEndTime = Date.now() + (remainingSeconds * 1000);
      await chrome.storage.local.set({ restEndTime });
    }

    if (hasTarget) {
      // 只要目标网站打开，我们就“暂停”倒计时。
      // 具体做法是：把 restEndTime 往后推，使得 (restEndTime - Now) 保持不变。
      // 或者是直接重置 restEndTime = Now + remainingSeconds。
      
      // 此处逻辑：每过一秒(或者updateTimer调用一次)，如果不推迟，时间就流逝了。
      // 为了暂停，我们需要把“流逝的时间”补回来，或者简单粗暴地重置 restEndTime。
      
      // 注意：remainingSeconds 在这里是上次存储的值。
      // 我们重新计算 restEndTime，确保它相对于现在依然有 remainingSeconds 那么久。
      restEndTime = Date.now() + (remainingSeconds * 1000);
      
      // 同时确保注入 CSS
      await updateTabStyles('inject', REST_CSS);
    } else {
      // 目标网站关闭了，正常流逝。
      // 不修改 restEndTime，只更新 remainingSeconds。
      // 这样如果电脑休眠，Date.now() 会跳变，remainingSeconds 也会瞬间减少。
      const now = Date.now();
      const left = Math.ceil((restEndTime - now) / 1000);
      remainingSeconds = left; 
    }

    // 检查是否结束
    if (remainingSeconds <= 0) {
      monitorStatus = 'idle';
      remainingSeconds = 0;
      await chrome.storage.local.remove(['restEndTime']);
      await updateTabStyles('remove', REST_CSS);
    } else {
      // 更新存储
      // 注意：如果 hasTarget 为 true，我们推迟了 restEndTime，需要保存新的 restEndTime
      await chrome.storage.local.set({ 
        monitorStatus, 
        remainingSeconds,
        restEndTime 
      });
    }
    
    return;
  }
  // ---

  // 如果没有目标网站打开，不进行任何计时或阻拦
  if (!hasTarget) {
      // 只要没有打开，就当做停止使用
      await updateUsageLog(false);
      return; 
  }

  // 如果有目标网站打开，检查是否有 currentSession
  if (!currentSession) {

      // 状态：等待输入
      // 阻断页面，注入 prompt
      for (const tab of targetTabs) {
          await injectSessionPrompt(tab.id);
      }
      
      // 不计入使用时间 (传递 false)
      await updateUsageLog(false);
      return;
  }

  // 有 Session，检查是否过期
  const now = Date.now();
  const sessionElapsed = (now - currentSession.startTime) / 1000;
  const sessionLimit = currentSession.duration * 60;

  // 如果 session 结束了，强制休息
  if (sessionElapsed >= sessionLimit) {
      // 触发强制休息模式
      const restEndTime = Date.now() + (REST_DURATION * 1000);
      monitorStatus = 'rest';
      remainingSeconds = REST_DURATION;
      await updateTabStyles('inject', REST_CSS);
      // 清除 Session 并保存 REST 状态
      await chrome.storage.local.set({ 
          monitorStatus: 'rest', 
          remainingSeconds: REST_DURATION, 
          restEndTime: restEndTime,
          currentSession: null 
      });
      return;
  }

  // Session 有效，进入正常计时逻辑
  
  // 确保移除 Prompt
  for (const tab of targetTabs) {
      await removeSessionPrompt(tab.id);
  }

  // 此时 monitorStatus 可能是 idle 或 rest
  if (monitorStatus === 'idle') {
    // 仍在正常使用配额中
    // 即使不限制总时长，我们依然记录使用日志以备将来分析（可选）
    await updateUsageLog(true);
    
    // 更新剩余可用时间
    // 只依赖当前 session 的剩余时间
    const sessionLeft = Math.floor(Math.max(0, sessionLimit - sessionElapsed));
    remainingSeconds = sessionLeft;
      
    // 如果 session 结束了
    if (sessionLeft <= 0) {
        // 根据用户需求： session 结束 -> 强制休息
        const restEndTime = Date.now() + (REST_DURATION * 1000);
        monitorStatus = 'rest';
        remainingSeconds = REST_DURATION;
        await updateTabStyles('inject', REST_CSS);
        await chrome.storage.local.set({ 
            monitorStatus: 'rest', 
            remainingSeconds: REST_DURATION, 
            restEndTime: restEndTime,
            currentSession: null 
        });
        return;
    }
  } 
  // else if (monitorStatus === 'rest') block is removed as it's handled at the top

  
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
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SITES_UPDATED') {
    chrome.storage.local.set({ monitorStatus: 'idle', remainingSeconds: 0, usageLogs: [] });
  } else if (message.type === 'BLACKOUT_UPDATED') {
    updateTimer();
  } else if (message.type === 'START_SESSION') {
    const { intent, duration } = message.payload;
    // 重置 usageLogs 吗？根据需求 "The session limit will be min(user_duration, TOTAL_USAGE_LIMIT)"
    // 如果用户开始新session，可能希望重新计算? 
    // 不，usage limit 是 "TOTAL_USAGE_LIMIT" (Window Duration)，是防沉迷总额度。
    // 所以 session 是在总额度内的子任务。
    
    chrome.storage.local.set({
        currentSession: {
            intent,
            duration,
            startTime: Date.now()
        }
    }, () => {
        sendResponse({ success: true });
        updateTimer();
    });
    return true; // Keep channel open for async response
  }
});

// 监听标签页事件
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') updateTimer();
});
chrome.tabs.onActivated.addListener(() => updateTimer());
chrome.tabs.onRemoved.addListener(() => updateTimer());
