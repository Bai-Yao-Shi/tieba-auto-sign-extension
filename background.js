function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 获取关注贴吧列表
async function fetchTiebas() {
  let res = await fetch("https://tieba.baidu.com/mo/q/newmoindex", {
    credentials: "include"
  });
  let data = await res.json();
  if (!data.data || !data.data.like_forum) {
    return [];
  }
  return data.data.like_forum.map(f => f.forum_name);
}

// 签到单个贴吧
async function signOneTieba(kw, retryCount = 0) {
  let formData = new FormData();
  formData.append("ie", "utf-8");
  formData.append("kw", kw);

  try {
    let res = await fetch("https://tieba.baidu.com/sign/add", {
      method: "POST",
      body: formData,
      credentials: "include",
      headers: {
        "User-Agent": navigator.userAgent,
        "Referer": "https://tieba.baidu.com/",
        "X-Requested-With": "XMLHttpRequest",
        "Accept": "application/json, text/javascript, */*; q=0.01",
      }
    });
    let json = await res.json();

    if (json && json.no === 0) {
      return { kw, success: true, msg: "签到成功", retryCount };
    } else if (json && json.no === 1101) {
      return { kw, success: true, msg: "已签到", retryCount };
    } else if (json && json.no === 1102) {
      return { kw, success: false, msg: "签得太快，稍后再试", retryCount, needsRetry: true };
    } else if (json && json.no === 2150040 || json.no === 2150041) {
      // 验证码错误
      return { kw, success: false, msg: "需要验证码", retryCount, needsRetry: true };
    } else {
      return { kw, success: false, msg: "签到失败: " + JSON.stringify(json), retryCount, needsRetry: true };
    }
  } catch (err) {
    const errMsg = err.toString();
    let needsRetry = false;
    
    // 判断是否需要重试的网络错误
    if (errMsg.includes("Failed to fetch") || 
        errMsg.includes("NetworkError") || 
        errMsg.includes("Network request failed")) {
      needsRetry = true;
    }
    
    return { 
      kw, 
      success: false, 
      msg: "网络错误: " + errMsg, 
      retryCount, 
      needsRetry 
    };
  }
}

// 记录日志
async function logResult(res) {
  let { logs = [] } = await chrome.storage.local.get("logs");
  logs.unshift({
    time: new Date().toLocaleString(),
    kw: res.kw,
    success: res.success,
    msg: res.msg,
    retryCount: res.retryCount || 0
  });
  if (logs.length > 100) logs = logs.slice(0, 100);
  await chrome.storage.local.set({ logs });
}

// 将失败任务添加到重试队列
async function addToRetryQueue(kw, reason = "未知错误") {
  const now = Date.now();
  const retryTime = now + 60 * 60 * 1000; // 1小时后重试
  
  let { retryQueue = {} } = await chrome.storage.local.get("retryQueue");
  
  retryQueue[kw] = {
    kw,
    reason,
    addedTime: now,
    retryTime: retryTime,
    retryCount: (retryQueue[kw]?.retryCount || 0) + 1
  };
  
  await chrome.storage.local.set({ retryQueue });
  
  // 确保重试定时器运行
  await ensureRetryAlarm();
  
  console.log(`已将 ${kw} 添加到重试队列，将于 ${new Date(retryTime).toLocaleTimeString()} 重试`);
}

// 从重试队列移除
async function removeFromRetryQueue(kw) {
  let { retryQueue = {} } = await chrome.storage.local.get("retryQueue");
  delete retryQueue[kw];
  await chrome.storage.local.set({ retryQueue });
}

// 确保重试定时器运行
async function ensureRetryAlarm() {
  let { retryQueue = {} } = await chrome.storage.local.get("retryQueue");
  
  if (Object.keys(retryQueue).length === 0) {
    chrome.alarms.clear("retrySign");
    return;
  }
  
  // 找到最早需要重试的时间
  const earliestRetry = Math.min(...Object.values(retryQueue).map(item => item.retryTime));
  
  chrome.alarms.clear("retrySign", () => {
    chrome.alarms.create("retrySign", { when: earliestRetry });
  });
}

