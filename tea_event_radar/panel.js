// DOM元素
const toggleBtn = document.getElementById('toggleBtn');
const toggleIcon = document.getElementById('toggleIcon');
const toggleText = document.getElementById('toggleText');
const clearBtn = document.getElementById('clearBtn');
const downloadBtn = document.getElementById('downloadBtn');
const searchInput = document.getElementById('searchInput');
const searchTags = document.getElementById('searchTags');
const filterMode = document.getElementById('filterMode');
const platformFilterWrapper = document.getElementById('platformFilterWrapper');
const platformFilterTrigger = document.getElementById('platformFilterTrigger');
const platformFilterMenu = document.getElementById('platformFilterMenu');
const eventCount = document.getElementById('eventCount');
const noEvents = document.getElementById('noEvents');
const eventsList = document.getElementById('eventsList');
const resizeHandle = document.querySelector('.resize-handle');

// 存储所有事件数据
let allEvents = [];
let isCapturing = false;
let searchKeywords = []; // 存储搜索关键词
let currentFilterMode = 'include'; // 当前过滤模式
let currentPlatformFilter = '__known__'; // 当前平台过滤，默认仅显示已知平台

// 性能优化配置
const RENDER_DEBOUNCE_TIME = 50; // 渲染防抖时间(ms)
const SEARCH_DEBOUNCE_TIME = 200; // 搜索防抖时间(ms)
const MAX_VISIBLE_EVENTS = 100; // 最大可见事件数量

// 防抖和性能优化变量
let renderTimeout = null;
let searchTimeout = null;
let isRendering = false;
let pendingRenderEvents = null; // 队列：渲染期间到达的最新事件

// 拖拽调整宽度相关变量
let isDragging = false;
let startX = 0;
let startWidth = 0;
let currentWidth = 400; // 当前宽度
let lastUpdateTime = 0; // 上次更新时间，用于防抖
let resizePointerId = null; // 当前拖拽指针ID
const minWidth = 280; // 最小宽度
const maxWidth = 800; // 最大宽度
const defaultWidth = 400; // 默认宽度
const UPDATE_THROTTLE = 16; // 更新节流，约60fps
const isEmbeddedPanel = window.top !== window;

// 添加解码函数来处理中文字符乱码
function decodeChineseText(text) {
  if (typeof text !== 'string') {
    return text;
  }

  try {

    if (text.includes('%')) {
      try {
        const decoded = decodeURIComponent(text);
        if (decoded !== text && !decoded.includes('�')) {
          return decoded;
        }
      } catch (e) {
      }
    }

    if (/[àáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ]/.test(text)) {
      try {
        const bytes = [];
        for (let i = 0; i < text.length; i++) {
          const char = text.charCodeAt(i);
          if (char > 255) {

            bytes.push((char >> 8) & 0xFF);
            bytes.push(char & 0xFF);
          } else {
            bytes.push(char);
          }
        }


        const decoder = new TextDecoder('utf-8');
        const uint8Array = new Uint8Array(bytes);
        const decoded = decoder.decode(uint8Array);

        // 检查解码结果是否包含中文字符
        if (/[\u4e00-\u9fff]/.test(decoded)) {
          return decoded;
        }
      } catch (e) {

      }
    }

    try {
      const bytes = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i++) {
        bytes[i] = text.charCodeAt(i) & 0xFF;
      }

      const decoder = new TextDecoder('utf-8');
      const decoded = decoder.decode(bytes);

      if (/[\u4e00-\u9fff]/.test(decoded) && !decoded.includes('�')) {
        return decoded;
      }
    } catch (e) {
    }

    return text;
  } catch (error) {
    return text;
  }
}

function decodeObjectStrings(obj) {
  if (typeof obj === 'string') {
    return decodeChineseText(obj);
  } else if (Array.isArray(obj)) {
    return obj.map(item => decodeObjectStrings(item));
  } else if (obj && typeof obj === 'object') {
    const decoded = {};
    for (const [key, value] of Object.entries(obj)) {
      decoded[decodeChineseText(key)] = decodeObjectStrings(value);
    }
    return decoded;
  }
  return obj;
}

