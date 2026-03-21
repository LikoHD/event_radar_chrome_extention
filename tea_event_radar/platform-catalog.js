/**
 * Platform Catalog - Platform metadata registry for Tea Event Radar
 *
 * Registers all supported analytics platforms with their metadata
 * including display labels, icon paths, documentation URLs, and
 * identification keywords for quick pre-filtering.
 */
(function () {
  var root = (typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this);
  root.TeaRadar = root.TeaRadar || {};

  /**
   * Platform catalog keyed by platform id.
   * Each entry is a PlatformCatalogItem.
   */
  var PLATFORMS = {
    // --- ByteDance / DataRangers (current default) ---
    datarangers: {
      id: 'datarangers',
      label: 'ByteDance Data',
      shortLabel: 'DR',
      vendor: 'ByteDance',
      category: 'commercial',
      iconPath: 'images/platforms/datarangers.png',
      docsUrl: 'https://www.volcengine.com/docs/6285',
      color: '#3370FF',
      priority: 0, // P0 - currently supported
      identificationHints: {
        hosts: ['mcs.zijieapi.com', 'mcs.tobsnssdk.com', 'applog.zijieapi.com'],
        paths: ['/list'],
        queryKeys: ['aid', 'sdk_version', 'device_platform'],
        headerKeys: ['X-MCS-AppKey'],
        bodyKeys: ['events', 'user', 'header'],
        globalVars: [],
        cookies: []
      }
    },

    // --- Sensors Data / Shen Ce ---
    sensors: {
      id: 'sensors',
      label: '神策',
      shortLabel: 'SD',
      vendor: 'Sensors Data',
      category: 'commercial',
      iconPath: 'images/platforms/sensors.png',
      docsUrl: 'https://manual.sensorsdata.cn/sa/docs/tech_sdk_client_web',
      color: '#2563EB',
      priority: 1,
      identificationHints: {
        hosts: ['sensorsdata.cn', 'datasink.sensorsdata.cn'],
        paths: ['/sa', '/sa.gif', '/batch'],
        queryKeys: ['project', 'token'],
        headerKeys: [],
        bodyKeys: ['data_list', 'data', 'gzip'],
        globalVars: ['sensorsDataAnalytic201505'],
        cookies: ['sensorsdata2015jssdkcross']
      }
    },

    // --- Google Analytics (GA4 + Universal Analytics) ---
    google: {
      id: 'google',
      label: 'GA4',
      shortLabel: 'GA',
      vendor: 'Google',
      category: 'commercial',
      iconPath: 'images/platforms/google.png',
      docsUrl: 'https://developers.google.com/analytics/devguides/collection/ga4',
      color: '#E37400',
      priority: 1,
      identificationHints: {
        hosts: ['www.google-analytics.com', 'region1.google-analytics.com', 'analytics.google.com'],
        paths: ['/g/collect', '/mp/collect', '/collect', '/r/collect', '/batch', '/j/collect', '/debug/mp/collect'],
        queryKeys: ['tid', 'v', 'cid', 'en', 'measurement_id', 'api_secret'],
        headerKeys: [],
        bodyKeys: ['client_id', 'events', 'measurement_id'],
        globalVars: ['gtag', 'ga', 'dataLayer'],
        cookies: ['_ga', '_gid']
      }
    },

    // --- Baidu Tongji ---
    baidu: {
      id: 'baidu',
      label: '百度统计',
      shortLabel: 'BD',
      vendor: 'Baidu',
      category: 'commercial',
      iconPath: 'images/platforms/baidu.png',
      docsUrl: 'https://tongji.baidu.com/web/help/article?id=174',
      color: '#2932E1',
      priority: 1,
      identificationHints: {
        hosts: ['hm.baidu.com'],
        paths: ['/hm.gif', '/hm.js'],
        queryKeys: ['si'],
        headerKeys: [],
        bodyKeys: [],
        globalVars: ['_hmt'],
        cookies: ['HMACCOUNT', 'Hm_lvt_', 'Hm_lpvt_']
      }
    },

    // --- GrowingIO ---
    growingio: {
      id: 'growingio',
      label: 'GrowingIO',
      shortLabel: 'GIO',
      vendor: 'GrowingIO',
      category: 'commercial',
      iconPath: 'images/platforms/growingio.png',
      docsUrl: 'https://docs.growingio.com/',
      color: '#1AB394',
      priority: 2,
      identificationHints: {
        hosts: ['napi.growingio.com', 'api.growingio.com'],
        paths: ['/v3/', '/v2/', '/s.gif', '/collect'],
        queryKeys: [],
        headerKeys: [],
        bodyKeys: ['eventType', 'dataSourceId', 'sessionId', 'deviceId'],
        globalVars: ['gdp', 'gio'],
        cookies: ['grwng_uid', 'grwng_sid']
      }
    },

    // --- Mixpanel ---
    mixpanel: {
      id: 'mixpanel',
      label: 'Mixpanel',
      shortLabel: 'MP',
      vendor: 'Mixpanel',
      category: 'commercial',
      iconPath: 'images/platforms/mixpanel.png',
      docsUrl: 'https://developer.mixpanel.com/reference/track-event',
      color: '#7856FF',
      priority: 2,
      identificationHints: {
        hosts: ['api-js.mixpanel.com', 'api.mixpanel.com', 'api-eu.mixpanel.com'],
        paths: ['/track/', '/track', '/engage/', '/engage', '/groups/', '/record/', '/import', '/decide'],
        queryKeys: [],
        headerKeys: [],
        bodyKeys: ['event', 'properties', '$token', 'token', 'distinct_id'],
        globalVars: ['mixpanel'],
        cookies: ['mp_*_mixpanel']
      }
    },

    // --- Segment ---
    segment: {
      id: 'segment',
      label: 'Segment',
      shortLabel: 'SEG',
      vendor: 'Twilio',
      category: 'commercial',
      iconPath: 'images/platforms/segment.png',
      docsUrl: 'https://segment.com/docs/connections/sources/catalog/libraries/website/javascript/',
      color: '#52BD95',
      priority: 2,
      identificationHints: {
        hosts: ['api.segment.io', 'cdn.segment.com', 'events.eu1.segmentapis.com'],
        paths: ['/v1/t', '/v1/p', '/v1/i', '/v1/batch', '/v1/track', '/v1/page', '/v1/identify'],
        queryKeys: [],
        headerKeys: ['Authorization'],
        bodyKeys: ['anonymousId', 'writeKey', 'messageId', 'userId', 'type'],
        globalVars: ['analytics'],
        cookies: ['ajs_anonymous_id', 'ajs_user_id']
      }
    },

    // --- Amplitude ---
    amplitude: {
      id: 'amplitude',
      label: 'Amplitude',
      shortLabel: 'AMP',
      vendor: 'Amplitude',
      category: 'commercial',
      iconPath: 'images/platforms/amplitude.png',
      docsUrl: 'https://www.docs.developers.amplitude.com/analytics/apis/http-v2-api/',
      color: '#1D61F0',
      priority: 2,
      identificationHints: {
        hosts: ['api2.amplitude.com', 'api.amplitude.com', 'api.eu.amplitude.com'],
        paths: ['/2/httpapi', '/groupidentify'],
        queryKeys: [],
        headerKeys: [],
        bodyKeys: ['api_key', 'events', 'event_type'],
        globalVars: ['amplitude'],
        cookies: ['AMP_']
      }
    },

    // --- Matomo ---
    matomo: {
      id: 'matomo',
      label: 'Matomo',
      shortLabel: 'MTM',
      vendor: 'Matomo (Open Source)',
      category: 'opensource',
      iconPath: 'images/platforms/matomo.png',
      docsUrl: 'https://developer.matomo.org/api-reference/tracking-api',
      color: '#3152A0',
      priority: 3,
      identificationHints: {
        hosts: [],
        paths: ['/matomo.php', '/piwik.php'],
        queryKeys: ['idsite', 'rec'],
        headerKeys: [],
        bodyKeys: [],
        globalVars: ['_paq', 'Matomo', 'Piwik'],
        cookies: ['_pk_id', '_pk_ses']
      }
    },

    // --- Plausible ---
    plausible: {
      id: 'plausible',
      label: 'Plausible',
      shortLabel: 'PL',
      vendor: 'Plausible (Open Source)',
      category: 'opensource',
      iconPath: 'images/platforms/plausible.png',
      docsUrl: 'https://plausible.io/docs',
      color: '#5850EC',
      priority: 3,
      identificationHints: {
        hosts: ['plausible.io'],
        paths: ['/api/event'],
        queryKeys: [],
        headerKeys: [],
        bodyKeys: ['name', 'url', 'domain'],
        globalVars: ['plausible'],
        cookies: []
      }
    },

    // --- Umami ---
    umami: {
      id: 'umami',
      label: 'Umami',
      shortLabel: 'UMA',
      vendor: 'Umami (Open Source)',
      category: 'opensource',
      iconPath: 'images/platforms/umami.png',
      docsUrl: 'https://umami.is/docs',
      color: '#000000',
      priority: 3,
      identificationHints: {
        hosts: [],
        paths: ['/api/send', '/api/collect'],
        queryKeys: [],
        headerKeys: [],
        bodyKeys: ['payload', 'website', 'hostname'],
        globalVars: ['umami'],
        cookies: []
      }
    },

    // --- PostHog ---
    posthog: {
      id: 'posthog',
      label: 'PostHog',
      shortLabel: 'PH',
      vendor: 'PostHog',
      category: 'opensource',
      iconPath: 'images/platforms/posthog.png',
      docsUrl: 'https://posthog.com/docs/api/capture',
      color: '#F9BD2B',
      priority: 3,
      identificationHints: {
        hosts: ['us.i.posthog.com', 'eu.i.posthog.com', 'app.posthog.com'],
        paths: ['/i/v0/e', '/capture', '/capture/', '/batch/', '/e/', '/e', '/decide', '/s/'],
        queryKeys: [],
        headerKeys: [],
        bodyKeys: ['api_key', 'event', 'distinct_id', 'properties', 'batch'],
        globalVars: ['posthog'],
        cookies: []
      }
    },

    // --- TikTok Pixel ---
    tiktok: {
      id: 'tiktok',
      label: 'TikTok Pixel',
      shortLabel: 'TT',
      vendor: 'TikTok / ByteDance',
      category: 'commercial',
      iconPath: 'images/platforms/tiktok.png',
      docsUrl: 'https://ads.tiktok.com/marketing_api/docs',
      color: '#000000',
      priority: 4,
      identificationHints: {
        hosts: ['analytics.tiktok.com', 'business-api.tiktok.com'],
        paths: ['/api/v2/pixel', '/i18n/pixel/events.js', '/i18n/pixel/static/main.js', '/pixel/track'],
        queryKeys: ['sdkid'],
        headerKeys: [],
        bodyKeys: [],
        globalVars: ['ttq', 'TiktokAnalyticsObject'],
        cookies: ['_ttp']
      }
    },

    // --- Heap Analytics ---
    heap: {
      id: 'heap',
      label: 'Heap',
      shortLabel: 'HP',
      vendor: 'Heap (Contentsquare)',
      category: 'commercial',
      iconPath: 'images/platforms/heap.png',
      docsUrl: 'https://developers.heap.io/docs',
      color: '#5C3FDD',
      priority: 4,
      identificationHints: {
        hosts: ['c.us.heap-api.com', 'c.eu.heap-api.com', 'cdn.us.heap-api.com', 'cdn.eu.heap-api.com'],
        paths: ['/api/track', '/api/identify', '/api/add_user_properties'],
        queryKeys: [],
        headerKeys: [],
        bodyKeys: [],
        globalVars: ['heap'],
        cookies: ['_hp2_id', '_hp2_ses_props']
      }
    },

    // --- Hotjar ---
    hotjar: {
      id: 'hotjar',
      label: 'Hotjar',
      shortLabel: 'HJ',
      vendor: 'Hotjar (Contentsquare)',
      category: 'commercial',
      iconPath: 'images/platforms/hotjar.png',
      docsUrl: 'https://help.hotjar.com/hc/en-us',
      color: '#FD3A5C',
      priority: 4,
      identificationHints: {
        hosts: ['static.hotjar.com', 'in.hotjar.com', 'vc.hotjar.io', 'ws.hotjar.com'],
        paths: ['/c/hotjar-', '/api/v2/client/sites'],
        queryKeys: [],
        headerKeys: [],
        bodyKeys: [],
        globalVars: ['hj', '_hjSettings'],
        cookies: ['_hjSessionUser_', '_hjSession_']
      }
    },

    // --- Microsoft Clarity ---
    clarity: {
      id: 'clarity',
      label: 'Microsoft Clarity',
      shortLabel: 'CL',
      vendor: 'Microsoft',
      category: 'commercial',
      iconPath: 'images/platforms/clarity.png',
      docsUrl: 'https://learn.microsoft.com/en-us/clarity/',
      color: '#5C2D91',
      priority: 4,
      identificationHints: {
        hosts: ['www.clarity.ms'],
        paths: ['/collect', '/tag/'],
        queryKeys: [],
        headerKeys: [],
        bodyKeys: [],
        globalVars: ['clarity'],
        cookies: ['_clck', '_clsk']
      }
    },

    // --- Adobe Analytics ---
    adobe: {
      id: 'adobe',
      label: 'Adobe Analytics',
      shortLabel: 'AA',
      vendor: 'Adobe',
      category: 'commercial',
      iconPath: 'images/platforms/adobe.png',
      docsUrl: 'https://experienceleague.adobe.com/docs/analytics/',
      color: '#FF0000',
      priority: 4,
      identificationHints: {
        hosts: ['sc.omtrdc.net', 'edge.adobedc.net'],
        paths: ['/b/ss/', '/ee/', '/ee-pre-prd/', '/interact'],
        queryKeys: ['pageName', 'events'],
        headerKeys: [],
        bodyKeys: ['xdm', '__adobe'],
        globalVars: ['s', 'alloy', 's_gi'],
        cookies: ['s_vi', 's_fid', 'AMCV_']
      }
    },

    // --- Unknown / Fallback ---
    unknown: {
      id: 'unknown',
      label: '未知平台',
      shortLabel: '?',
      vendor: 'Unknown',
      category: 'unknown',
      iconPath: 'images/platforms/unknown.png',
      docsUrl: '',
      color: '#6B7280',
      priority: 99,
      identificationHints: {
        hosts: [],
        paths: [],
        queryKeys: [],
        headerKeys: [],
        bodyKeys: [],
        globalVars: [],
        cookies: []
      }
    }
  };

  /**
   * Get a platform by id.
   * @param {string} id - Platform id
   * @returns {Object|null} Platform catalog item or null
   */
  function getPlatform(id) {
    return PLATFORMS[id] || null;
  }

  /**
   * Get all platforms (excluding 'unknown').
   * @returns {Object[]} Array of platform catalog items
   */
  function getAllPlatforms() {
    var result = [];
    for (var key in PLATFORMS) {
      if (PLATFORMS.hasOwnProperty(key) && key !== 'unknown') {
        result.push(PLATFORMS[key]);
      }
    }
    return result;
  }

  /**
   * Get all platform ids (excluding 'unknown').
   * @returns {string[]}
   */
  function getAllPlatformIds() {
    var result = [];
    for (var key in PLATFORMS) {
      if (PLATFORMS.hasOwnProperty(key) && key !== 'unknown') {
        result.push(key);
      }
    }
    return result;
  }

  /**
   * Get platforms by category.
   * @param {string} category - 'commercial', 'opensource', or 'unknown'
   * @returns {Object[]}
   */
  function getPlatformsByCategory(category) {
    var result = [];
    for (var key in PLATFORMS) {
      if (PLATFORMS.hasOwnProperty(key) && PLATFORMS[key].category === category) {
        result.push(PLATFORMS[key]);
      }
    }
    return result;
  }

  /**
   * Get platforms sorted by priority (lower = higher priority).
   * @returns {Object[]}
   */
  function getPlatformsByPriority() {
    return getAllPlatforms().sort(function (a, b) {
      return a.priority - b.priority;
    });
  }

  // --- Expose on global namespace ---
  root.TeaRadar.PlatformCatalog = {
    PLATFORMS: PLATFORMS,
    getPlatform: getPlatform,
    getAllPlatforms: getAllPlatforms,
    getAllPlatformIds: getAllPlatformIds,
    getPlatformsByCategory: getPlatformsByCategory,
    getPlatformsByPriority: getPlatformsByPriority
  };
})();
