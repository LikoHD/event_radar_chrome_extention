importScripts('ab-worker.js');
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
const PAGE_CONTEXT_TTL_MS = 30 * 60 * 1000;

// Filter rules state
let userFilterRules = [];   // { pattern: string, enabled: boolean }
let userWhitelistRules = [];

// 防抖和批量更新相关变量
let updateTimeout = null;
let pendingUpdates = false;
let pageContextCache = {};
let mainWorldProbeConfig = null;

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

/**
 * Check if a URL should be excluded by user-defined filter rules.
 * Returns true if the URL should be BLOCKED (not captured).
 * Whitelist rules override filter rules.
 */
function isUrlFiltered(url) {
  if (!url) return false;

  // Check whitelist first - if matched, always allow
  for (var i = 0; i < userWhitelistRules.length; i++) {
    var rule = userWhitelistRules[i];
    if (!rule.enabled) continue;
    try {
      if (new RegExp(rule.pattern, 'i').test(url)) {
        return false; // Whitelisted, do not filter
      }
    } catch (e) { /* invalid regex, skip */ }
  }

  // Check filter rules - if matched, block
  for (var j = 0; j < userFilterRules.length; j++) {
    var rule2 = userFilterRules[j];
    if (!rule2.enabled) continue;
    try {
      if (new RegExp(rule2.pattern, 'i').test(url)) {
        return true; // Filtered out
      }
    } catch (e) { /* invalid regex, skip */ }
  }

  return false; // Not filtered
}

// Load filter rules from storage at startup
function loadFilterRules() {
  try {
    chrome.storage.local.get(['filterRules', 'whitelistRules'], function(result) {
      userFilterRules = Array.isArray(result.filterRules) ? result.filterRules : [];
      userWhitelistRules = Array.isArray(result.whitelistRules) ? result.whitelistRules : [];
    });
  } catch(e) { /* ignore */ }
}
loadFilterRules();

function getPageContextCacheKey(tabId, frameId, documentId) {
  if (typeof tabId !== 'number' || tabId < 0) {
    return null;
  }
  if (documentId) {
    return tabId + ':' + documentId;
  }
  if (typeof frameId === 'number') {
    return tabId + ':frame:' + frameId;
  }
  return null;
}

function cleanupPageContextCache() {
  var now = Date.now();
  for (var key in pageContextCache) {
    if (!pageContextCache.hasOwnProperty(key)) continue;
    var entry = pageContextCache[key];
    if (!entry || typeof entry.updatedAt !== 'number' || now - entry.updatedAt > PAGE_CONTEXT_TTL_MS) {
      delete pageContextCache[key];
    }
  }
}

function clearPageContextForTab(tabId) {
  for (var key in pageContextCache) {
    if (!pageContextCache.hasOwnProperty(key)) continue;
    if (key.indexOf(tabId + ':') === 0) {
      delete pageContextCache[key];
    }
  }
}

function dedupePlatforms(platforms) {
  var seen = {};
  var result = [];
  if (!Array.isArray(platforms)) return result;

  for (var i = 0; i < platforms.length; i++) {
    var platformId = platforms[i];
    if (!platformId || seen[platformId]) continue;
    seen[platformId] = true;
    result.push(platformId);
  }
  return result;
}

function getMainWorldProbeConfig() {
  if (mainWorldProbeConfig) {
    return mainWorldProbeConfig;
  }

  var globalChecks = [];
  try {
    var platforms = TeaRadar.PlatformCatalog.getAllPlatforms();
    for (var i = 0; i < platforms.length; i++) {
      var hints = platforms[i].identificationHints || {};
      var globalVars = Array.isArray(hints.globalVars) ? hints.globalVars : [];
      for (var j = 0; j < globalVars.length; j++) {
        if (!globalVars[j]) continue;
        globalChecks.push({
          platformId: platforms[i].id,
          globalVar: globalVars[j]
        });
      }
    }
  } catch (e) {
    globalChecks = [];
  }

  mainWorldProbeConfig = {
    globalChecks: globalChecks
  };

  return mainWorldProbeConfig;
}