// 初始化平台过滤下拉框（自定义带 icon 下拉）
function initPlatformFilter() {
  if (!window.TeaRadar || !window.TeaRadar.PlatformCatalog) return;
  const platforms = window.TeaRadar.PlatformCatalog.getPlatformsByPriority();
  platforms.forEach(p => {
    if (p.id === 'unknown') return;
    const item = document.createElement('div');
    item.className = 'platform-filter-item';
    item.dataset.value = p.id;
    item.innerHTML = `<img src="${p.iconPath}" alt="${p.label}"><span class="platform-filter-item-label">${p.label}</span>`;
    platformFilterMenu.appendChild(item);
  });

  // Add "unknown platform" option at the end
  const unknownMeta = window.TeaRadar.PlatformCatalog.getPlatform('unknown');
  if (unknownMeta) {
    const unknownItem = document.createElement('div');
    unknownItem.className = 'platform-filter-item';
    unknownItem.dataset.value = 'unknown';
    unknownItem.innerHTML = `<span class="platform-filter-item-label">\u{1F4AD} ${unknownMeta.label}</span>`;
    platformFilterMenu.appendChild(unknownItem);
  }

  // Set default selection to "known platforms only"
  const defaultItem = platformFilterMenu.querySelector('[data-value=""]');
  if (defaultItem) {
    defaultItem.classList.remove('selected');
    defaultItem.dataset.value = '';
  }
  // Insert a "known platforms" option right after "all"
  const knownItem = document.createElement('div');
  knownItem.className = 'platform-filter-item selected';
  knownItem.dataset.value = '__known__';
  knownItem.innerHTML = `<span class="platform-filter-item-label">\u{1F4E1} \u5DF2\u8BC6\u522B\u5E73\u53F0</span>`;
  // Insert after "全部平台"
  if (defaultItem && defaultItem.nextSibling) {
    platformFilterMenu.insertBefore(knownItem, defaultItem.nextSibling);
  } else {
    platformFilterMenu.appendChild(knownItem);
  }

  // Update trigger to reflect default
  platformFilterTrigger.querySelector('.platform-filter-label').textContent = '\u{1F4E1} \u5DF2\u8BC6\u522B\u5E73\u53F0';

  // Toggle menu
  platformFilterTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    platformFilterWrapper.classList.toggle('open');
  });

  // Select item
  platformFilterMenu.addEventListener('click', (e) => {
    const item = e.target.closest('.platform-filter-item');
    if (!item) return;
    const value = item.dataset.value;
    currentPlatformFilter = value;

    // Update selected state
    platformFilterMenu.querySelectorAll('.platform-filter-item').forEach(el => el.classList.remove('selected'));
    item.classList.add('selected');

    // Update trigger display
    if (value === '__known__') {
      platformFilterTrigger.querySelector('.platform-filter-label').textContent = '\u{1F4E1} \u5DF2\u8BC6\u522B\u5E73\u53F0';
    } else if (value === 'unknown') {
      platformFilterTrigger.querySelector('.platform-filter-label').textContent = '\u{1F4AD} \u672A\u77E5\u5E73\u53F0';
    } else if (value) {
      const p = window.TeaRadar.PlatformCatalog.getPlatform(value);
      platformFilterTrigger.querySelector('.platform-filter-label').innerHTML =
        `<img src="${p.iconPath}" style="width:16px;height:16px;border-radius:2px;vertical-align:middle"> ${p.label}`;
    } else {
      platformFilterTrigger.querySelector('.platform-filter-label').textContent = '\u5168\u90E8\u5E73\u53F0';
    }

    platformFilterWrapper.classList.remove('open');
    filterEvents();
  });

  // Close on outside click
  document.addEventListener('click', () => {
    platformFilterWrapper.classList.remove('open');
  });
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  document.body.classList.toggle('embedded-panel', isEmbeddedPanel);

  // 顶层页面才启用内部拖拽手柄；嵌入 iframe 时由宿主页面处理拉伸
  if (!isEmbeddedPanel) {
    initResizeHandler();
  }

  // 初始化平台过滤下拉框
  initPlatformFilter();

  // 恢复保存的宽度
  restorePanelWidth();

  // 默认开始捕获
  chrome.runtime.sendMessage({ action: 'startCapturing' }, (response) => {
    if (response && response.success) {
      isCapturing = true;
      updateToggleButton();
    }
  });

  chrome.runtime.sendMessage({ action: 'getEvents' }, (response) => {
    if (response && response.events) {
      allEvents = response.events;
      updateEventCount();
      filterEvents();
    }
  });

  const eventsContainer = document.querySelector('.events-container');
  let scrollTimeout;

  eventsContainer.addEventListener('scroll', () => {
    isUserInteracting = true;

    clearTimeout(scrollTimeout);

    // 1秒后恢复自动滚动
    scrollTimeout = setTimeout(() => {
      // 检查是否滚动到底部，如果是则恢复自动滚动
      const isAtBottom = Math.abs(eventsContainer.scrollHeight - eventsContainer.scrollTop - eventsContainer.clientHeight) < 10;
      if (isAtBottom) {
        isUserInteracting = false;
      }
    }, 1000);
  });
});

// 切换按钮点击事件
toggleBtn.addEventListener('click', () => {
  if (isCapturing) {
    // 当前正在捕获，点击后停止
    chrome.runtime.sendMessage({ action: 'stopCapturing' }, (response) => {
      if (response && response.success) {
        isCapturing = false;
        updateToggleButton();
      }
    });
  } else {
    // 当前已停止，点击后开始
    chrome.runtime.sendMessage({ action: 'startCapturing' }, (response) => {
      if (response && response.success) {
        isCapturing = true;
        updateToggleButton();
      }
    });
  }
});

clearBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'clearEvents' }, (response) => {
    if (response && response.success) {
      allEvents = [];
      // 清除展开状态记录
      expandedCards.clear();
      renderEvents(allEvents);
      updateEventCount();
      // 清除搜索关键词
      searchKeywords = [];
      renderSearchTags();
    }
  });
});

// CSV下载按钮事件
downloadBtn.addEventListener('click', () => {
  if (allEvents.length === 0) {
    showNotification('暂无数据可下载', 'warning');
    return;
  }

  // 设置下载状态
  downloadBtn.classList.add('downloading');
  downloadBtn.disabled = true;

  try {
    const csvData = generateCSV(allEvents);
    downloadCSV(csvData, `tea_events_${new Date().toISOString().slice(0, 19).replace(/[:-]/g, '')}.csv`);

    // 显示成功状态
    downloadBtn.classList.remove('downloading');
    downloadBtn.classList.add('success');
    showNotification('CSV文件下载成功', 'success');

    // 2秒后恢复正常状态
    setTimeout(() => {
      downloadBtn.classList.remove('success');
      downloadBtn.disabled = false;
    }, 2000);
  } catch (error) {
    downloadBtn.classList.remove('downloading');
    downloadBtn.disabled = false;
    showNotification('下载失败: ' + error.message, 'error');
  }
});

