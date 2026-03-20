// Load multi-platform detection modules
importScripts('analytics-core.js');
importScripts('platform-catalog.js');
importScripts('platform-adapters.js');

// 存储捕获的埋点数据
let capturedEvents = [];
let isCapturing = false;

// 性能优化配置
const MAX_EVENTS = 1000; // 最大事件数量
const CLEANUP_THRESHOLD = 1200; // 清理阈值
const UPDATE_DEBOUNCE_TIME = 100; // 更新防抖时间(ms)

// 防抖和批量更新相关变量
let updateTimeout = null;
let pendingUpdates = false;

// =========================================================================
// URL pre-filter: only capture requests that match known platform patterns
// =========================================================================

// Build lookup sets from PlatformCatalog at startup
var _knownHosts = null;
var _knownPaths = null;

function buildPlatformIndex() {
  if (_knownHosts !== null) return;
  _knownHosts = [];
  _knownPaths = [];
  try {
    var platforms = TeaRadar.PlatformCatalog.getAllPlatforms();
    for (var i = 0; i < platforms.length; i++) {
      var hints = platforms[i].identificationHints;
      if (hints.hosts) {
        for (var h = 0; h < hints.hosts.length; h++) {
          if (hints.hosts[h]) _knownHosts.push(hints.hosts[h]);
        }
      }
      if (hints.paths) {
        for (var p = 0; p < hints.paths.length; p++) {
          if (hints.paths[p]) _knownPaths.push(hints.paths[p]);
        }
      }
    }
  } catch (e) {
    // If catalog unavailable, fall back to empty lists (will capture nothing via pre-filter)
  }
}

/**
 * Quick pre-filter: returns true if the request looks like an analytics request
 * from any known platform. Allows both POST and GET (e.g. Baidu hm.gif).
 *
 * @param {string} url
 * @param {string} method
 * @returns {boolean}
 */
function shouldCapture(url, method) {
  if (!url) return false;

  buildPlatformIndex();

  try {
    var parsed = new URL(url);
    var hostname = parsed.hostname;
    var pathname = parsed.pathname;

    // Check known hosts
    for (var h = 0; h < _knownHosts.length; h++) {
      var host = _knownHosts[h];
      if (hostname === host || hostname.endsWith('.' + host) || hostname.indexOf(host) !== -1) {
        return true;
      }
    }

    // Check known paths
    for (var p = 0; p < _knownPaths.length; p++) {
      if (pathname.indexOf(_knownPaths[p]) !== -1) {
        return true;
      }
    }
  } catch (e) {
    // Invalid URL
  }

  return false;
}