function probeMainWorldGlobals(config) {
  var detected = [];
  var seen = {};
  var checks = config && Array.isArray(config.globalChecks) ? config.globalChecks : [];

  function pushPlatform(platformId) {
    if (!platformId || seen[platformId]) return;
    seen[platformId] = true;
    detected.push(platformId);
  }

  try {
    for (var i = 0; i < checks.length; i++) {
      var item = checks[i];
      if (!item || !item.globalVar || !item.platformId) continue;
      try {
        if (typeof window[item.globalVar] !== 'undefined' && window[item.globalVar] !== null) {
          pushPlatform(item.platformId);
        }
      } catch (_err) {
        // Skip inaccessible globals silently.
      }
    }

    try {
      if (window.s && typeof window.s === 'object' &&
          (typeof window.s.t === 'function' || typeof window.s.tl === 'function' ||
           window.s.version || window.s.account)) {
        pushPlatform('adobe');
      }
    } catch (_err) {
      // Ignore Adobe special-case errors.
    }

    try {
      if (window.analytics && typeof window.analytics === 'object' &&
          typeof window.analytics.identify === 'function' &&
          typeof window.analytics.track === 'function' &&
          typeof window.analytics.page === 'function') {
        pushPlatform('segment');
      }
    } catch (_err) {
      // Ignore Segment special-case errors.
    }
  } catch (_err) {
    return detected;
  }

  return detected;
}

async function detectMainWorldGlobals(tabId, frameId) {
  if (typeof tabId !== 'number' || tabId < 0 || typeof frameId !== 'number' || frameId < 0) {
    return [];
  }

  try {
    var results = await chrome.scripting.executeScript({
      target: {
        tabId: tabId,
        frameIds: [frameId]
      },
      world: 'MAIN',
      func: probeMainWorldGlobals,
      args: [getMainWorldProbeConfig()]
    });
    if (Array.isArray(results) && results[0] && Array.isArray(results[0].result)) {
      return dedupePlatforms(results[0].result);
    }
  } catch (error) {
    // Some pages/frames may reject main-world execution; fall back to isolated-world signals only.
  }

  return [];
}

async function updatePageContext(message, sender) {
  var tabId = sender && sender.tab ? sender.tab.id : null;
  var frameId = typeof sender.frameId === 'number' ? sender.frameId : 0;
  var documentId = sender && sender.documentId ? sender.documentId : null;
  if (typeof tabId !== 'number' || tabId < 0) {
    return { success: false };
  }

  cleanupPageContextCache();

  var data = message && message.data ? message.data : {};
  var detectedScripts = dedupePlatforms(data.detectedScripts);
  var detectedCookies = dedupePlatforms(data.detectedCookies);
  var detectedGlobals = await detectMainWorldGlobals(tabId, frameId);
  var detectedSDKs = dedupePlatforms(
    detectedGlobals.concat(detectedScripts, detectedCookies)
  );

  var entry = {
    url: data.url || '',
    tabId: tabId,
    frameId: frameId,
    documentId: documentId || undefined,
    detectedGlobals: detectedGlobals,
    detectedScripts: detectedScripts,
    detectedCookies: detectedCookies,
    detectedSDKs: detectedSDKs,
    updatedAt: Date.now()
  };
  var cacheKey = getPageContextCacheKey(tabId, frameId, documentId);
  if (cacheKey) {
    pageContextCache[cacheKey] = entry;
  }

  return {
    success: true,
    detectedSDKs: detectedSDKs
  };
}

function getPageContextForRequest(details) {
  cleanupPageContextCache();

  var tabId = typeof details.tabId === 'number' ? details.tabId : -1;
  var frameId = typeof details.frameId === 'number' ? details.frameId : 0;
  var documentId = details.documentId || null;
  var cacheKey = getPageContextCacheKey(tabId, frameId, documentId);
  if (cacheKey && pageContextCache[cacheKey]) {
    return pageContextCache[cacheKey];
  }

  cacheKey = getPageContextCacheKey(tabId, frameId, null);
  if (cacheKey && pageContextCache[cacheKey]) {
    return pageContextCache[cacheKey];
  }

  return null;
}