// 处理重试队列
async function processRetryQueue() {
  const now = Date.now();
  let { retryQueue = {} } = await chrome.storage.local.get("retryQueue");
  
  // 找出需要重试的任务（重试时间已到且重试次数小于3次）
  const toRetry = Object.values(retryQueue).filter(item => 
    item.retryTime <= now && item.retryCount < 3
  );
  
  if (toRetry.length === 0) {
    await ensureRetryAlarm();
    return;
  }
  
  console.log(`开始重试 ${toRetry.length} 个失败贴吧`);
  
  for (let item of toRetry) {
    console.log(`重试贴吧: ${item.kw}，之前失败原因: ${item.reason}，第 ${item.retryCount} 次重试`);
    
    let res = await signOneTieba(item.kw, item.retryCount);
    await logResult(res);
    
    if (res.success) {
      // 重试成功，从队列移除
      await removeFromRetryQueue(item.kw);
      console.log(`贴吧 ${item.kw} 重试成功`);
    } else if (res.needsRetry && item.retryCount < 2) {
      // 需要再次重试，更新重试时间（1小时后）
      await addToRetryQueue(item.kw, res.msg);
    } else {
      // 重试次数已达上限或不需要重试，从队列移除
      await removeFromRetryQueue(item.kw);
      console.log(`贴吧 ${item.kw} 重试失败，已达到最大重试次数`);
    }
    
    // 重试间隔
    await sleep(3000 + Math.random() * 2000);
  }
  
  await ensureRetryAlarm();
}

// 签到所有贴吧，并逐个延时
async function signAll() {
  let tiebas = await fetchTiebas();
  let results = [];

  for (let i = 0; i < tiebas.length; i++) {
    let kw = tiebas[i];
    let res = await signOneTieba(kw);
    results.push(res);
    await logResult(res);
    
    // 如果签到失败且需要重试，添加到重试队列
    if (!res.success && res.needsRetry) {
      await addToRetryQueue(kw, res.msg);
    } else if (res.success) {
      // 如果签到成功，确保从重试队列移除（如果有的话）
      await removeFromRetryQueue(kw);
    }

    // 每次签到后延时 2s ~ 3s
    let delay = 2000 + Math.random() * 1000;
    await sleep(delay);

    // 发送进度给 popup
    chrome.runtime.sendMessage({ action: "updateProgress", current: i + 1, total: tiebas.length });
  }

  return results;
}

// 监听 popup 消息
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "signAll") {
    signAll().then(results => sendResponse({ results }));
    return true;
  }
  if (msg.action === "setSchedule") {
    chrome.storage.local.set({ schedule: msg.schedule }, () => {
      setupAlarm(msg.schedule);
      sendResponse({ success: true });
    });
    return true;
  }
  if (msg.action === "getRetryQueue") {
    chrome.storage.local.get("retryQueue", ({ retryQueue = {} }) => {
      sendResponse({ retryQueue });
    });
    return true;
  }
  if (msg.action === "clearRetryQueue") {
    chrome.storage.local.set({ retryQueue: {} }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
  if (msg.action === "retryFailed") {
    processRetryQueue().then(() => {
      sendResponse({ success: true });
    });
    return true;
  }
});

// 创建或更新定时任务
function setupAlarm(schedule) {
  chrome.alarms.clear("dailySign", () => {
    if (!schedule || schedule.hour === undefined || schedule.minute === undefined) return;
    let now = new Date();
    let firstTime = new Date();
    firstTime.setHours(schedule.hour, schedule.minute, 0, 0);
    if (firstTime <= now) {
      firstTime.setDate(firstTime.getDate() + 1);
    }
    chrome.alarms.create("dailySign", { when: firstTime.getTime(), periodInMinutes: 1440 });
  });
}

// 监听定时任务
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === "dailySign") {
    signAll();
  } else if (alarm.name === "retrySign") {
    processRetryQueue();
  }
});

// 初始化时读取定时任务和设置重试检查
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get("schedule", ({ schedule }) => {
    if (schedule) {
      setupAlarm(schedule);
    }
  });
  
  // 设置每5分钟检查一次重试队列
  chrome.alarms.create("checkRetry", { periodInMinutes: 5 });
});