// 监听网络请求
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!isCapturing) return;

    if (shouldCapture(details.url, details.method)) {
      try {
        let postedString = '';

        if (details.method === 'GET') {
          // For GET requests, use URL query string as request data
          try {
            postedString = new URL(details.url).search || '';
          } catch (e) {
            postedString = '';
          }
        } else {
          // Decode POST request body
          const requestBody = details.requestBody;
          if (requestBody && requestBody.raw && requestBody.raw[0] && requestBody.raw[0].bytes) {
            try {
              // First try UTF-8 decode
              const decoder = new TextDecoder('utf-8');
              postedString = decoder.decode(new Uint8Array(requestBody.raw[0].bytes));
            } catch (e) {
              try {
                postedString = decodeURIComponent(String.fromCharCode.apply(null,
                  new Uint8Array(requestBody.raw[0].bytes)));
              } catch (e2) {
                postedString = String.fromCharCode.apply(null,
                  new Uint8Array(requestBody.raw[0].bytes));
              }
            }
          }
        }

        // 存储请求信息
        const eventData = {
          id: Date.now(),
          timestamp: new Date().toISOString(),
          url: details.url,
          method: details.method,
          requestData: postedString,
          headers: null, // 请求头在onSendHeaders中获取
          status: "pending"
        };

        // Platform detection
        try {
          var matchResult = TeaRadar.PlatformAdapters.matchPlatform({
            url: details.url,
            method: details.method,
            bodyRaw: postedString || '',
            headers: [],
            contentType: ''
          });
          eventData.platformId = matchResult.platform;
          eventData.platformConfidence = matchResult.confidence;
          eventData.platformMatchedBy = matchResult.matchedBy;
        } catch(e) {
          eventData.platformId = 'unknown';
          eventData.platformConfidence = 0;
          eventData.platformMatchedBy = [];
        }

        capturedEvents.unshift(eventData); // 新事件放在前面

        // 检查并清理过多的事件
        cleanupEventsIfNeeded();

        // 防抖更新面板
        debouncedUpdatePanel();
      } catch (error) {
        // Ignore capture errors
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

    if (shouldCapture(details.url, details.method)) {
      // 查找匹配的请求并添加头信息
      const event = capturedEvents.find(e => e.url === details.url && !e.headers);
      if (event) {
        event.headers = details.requestHeaders;
        debouncedUpdatePanel();
      }
    }
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders"]
);

// 更新请求状态
chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (shouldCapture(details.url, details.method)) {
      // 查找匹配的请求并更新状态
      const event = capturedEvents.find(e => e.url === details.url && e.status === "pending");
      if (event) {
        event.status = details.statusCode;
        event.statusText = details.statusLine;
        debouncedUpdatePanel();
      }
    }
  },
  { urls: ["<all_urls>"] }
);

// 清理过多的事件
function cleanupEventsIfNeeded() {
  if (capturedEvents.length >= CLEANUP_THRESHOLD) {
    // 保留最新的MAX_EVENTS个事件
    capturedEvents = capturedEvents.slice(0, MAX_EVENTS);
    console.log(`事件数量已清理，当前保留 ${capturedEvents.length} 个事件`);
  }
}

// 防抖更新面板
function debouncedUpdatePanel() {
  if (updateTimeout) {
    clearTimeout(updateTimeout);
  }

  pendingUpdates = true;
  updateTimeout = setTimeout(() => {
    if (pendingUpdates) {
      updatePanel();
      pendingUpdates = false;
    }
  }, UPDATE_DEBOUNCE_TIME);
}

// 更新侧边栏面板
function updatePanel() {
  chrome.runtime.sendMessage({
    action: "updateEvents",
    events: capturedEvents
  }).catch(error => {
    // 忽略消息传递错误
    console.debug("面板更新消息发送失败，可能面板未打开", error);
  });
}

// 监听来自面板的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getEvents") {
    sendResponse({ events: capturedEvents });
  } else if (message.action === "clearEvents") {
    capturedEvents = [];
    debouncedUpdatePanel();
    sendResponse({ success: true });
  } else if (message.action === "startCapturing") {
    isCapturing = true;
    sendResponse({ success: true, isCapturing });
  } else if (message.action === "stopCapturing") {
    isCapturing = false;
    sendResponse({ success: true, isCapturing });
  } else if (message.action === "getStatus") {
    sendResponse({ isCapturing });
  } else if (message.action === "resizePanel") {
    // 调整面板宽度
    resizeInPagePanel(message.width, sender && sender.tab ? sender.tab.id : null);
    sendResponse({ success: true });
  }
  return true;
});

// 当用户点击扩展图标时，直接注入页面内面板
chrome.action.onClicked.addListener(async (tab) => {
  // 确保在有效的标签页上
  if (!tab || !tab.id) {
    console.error("无效的标签页");
    return;
  }

  try {
    // 直接注入页面内面板
    await injectInPagePanel(tab.id);
  } catch (error) {
    console.error("注入页面内面板失败:", error);
    // 如果注入失败，尝试创建新标签页
    try {
      chrome.tabs.create({ url: "panel.html" });
    } catch (e) {
      console.error("创建标签页失败:", e);
    }
  }
});

