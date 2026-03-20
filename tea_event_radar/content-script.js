// ============================================================
// Tea Event Radar — Content Script
// Handles: UI notifications, panel resize, SDK/analytics detection
// ============================================================

// ------------------------------------------------------------
// 1. Message listener (existing functionality preserved)
// ------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "openSidePanel") {
    console.log("收到打开侧边栏的请求");

    // 尝试通过DOM操作或其他方式提示用户
    showNotification("请点击浏览器右侧的侧边栏图标打开插件面板");
    sendResponse({ success: true });
  }
  else if (message.action === "showInPagePanel") {
    console.log("收到显示页面内面板的请求");

    // 检查是否已存在面板
    const existingPanel = document.getElementById('tea-event-radar-panel');
    if (existingPanel) {
      existingPanel.style.display = 'block';
      existingPanel.classList.remove('hidden');
    }

    sendResponse({ success: true });
  }
  else if (message.action === "resizePanel") {
    console.log("收到调整面板宽度的请求:", message.width);

    // 调整页面内面板宽度
    const existingPanel = document.getElementById('tea-event-radar-panel');
    if (existingPanel) {
      existingPanel.style.width = message.width + 'px';
    }

    sendResponse({ success: true });
  }
  return true;
});

// ------------------------------------------------------------
// 2. Toast notification (existing functionality preserved)
// ------------------------------------------------------------
function showNotification(message) {
  // 检查是否已存在通知
  const existingNotification = document.getElementById('tea-event-radar-notification');
  if (existingNotification) {
    existingNotification.remove();
  }

  // 创建通知元素
  const notification = document.createElement("div");
  notification.id = 'tea-event-radar-notification';
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background-color: #4CAF50;
    color: white;
    padding: 16px;
    border-radius: 4px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    z-index: 9999;
    max-width: 300px;
    animation: slideIn 0.3s ease;
  `;

  // 添加动画样式
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes fadeOut {
      from { opacity: 1; }
      to { opacity: 0; }
    }
  `;
  document.head.appendChild(style);

  // 设置通知内容
  notification.innerHTML = `
    <div style="font-weight: bold; margin-bottom: 8px;">Tea Event Radar</div>
    <div>${message}</div>
  `;

  // 添加关闭按钮
  const closeBtn = document.createElement('div');
  closeBtn.style.cssText = `
    position: absolute;
    top: 5px;
    right: 5px;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 14px;
  `;
  closeBtn.innerHTML = '✕';
  closeBtn.addEventListener('click', () => {
    notification.style.animation = 'fadeOut 0.3s ease forwards';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  });

  notification.appendChild(closeBtn);
  document.body.appendChild(notification);

  // 5秒后自动移除通知
  setTimeout(() => {
    if (notification.parentNode) {
      notification.style.animation = 'fadeOut 0.3s ease forwards';
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }
  }, 5000);
}

// ============================================================
// 3. SDK / Analytics Platform Detection
// ============================================================

// --- 3a. Global variable detection (runs in MAIN world) ------
//
// Content scripts run in an isolated world and cannot see page
// globals. We inject a minimal read-only probe into the page's
// MAIN world that checks for known SDK globals and dispatches
// results back via a CustomEvent. The probe self-removes
// immediately and never modifies any page state.

