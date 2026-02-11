const signAllBtn = document.getElementById("signAll");
const retryFailedBtn = document.getElementById("retryFailed");
const clearRetryBtn = document.getElementById("clearRetryQueue");
const logListEl = document.getElementById("logList");
const progressBar = document.getElementById("progressBar");
const hourInput = document.getElementById("hour");
const minuteInput = document.getElementById("minute");
const saveScheduleBtn = document.getElementById("saveSchedule");
const scheduleInfo = document.getElementById("scheduleInfo");
const retryQueueInfo = document.getElementById("retryQueueInfo");

// 点击立即签到
signAllBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "signAll" }, () => {
    loadLogs();
    setTimeout(loadRetryQueue, 1000); // 稍后加载重试队列
  });
});

// 重试失败贴吧
retryFailedBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "retryFailed" }, () => {
    loadRetryQueue();
  });
});

// 清空重试队列
clearRetryBtn.addEventListener("click", () => {
  if (confirm("确定要清空所有重试任务吗？")) {
    chrome.runtime.sendMessage({ action: "clearRetryQueue" }, () => {
      loadRetryQueue();
    });
  }
});

// 保存定时
saveScheduleBtn.addEventListener("click", () => {
  let hour = parseInt(hourInput.value, 10);
  let minute = parseInt(minuteInput.value, 10);
  if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    alert("请输入正确的时间 (0-23 点, 0-59 分)");
    return;
  }
  chrome.runtime.sendMessage({ action: "setSchedule", schedule: { hour, minute } }, () => {
    scheduleInfo.textContent = `已设置每天 ${hour} 点 ${minute} 分自动签到`;
  });
});

// 加载重试队列
async function loadRetryQueue() {
  chrome.runtime.sendMessage({ action: "getRetryQueue" }, (response) => {
    const retryQueue = response.retryQueue || {};
    const count = Object.keys(retryQueue).length;
    
    if (count === 0) {
      retryQueueInfo.innerHTML = '<p style="color: green;">没有失败的重试任务</p>';
      retryFailedBtn.disabled = true;
    } else {
      let html = `<p>有 <strong>${count}</strong> 个贴吧需要重试：</p><ul>`;
      
      Object.values(retryQueue).forEach(item => {
        const retryTime = new Date(item.retryTime).toLocaleTimeString();
        html += `<li><strong>${item.kw}</strong> - ${item.reason.substring(0, 50)}... (${retryTime})</li>`;
      });
      
      html += '</ul>';
      retryQueueInfo.innerHTML = html;
      retryFailedBtn.disabled = false;
    }
  });
}

// 加载日志
async function loadLogs() {
  let { logs = [] } = await chrome.storage.local.get("logs");
  logListEl.innerHTML = "";
  for (let log of logs) {
    let li = document.createElement("li");
    li.innerHTML = `[${log.time}] <strong>${log.kw}</strong> → `;
    let span = document.createElement("span");
    span.textContent = log.retryCount > 0 ? `[重试${log.retryCount}] ${log.msg}` : log.msg;
    span.className = log.success ? "success" : "fail";
    li.appendChild(span);
    logListEl.appendChild(li);
  }
}

// 监听签到进度
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "updateProgress") {
    let percent = Math.round((msg.current / msg.total) * 100);
    progressBar.style.width = percent + "%";
  }
});

// 初始化
(async function init() {
  loadLogs();
  loadRetryQueue();
  progressBar.style.width = "0%";

  let { schedule } = await chrome.storage.local.get("schedule");
  if (schedule) {
    hourInput.value = schedule.hour;
    minuteInput.value = schedule.minute;
    scheduleInfo.textContent = `已设置每天 ${schedule.hour} 点 ${schedule.minute} 分自动签到`;
  }
})();