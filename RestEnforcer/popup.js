document.addEventListener('DOMContentLoaded', () => {
  // 获取所有页面元素（原有+新增）
  const siteListText = document.getElementById('siteList');
  const saveBtn = document.getElementById('saveBtn');
  const blackoutTimes = document.getElementById('blackoutTimes');
  const saveBlackoutBtn = document.getElementById('saveBlackoutBtn');
  const currentStatus = document.getElementById('currentStatus');
  const remainingTime = document.getElementById('remainingTime');

  // 设置 Placeholder（使用 JS 设置可以完美支持换行）
  siteListText.placeholder = '请输入需要监督的网站，一行一个\n示例：\nwww.bilibili.com\nwww.xiaohongshu.com';
  blackoutTimes.placeholder = '请输入每日黑屏时段，一行一个\n格式：小时:分钟-小时:分钟\n示例：\n23:00-07:00\n12:00-14:00';

  // 1. 从本地存储读取数据并回显（原有网站列表+新增黑屏时段）
  chrome.storage.local.get(['targetSites', 'blackoutTimeList'], (result) => {
    // 回显目标网站列表
    if (result.targetSites && result.targetSites.length > 0) {
      siteListText.value = result.targetSites.join('\n');
    }
    // 回显黑屏时段列表
    if (result.blackoutTimeList && result.blackoutTimeList.length > 0) {
      blackoutTimes.value = result.blackoutTimeList.join('\n');
    }
  });

  // 2. 原有功能：保存目标网站列表
  saveBtn.addEventListener('click', () => {
    const inputValue = siteListText.value.trim();
    let targetSites = [];
    if (inputValue) {
      targetSites = inputValue.split('\n').map(s => s.trim()).filter(s => s);
    }
    chrome.storage.local.set({ targetSites }, () => {
      alert('网站列表保存成功！');
      chrome.runtime.sendMessage({ type: 'SITES_UPDATED' });
    });
  });

  // 新增核心：3. 保存黑屏时段（含格式校验、去重、过滤空行）
  saveBlackoutBtn.addEventListener('click', () => {
    const inputValue = blackoutTimes.value.trim();
    let blackoutTimeList = [];
    const timeReg = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/; // 时段格式校验正则（00:00-23:59）

    if (inputValue) {
      blackoutTimeList = inputValue.split('\n')
        .map(time => time.trim())
        .filter(time => time) // 过滤空行
        .filter(time => {
          // 格式校验，不符合的提示并过滤
          if (!timeReg.test(time)) {
            alert(`时段${time}格式错误！请按 小时:分钟-小时:分钟 填写（如23:00-07:00）`);
            return false;
          }
          return true;
        });
    }

    // 保存到本地存储并提示
    chrome.storage.local.set({ blackoutTimeList }, () => {
      alert('黑屏时段保存成功！立即生效');
      chrome.runtime.sendMessage({ type: 'BLACKOUT_UPDATED' }); // 通知后台时段更新
    });
  });

  // 新增核心：4. 检测是否处于黑屏时段，若是则禁用所有输入框和按钮
  function checkBlackoutStatus() {
    chrome.storage.local.get(['isInBlackout'], (result) => {
      const isBlackout = result.isInBlackout || false;
      // 黑屏时段：禁用所有输入和按钮，添加提示
      if (isBlackout) {
        siteListText.disabled = true;
        saveBtn.disabled = true;
        blackoutTimes.disabled = true;
        saveBlackoutBtn.disabled = true;
        siteListText.placeholder = '当前处于黑屏时段，禁止修改设置';
        blackoutTimes.placeholder = '当前处于黑屏时段，禁止修改设置';
        currentStatus.textContent = '当前处于每日黑屏屏蔽时段';
        currentStatus.style.color = '#f56c6c';
        remainingTime.textContent = '——';
      } else {
        // 非黑屏时段：启用所有输入和按钮，恢复原有占位符
        siteListText.disabled = false;
        saveBtn.disabled = false;
        blackoutTimes.disabled = false;
        saveBlackoutBtn.disabled = false;
        siteListText.placeholder = '请输入需要监督的网站，一行一个，eg：\nwww.bilibili.com\nwww.xiaohongshu.com';
        blackoutTimes.placeholder = '请输入每日黑屏时段，一行一个，eg：\n23:00-07:00\n12:00-14:00';
      }
    });
  }

  // 5. 原有功能：更新计时状态（黑屏时段内会被上面的逻辑覆盖）
  function updateStatus() {
    // 先检测黑屏状态，非黑屏才更新计时状态
    chrome.storage.local.get(['isInBlackout', 'monitorStatus', 'remainingSeconds'], (result) => {
      if (result.isInBlackout) return; // 黑屏时段跳过计时状态更新

      const status = result.monitorStatus || 'idle';
      const seconds = result.remainingSeconds || 0;
      const min = Math.floor(seconds / 60).toString().padStart(2, '0');
      const sec = (seconds % 60).toString().padStart(2, '0');
      remainingTime.textContent = `${min}:${sec}`;

      switch (status) {
        case 'running':
          currentStatus.textContent = '正在使用目标网站（计时中）';
          currentStatus.style.color = '#409eff';
          break;
        case 'rest':
          currentStatus.textContent = '已达时长，强制休息中';
          currentStatus.style.color = '#f5f56c6c';
          break;
        default:
          currentStatus.textContent = '未检测到目标网站';
          currentStatus.style.color = '#67c23a';
          break;
      }
    });
  }

  // 初始化执行+实时更新（每秒）
  checkBlackoutStatus();
  updateStatus();
  setInterval(() => {
    checkBlackoutStatus();
    updateStatus();
  }, 1000);
});