/** Build the MAIN-world probe script source. */
function buildGlobalProbeScript() {
  // This string will execute in the page context.
  // It only reads typeof checks and dispatches a CustomEvent.
  return `
(function() {
  try {
    var detected = [];
    var checks = [
      ['sensorsDataAnalytic201505', 'sensors'],
      ['ga', 'google'],
      ['gtag', 'google'],
      ['dataLayer', 'google'],
      ['_hmt', 'baidu'],
      ['gio', 'growingio'],
      ['gdp', 'growingio'],
      ['mixpanel', 'mixpanel'],
      ['amplitude', 'amplitude'],
      ['_paq', 'matomo'],
      ['plausible', 'plausible'],
      ['umami', 'umami'],
      ['posthog', 'posthog'],
      ['ttq', 'tiktok'],
      ['heap', 'heap'],
      ['hj', 'hotjar'],
      ['_hjSettings', 'hotjar'],
      ['clarity', 'clarity'],
      ['alloy', 'adobe']
    ];
    for (var i = 0; i < checks.length; i++) {
      try {
        var key = checks[i][0], platform = checks[i][1];
        if (typeof window[key] !== 'undefined' && window[key] !== null) {
          if (detected.indexOf(platform) === -1) detected.push(platform);
        }
      } catch(e) {}
    }
    // Adobe AppMeasurement: window.s with tracking methods
    try {
      if (window.s && typeof window.s === 'object' &&
          (typeof window.s.t === 'function' || typeof window.s.tl === 'function' ||
           window.s.version || window.s.account)) {
        if (detected.indexOf('adobe') === -1) detected.push('adobe');
      }
    } catch(e) {}
    // Segment: window.analytics with identify/track/page
    try {
      if (window.analytics && typeof window.analytics === 'object' &&
          typeof window.analytics.identify === 'function' &&
          typeof window.analytics.track === 'function' &&
          typeof window.analytics.page === 'function') {
        if (detected.indexOf('segment') === -1) detected.push('segment');
      }
    } catch(e) {}
    document.dispatchEvent(new CustomEvent('__tea_radar_globals__', {
      detail: JSON.stringify(detected)
    }));
  } catch(e) {}
})();
`;
}

/**
 * Inject the global probe into the MAIN world and listen for results.
 * Returns a Promise that resolves with detected platform IDs.
 */
function detectGlobalVariables() {
  return new Promise(function(resolve) {
    var timeout = setTimeout(function() { resolve([]); }, 3000);

    document.addEventListener('__tea_radar_globals__', function handler(e) {
      document.removeEventListener('__tea_radar_globals__', handler);
      clearTimeout(timeout);
      try {
        resolve(JSON.parse(e.detail));
      } catch (_err) {
        resolve([]);
      }
    }, { once: true });

    try {
      var script = document.createElement('script');
      script.textContent = buildGlobalProbeScript();
      (document.documentElement || document.head || document.body).appendChild(script);
      script.remove(); // Self-clean immediately
    } catch (_e) {
      clearTimeout(timeout);
      resolve([]);
    }
  });
}

// --- 3b. Script tag detection (works from isolated world) ----

/**
 * Detect analytics SDKs by scanning <script src="..."> tags.
 * Returns an array of platform identifier strings.
 */
function detectScriptTags() {
  var detected = [];

  var patterns = [
    [/sensorsdata/i, 'sensors'],
    [/gtag\/js/i, 'google'],
    [/googletagmanager/i, 'google'],
    [/hm\.baidu\.com\/hm\.js/i, 'baidu'],
    [/growingio/i, 'growingio'],
    [/cdn\.mxpnl\.com/i, 'mixpanel'],
    [/mixpanel/i, 'mixpanel'],
    [/cdn\.amplitude\.com/i, 'amplitude'],
    [/cdn\.segment\.com/i, 'segment'],
    [/matomo\.js/i, 'matomo'],
    [/piwik\.js/i, 'matomo'],
    [/plausible\.io\/js\/script/i, 'plausible'],
    [/posthog/i, 'posthog'],
    [/analytics\.tiktok\.com/i, 'tiktok'],
    [/heap-api\.com/i, 'heap'],
    [/static\.hotjar\.com/i, 'hotjar'],
    [/clarity\.ms/i, 'clarity'],
  ];

  try {
    var scripts = document.querySelectorAll('script[src]');
    for (var s = 0; s < scripts.length; s++) {
      var src = scripts[s].src || '';
      for (var p = 0; p < patterns.length; p++) {
        try {
          if (patterns[p][0].test(src) && detected.indexOf(patterns[p][1]) === -1) {
            detected.push(patterns[p][1]);
          }
        } catch (_e) { /* skip */ }
      }
    }

    // Special: script[data-website-id] — Umami signature
    if (document.querySelectorAll('script[data-website-id]').length > 0 &&
        detected.indexOf('umami') === -1) {
      detected.push('umami');
    }
  } catch (_e) { /* skip */ }

  return detected;
}

