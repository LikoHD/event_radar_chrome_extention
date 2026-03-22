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

    // --- Microsoft Advertising UET ---
    microsoft_uet: {
      id: 'microsoft_uet',
      label: 'Microsoft UET',
      shortLabel: 'UET',
      vendor: 'Microsoft Advertising',
      category: 'commercial',
      iconPath: 'images/platforms/microsoft-uet.png',
      docsUrl: 'https://learn.microsoft.com/en-us/advertising/guides/universal-event-tracking?view=bingads-13',
      color: '#008373',
      priority: 2,
      identificationHints: {
        hosts: ['bat.bing.com'],
        paths: ['/action/0'],
        queryKeys: ['ti', 'evt', 'u', 'mid'],
        headerKeys: [],
        bodyKeys: [],
        globalVars: ['uetq'],
        cookies: ['_uetmsclkid', '_uetsid', '_uetvid']
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

    // --- Alibaba / Taobao Goldlog & ARMS ---
    alibaba: {
      id: 'alibaba',
      label: '阿里/淘宝',
      shortLabel: 'ALI',
      vendor: 'Alibaba Group',
      category: 'commercial',
      iconPath: 'images/platforms/alibaba.png',
      docsUrl: '',
      color: '#FF6A00',
      priority: 1,
      identificationHints: {
        hosts: ['gm.mmstat.com', 's-gm.mmstat.com', 'log.mmstat.com', 'g.aplus.taobao.com', 'gj.mmstat.com'],
        paths: ['/arms.1.1', '/jstracker.3', '/y.gif'],
        queryKeys: ['gokey', 'gmkey', 'logtype', 'cna'],
        headerKeys: [],
        bodyKeys: ['gmkey', 'gokey', 'logtype'],
        globalVars: ['aplus_queue', 'goldlog'],
        cookies: ['cna']
      }
    },

    // --- Tencent Beacon / QQ ---
    tencent: {
      id: 'tencent',
      label: '腾讯/QQ',
      shortLabel: 'QQ',
      vendor: 'Tencent',
      category: 'commercial',
      iconPath: 'images/platforms/tencent.png',
      docsUrl: 'https://cloud.tencent.com/document/product/248/87280',
      color: '#0F7BFF',
      priority: 1,
      identificationHints: {
        hosts: ['otheve.beacon.qq.com', 'snowflake.qq.com'],
        paths: ['/analytics/v2_upload', '/ola/v2'],
        queryKeys: ['appkey'],
        headerKeys: [],
        bodyKeys: ['sdkId', 'sdkVersion', 'common', 'events'],
        globalVars: ['Aegis'],
        cookies: []
      }
    },

    // --- NetEase NTM / VMonitor ---
    netease: {
      id: 'netease',
      label: '网易',
      shortLabel: 'WY',
      vendor: 'NetEase',
      category: 'commercial',
      iconPath: 'images/platforms/netease.png',
      docsUrl: '',
      color: '#E60012',
      priority: 1,
      identificationHints: {
        hosts: ['h5.analytics.126.net', 'vmonitor.ws.netease.com'],
        paths: ['/news/c', '/web/performance', '/web/resource'],
        queryKeys: ['param', 'projectid'],
        headerKeys: [],
        bodyKeys: [],
        globalVars: [],
        cookies: []
      }
    },

    // --- Didi Omega ---
    didi: {
      id: 'didi',
      label: '滴滴',
      shortLabel: 'DD',
      vendor: 'DiDi Global',
      category: 'commercial',
      iconPath: 'images/platforms/didi.png',
      docsUrl: '',
      color: '#FF7A00',
      priority: 1,
      identificationHints: {
        hosts: ['omgup.didiglobal.com'],
        paths: ['/api/web/stat'],
        queryKeys: ['e'],
        headerKeys: [],
        bodyKeys: ['e', 'attrs', 'oid', 'uwid'],
        globalVars: [],
        cookies: []
      }
    },

    // --- Meituan LX / Owl ---
    meituan: {
      id: 'meituan',
      label: '美团',
      shortLabel: 'MT',
      vendor: 'Meituan',
      category: 'commercial',
      iconPath: 'images/platforms/meituan.png',
      docsUrl: '',
      color: '#FFD100',
      priority: 1,
      identificationHints: {
        hosts: ['lx1.meituan.net', 'lx2.meituan.net', 'lx.meituan.net', 'catfront.dianping.com'],
        paths: ['/api/pv', '/batch', '/api/metric', '/raptorapi/fstSpeed'],
        queryKeys: ['d'],
        headerKeys: [],
        bodyKeys: ['project', 'pageUrl', 'realUrl', 'infos'],
        globalVars: [],
        cookies: []
      }
    },

    // --- JD Mercury ---
    jd: {
      id: 'jd',
      label: '京东',
      shortLabel: 'JD',
      vendor: 'JD.com',
      category: 'commercial',
      iconPath: 'images/platforms/jd.png',
      docsUrl: '',
      color: '#E2231A',
      priority: 1,
      identificationHints: {
        hosts: ['mercury.jd.com'],
        paths: ['/log.gif'],
        queryKeys: ['uid', 'sid', 'v', 't'],
        headerKeys: [],
        bodyKeys: [],
        globalVars: [],
        cookies: []
      }
    },

    // --- Bilibili Web Logger ---
    bilibili: {
      id: 'bilibili',
      label: 'B站',
      shortLabel: 'B',
      vendor: 'Bilibili',
      category: 'commercial',
      iconPath: 'images/platforms/bilibili.png',
      docsUrl: '',
      color: '#00A1D6',
      priority: 1,
      identificationHints: {
        hosts: ['data.bilibili.com', 'cm.bilibili.com'],
        paths: ['/log/web', '/v2/log/web', '/cm/api/fees/pc'],
        queryKeys: ['content_type', 'spm_id_from'],
        headerKeys: [],
        bodyKeys: [],
        globalVars: [],
        cookies: ['buvid3', 'buvid4', '_uuid']
      }
    },

    // --- Ctrip UBT / Bee ---
    ctrip: {
      id: 'ctrip',
      label: '携程',
      shortLabel: 'CT',
      vendor: 'Trip.com Group',
      category: 'commercial',
      iconPath: 'images/platforms/ctrip.png',
      docsUrl: '',
      color: '#1A73E8',
      priority: 2,
      identificationHints: {
        hosts: ['s.c-ctrip.com', 'ma-adx.ctrip.com'],
        paths: ['/bee/collect', '/_ma.gif'],
        queryKeys: ['metaSender', 'contextTs', 'vid', 'sid', 'pvId', 'appId', 'key'],
        headerKeys: [],
        bodyKeys: ['d', 'ac'],
        globalVars: [],
        cookies: ['_bfa', 'UBT_VID']
      }
    },

    // --- Amazon Internal Telemetry ---
    amazon: {
      id: 'amazon',
      label: 'Amazon',
      shortLabel: 'AMZ',
      vendor: 'Amazon',
      category: 'commercial',
      iconPath: 'images/platforms/amazon.png',
      docsUrl: '',
      color: '#FF9900',
      priority: 2,
      identificationHints: {
        hosts: ['fls-na.amazon.com', 'unagi.amazon.com'],
        paths: ['/1/batch/1/OP/', '/tt/i', '/1/events/com.amazon.csm.nexusclient.prod'],
        queryKeys: ['uedata', 'productId', 'ts', 'firstImp'],
        headerKeys: [],
        bodyKeys: ['cs', 'events'],
        globalVars: [],
        cookies: ['csm-hit']
      }
    },

    // --- Meta / Facebook Pixel ---
    meta: {
      id: 'meta',
      label: 'Facebook / Meta Pixel',
      shortLabel: 'META',
      vendor: 'Meta',
      category: 'commercial',
      iconPath: 'images/platforms/meta.png',
      docsUrl: 'https://www.facebook.com/business/help/952192354843755',
      color: '#1877F2',
      priority: 2,
      identificationHints: {
        hosts: ['www.facebook.com', 'facebook.com', 'www.instagram.com'],
        paths: ['/tr'],
        queryKeys: ['id', 'ev', 'dl'],
        headerKeys: [],
        bodyKeys: [],
        globalVars: ['fbq'],
        cookies: ['_fbp', '_fbc']
      }
    },

    // --- LinkedIn Insight Tag ---
    linkedin: {
      id: 'linkedin',
      label: 'LinkedIn',
      shortLabel: 'IN',
      vendor: 'LinkedIn',
      category: 'commercial',
      iconPath: 'images/platforms/linkedin.png',
      docsUrl: 'https://www.linkedin.com/help/lms/answer/a427660',
      color: '#0A66C2',
      priority: 2,
      identificationHints: {
        hosts: ['px.ads.linkedin.com'],
        paths: ['/collect', '/db_sync'],
        queryKeys: ['pid', 'url', 'conversionId', 'eventId'],
        headerKeys: [],
        bodyKeys: [],
        globalVars: ['lintrk'],
        cookies: ['li_fat_id']
      }
    },

    // --- Pinterest Tag ---
    pinterest: {
      id: 'pinterest',
      label: 'Pinterest',
      shortLabel: 'PIN',
      vendor: 'Pinterest',
      category: 'commercial',
      iconPath: 'images/platforms/pinterest.png',
      docsUrl: 'https://help.pinterest.com/en/business/article/track-conversions-with-pinterest-tag',
      color: '#E60023',
      priority: 2,
      identificationHints: {
        hosts: ['ct.pinterest.com'],
        paths: ['/v3/'],
        queryKeys: ['tid', 'event'],
        headerKeys: [],
        bodyKeys: [],
        globalVars: ['pintrk'],
        cookies: ['_pinterest_ct_ua']
      }
    },

    // --- Reddit Pixel ---
    reddit: {
      id: 'reddit',
      label: 'Reddit Pixel',
      shortLabel: 'RDT',
      vendor: 'Reddit',
      category: 'commercial',
      iconPath: 'images/platforms/reddit.png',
      docsUrl: 'https://business.reddithelp.com/articles/Knowledge/Web-Attribution-Overview',
      color: '#FF4500',
      priority: 2,
      identificationHints: {
        hosts: ['alb.reddit.com'],
        paths: ['/rp.gif'],
        queryKeys: ['id', 'event', 'uuid'],
        headerKeys: [],
        bodyKeys: [],
        globalVars: ['rdt'],
        cookies: ['_rdt_uuid']
      }
    },

    // --- X Pixel ---
    x: {
      id: 'x',
      label: 'X Pixel',
      shortLabel: 'X',
      vendor: 'X Corp',
      category: 'commercial',
      iconPath: 'images/platforms/x.png',
      docsUrl: 'https://business.x.com/en/help/campaign-measurement-and-analytics/conversion-tracking-for-websites',
      color: '#111111',
      priority: 2,
      identificationHints: {
        hosts: ['analytics.twitter.com'],
        paths: ['/i/adsct', '/i/adsctp'],
        queryKeys: ['event', 'events', 'event_id', 'txn_id', 'tw_document_href', 'conversion_id', 'currency'],
        headerKeys: [],
        bodyKeys: ['event', 'event_id', 'txn_id', 'conversion_id', 'contents'],
        globalVars: ['twq'],
        cookies: ['personalization_id']
      }
    },

    // --- Zhihu ZA / DataHub ---
    zhihu: {
      id: 'zhihu',
      label: '知乎',
      shortLabel: 'ZH',
      vendor: 'Zhihu',
      category: 'commercial',
      iconPath: 'images/platforms/zhihu.png',
      docsUrl: '',
      color: '#1677FF',
      priority: 2,
      identificationHints: {
        hosts: ['zhihu-web-analytics.zhihu.com', 'datahub.zhihu.com', 'apm.zhihu.com'],
        paths: ['/api/v2/za/logs/batch', '/api/v3inv2/za/logs/batch', '/collector/zlab', '/collector/apm'],
        queryKeys: [],
        headerKeys: ['x-za-platform', 'x-za-clientid', 'x-za-product'],
        bodyKeys: [],
        globalVars: [],
        cookies: []
      }
    },

    // --- Weibo Website Telemetry ---
    weibo: {
      id: 'weibo',
      label: '微博',
      shortLabel: 'WB',
      vendor: 'Weibo / Sina',
      category: 'commercial',
      iconPath: 'images/platforms/weibo.png',
      docsUrl: '',
      color: '#E6162D',
      priority: 2,
      identificationHints: {
        hosts: [],
        paths: ['/ajax/log/action', '/ajax/log/read', '/ajax/log/detectVideoCodecSupport'],
        queryKeys: ['type', 'act_code', 'uicode', 'fid', 'ext', 'data'],
        headerKeys: ['x-requested-with', 'x-xsrf-token', 'client-version'],
        bodyKeys: ['data'],
        globalVars: [],
        cookies: ['SUB', 'XSRF-TOKEN']
      }
    },

    // --- Snap Pixel ---
    snap: {
      id: 'snap',
      label: 'Snap Pixel',
      shortLabel: 'SNAP',
      vendor: 'Snap',
      category: 'commercial',
      iconPath: 'images/platforms/snap.png',
      docsUrl: 'https://forbusiness.snapchat.com/learn-with-snap/web-success',
      color: '#FFFC00',
      priority: 2,
      identificationHints: {
        hosts: ['tr.snapchat.com'],
        paths: ['/p', '/cm/i', '/cm/p'],
        queryKeys: ['event', 'ev', 'transaction_id', 'price', 'currency', 'pid', 'pixel_id'],
        headerKeys: [],
        bodyKeys: ['event', 'transaction_id', 'price', 'currency', 'contents', 'item_ids'],
        globalVars: ['snaptr'],
        cookies: []
      }
    },

    // --- Xiaohongshu (小红书) Ranger Analytics ---
    xhs: {
      id: 'xhs',
      label: '小红书',
      shortLabel: 'XHS',
      vendor: 'Xiaohongshu',
      category: 'commercial',
      iconPath: 'images/platforms/xhs.png',
      docsUrl: '',
      color: '#FF2442',
      priority: 1,
      identificationHints: {
        hosts: ['t2.xiaohongshu.com'],
        paths: ['/api/v2/collect'],
        queryKeys: [],
        headerKeys: [],
        bodyKeys: [],
        globalVars: [],
        cookies: []
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