// 监听网络请求
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!isCapturing) return;

    if (shouldCapture(details.url, details.method) && !isUrlFiltered(details.url)) {
      try {
        let postedString = '';
        let requestBodyBase64 = '';
        var pageContext = getPageContextForRequest(details);

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
            const bodyBytes = new Uint8Array(requestBody.raw[0].bytes);
            requestBodyBase64 = shouldPreserveBodyBase64(bodyBytes) ? bytesToBase64(bodyBytes) : '';
            try {
              // First try UTF-8 decode
              const decoder = new TextDecoder('utf-8');
              postedString = decoder.decode(bodyBytes);
            } catch (e) {
              try {
                postedString = decodeURIComponent(String.fromCharCode.apply(null, bodyBytes));
              } catch (e2) {
                postedString = String.fromCharCode.apply(null, bodyBytes);
              }
            }
          }
        }

        // 存储请求信息
        const eventData = {
          id: Date.now(),
          requestId: details.requestId,
          timestamp: new Date().toISOString(),
          url: details.url,
          tabId: details.tabId,
          frameId: details.frameId,
          documentId: details.documentId,
          method: details.method,
          requestData: postedString,
          requestBodyBase64: requestBodyBase64,
          headers: null, // 请求头在onSendHeaders中获取
          status: "pending"
        };

        // Platform detection
        try {
          var matchResult = TeaRadar.PlatformAdapters.matchPlatform({
            url: details.url,
            method: details.method,
            bodyRaw: postedString || '',
            bodyBase64: requestBodyBase64 || '',
            headers: [],
            contentType: ''
          }, pageContext);
          eventData.platformId = matchResult.platform;
          eventData.platformConfidence = matchResult.confidence;
          eventData.platformMatchedBy = matchResult.matchedBy;

          // For sensors gzipped payloads, attempt async decode
          if (matchResult.platform === 'sensors' && postedString) {
            trySensorsAsyncDecode(eventData, postedString);
          }

          if (matchResult.platform === 'zhihu' && requestBodyBase64) {
            tryZhihuAsyncDecode(eventData, requestBodyBase64);
          }
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

    if (shouldCapture(details.url, details.method) && !isUrlFiltered(details.url)) {
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

function bytesToBase64(bytes) {
  if (!bytes || !bytes.length) return '';

  var chunkSize = 0x8000;
  var binary = '';
  for (var i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  if (!base64) return new Uint8Array(0);
  var binary = atob(base64);
  var bytes = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i) & 0xFF;
  }
  return bytes;
}

function shouldPreserveBodyBase64(bytes) {
  if (!bytes || !bytes.length) return false;
  if (bytes.length > 2 && bytes[0] === 0x1F && bytes[1] === 0x8B) return true;

  var suspicious = 0;
  var sample = Math.min(bytes.length, 128);
  for (var i = 0; i < sample; i++) {
    var b = bytes[i];
    if (b === 0 || b < 9 || (b > 13 && b < 32)) suspicious++;
  }
  return suspicious / sample >= 0.08;
}

function tryParseEmbeddedJson(text) {
  if (!text || typeof text !== 'string') return null;
  var start = text.indexOf('{');
  if (start === -1) return null;
  for (var end = text.lastIndexOf('}'); end > start; end = text.lastIndexOf('}', end - 1)) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch (e) { /* keep scanning */ }
  }
  return null;
}

