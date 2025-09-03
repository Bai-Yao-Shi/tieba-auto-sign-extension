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
async function signOneTieba(kw) {
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
      return { kw, success: true, msg: "签到成功" };
    } else if (json && json.no === 1101) {
      return { kw, success: true, msg: "已签到" };
    } else if (json && json.no === 1102) {
      return { kw, success: false, msg: "签得太快，稍后再试" };
    } else {
      return { kw, success: false, msg: "签到失败: " + JSON.stringify(json) };
    }
  } catch (err) {
    return { kw, success: false, msg: "网络错误: " + err };
  }
}

// 记录日志
async function logResult(res) {
  let { logs = [] } = await chrome.storage.local.get("logs");
  logs.unshift({
    time: new Date().toLocaleString(),
    kw: res.kw,
    success: res.success,
    msg: res.msg
  });
  if (logs.length > 100) logs = logs.slice(0, 100);
  await chrome.storage.local.set({ logs });
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
  }
});

// 初始化时读取定时任务
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get("schedule", ({ schedule }) => {
    if (schedule) {
      setupAlarm(schedule);
    }
  });
});