// 更新切换按钮状态
function updateToggleButton() {
  if (isCapturing) {
    toggleIcon.className = 'ri-pause-fill';
    toggleText.textContent = 'Stop';
    toggleBtn.classList.remove('btn-primary');
    toggleBtn.classList.add('btn-secondary');
  } else {
    toggleIcon.className = 'ri-play-fill';
    toggleText.textContent = 'RadarUp';
    toggleBtn.classList.remove('btn-secondary');
    toggleBtn.classList.add('btn-primary');
  }
}

// 搜索过滤 - 防抖优化
searchInput.addEventListener('input', (e) => {
  // 清除之前的搜索防抖
  if (searchTimeout) {
    clearTimeout(searchTimeout);
  }

  // 防抖搜索
  searchTimeout = setTimeout(() => {
    filterEvents();
  }, SEARCH_DEBOUNCE_TIME);
});

// 回车键添加搜索标签
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && searchInput.value.trim() !== '') {
    // 添加单个关键词作为标签
    const keyword = searchInput.value.trim().toLowerCase();

    // 如果关键词不存在，则添加
    if (!searchKeywords.includes(keyword)) {
      searchKeywords.push(keyword);
    }

    // 清空输入框
    searchInput.value = '';

    // 渲染搜索标签
    renderSearchTags();

    // 过滤事件
    filterEvents();
  }
});

// 监听过滤模式变化
filterMode.addEventListener('change', (e) => {
  currentFilterMode = e.target.value;
  filterEvents();
});

// 渲染搜索标签
function renderSearchTags() {
  searchTags.innerHTML = '';

  searchKeywords.forEach(keyword => {
    const tag = document.createElement('span');
    tag.className = 'search-tag';
    tag.innerHTML = `${keyword} <i class="ri-close-line"></i>`;

    // 点击删除标签
    tag.querySelector('i').addEventListener('click', () => {
      searchKeywords = searchKeywords.filter(k => k !== keyword);
      renderSearchTags();
      filterEvents();
    });

    searchTags.appendChild(tag);
  });
}

// 过滤事件 - 支持多种过滤模式
function filterEvents() {
  // 组合输入框中的关键词和已添加的标签关键词
  const inputStr = searchInput.value.trim().toLowerCase();
  const allKeywords = [...searchKeywords];

  // 支持输入框中以空格分隔的多个关键词
  if (inputStr) {
    inputStr.split(/\s+/).forEach(k => {
      if (k && !allKeywords.includes(k)) {
        allKeywords.push(k);
      }
    });
  }

  // 根据平台过滤
  let filteredEvents;
  if (currentPlatformFilter === '__known__') {
    // Show only events from recognized platforms (exclude unknown)
    filteredEvents = allEvents.filter(event => (event.platformId || 'unknown') !== 'unknown');
  } else if (currentPlatformFilter) {
    // Show specific platform
    filteredEvents = allEvents.filter(event => (event.platformId || 'unknown') === currentPlatformFilter);
  } else {
    // Show all (including unknown)
    filteredEvents = allEvents;
  }

  // 根据过滤模式进行过滤
  if (allKeywords.length > 0) {
    switch (currentFilterMode) {
      case 'include':
        // 只看匹配：事件必须包含任意一个关键词
        filteredEvents = filteredEvents.filter(event => {
          const eventData = JSON.stringify(event).toLowerCase();
          return allKeywords.some(keyword => eventData.includes(keyword));
        });
        break;
      case 'exclude':
        // 排除匹配：事件不能包含任何关键词
        filteredEvents = filteredEvents.filter(event => {
          const eventData = JSON.stringify(event).toLowerCase();
          return !allKeywords.some(keyword => eventData.includes(keyword));
        });
        break;
      default:
        break;
    }
  }

  renderEvents(filteredEvents);
}

// 更新事件计数
function updateEventCount() {
  eventCount.textContent = allEvents.length;
}

// 监听来自background的消息
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'updateEvents' && message.events) {
    allEvents = message.events;
    updateEventCount();

    // 取消正在等待的搜索防抖，避免与下面的filterEvents重复执行导致抖动
    if (searchTimeout) {
      clearTimeout(searchTimeout);
      searchTimeout = null;
    }

    // 应用当前的过滤条件
    filterEvents();
  }
});

// 用于跟踪用户是否正在悬停事件卡片
let isUserInteracting = false;
let userInteractTimeout;
let isCardExpanded = false; // 是否有卡片处于展开状态
let expandedCards = new Set(); // 存储已展开卡片的ID

// 自动滚动到底部函数
function autoScrollToBottom() {
  if (!isUserInteracting && !isCardExpanded) {
    setTimeout(() => {
      if (!isUserInteracting && !isCardExpanded) {
        const eventsContainer = document.querySelector('.events-container');
        eventsContainer.scrollTop = eventsContainer.scrollHeight;
      }
    }, 100);
  }
}

// 防抖渲染事件列表
function renderEvents(events) {
  // 清除之前的渲染防抖
  if (renderTimeout) {
    clearTimeout(renderTimeout);
  }

  // 防抖渲染
  renderTimeout = setTimeout(() => {
    doRenderEvents(events);
  }, RENDER_DEBOUNCE_TIME);
}