// 注入页面内面板
async function injectInPagePanel(tabId) {
  try {
    // 注入CSS
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["in-page-panel.css"]
    });

    // 注入HTML和JS
    await chrome.scripting.executeScript({
      target: { tabId },
      function: createInPagePanel
    });

    console.log("页面内面板已注入");
  } catch (error) {
    console.error("注入页面内面板失败:", error);
    throw error;
  }
}

// 创建页面内面板的函数
function createInPagePanel() {
  const PANEL_ID = 'tea-event-radar-panel';
  const WIDTH_STORAGE_KEY = 'panelWidth';
  const RESIZE_HANDLE_CLASS = 'tea-event-radar-resize-handle';
  const FRAME_MESSAGE_SOURCE = 'tea-event-radar-panel-frame';
  const minWidth = 320;
  const maxWidth = 800;
  const defaultWidth = 400;

  const clampWidth = (width) => {
    const viewportMaxWidth = Math.max(minWidth, window.innerWidth - 80);
    return Math.max(minWidth, Math.min(Math.min(maxWidth, viewportMaxWidth), Math.round(width)));
  };

  const restoreSavedWidth = (onWidthReady) => {
    try {
      chrome.storage.local.get([WIDTH_STORAGE_KEY], (result) => {
        const savedWidth = typeof result[WIDTH_STORAGE_KEY] === 'number'
          ? result[WIDTH_STORAGE_KEY]
          : defaultWidth;
        onWidthReady(clampWidth(savedWidth));
      });
    } catch (error) {
      onWidthReady(defaultWidth);
    }
  };

  // 检查是否已存在面板
  const existingPanel = document.getElementById(PANEL_ID);
  if (existingPanel) {
    existingPanel.style.display = 'block';
    existingPanel.classList.remove('hidden');
    restoreSavedWidth((width) => {
      existingPanel.style.width = width + 'px';
    });
    return;
  }

  // 创建面板容器
  const panelContainer = document.createElement('div');
  panelContainer.id = PANEL_ID;
  panelContainer.style.cssText = `
    position: fixed;
    top: 0;
    right: 0;
    width: ${defaultWidth}px;
    height: 100vh;
    background-color: #fff;
    box-shadow: -2px 0 10px rgba(0, 0, 0, 0.1);
    z-index: 9999999;
    border-left: 1px solid #ddd;
    display: flex;
    flex-direction: column;
  `;

  let currentWidth = defaultWidth;
  let isDragging = false;
  let dragStartX = 0;
  let dragStartWidth = defaultWidth;
  let activePointerId = null;

  const saveWidth = (width) => {
    try {
      chrome.storage.local.set({ [WIDTH_STORAGE_KEY]: width });
    } catch (error) {
      // 忽略存储错误，避免影响面板拖拽
    }
  };

  const applyWidth = (width, options = {}) => {
    const nextWidth = clampWidth(width);
    currentWidth = nextWidth;
    panelContainer.style.width = nextWidth + 'px';

    if (options.persist !== false) {
      saveWidth(nextWidth);
    }
  };

  // 创建iframe加载面板
  const iframe = document.createElement('iframe');
  iframe.src = chrome.runtime.getURL('panel.html');
  iframe.className = 'tea-event-radar-panel-frame';
  iframe.style.cssText = `
    width: 100%;
    height: 100%;
    border: none;
    overflow: hidden;
  `;

  // 创建拉伸手柄，直接挂在宿主页面，避免鼠标离开 iframe 后丢失拖拽事件
  const resizeHandle = document.createElement('div');
  resizeHandle.className = RESIZE_HANDLE_CLASS;
  resizeHandle.title = '拖拽调整宽度，双击恢复默认宽度';

  const stopResize = () => {
    if (!isDragging) {
      return;
    }

    isDragging = false;
    resizeHandle.classList.remove('dragging');
    panelContainer.classList.remove('resizing');
    document.body.classList.remove('tea-event-radar-panel-resizing');

    if (
      resizeHandle.releasePointerCapture &&
      activePointerId !== null &&
      resizeHandle.hasPointerCapture &&
      resizeHandle.hasPointerCapture(activePointerId)
    ) {
      resizeHandle.releasePointerCapture(activePointerId);
    }

    activePointerId = null;
    saveWidth(currentWidth);
  };

  resizeHandle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }

    isDragging = true;
    dragStartX = event.clientX;
    dragStartWidth = currentWidth;
    activePointerId = event.pointerId;

    resizeHandle.classList.add('dragging');
    panelContainer.classList.add('resizing');
    document.body.classList.add('tea-event-radar-panel-resizing');

    if (resizeHandle.setPointerCapture) {
      resizeHandle.setPointerCapture(activePointerId);
    }

    event.preventDefault();
    event.stopPropagation();
  });

  resizeHandle.addEventListener('pointermove', (event) => {
    if (!isDragging) {
      return;
    }

    const deltaX = dragStartX - event.clientX;
    applyWidth(dragStartWidth + deltaX, { persist: false });
    event.preventDefault();
  });

  resizeHandle.addEventListener('pointerup', stopResize);
  resizeHandle.addEventListener('pointercancel', stopResize);
  resizeHandle.addEventListener('lostpointercapture', stopResize);
  resizeHandle.addEventListener('dblclick', () => {
    applyWidth(defaultWidth);
  });
  resizeHandle.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });

  window.addEventListener('message', (event) => {
    if (event.source !== iframe.contentWindow) {
      return;
    }

    const data = event.data;
    if (!data || data.source !== FRAME_MESSAGE_SOURCE) {
      return;
    }

    if (data.action === 'resizePanel' && typeof data.width === 'number') {
      applyWidth(data.width);
    }
  });

  window.addEventListener('resize', () => {
    applyWidth(currentWidth, { persist: false });
  });

  // 创建关闭按钮
  const closeBtn = document.createElement('div');
  closeBtn.className = 'tea-event-radar-close-btn';
  closeBtn.innerHTML = '✕';
  closeBtn.addEventListener('click', () => {
    panelContainer.classList.add('hidden');
    setTimeout(() => {
      panelContainer.style.display = 'none';
    }, 300);
  });

  // 添加到面板
  panelContainer.appendChild(resizeHandle);
  panelContainer.appendChild(iframe);
  panelContainer.appendChild(closeBtn);

  // 添加到页面
  document.body.appendChild(panelContainer);

  restoreSavedWidth((width) => {
    applyWidth(width, { persist: false });
  });
}

// 初始化扩展
function initializeExtension() {
  console.log("Tea Event Radar 服务工作者已启动");
  // Pre-build platform index on startup
  buildPlatformIndex();
}

// 防抖变量
let resizeTimeout = null;
let lastResizeWidth = null;

// 调整页面内面板宽度（防抖优化）
function resizeInPagePanel(width, targetTabId = null) {
  // 如果宽度没有变化，直接返回
  if (lastResizeWidth === width) {
    return;
  }

  // 清除之前的延时调用
  if (resizeTimeout) {
    clearTimeout(resizeTimeout);
  }

  // 使用防抖机制，减少频繁调用
  resizeTimeout = setTimeout(() => {
    lastResizeWidth = width;

    if (targetTabId) {
      chrome.tabs.sendMessage(targetTabId, {
        action: 'resizePanel',
        width: width
      }).catch(() => {
        // 忽略消息发送失败的情况（标签页可能没有注入面板）
      });
      return;
    }

    // 兜底：向所有标签页发送调整宽度的消息
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          action: 'resizePanel',
          width: width
        }).catch(() => {
          // 忽略消息发送失败的情况（标签页可能没有注入面板）
        });
      });
    });
  }, 10); // 10ms防抖延迟
}

// 启动初始化
initializeExtension();