function extractZhihuProtoHints(bytes) {
  function readVarint(buf, pos) {
    var result = 0;
    var shift = 0;
    while (pos < buf.length) {
      var b = buf[pos++];
      result += (b & 0x7F) * Math.pow(2, shift);
      if (!(b & 0x80)) break;
      shift += 7;
      if (shift > 56) break;
    }
    return { value: result, pos: pos };
  }

  function parseFields(buf, start, endPos) {
    var entries = [];
    var pos = start || 0;
    var end = endPos == null ? buf.length : endPos;

    while (pos < end && pos < buf.length) {
      var tag = readVarint(buf, pos);
      pos = tag.pos;
      if (tag.value === 0) break;

      var wireType = tag.value & 7;
      if (wireType === 0) {
        var valueVarint = readVarint(buf, pos);
        pos = valueVarint.pos;
        entries.push({ type: 'varint', value: valueVarint.value });
      } else if (wireType === 2) {
        var lenVarint = readVarint(buf, pos);
        pos = lenVarint.pos;
        if (lenVarint.value < 0 || pos + lenVarint.value > buf.length) break;
        entries.push({ type: 'bytes', raw: buf.slice(pos, pos + lenVarint.value) });
        pos += lenVarint.value;
      } else if (wireType === 1) {
        pos += 8;
      } else if (wireType === 5) {
        pos += 4;
      } else {
        break;
      }
    }

    return entries;
  }

  function bytesToUtf8(raw) {
    try { return new TextDecoder('utf-8').decode(raw); } catch (e) { return ''; }
  }

  function normalizeText(text) {
    if (!text || typeof text !== 'string') return '';
    return text.replace(/\u0000/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function isMostlyPrintable(text) {
    if (!text) return false;
    var printable = 0;
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      if ((code >= 32 && code !== 127) || code === 9 || code === 10 || code === 13) printable++;
    }
    return printable / text.length >= 0.85;
  }

  function pushUnique(arr, value, limit) {
    if (!value || arr.indexOf(value) !== -1) return;
    arr.push(value);
    if (limit && arr.length > limit) arr.length = limit;
  }

  function isStableEventName(text) {
    return /^(?:pageview|page_view|[a-z0-9]+(?:_[a-z0-9]+){1,3}|[a-z0-9]+(?:\.[a-z0-9]+){1,4})$/i.test(text) &&
      !/^(?:desktopweb|zhihuweb|gzip|protobuf|api|web|www|zhihu|question|answer|article|search|people|column|pin|zvideo)$/i.test(text);
  }

  function addEntityHintsFromUrl(url, hints) {
    var cleanUrl = normalizeText(url).replace(/[)"'\\\],};]+$/g, '');
    var match = null;
    if (!/^https?:\/\//i.test(cleanUrl)) return;

    try {
      var parsedUrl = new URL(cleanUrl);
      if (!hints.pagePath) hints.pagePath = parsedUrl.pathname || '';
      if (!hints.nextPath) hints.nextPath = parsedUrl.searchParams.get('next') || '';
    } catch (e) { /* ignore invalid url */ }

    if (!hints.pageType && /zhihu\.com\/signin/i.test(cleanUrl)) {
      hints.pageType = 'signin';
    }

    if (!hints.pageType && /zhihu\.com\/signup/i.test(cleanUrl)) {
      hints.pageType = 'signup';
    }

    if (!hints.pageType && /zhihu\.com\/search/i.test(cleanUrl)) {
      hints.pageType = 'search';
    }

    match = cleanUrl.match(/zhihu\.com\/question\/(\d+)(?:\/answer\/(\d+))?/i);
    if (match) {
      hints.pageType = match[2] ? 'answer' : 'question';
      if (!hints.questionId) hints.questionId = match[1];
      if (match[2] && !hints.answerId) hints.answerId = match[2];
      return;
    }

    match = cleanUrl.match(/zhuanlan\.zhihu\.com\/p\/(\d+)/i);
    if (match) {
      if (!hints.pageType) hints.pageType = 'article';
      if (!hints.articleId) hints.articleId = match[1];
      return;
    }

    match = cleanUrl.match(/zhihu\.com\/zvideo\/(\d+)/i);
    if (match) {
      if (!hints.pageType) hints.pageType = 'zvideo';
      if (!hints.zvideoId) hints.zvideoId = match[1];
      return;
    }

    match = cleanUrl.match(/zhihu\.com\/pin\/(\d+)/i);
    if (match) {
      if (!hints.pageType) hints.pageType = 'pin';
      if (!hints.pinId) hints.pinId = match[1];
    }
  }

  function collectStringsFromJson(value, hints) {
    if (value == null) return;
    if (typeof value === 'string') {
      addText(value, hints);
      return;
    }
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i++) collectStringsFromJson(value[i], hints);
      return;
    }
    if (typeof value === 'object') {
      for (var key in value) {
        if (!value.hasOwnProperty(key)) continue;
        if (typeof value[key] === 'string' && key.toLowerCase().indexOf('url') !== -1) {
          var cleanUrl = normalizeText(value[key]).replace(/[)"'\\\],};]+$/g, '');
          pushUnique(hints.urls, cleanUrl, 24);
          addEntityHintsFromUrl(cleanUrl, hints);
        }
        collectStringsFromJson(value[key], hints);
      }
    }
  }

  function addText(text, hints) {
    var clean = normalizeText(text);
    if (!clean || clean.length < 3 || !isMostlyPrintable(clean)) return;

    pushUnique(hints.extractedStrings, clean, 80);
    if (/^https?:\/\//i.test(clean)) {
      var cleanUrl = clean.replace(/[)"'\\\],};]+$/g, '');
      pushUnique(hints.urls, cleanUrl, 24);
      addEntityHintsFromUrl(cleanUrl, hints);
    }
    if (/^[a-z][a-z0-9_.-]{2,}$/i.test(clean) &&
        !/^(desktopweb|zhihuweb|gzip|protobuf|api|web|www)$/i.test(clean)) {
      pushUnique(hints.eventCandidates, clean, 24);
      if (isStableEventName(clean)) {
        pushUnique(hints.stableEventCandidates, clean, 16);
      }
    }

    var embeddedJson = tryParseEmbeddedJson(clean);
    if (embeddedJson) collectStringsFromJson(embeddedJson, hints);
  }

  function collect(raw, hints, depth) {
    if (!raw || !raw.length || depth > 5) return;

    addText(bytesToUtf8(raw), hints);
    var entries = parseFields(raw, 0, raw.length);
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].type === 'bytes') {
        addText(bytesToUtf8(entries[i].raw), hints);
        collect(entries[i].raw, hints, depth + 1);
      }
    }
  }

  var hints = {
    __decodedBy: 'zhihu_gzip_protobuf',
    extractedStrings: [],
    urls: [],
    eventCandidates: [],
    stableEventCandidates: [],
    payloadLength: bytes.length
  };

  collect(bytes, hints, 0);

  for (var i = 0; i < hints.urls.length; i++) {
    if (hints.urls[i].indexOf('zhihu.com') !== -1 &&
        hints.urls[i].indexOf('zhihu-web-analytics.zhihu.com') === -1) {
      hints.pageUrl = hints.urls[i];
      addEntityHintsFromUrl(hints.pageUrl, hints);
      break;
    }
  }

  return hints;
}