// 实际渲染事件列表
function doRenderEvents(events) {
  // 如果正在渲染，将最新事件排队等待，而不是丢弃
  if (isRendering) {
    pendingRenderEvents = events;
    return;
  }
  isRendering = true;

  try {
    // 清空列表
    eventsList.innerHTML = '';

    // 显示或隐藏无事件提示
    if (events.length === 0) {
      noEvents.style.display = 'flex';
      eventsList.style.display = 'none';
      return;
    }

    noEvents.style.display = 'none';
    eventsList.style.display = 'flex';

    // 按时间顺序排序（旧 -> 新），确保最新事件位于底部
    const sortedEvents = [...events].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // 限制可见事件数量以提高性能
    const visibleEvents = sortedEvents.slice(-MAX_VISIBLE_EVENTS);

    // 使用DocumentFragment批量添加DOM元素
    const fragment = document.createDocumentFragment();

    // 渲染每个事件卡片
    visibleEvents.forEach(event => {
      const card = createEventCard(event);

      // 添加悬停事件监听（防抖）
      card.addEventListener('mouseenter', () => {
        clearTimeout(userInteractTimeout);
        isUserInteracting = true;
      });

      card.addEventListener('mouseleave', () => {
        // 500ms 后再恢复自动滚动，防止抖动
        userInteractTimeout = setTimeout(() => {
          isUserInteracting = false;
        }, 500);
      });

      fragment.appendChild(card);
    });

    // 批量添加到DOM
    eventsList.appendChild(fragment);

    // 如果事件被截断，显示提示
    if (sortedEvents.length > MAX_VISIBLE_EVENTS) {
      const truncateNotice = document.createElement('div');
      truncateNotice.className = 'truncate-notice';
      truncateNotice.innerHTML = `
        <div style="text-align: center; padding: 12px; color: var(--muted-foreground); font-size: 12px; background: var(--muted); border-radius: var(--radius); margin-bottom: 8px;">
          <i class="ri-information-line" style="margin-right: 4px;"></i>
          为了性能考虑，仅显示最新的 ${MAX_VISIBLE_EVENTS} 个事件（共 ${sortedEvents.length} 个）
        </div>
      `;
      eventsList.insertBefore(truncateNotice, eventsList.firstChild);
    }

    // 自动滚动到底部显示最新事件
    autoScrollToBottom();
  } finally {
    isRendering = false;

    // 如果渲染期间有新的渲染请求排队，立即处理最新的
    if (pendingRenderEvents) {
      const nextEvents = pendingRenderEvents;
      pendingRenderEvents = null;
      // 使用 requestAnimationFrame 避免同步递归，确保浏览器有机会绘制
      requestAnimationFrame(() => doRenderEvents(nextEvents));
    }
  }
}

