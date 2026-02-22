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

  const windows = await chrome.windows.getAll({ populate: true });
  let hasTarget = false;
  const targetTabs = [];

  for (const win of windows) {
    if (!win.focused) continue;
    
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

// 注入剩余时间提醒 (1分钟)
async function injectReminder(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // 创建提示框
        const div = document.createElement('div');
        div.textContent = "⚠️ 注意：剩余时间仅剩 1 分钟";
        div.style.cssText = `
          position: fixed;
          top: 20px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(255, 69, 0, 0.9);
          color: white;
          padding: 12px 24px;
          border-radius: 8px;
          font-size: 16px;
          font-weight: bold;
          z-index: 2147483647;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          pointer-events: none;
          transition: opacity 0.5s ease;
          opacity: 0;
        `;
        document.body.appendChild(div);

        // 动画效果
        requestAnimationFrame(() => {
          div.style.opacity = '1';
        });

        // 5秒后自动消失
        setTimeout(() => {
          div.style.opacity = '0';
          setTimeout(() => div.remove(), 500);
        }, 5000);
      }
    });
  } catch (e) { console.error("Failed to inject reminder", e); }
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

// 注入非侵入式提醒 (Toast)
async function injectReminder(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // 防止重复注入
        if (document.getElementById('rest-enforcer-toast')) return;

        const toast = document.createElement('div');
        toast.id = 'rest-enforcer-toast';
        toast.textContent = '⏱️ 剩余时间 1 分钟，即将进入休息时间。';
        
        // 样式设置
        Object.assign(toast.style, {
          position: 'fixed',
          top: '20px',
          right: '50%', // 居中显示更显眼
          transform: 'translateX(50%) translateY(-100px)',
          zIndex: '2147483647',
          padding: '12px 24px',
          backgroundColor: 'rgba(50, 50, 50, 0.95)',
          color: '#fff',
          borderRadius: '8px',
          fontSize: '16px',
          fontWeight: '500',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          pointerEvents: 'none', // 不影响点击
          transition: 'transform 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.5s ease',
          opacity: '0'
        });

        document.body.appendChild(toast);

        // 进场动画
        requestAnimationFrame(() => {
          toast.style.transform = 'translateX(50%) translateY(0)';
          toast.style.opacity = '1';
        });

        // 5秒后消失
        setTimeout(() => {
          if (toast) {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(50%) translateY(-20px)';
            setTimeout(() => toast.remove(), 500);
          }
        }, 5000);
      }
    });
  } catch (e) { console.error("Failed to inject reminder", e); }
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
    'monitorStatus', 'remainingSeconds', 'targetSites', 'usageLogs', 'currentSession', 'restEndTime'
  ]);
  
  let { monitorStatus = 'idle', remainingSeconds = 0, usageLogs = [], currentSession, restEndTime } = storageData;
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

  // DEBUG LOG
  console.log(`[Timer] Status: ${monitorStatus}, Remaining: ${remainingSeconds}, HasTarget: ${hasTarget}, RestKey: ${restEndTime}`);

  // --- 优先级调整：如果由于防沉迷（Usage Limit）或 Session 耗尽导致处于 REST 状态，
  // 应优先执行 Rest 逻辑，而不是先检查 Session 是否存在。
  if (monitorStatus === 'rest') {
    const now = Date.now();

    // 如果 restEndTime 不存在，或者 remainingSeconds 看起来是满的（REST_DURATION），重新初始化
    // 强制修正：如果 remainingSeconds 是 undefined 或者 null，默认为 REST_DURATION
    if (typeof remainingSeconds !== 'number') remainingSeconds = REST_DURATION;

    // 关键修正：如果 restEndTime 无效，或者比现在早很多（异常过期），我们需要重置它
    // 逻辑：如果 restEndTime 不存在，我们根据 remainingSeconds 算出 restEndTime
    if (!restEndTime || typeof restEndTime !== 'number') {
        // 使用 remainingSeconds 计算；如果是 0 或负数，重置为 REST_DURATION
        const secondsToRest = (remainingSeconds > 0) ? remainingSeconds : REST_DURATION;
        restEndTime = now + (secondsToRest * 1000);
        console.log(`[Rest] Initializing restEndTime to ${new Date(restEndTime).toLocaleTimeString()}`);
        await chrome.storage.local.set({ restEndTime });
    }

    if (hasTarget) {
      // 用户正在看目标网页 -> 暂停/推迟休息结束时间
      // 将 restEndTime 推迟到 "从现在起 remainingSeconds 秒后"
      // 这里的 remainingSeconds 应该是 "实际上还要休息多久"
      // 但为了简单，每秒钟如果看着网页，就把 restEndTime 设为 now + remainingSeconds
      
      // 读取当前的剩余时间（从上次存储）
      // 如果这个剩余时间很小（比如已经是0了），就会导致问题。
      // 但进入这里理论上 remainingSeconds > 0
      
      restEndTime = now + (remainingSeconds * 1000);
      console.log(`[Rest] Target open, pausing. Pushing end time to ${new Date(restEndTime).toLocaleTimeString()}`);

      // 强制覆盖样式
      await updateTabStyles('inject', REST_CSS);
      
      // 保存状态（这里存储 remainingSeconds 没变，restEndTime 变了）
      await chrome.storage.local.set({ 
          restEndTime,
          // 确保 monitorStatus 还是 rest
          monitorStatus: 'rest'
      });
      
    } else {
      // 用户没看网页 -> 正常倒计时
      // 计算新的剩余时间
      let left = Math.ceil((restEndTime - now) / 1000);
      console.log(`[Rest] Counting down... Left: ${left}s`);
      
      if (left < 0) left = 0;
      remainingSeconds = left;
      
      // 只有剩余时间真的变了或者需要更新状态时才 set
      // 但是为了 popup 看着在动，必须更新 remainingSeconds
      
      if (remainingSeconds <= 0) {
        console.log(`[Rest] Finished! Resetting to idle.`);
        monitorStatus = 'idle';
        remainingSeconds = 0;
        await chrome.storage.local.remove(['restEndTime']);
        await updateTabStyles('remove', REST_CSS);
        await chrome.storage.local.set({ 
            monitorStatus: 'idle', 
            remainingSeconds: 0,
            currentSession: null 
        });
      } else {
         // 正常更新剩余时间
         await chrome.storage.local.set({ 
             monitorStatus: 'rest',
             remainingSeconds,
             restEndTime // 保持原来的 restEndTime
         });
      }
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

  // === 剩余 1 分钟提醒 ===
  const sessionLeftSeconds = sessionLimit - sessionElapsed;
  if (sessionLeftSeconds <= 60 && sessionLeftSeconds > 0 && !currentSession.reminderShown) {
    for (const tab of targetTabs) {
      injectReminder(tab.id);
    }
    currentSession.reminderShown = true;
    await chrome.storage.local.set({ currentSession });
  }

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

    // 检查是否仅剩 1 分钟 (60秒)，并且从未提醒过
    if (sessionLeft <= 60 && sessionLeft > 0 && !currentSession.hasReminded) {
        // 触发提醒
        for (const tab of targetTabs) {
            injectReminder(tab.id);
        }
        // 标记已提醒
        currentSession.hasReminded = true;
        // 更新 Session 状态
        await chrome.storage.local.set({ currentSession });
    }
      
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
            startTime: Date.now(),
            hasReminded: false
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
