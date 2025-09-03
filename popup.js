const signAllBtn = document.getElementById("signAll");
const logListEl = document.getElementById("logList");
const progressBar = document.getElementById("progressBar");
const hourInput = document.getElementById("hour");
const minuteInput = document.getElementById("minute");
const saveScheduleBtn = document.getElementById("saveSchedule");
const scheduleInfo = document.getElementById("scheduleInfo");

// 点击立即签到
signAllBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "signAll" }, response => {
    loadLogs();
  });
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

// 加载日志
async function loadLogs() {
  let { logs = [] } = await chrome.storage.local.get("logs");
  logListEl.innerHTML = "";
  for (let log of logs) {
    let li = document.createElement("li");
    li.innerHTML = `[${log.time}] <strong>${log.kw}</strong> → `;
    let span = document.createElement("span");
    span.textContent = log.msg;
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
  progressBar.style.width = "0%";

  let { schedule } = await chrome.storage.local.get("schedule");
  if (schedule) {
    hourInput.value = schedule.hour;
    minuteInput.value = schedule.minute;
    scheduleInfo.textContent = `已设置每天 ${schedule.hour} 点 ${schedule.minute} 分自动签到`;
  }
})();