// 创建事件卡片
function createEventCard(event) {
  const card = document.createElement('div');
  card.className = 'event-card';

  // 解析事件数据
  let eventName = '未知事件';
  let eventUser = '未知用户';
  let eventType = '';
  let parsedEvents = []; // normalized events from platform adapters
  let useLegacyFormat = false; // flag for DataRangers raw format

  const platformId = event.platformId || 'unknown';

  try {
    // Use platform adapters for parsing when available
    if (platformId !== 'unknown' && platformId !== 'datarangers' &&
        window.TeaRadar && window.TeaRadar.PlatformAdapters) {
      var normalized = window.TeaRadar.PlatformAdapters.parseRequest(platformId, {
        url: event.url,
        method: event.method,
        bodyRaw: event.requestData || '',
        headers: event.headers || [],
        contentType: ''
      });
      if (normalized && normalized.length > 0) {
        parsedEvents = normalized;
        var first = normalized[0];
        eventName = decodeChineseText(first.eventName || '未知事件');
        eventUser = decodeChineseText(first.userId || first.distinctId || first.anonymousId || '未知用户');
        eventType = first.eventName && first.eventName.includes('api') ? 'api' : 'event';
      }
    }

    // DataRangers legacy format or fallback
    if (parsedEvents.length === 0 && event.requestData) {
      const requestData = JSON.parse(event.requestData);

      if (requestData && requestData[0] && requestData[0].events) {
        useLegacyFormat = true;
        var legacyEvents = requestData[0].events;

        if (legacyEvents.length > 0) {
          eventName = decodeChineseText(legacyEvents[0].event || '未知事件');
          eventType = eventName.includes('api') ? 'api' : 'event';

          if (legacyEvents[0].params) {
            try {
              const params = JSON.parse(legacyEvents[0].params);
              const decodedParams = decodeObjectStrings(params);
              eventUser = decodedParams.user || '未知用户';
            } catch (e) {
              const paramsStr = decodeChineseText(legacyEvents[0].params.toString());
              const userMatch = paramsStr.match(/user[\"']?\s*:\s*[\"']([^\"']+)[\"']/i);
              if (userMatch && userMatch[1]) {
                eventUser = decodeChineseText(userMatch[1]);
              }
            }
          }
        }

        // Convert legacy events to normalized format for uniform rendering
        parsedEvents = legacyEvents.map(function(evt) {
          var params = {};
          if (evt.params) {
            try { params = JSON.parse(evt.params); } catch(e) { params = { _raw: evt.params }; }
          }
          return {
            platform: platformId,
            eventName: evt.event || '',
            userId: '',
            anonymousId: '',
            distinctId: '',
            eventTime: '',
            properties: decodeObjectStrings(params),
            rawEvent: evt
          };
        });
      }

      if (eventUser === '未知用户' && requestData[0] && requestData[0].user) {
        eventUser = decodeChineseText(requestData[0].user.user_unique_id || '未知用户');
      }
    }
  } catch (error) {
  }

  // 创建卡片头部
  const header = document.createElement('div');
  header.className = 'event-header';

  // 格式化时间
  const eventTime = new Date(event.timestamp).toLocaleTimeString();

  // 获取平台元数据
  const platformMeta = (window.TeaRadar && window.TeaRadar.PlatformCatalog)
    ? (window.TeaRadar.PlatformCatalog.getPlatform(platformId) || window.TeaRadar.PlatformCatalog.getPlatform('unknown'))
    : null;

  // 创建左侧内容
  const headerLeft = document.createElement('div');
  headerLeft.className = 'event-header-left';

  // 添加事件名称和标签
  const nameContainer = document.createElement('div');
  nameContainer.style.display = 'flex';
  nameContainer.style.alignItems = 'center';
  nameContainer.style.gap = '6px';
  nameContainer.style.flexWrap = 'wrap';

  // 平台 badge
  if (platformMeta) {
    const badge = document.createElement('span');
    badge.className = 'platform-badge';
    badge.style.backgroundColor = platformMeta.color;
    if (platformId === 'unknown') {
      badge.appendChild(document.createTextNode('💭 ' + platformMeta.shortLabel));
    } else {
      const badgeImg = document.createElement('img');
      badgeImg.src = platformMeta.iconPath;
      badgeImg.alt = platformMeta.shortLabel;
      badgeImg.onerror = () => { badgeImg.style.display = 'none'; };
      badge.appendChild(badgeImg);
      badge.appendChild(document.createTextNode(platformMeta.shortLabel));
    }
    nameContainer.appendChild(badge);
  }

  const tagSpan = document.createElement('span');
  tagSpan.className = `tag tag-${eventType}`;
  tagSpan.textContent = eventType.toUpperCase();
  nameContainer.appendChild(tagSpan);

  const nameSpan = document.createElement('span');
  nameSpan.className = 'event-name';
  nameSpan.textContent = eventName;
  nameContainer.appendChild(nameSpan);

  headerLeft.appendChild(nameContainer);

  // 添加用户信息
  const userElem = document.createElement('div');
  userElem.className = 'event-user';
  userElem.textContent = `@${eventUser}`;
  headerLeft.appendChild(userElem);

  // 创建右侧内容
  const headerRight = document.createElement('div');
  headerRight.className = 'event-header-right';

  // 添加时间（不显示状态）
  headerRight.innerHTML = `
    <span class="event-time">${eventTime}</span>
  `;

  // 将左右两侧添加到头部
  header.appendChild(headerLeft);
  header.appendChild(headerRight);

  // 创建卡片内容
  const content = document.createElement('div');
  content.className = 'event-content';

  // 事件信息部分
  const eventsSection = document.createElement('div');
  eventsSection.className = 'event-section';

  // 创建标题和复制按钮
  const eventsSectionTitle = document.createElement('h3');
  eventsSectionTitle.className = 'event-section-title';
  eventsSectionTitle.innerHTML = `
    <span>事件信息</span>
    <button class="copy-btn" title="复制事件信息">
      <i class="ri-file-copy-line"></i>
    </button>
  `;
  eventsSection.appendChild(eventsSectionTitle);

  const eventDetailList = document.createElement('div');
  eventDetailList.className = 'event-detail-list';

  // 添加每个事件的详细信息 (unified NormalizedEvent format)
  if (parsedEvents.length > 0) {
    parsedEvents.forEach((evt, index) => {
      const eventDetail = document.createElement('div');
      eventDetail.className = 'event-detail-item';

      // 事件名称
      const decodedEvtName = decodeChineseText(evt.eventName || evt.event || '未知');
      const eventNameElem = document.createElement('div');
      eventNameElem.className = 'event-param';
      eventNameElem.innerHTML = `
        <span class="event-param-name">事件名称:</span>
        <span class="event-param-value">${decodedEvtName}</span>
      `;
      eventDetail.appendChild(eventNameElem);

      // 用户标识 (normalized events)
      if (evt.distinctId || evt.userId || evt.anonymousId) {
        const idElem = document.createElement('div');
        idElem.className = 'event-param';
        const idParts = [];
        if (evt.distinctId) idParts.push('distinct_id: ' + evt.distinctId);
        else {
          if (evt.userId) idParts.push('user_id: ' + evt.userId);
          if (evt.anonymousId) idParts.push('anonymous_id: ' + evt.anonymousId);
        }
        idElem.innerHTML = `
          <span class="event-param-name">用户标识:</span>
          <span class="event-param-value">${decodeChineseText(idParts.join(', '))}</span>
        `;
        eventDetail.appendChild(idElem);
      }

      // 事件时间
      if (evt.eventTime) {
        const timeElem = document.createElement('div');
        timeElem.className = 'event-param';
        timeElem.innerHTML = `
          <span class="event-param-name">事件时间:</span>
          <span class="event-param-value">${evt.eventTime}</span>
        `;
        eventDetail.appendChild(timeElem);
      }

      // 事件参数 (properties from NormalizedEvent, or legacy params)
      var propsObj = evt.properties || null;
      if (!propsObj && evt.params) {
        try { propsObj = typeof evt.params === 'string' ? JSON.parse(evt.params) : evt.params; } catch(e) {}
      }

      if (propsObj && typeof propsObj === 'object' && Object.keys(propsObj).length > 0) {
        const decodedParams = decodeObjectStrings(propsObj);

        const paramsElem = document.createElement('div');
        paramsElem.className = 'event-param';
        paramsElem.innerHTML = `<span class="event-param-name">参数:</span>`;

        const paramsTable = document.createElement('table');
        paramsTable.className = 'params-table';

        const tableHead = document.createElement('thead');
        tableHead.innerHTML = `
          <tr>
            <th>参数名</th>
            <th>值</th>
          </tr>
        `;

        const tableBody = document.createElement('tbody');

        Object.entries(decodedParams).forEach(([key, value]) => {
          const row = document.createElement('tr');
          const keyCell = document.createElement('td');
          keyCell.textContent = key;
          row.appendChild(keyCell);

          const valueCell = document.createElement('td');
          const displayValue = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
          valueCell.textContent = displayValue;
          row.appendChild(valueCell);

          tableBody.appendChild(row);
        });

        paramsTable.appendChild(tableHead);
        paramsTable.appendChild(tableBody);
        paramsElem.appendChild(paramsTable);
        eventDetail.appendChild(paramsElem);
      }

      eventDetailList.appendChild(eventDetail);
    });
  } else {
    const noEventsElem = document.createElement('div');
    noEventsElem.className = 'no-events-detail';
    noEventsElem.textContent = '无事件详情';
    eventDetailList.appendChild(noEventsElem);
  }

  eventsSection.appendChild(eventDetailList);
  content.appendChild(eventsSection);

  // 请求信息部分
  const requestSection = document.createElement('div');
  requestSection.className = 'event-section';
  requestSection.innerHTML = `<h3 class="event-section-title">请求信息</h3>`;

  const urlElem = document.createElement('div');
  urlElem.className = 'event-url';
  urlElem.textContent = event.url;
  requestSection.appendChild(urlElem);

  content.appendChild(requestSection);

  // 原始JSON部分
  const jsonSection = document.createElement('div');
  jsonSection.className = 'event-section';

  // 创建标题和复制按钮
  const jsonSectionTitle = document.createElement('h3');
  jsonSectionTitle.className = 'event-section-title';
  jsonSectionTitle.innerHTML = `
    <span>原始数据</span>
    <button class="copy-btn" title="复制原始数据">
      <i class="ri-file-copy-line"></i>
    </button>
  `;
  jsonSection.appendChild(jsonSectionTitle);

  const jsonViewer = document.createElement('pre');
  jsonViewer.className = 'json-viewer';

  let rawJsonData = '';
  try {
    // 格式化JSON并添加语法高亮
    const formattedJson = JSON.stringify(JSON.parse(event.requestData), null, 2);
    rawJsonData = formattedJson;
    jsonViewer.innerHTML = syntaxHighlight(formattedJson);
  } catch (e) {
    // For non-JSON bodies (e.g. sensors form data), try to show decoded events
    if (parsedEvents.length > 0 && parsedEvents[0].rawEvent) {
      try {
        var rawEvents = parsedEvents.map(function(pe) { return pe.rawEvent; });
        rawJsonData = JSON.stringify(rawEvents.length === 1 ? rawEvents[0] : rawEvents, null, 2);
        jsonViewer.innerHTML = syntaxHighlight(rawJsonData);
      } catch(e2) {
        rawJsonData = event.requestData || '无数据';
        jsonViewer.textContent = rawJsonData;
      }
    } else {
      rawJsonData = event.requestData || '无数据';
      jsonViewer.textContent = rawJsonData;
    }
  }

  jsonSection.appendChild(jsonViewer);
  content.appendChild(jsonSection);

  // 添加到卡片
  card.appendChild(header);
  card.appendChild(content);

  // 检查当前卡片是否之前已展开
  if (expandedCards.has(event.id)) {
    content.classList.add('active');
  }

  // 添加点击事件，展开/折叠卡片
  header.addEventListener('click', () => {
    content.classList.toggle('active');

    // 更新展开状态记录
    if (content.classList.contains('active')) {
      expandedCards.add(event.id);
    } else {
      expandedCards.delete(event.id);
    }

    // 更新是否有展开卡片
    isCardExpanded = document.querySelector('.event-content.active') !== null;

    // 如果所有卡片都已折叠，恢复自动滚动到底部
    if (!isCardExpanded) {
      autoScrollToBottom();
    }
  });

  // 添加复制按钮事件监听器
  // 事件信息复制按钮
  const eventCopyBtn = eventsSectionTitle.querySelector('.copy-btn');
  eventCopyBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // 阻止冒泡到卡片展开事件

    // 仅复制事件名称（每行一个）
    let eventNamesText = parsedEvents.map(p => p.eventName || p.event || '未知').join('\n');
    if (!eventNamesText) {
      eventNamesText = eventName; // 回退到主事件名称
    }
    copyToClipboard(eventNamesText, eventCopyBtn);
  });

  // 原始数据复制按钮
  const jsonCopyBtn = jsonSectionTitle.querySelector('.copy-btn');
  jsonCopyBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // 阻止冒泡到卡片展开事件
    copyToClipboard(rawJsonData, jsonCopyBtn);
  });

  return card;
}