// Async decode sensors gzipped payloads and update event requestData
function trySensorsAsyncDecode(eventData, bodyStr) {
  try {
    var formData = TeaRadar.AnalyticsCore.tryParseFormData(bodyStr);
    if (!formData) return;
    var encoded = formData.data_list || formData.data || '';
    if (!encoded || typeof encoded !== 'string') return;

    TeaRadar.AnalyticsCore.decodeSensorsPayloadAsync(encoded).then(function(decoded) {
      if (decoded) {
        // Store the decoded JSON as requestData so the panel can render it
        var items = Array.isArray(decoded) ? decoded : [decoded];
        eventData.requestData = JSON.stringify(items);
        eventData._sensorsDecoded = true;
        debouncedUpdatePanel();
      }
    }).catch(function() { /* ignore async decode failures */ });
  } catch(e) { /* ignore */ }
}

function tryZhihuAsyncDecode(eventData, bodyBase64) {
  try {
    var bytes = base64ToBytes(bodyBase64);
    if (!(bytes.length > 2 && bytes[0] === 0x1F && bytes[1] === 0x8B)) return;
    if (typeof DecompressionStream === 'undefined') return;

    var ds = new DecompressionStream('gzip');
    var blob = new Blob([bytes]);
    var stream = blob.stream().pipeThrough(ds);

    new Response(stream).arrayBuffer().then(function (buffer) {
      var decompressed = new Uint8Array(buffer);
      var hints = extractZhihuProtoHints(decompressed);
      eventData.requestData = JSON.stringify(hints);
      eventData._zhihuDecoded = true;
      debouncedUpdatePanel();
    }).catch(function () { /* ignore zhihu decode failures */ });
  } catch (e) { /* ignore zhihu decode failures */ }
}

