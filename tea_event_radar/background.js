// 存储捕获的埋点数据
let capturedEvents = [];
let isCapturing = false;

// 监听网络请求
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!isCapturing) return;
    
    // 只捕获POST请求且URL包含list的请求
    if (details.method === "POST" && details.url.includes("list")) {
      try {
        // 尝试解析请求体
        const requestBody = details.requestBody;
        if (requestBody && requestBody.raw) {
          // 改进的解码方式，更好地处理中文字符
          let postedString;
          try {
            // 首先尝试使用TextDecoder进行UTF-8解码
            const decoder = new TextDecoder('utf-8');
            postedString = decoder.decode(new Uint8Array(requestBody.raw[0].bytes));
          } catch (e) {
            // 如果UTF-8解码失败，回退到原来的方式
            try {
              postedString = decodeURIComponent(String.fromCharCode.apply(null,
                new Uint8Array(requestBody.raw[0].bytes)));
            } catch (e2) {
              // 如果都失败了，直接转换为字符串
              postedString = String.fromCharCode.apply(null,
                new Uint8Array(requestBody.raw[0].bytes));
            }
          }
          
          // 存储请求信息
          const eventData = {
            id: Date.now(),
            timestamp: new Date().toISOString(),
            url: details.url,
            requestData: postedString,
            headers: null, // 请求头在onSendHeaders中获取
            status: "pending"
          };
          
          capturedEvents.push(eventData); // 新事件放在数组末尾，最新事件显示在列表底部
          
          // 通知面板更新
          updatePanel();
        }
      } catch (error) {
        
      }
    }
  },
  { urls: ["<all_urls>"] },
  ["requestBody"]
);

// 获取请求头信息
chrome.webRequest.onSendHeaders.addListener(
  (details) => {
    if (!isCapturing) return;
    
    if (details.method === "POST" && details.url.includes("list")) {
      // 查找匹配的请求并添加头信息
      const event = capturedEvents.find(e => e.url === details.url && !e.headers);
      if (event) {
        event.headers = details.requestHeaders;
        updatePanel();
      }
    }
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders"]
);

// 更新请求状态
chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.method === "POST" && details.url.includes("list")) {
      // 查找匹配的请求并更新状态
      const event = capturedEvents.find(e => e.url === details.url && e.status === "pending");
      if (event) {
        event.status = details.statusCode;
        event.statusText = details.statusLine;
        updatePanel();
      }
    }
  },
  { urls: ["<all_urls>"] }
);

// 更新侧边栏面板
function updatePanel() {
  chrome.runtime.sendMessage({
    action: "updateEvents",
    events: capturedEvents
  });
}

// 监听来自面板的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getEvents") {
    sendResponse({ events: capturedEvents });
  } else if (message.action === "clearEvents") {
    capturedEvents = [];
    updatePanel();
    sendResponse({ success: true });
  } else if (message.action === "startCapturing") {
    isCapturing = true;
    sendResponse({ success: true, isCapturing });
  } else if (message.action === "stopCapturing") {
    isCapturing = false;
    sendResponse({ success: true, isCapturing });
  } else if (message.action === "getStatus") {
    sendResponse({ isCapturing });
  }
  return true;
});

// 当用户点击扩展图标时，打开侧边栏
chrome.action.onClicked.addListener((tab) => {
  // 检查sidePanel API是否可用
  if (chrome.sidePanel && chrome.sidePanel.open) {
    chrome.sidePanel.open({ tabId: tab.id });
  }
});

// 初始化侧边栏 - 使用try-catch防止在不支持的浏览器版本上报错
try {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
} catch (error) {
  // 忽略设置侧边栏行为失败
} 