// 复制到剪贴板功能 - 支持多种复制方式
function copyToClipboard(text, button) {
  const icon = button.querySelector('i');
  const originalClass = icon.className;

  // 方法1: 尝试使用现代剪贴板API
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showCopySuccess(icon, originalClass, button);
    }).catch(err => {
      fallbackCopyToClipboard(text, icon, originalClass, button);
    });
  } else {
    // 方法2: 使用备用复制方法
    fallbackCopyToClipboard(text, icon, originalClass, button);
  }
}

// 备用复制方法
function fallbackCopyToClipboard(text, icon, originalClass, button) {
  try {
    // 创建临时文本区域
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    textArea.style.opacity = '0';
    textArea.style.pointerEvents = 'none';

    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    // 尝试使用 document.execCommand
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);

    if (successful) {
      showCopySuccess(icon, originalClass, button);
    } else {
      // 如果 execCommand 也失败，显示文本选择提示
      showCopyFallback(text, icon, originalClass, button);
    }
  } catch (err) {
    showCopyFallback(text, icon, originalClass, button);
  }
}

// 显示复制成功状态
function showCopySuccess(icon, originalClass, button) {
  icon.className = 'ri-check-line';
  button.classList.add('copied');
  button.title = '复制成功！';

  setTimeout(() => {
    icon.className = originalClass;
    button.classList.remove('copied');
    button.title = '复制';
  }, 2000);
}