// --- 3c. Cookie detection (works from isolated world) --------

/**
 * Detect analytics SDKs by checking known cookie name patterns.
 * Returns an array of platform identifier strings.
 */
function detectCookies() {
  var detected = [];

  var cookiePatterns = [
    [/sensorsdata2015/, 'sensors'],
    [/(^|;\s*)_ga=/, 'google'],
    [/Hm_lvt_/, 'baidu'],
    [/grwng_/, 'growingio'],
    [/mp_[^=]*=/, 'mixpanel'],
    [/(^|;\s*)AMP_/, 'amplitude'],
    [/ajs_/, 'segment'],
    [/_pk_id/, 'matomo'],
    [/_hp2_/, 'heap'],
    [/_hjSession/, 'hotjar'],
    [/(^|;\s*)_clck=/, 'clarity'],
    [/(^|;\s*)s_vi=/, 'adobe'],
  ];

  try {
    var cookieStr = document.cookie || '';
    for (var i = 0; i < cookiePatterns.length; i++) {
      try {
        if (cookiePatterns[i][0].test(cookieStr) &&
            detected.indexOf(cookiePatterns[i][1]) === -1) {
          detected.push(cookiePatterns[i][1]);
        }
      } catch (_e) { /* skip */ }
    }
  } catch (_e) { /* skip */ }

  return detected;
}

// --- 3d. Orchestrator: run all methods and report -------------

/**
 * Run all three detection methods, merge results, and send
 * a pageContext message to the background service worker.
 */
function runSDKDetection() {
  try {
    var detectedScripts = detectScriptTags();
    var detectedCookies = detectCookies();

    // Global variable detection is async (MAIN world probe)
    detectGlobalVariables().then(function(detectedGlobals) {
      // Merge into a unified set
      var seen = {};
      var allDetected = [];
      var sources = [].concat(detectedGlobals, detectedScripts, detectedCookies);
      for (var i = 0; i < sources.length; i++) {
        if (!seen[sources[i]]) {
          seen[sources[i]] = true;
          allDetected.push(sources[i]);
        }
      }

      chrome.runtime.sendMessage({
        action: 'pageContext',
        data: {
          detectedSDKs: allDetected,
          detectedScripts: detectedScripts,
          detectedCookies: detectedCookies,
          url: location.href,
        },
      }).catch(function() {
        // Extension context may be invalidated — ignore silently
      });
    });
  } catch (_e) {
    // Ensure detection never breaks the page
  }
}

// ------------------------------------------------------------
// 4. Detection scheduling
// ------------------------------------------------------------

/**
 * Schedule detection after page load using requestIdleCallback
 * (with setTimeout fallback for browsers that lack it).
 */
function scheduleDetection() {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(function() { runSDKDetection(); }, { timeout: 5000 });
  } else {
    setTimeout(runSDKDetection, 1500);
  }
}

// Run on initial page load
if (document.readyState === 'complete') {
  scheduleDetection();
} else {
  window.addEventListener('load', scheduleDetection, { once: true });
}

// Re-detect on SPA navigation events (popstate / hashchange)
window.addEventListener('popstate', function() {
  setTimeout(runSDKDetection, 500);
});
window.addEventListener('hashchange', function() {
  setTimeout(runSDKDetection, 500);
});

// ------------------------------------------------------------
// 5. Startup log
// ------------------------------------------------------------
console.log("Tea Event Radar 内容脚本已加载");