// 清理过多的事件
function cleanupEventsIfNeeded() {
  if (capturedEvents.length >= CLEANUP_THRESHOLD) {
    // 保留最新的MAX_EVENTS个事件
    capturedEvents = capturedEvents.slice(0, MAX_EVENTS);
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
  });
}

// 监听来自面板的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action?.startsWith("ab:")) return false;
  if (message.action === 'getPanelWidth') {
    chrome.storage.local.get('panelWidth').then(sendResponse); return true;
  } else if (message.action === 'setPanelWidth') {
    const width = Number(message.width);
    if (Number.isFinite(width)) chrome.storage.local.set({panelWidth: Math.max(280, Math.min(800, width))});
    sendResponse({success: true});
  } else if (message.action === "getEvents") {
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
  } else if (message.action === 'updateFilterRules') {
    userFilterRules = Array.isArray(message.filterRules) ? message.filterRules : [];
    userWhitelistRules = Array.isArray(message.whitelistRules) ? message.whitelistRules : [];
    sendResponse({ success: true });
  } else if (message.action === 'updatePageContext') {
    updatePageContext(message, sender).then(function(result) {
      sendResponse(result);
    }).catch(function() {
      sendResponse({ success: false });
    });
  }
  return true;
});

chrome.tabs.onRemoved.addListener(function(tabId) {
  clearPageContextForTab(tabId);
});

// 当用户点击扩展图标时，直接注入页面内面板
chrome.action.onClicked.addListener(async (tab) => {
  // 确保在有效的标签页上
  if (!tab || !tab.id) {
    return;
  }

  try {
    // 直接注入页面内面板
    await injectInPagePanel(tab.id);
  } catch (error) {
    // 如果注入失败，尝试创建新标签页
    try {
      chrome.tabs.create({ url: "panel.html" });
    } catch (e) {
      // 忽略创建标签页失败
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
      func: createInPagePanel
    });

  } catch (error) {
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
      chrome.runtime.sendMessage({action:'getPanelWidth'}, (result = {}) => {
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

  const saveWidth = (width) => {
    try {
      chrome.runtime.sendMessage({action:'setPanelWidth',width});
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
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', stopResize);
    saveWidth(currentWidth);
  };

  const handleMouseMove = (event) => {
    if (!isDragging) {
      return;
    }

    const deltaX = dragStartX - event.clientX;
    applyWidth(dragStartWidth + deltaX, { persist: false });
    event.preventDefault();
  };

  resizeHandle.addEventListener('mousedown', (event) => {
    if (event.button !== 0) {
      return;
    }

    isDragging = true;
    dragStartX = event.clientX;
    dragStartWidth = currentWidth;

    resizeHandle.classList.add('dragging');
    panelContainer.classList.add('resizing');
    document.body.classList.add('tea-event-radar-panel-resizing');
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', stopResize);

    event.preventDefault();
    event.stopPropagation();
  });
  resizeHandle.addEventListener('dblclick', () => {
    applyWidth(defaultWidth);
  });
  resizeHandle.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });

  window.addEventListener('blur', stopResize);

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