// 显示复制失败，提供手动复制选项
function showCopyFallback(text, icon, originalClass, button) {
  // 创建模态框显示文本供用户手动复制
  const modal = document.createElement('div');
  modal.className = 'tea-copy-modal';

  const modalContent = document.createElement('div');
  modalContent.className = 'tea-copy-modal-content';

  modalContent.innerHTML = `
    <h3>手动复制内容</h3>
    <p>由于权限限制，请手动选择并复制以下内容：</p>
    <textarea readonly>${text}</textarea>
    <div class="tea-copy-modal-footer">
      <button>关闭</button>
    </div>
  `;

  // 关闭按钮事件
  const closeBtn = modalContent.querySelector('button');
  closeBtn.addEventListener('click', () => {
    document.body.removeChild(modal);
  });

  // 点击背景关闭
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  });

  // 自动选择文本
  const textarea = modalContent.querySelector('textarea');
  setTimeout(() => {
    textarea.select();
    textarea.focus();
  }, 100);

  modal.appendChild(modalContent);
  document.body.appendChild(modal);

  // 更新按钮状态
  icon.className = 'ri-information-line';
  button.style.color = '#ffc107';
  button.title = '点击查看复制内容';

  setTimeout(() => {
    icon.className = originalClass;
    button.style.color = '';
    button.title = '复制';
  }, 3000);
}

// JSON语法高亮
function syntaxHighlight(json) {
  json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
    let cls = 'json-number';
    if (/^"/.test(match)) {
      if (/:$/.test(match)) {
        cls = 'json-key';
      } else {
        cls = 'json-string';
      }
    } else if (/true|false/.test(match)) {
      cls = 'json-boolean';
    } else if (/null/.test(match)) {
      cls = 'json-null';
    }
    return '<span class="' + cls + '">' + match + '</span>';
  });
}

// 初始化拖拽调整宽度功能
function initResizeHandler() {
  if (!resizeHandle) return;

  resizeHandle.addEventListener('pointerdown', startResize);
  resizeHandle.addEventListener('pointermove', doResize);
  resizeHandle.addEventListener('pointerup', stopResize);
  resizeHandle.addEventListener('pointercancel', stopResize);
  resizeHandle.addEventListener('lostpointercapture', stopResize);

  // 防止选中文本和右键菜单
  resizeHandle.addEventListener('selectstart', (e) => e.preventDefault());
  resizeHandle.addEventListener('contextmenu', (e) => e.preventDefault());

  // 添加双击重置宽度功能
  resizeHandle.addEventListener('dblclick', () => {
    currentWidth = defaultWidth;
    setPanelWidth(defaultWidth);
    savePanelWidth(defaultWidth);
  });
}

// 开始拖拽
function startResize(e) {
  if (e.button !== undefined && e.button !== 0) {
    return;
  }

  isDragging = true;
  startX = e.clientX;
  startWidth = currentWidth;
  resizePointerId = e.pointerId;

  // 添加拖拽样式
  resizeHandle.classList.add('dragging');
  document.body.classList.add('resizing');
  lastUpdateTime = 0;

  if (resizeHandle.setPointerCapture && resizePointerId !== undefined) {
    resizeHandle.setPointerCapture(resizePointerId);
  }

  // 防止拖拽时的默认行为
  e.preventDefault();
  e.stopPropagation();
}

// 执行拖拽
function doResize(e) {
  if (!isDragging) return;

  // 性能优化：节流更新
  const now = Date.now();
  if (now - lastUpdateTime < UPDATE_THROTTLE) {
    return;
  }
  lastUpdateTime = now;

  // 面板在右侧，向左拖拽应该增加宽度，向右拖拽应该减小宽度
  const deltaX = startX - e.clientX; // 向左拖动为正值，向右拖动为负值
  let newWidth = startWidth + deltaX;

  // 限制宽度范围
  newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));

  // 只有宽度真正改变时才更新
  if (Math.abs(newWidth - currentWidth) > 1) {
    currentWidth = newWidth;
    setPanelWidth(newWidth);
  }

  e.preventDefault();
}

// 停止拖拽
function stopResize(e) {
  if (!isDragging) return;

  isDragging = false;

  // 移除拖拽样式
  resizeHandle.classList.remove('dragging');
  document.body.classList.remove('resizing');
  if (
    resizeHandle.releasePointerCapture &&
    resizePointerId !== null &&
    resizeHandle.hasPointerCapture &&
    resizeHandle.hasPointerCapture(resizePointerId)
  ) {
    resizeHandle.releasePointerCapture(resizePointerId);
  }
  resizePointerId = null;

  // 保存当前宽度
  savePanelWidth(currentWidth);

  if (e) {
    e.preventDefault();
  }
}

// 设置面板宽度
function setPanelWidth(width) {
  if (isEmbeddedPanel) {
    try {
      window.parent.postMessage({
        source: 'tea-event-radar-panel-frame',
        action: 'resizePanel',
        width: width
      }, '*');
    } catch (error) {
      // 忽略向宿主页面发送消息失败
    }

    if (document.documentElement) {
      document.documentElement.style.width = '100%';
    }
    if (document.body) {
      document.body.style.width = '100%';
    }
  }

  // 首先尝试直接调整当前面板宽度（侧边栏模式）
  if (!isEmbeddedPanel) {
    try {
      if (window.parent && window.parent !== window) {
        // 在iframe中，尝试调整父容器
        const parentPanel = window.parent.document.getElementById('tea-event-radar-panel');
        if (parentPanel) {
          parentPanel.style.width = width + 'px';
          return;
        }
      }

      // 尝试调整当前窗口的body宽度（侧边栏模式）
      if (document.body) {
        document.body.style.width = width + 'px';
      }
    } catch (error) {
      // 忽略直接调整面板宽度失败
    }
  }

  // 向service worker发送消息调整页面内面板宽度（备用方案）
  chrome.runtime.sendMessage({
    action: 'resizePanel',
    width: width
  }).catch(error => {
    // 忽略发送调整宽度消息失败
  });
}

// 保存面板宽度到本地存储
function savePanelWidth(width) {
  try {
    chrome.storage.local.set({ panelWidth: width });
  } catch (error) {
    // 忽略保存面板宽度失败
  }
}

// 恢复面板宽度
function restorePanelWidth() {
  try {
    chrome.storage.local.get(['panelWidth'], (result) => {
      const savedWidth = result.panelWidth || defaultWidth;
      currentWidth = savedWidth;
      setPanelWidth(savedWidth);
    });
  } catch (error) {
    // 忽略恢复面板宽度失败
    currentWidth = defaultWidth;
    setPanelWidth(defaultWidth);
  }
}

// CSV生成函数
function generateCSV(events) {
  if (!events || events.length === 0) {
    throw new Error('无数据可导出');
  }

  // CSV头部
  const headers = [
    '时间戳',
    '事件名称',
    '用户ID',
    '状态码',
    '请求URL',
    '事件参数',
    '原始数据'
  ];

  const csvRows = [headers.join(',')];

  events.forEach(event => {
    try {
      let eventName = '';
      let userId = '';
      let eventParams = '';
      let rawData = '';

      // 解析请求数据
      if (event.requestData) {
        try {
          const parsedData = JSON.parse(event.requestData);
          rawData = JSON.stringify(parsedData).replace(/"/g, '""'); // CSV转义

          if (Array.isArray(parsedData) && parsedData.length > 0) {
            const firstItem = parsedData[0];

            // 提取用户ID
            if (firstItem.user && firstItem.user.user_unique_id) {
              userId = firstItem.user.user_unique_id;
            }

            // 提取事件信息
            if (firstItem.events && Array.isArray(firstItem.events)) {
              const eventNames = firstItem.events.map(e => e.event || '').filter(Boolean);
              eventName = eventNames.join('; ');

              // 提取事件参数
              const allParams = firstItem.events.map(e => {
                if (e.params) {
                  try {
                    const params = typeof e.params === 'string' ? JSON.parse(e.params) : e.params;
                    return JSON.stringify(params);
                  } catch (err) {
                    return e.params;
                  }
                }
                return '';
              }).filter(Boolean);
              eventParams = allParams.join('; ');
            }
          }
        } catch (parseError) {
          rawData = event.requestData.replace(/"/g, '""');
        }
      }

      // 格式化时间戳
      const timestamp = new Date(event.timestamp).toLocaleString('zh-CN');

      // 构建CSV行
      const row = [
        `"${timestamp}"`,
        `"${eventName}"`,
        `"${userId}"`,
        `"${event.status || 'pending'}"`,
        `"${event.url || ''}"`,
        `"${eventParams}"`,
        `"${rawData}"`
      ];

      csvRows.push(row.join(','));
    } catch (error) {
      // 忽略处理事件数据出错
      // 添加错误行
      csvRows.push(`"${new Date(event.timestamp).toLocaleString('zh-CN')}","解析错误","","","${event.url || ''}","","${(event.requestData || '').replace(/"/g, '""')}"`);
    }
  });

  return csvRows.join('\n');
}

// CSV下载函数
function downloadCSV(csvData, filename) {
  // 添加BOM以支持中文
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csvData], { type: 'text/csv;charset=utf-8;' });

  // 创建下载链接
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // 清理URL对象
  URL.revokeObjectURL(url);
}

// 通知函数
function showNotification(message, type = 'info') {
  // 创建通知元素
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 16px;
    border-radius: 6px;
    color: white;
    font-size: 13px;
    font-weight: 500;
    z-index: 9999;
    max-width: 280px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    animation: slideInNotification 0.3s ease;
  `;

  // 根据类型设置背景色
  const colors = {
    success: '#10b981',
    error: '#ef4444',
    warning: '#f59e0b',
    info: '#3b82f6'
  };

  notification.style.backgroundColor = colors[type] || colors.info;
  notification.textContent = message;

  // 添加动画样式
  if (!document.getElementById('notification-styles')) {
    const style = document.createElement('style');
    style.id = 'notification-styles';
    style.textContent = `
      @keyframes slideInNotification {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      @keyframes fadeOutNotification {
        from { opacity: 1; }
        to { opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(notification);

  // 3秒后自动移除
  setTimeout(() => {
    notification.style.animation = 'fadeOutNotification 0.3s ease forwards';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, 3000);
} 
