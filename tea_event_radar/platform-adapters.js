/**
 * Platform Adapters - Matcher and parser for each analytics platform
 *
 * Each adapter provides:
 *   matcher(request)  -> { matched: bool, confidence: 0-1, matchedBy: string[] }
 *   parser(request)   -> NormalizedEvent[]
 *
 * Depends on: analytics-core.js (TeaRadar.AnalyticsCore)
 *             platform-catalog.js (TeaRadar.PlatformCatalog)
 */
(function () {
  var root = (typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this);
  root.TeaRadar = root.TeaRadar || {};

  var Core = root.TeaRadar.AnalyticsCore;
  var Catalog = root.TeaRadar.PlatformCatalog;

  // =========================================================================
  // Helper: safe wrapper for parser functions
  // =========================================================================

  function safeParse(platformId, parseFn, request) {
    try {
      var events = parseFn(request);
      return Array.isArray(events) ? events : [];
    } catch (e) {
      return [{
        platform: platformId,
        eventName: '[parse_error]',
        userId: '',
        anonymousId: '',
        distinctId: '',
        eventTime: '',
        properties: {},
        rawEvent: null,
        _warning: 'Parser error: ' + (e.message || String(e))
      }];
    }
  }

  /**
   * Build a standard match result.
   */
  function matchResult(matched, confidence, matchedBy) {
    return {
      matched: matched,
      confidence: Math.min(1, Math.max(0, confidence)),
      matchedBy: matchedBy || []
    };
  }

  /**
   * Prepare request context for matchers: parsed URL, parsed body, etc.
   * This is computed once and reused across all matchers.
   */
  function prepareRequestContext(request) {
    if (request._ctx) return request._ctx;

    var urlInfo = Core.parseUrl(request.url || '');
    var bodyParsed = null;
    var bodyStr = request.bodyRaw || request.requestData || '';

    if (typeof bodyStr === 'string' && bodyStr.length > 0) {
      var parsed = Core.parseBody(bodyStr);
      bodyParsed = parsed.data;
    }

    var ctx = {
      url: request.url || '',
      method: (request.method || 'GET').toUpperCase(),
      host: urlInfo.hostname,
      path: urlInfo.pathname,
      search: urlInfo.search,
      query: urlInfo.query,
      bodyStr: bodyStr,
      bodyParsed: bodyParsed,
      contentType: request.contentType || '',
      headers: request.headers || []
    };

    request._ctx = ctx;
    return ctx;
  }

  // =========================================================================
  // ADAPTER: DataRangers (ByteDance / Volcengine)
  // =========================================================================

  var datarangersAdapter = {
    id: 'datarangers',

    matcher: function (request) {
      var ctx = prepareRequestContext(request);
      var score = 0;
      var reasons = [];

      // Host match
      var hosts = ['mcs.zijieapi.com', 'mcs.tobsnssdk.com', 'applog.zijieapi.com'];
      for (var i = 0; i < hosts.length; i++) {
        if (Core.hostMatches(ctx.host, hosts[i])) {
          score += 0.4;
          reasons.push('host:' + hosts[i]);
          break;
        }
      }

      // Path contains /list
      if (Core.pathMatches(ctx.path, '/list')) {
        score += 0.3;
        reasons.push('path:/list');
      }

      // Query params: aid=, device_platform=
      if (ctx.query.aid) { score += 0.1; reasons.push('query:aid'); }
      if (ctx.query.device_platform) { score += 0.05; reasons.push('query:device_platform'); }
      if (ctx.query.sdk_version) { score += 0.05; reasons.push('query:sdk_version'); }

      // Header: X-MCS-AppKey
      if (ctx.headers && Array.isArray(ctx.headers)) {
        for (var h = 0; h < ctx.headers.length; h++) {
          if (ctx.headers[h].name && ctx.headers[h].name.toLowerCase() === 'x-mcs-appkey') {
            score += 0.15;
            reasons.push('header:X-MCS-AppKey');
            break;
          }
        }
      }

      // Body structure: events[], user, header
      if (ctx.bodyParsed) {
        var data = Array.isArray(ctx.bodyParsed) ? ctx.bodyParsed[0] : ctx.bodyParsed;
        if (data && data.events) { score += 0.15; reasons.push('body:events'); }
        if (data && data.user) { score += 0.05; reasons.push('body:user'); }
        if (data && data.header) { score += 0.05; reasons.push('body:header'); }
      }

      // POST method
      if (ctx.method === 'POST') { score += 0.05; reasons.push('method:POST'); }

      return matchResult(score >= 0.4, score, reasons);
    },

    parser: function (request) {
      var ctx = prepareRequestContext(request);
      var results = [];

      var dataArr = ctx.bodyParsed;
      if (!Array.isArray(dataArr)) dataArr = [dataArr];

      for (var i = 0; i < dataArr.length; i++) {
        var batch = dataArr[i];
        if (!batch || !batch.events) continue;

        var userId = Core.getNestedValue(batch, 'user.user_unique_id') || '';
        var deviceId = Core.getNestedValue(batch, 'user.bddid') ||
                       Core.getNestedValue(batch, 'user.web_id') || '';

        var events = Array.isArray(batch.events) ? batch.events : [];
        for (var j = 0; j < events.length; j++) {
          var evt = events[j];
          var params = {};
          if (evt.params) {
            if (typeof evt.params === 'string') {
              try { params = JSON.parse(evt.params); } catch (e) { params = { _raw: evt.params }; }
            } else {
              params = evt.params;
            }
          }

          results.push(Core.createNormalizedEvent({
            platform: 'datarangers',
            eventName: Core.decodeChineseText(evt.event || ''),
            userId: userId,
            anonymousId: deviceId,
            distinctId: userId || deviceId,
            eventTime: Core.normalizeTimestamp(evt.local_time_ms || evt.local_time),
            properties: Core.decodeObjectStrings(params),
            rawEvent: evt
          }));
        }
      }

      return results;
    }
  };

  // =========================================================================
  // ADAPTER: Sensors Data
  // =========================================================================

  var sensorsAdapter = {
    id: 'sensors',

    matcher: function (request) {
      var ctx = prepareRequestContext(request);
      var score = 0;
      var reasons = [];

      // Host contains sensorsdata
      if (ctx.host.indexOf('sensorsdata') !== -1) {
        score += 0.35;
        reasons.push('host:sensorsdata');
      }

      // Path /sa, /sa.gif (image pixel mode), or /batch (batch_send mode)
      if (ctx.path === '/sa' || ctx.path.indexOf('/sa?') !== -1 || ctx.path.indexOf('/sa/') !== -1) {
        score += 0.35;
        reasons.push('path:/sa');
      } else if (/\/sa\.gif\b/.test(ctx.path)) {
        score += 0.35;
        reasons.push('path:sa.gif');
      } else if (/\/batch\b/.test(ctx.path) && ctx.query.project) {
        score += 0.3;
        reasons.push('path:batch+project');
      }

      // Query: project= or token=
      if (ctx.query.project) { score += 0.15; reasons.push('query:project'); }
      if (ctx.query.token && ctx.host.indexOf('sensorsdata') !== -1) {
        score += 0.1;
        reasons.push('query:token');
      }

      // Body: data= or data_list= with optional gzip=1
      if (ctx.query.gzip || (ctx.bodyParsed && typeof ctx.bodyParsed === 'object')) {
        // Form-encoded with data/data_list
        if (ctx.query.data || ctx.query.data_list) {
          score += 0.2;
          reasons.push('query:data/data_list');
        }
      }

      // Body might be form-encoded with data/data_list (sensors base64 payload)
      if (ctx.bodyStr) {
        var hasDataKey = ctx.bodyStr.indexOf('data_list=') !== -1 || ctx.bodyStr.indexOf('data=') !== -1;
        if (hasDataKey) {
          if (ctx.bodyStr.indexOf('gzip=') !== -1) {
            score += 0.25;
            reasons.push('body:data+gzip');
          } else {
            // data= without gzip is still a strong sensors signal (non-gzip mode)
            score += 0.2;
            reasons.push('body:data(base64)');
          }
        }
      }

      // Form-parsed body with data/data_list key containing base64 string
      if (ctx.bodyParsed && typeof ctx.bodyParsed === 'object' && !Array.isArray(ctx.bodyParsed)) {
        var formData = ctx.bodyParsed;
        if ((formData.data && typeof formData.data === 'string' && formData.data.length > 20) ||
            (formData.data_list && typeof formData.data_list === 'string' && formData.data_list.length > 20)) {
          score += 0.15;
          reasons.push('body:form(data/data_list)');
        }
      }

      // Body as JSON with type field (track, track_signup, etc.)
      if (ctx.bodyParsed && typeof ctx.bodyParsed === 'object') {
        var data = Array.isArray(ctx.bodyParsed) ? ctx.bodyParsed[0] : ctx.bodyParsed;
        if (data) {
          var sensorTypes = ['track', 'track_signup', 'profile_set', 'profile_set_once',
                             'profile_increment', 'profile_append', 'profile_delete', 'profile_unset'];
          if (data.type && sensorTypes.indexOf(data.type) !== -1) {
            score += 0.3;
            reasons.push('body:type=' + data.type);
          }
          if (data.distinct_id !== undefined) {
            score += 0.1;
            reasons.push('body:distinct_id');
          }
        }
      }

      return matchResult(score >= 0.4, score, reasons);
    },

    parser: function (request) {
      var ctx = prepareRequestContext(request);
      var results = [];

      var dataItems = [];

      // Check if bodyParsed is form-encoded with data/data_list (sensors base64 payload)
      var isSensorsForm = false;
      if (ctx.bodyParsed && typeof ctx.bodyParsed === 'object' && !Array.isArray(ctx.bodyParsed)) {
        var encodedData = ctx.bodyParsed.data_list || ctx.bodyParsed.data || '';
        if (typeof encodedData === 'string' && encodedData.length > 20) {
          isSensorsForm = true;
          var decoded = Core.decodeSensorsPayload(encodedData);
          if (decoded && !decoded.__gzipped) {
            if (Array.isArray(decoded)) dataItems = decoded;
            else dataItems = [decoded];
          }
        }
      }

      // Try direct JSON body (only if not sensors form)
      if (!isSensorsForm && dataItems.length === 0 && ctx.bodyParsed) {
        if (Array.isArray(ctx.bodyParsed)) {
          dataItems = ctx.bodyParsed;
        } else if (typeof ctx.bodyParsed === 'object') {
          dataItems = [ctx.bodyParsed];
        }
      }

      // Fallback: try raw body string as form-encoded
      if (dataItems.length === 0 && ctx.bodyStr) {
        var formData = Core.tryParseFormData(ctx.bodyStr);
        if (formData) {
          var enc = formData.data_list || formData.data || '';
          if (enc) {
            var dec = Core.decodeSensorsPayload(enc);
            if (dec && !dec.__gzipped) {
              if (Array.isArray(dec)) dataItems = dec;
              else dataItems = [dec];
            }
          }
        }
      }

      for (var i = 0; i < dataItems.length; i++) {
        var item = dataItems[i];
        if (!item || typeof item !== 'object') continue;

        var props = item.properties || {};

        results.push(Core.createNormalizedEvent({
          platform: 'sensors',
          eventName: item.event || item.type || '',
          userId: item.login_id || '',
          anonymousId: item.anonymous_id || '',
          distinctId: item.distinct_id || '',
          eventTime: Core.normalizeTimestamp(item.time || item._flush_time),
          properties: Core.decodeObjectStrings(props),
          rawEvent: item
        }));
      }

      // If no events decoded (possibly gzipped), store async decode hint
      if (results.length === 0 && ctx.bodyParsed && typeof ctx.bodyParsed === 'object') {
        var encPayload = ctx.bodyParsed.data_list || ctx.bodyParsed.data || '';
        if (typeof encPayload === 'string' && encPayload.length > 20) {
          results.push(Core.createNormalizedEvent({
            platform: 'sensors',
            eventName: '[gzip_encoded]',
            properties: { _encodedPayload: encPayload, project: ctx.query.project || '' },
            rawEvent: ctx.bodyParsed
          }));
        }
      }

      return results;
    }
  };

  // =========================================================================
  // ADAPTER: Google Analytics (GA4 + Universal Analytics)
  // =========================================================================

  var googleAdapter = {
    id: 'google',

    matcher: function (request) {
      var ctx = prepareRequestContext(request);
      var score = 0;
      var reasons = [];

      // Host
      var gaHosts = ['www.google-analytics.com', 'region1.google-analytics.com',
                     'analytics.google.com', 'ssl.google-analytics.com'];
      for (var i = 0; i < gaHosts.length; i++) {
        if (Core.hostMatches(ctx.host, gaHosts[i])) {
          score += 0.4;
          reasons.push('host:' + gaHosts[i]);
          break;
        }
      }

      // Path
      var gaPaths = ['/g/collect', '/mp/collect', '/collect', '/r/collect', '/batch', '/j/collect'];
      for (var p = 0; p < gaPaths.length; p++) {
        if (Core.pathMatches(ctx.path, gaPaths[p])) {
          score += 0.3;
          reasons.push('path:' + gaPaths[p]);
          break;
        }
      }

      // Query params
      if (ctx.query.tid) {
        if (ctx.query.tid.indexOf('G-') === 0) {
          score += 0.2;
          reasons.push('query:tid=G-*');
        } else if (ctx.query.tid.indexOf('UA-') === 0) {
          score += 0.2;
          reasons.push('query:tid=UA-*');
        }
      }
      if (ctx.query.v === '2') { score += 0.1; reasons.push('query:v=2'); }
      if (ctx.query.v === '1') { score += 0.1; reasons.push('query:v=1'); }
      if (ctx.query.measurement_id) { score += 0.15; reasons.push('query:measurement_id'); }
      if (ctx.query.api_secret) { score += 0.1; reasons.push('query:api_secret'); }

      // Body: Measurement Protocol JSON
      if (ctx.bodyParsed && typeof ctx.bodyParsed === 'object' && !Array.isArray(ctx.bodyParsed)) {
        if (ctx.bodyParsed.client_id && ctx.bodyParsed.events) {
          score += 0.3;
          reasons.push('body:client_id+events');
        }
      }

      return matchResult(score >= 0.4, score, reasons);
    },

    parser: function (request) {
      var ctx = prepareRequestContext(request);
      var results = [];

      // GA4 client-side: params in query string
      if (ctx.query.tid || ctx.query.v) {
        // Merge query and body params (POST body may also contain same format)
        var allParams = {};
        for (var k in ctx.query) {
          if (ctx.query.hasOwnProperty(k)) allParams[k] = ctx.query[k];
        }
        // If POST body is form-encoded, merge
        if (ctx.bodyStr && ctx.method === 'POST') {
          var bodyParams = Core.tryParseFormData(ctx.bodyStr);
          if (bodyParams) {
            for (var bk in bodyParams) {
              if (bodyParams.hasOwnProperty(bk)) allParams[bk] = bodyParams[bk];
            }
          }
        }

        var ga4Data = Core.parseGA4Params(allParams);
        if (ga4Data.events.length > 0) {
          for (var i = 0; i < ga4Data.events.length; i++) {
            var evt = ga4Data.events[i];
            results.push(Core.createNormalizedEvent({
              platform: 'google',
              eventName: evt.name,
              userId: ga4Data.userId,
              anonymousId: ga4Data.clientId,
              distinctId: ga4Data.userId || ga4Data.clientId,
              eventTime: '',
              properties: evt.params,
              rawEvent: allParams
            }));
          }
        } else {
          // Fallback: create single event from query
          results.push(Core.createNormalizedEvent({
            platform: 'google',
            eventName: allParams.t || allParams.en || 'pageview',
            userId: allParams.uid || '',
            anonymousId: allParams.cid || '',
            distinctId: allParams.uid || allParams.cid || '',
            eventTime: '',
            properties: allParams,
            rawEvent: allParams
          }));
        }
        return results;
      }

      // Measurement Protocol JSON (server-side or MP collect)
      if (ctx.bodyParsed && ctx.bodyParsed.client_id) {
        var mpEvents = ctx.bodyParsed.events || [];
        for (var j = 0; j < mpEvents.length; j++) {
          var mpEvt = mpEvents[j];
          results.push(Core.createNormalizedEvent({
            platform: 'google',
            eventName: mpEvt.name || '',
            userId: ctx.bodyParsed.user_id || '',
            anonymousId: ctx.bodyParsed.client_id || '',
            distinctId: ctx.bodyParsed.user_id || ctx.bodyParsed.client_id || '',
            eventTime: '',
            properties: mpEvt.params || {},
            rawEvent: mpEvt
          }));
        }
      }

      return results;
    }
  };

  // =========================================================================
  // ADAPTER: Baidu Tongji
  // =========================================================================

  var baiduAdapter = {
    id: 'baidu',

    matcher: function (request) {
      var ctx = prepareRequestContext(request);
      var score = 0;
      var reasons = [];

      // Host
      if (Core.hostMatches(ctx.host, 'hm.baidu.com')) {
        score += 0.5;
        reasons.push('host:hm.baidu.com');
      }

      // Path
      if (Core.pathMatches(ctx.path, '/hm.gif')) {
        score += 0.3;
        reasons.push('path:/hm.gif');
      }
      if (Core.pathMatches(ctx.path, '/hm.js')) {
        score += 0.1;
        reasons.push('path:/hm.js');
      }

      // Query: si= (32-char hex site id)
      if (ctx.query.si && /^[a-f0-9]{32}$/i.test(ctx.query.si)) {
        score += 0.2;
        reasons.push('query:si');
      }

      return matchResult(score >= 0.4, score, reasons);
    },

    parser: function (request) {
      var ctx = prepareRequestContext(request);
      var results = [];

      // Baidu uses query parameters for everything
      var params = ctx.query;
      var eventType = 'pageview';
      if (params.et) eventType = 'event';

      results.push(Core.createNormalizedEvent({
        platform: 'baidu',
        eventName: eventType,
        userId: '',
        anonymousId: params.si || '',
        distinctId: params.si || '',
        eventTime: params.lt ? Core.normalizeTimestamp(parseInt(params.lt, 10)) : '',
        properties: {
          siteId: params.si || '',
          pageUrl: params.su || '',
          screenSize: params.ds || '',
          language: params.ln || '',
          stayTime: params.ep || '',
          sdkVersion: params.v || '',
          colorDepth: params.cl || ''
        },
        rawEvent: params
      }));

      return results;
    }
  };

  // =========================================================================
  // ADAPTER: GrowingIO
  // =========================================================================

  var growingioAdapter = {
    id: 'growingio',

    matcher: function (request) {
      var ctx = prepareRequestContext(request);
      var score = 0;
      var reasons = [];

      // Host
      if (Core.hostMatches(ctx.host, 'growingio.com') ||
          Core.hostMatches(ctx.host, 'napi.growingio.com')) {
        score += 0.4;
        reasons.push('host:growingio.com');
      }

      // Path
      if (Core.pathMatches(ctx.path, '/v3/') || Core.pathMatches(ctx.path, '/v2/')) {
        score += 0.2;
        reasons.push('path:/v3/ or /v2/');
      }
      if (Core.pathMatches(ctx.path, '/collect')) {
        score += 0.1;
        reasons.push('path:/collect');
      }

      // Body structure
      if (ctx.bodyParsed && typeof ctx.bodyParsed === 'object') {
        var data = Array.isArray(ctx.bodyParsed) ? ctx.bodyParsed[0] : ctx.bodyParsed;
        if (data) {
          if (data.eventType) { score += 0.2; reasons.push('body:eventType'); }
          if (data.dataSourceId) { score += 0.1; reasons.push('body:dataSourceId'); }
          if (data.sessionId !== undefined) { score += 0.05; reasons.push('body:sessionId'); }
          if (data.deviceId !== undefined) { score += 0.05; reasons.push('body:deviceId'); }
        }
      }

      return matchResult(score >= 0.4, score, reasons);
    },

    parser: function (request) {
      var ctx = prepareRequestContext(request);
      var results = [];

      var items = Array.isArray(ctx.bodyParsed) ? ctx.bodyParsed : [ctx.bodyParsed];

      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (!item || typeof item !== 'object') continue;

        results.push(Core.createNormalizedEvent({
          platform: 'growingio',
          eventName: item.eventType || item.t || '',
          userId: item.userId || '',
          anonymousId: item.deviceId || '',
          distinctId: item.userId || item.deviceId || '',
          eventTime: Core.normalizeTimestamp(item.timestamp),
          properties: item.attributes || {},
          rawEvent: item
        }));
      }

      return results;
    }
  };

  // =========================================================================
  // ADAPTER: Mixpanel
  // =========================================================================

  var mixpanelAdapter = {
    id: 'mixpanel',

    matcher: function (request) {
      var ctx = prepareRequestContext(request);
      var score = 0;
      var reasons = [];

      // Host
      var mpHosts = ['api-js.mixpanel.com', 'api.mixpanel.com', 'api-eu.mixpanel.com'];
      for (var i = 0; i < mpHosts.length; i++) {
        if (Core.hostMatches(ctx.host, mpHosts[i])) {
          score += 0.4;
          reasons.push('host:' + mpHosts[i]);
          break;
        }
      }

      // Path
      var mpPaths = ['/track/', '/track', '/engage/', '/engage', '/groups/', '/record/', '/import'];
      for (var p = 0; p < mpPaths.length; p++) {
        if (Core.pathMatches(ctx.path, mpPaths[p])) {
          score += 0.3;
          reasons.push('path:' + mpPaths[p]);
          break;
        }
      }

      // Body
      if (ctx.bodyParsed) {
        var data = Array.isArray(ctx.bodyParsed) ? ctx.bodyParsed[0] : ctx.bodyParsed;
        if (data) {
          if (data.event !== undefined && data.properties) {
            score += 0.2;
            reasons.push('body:event+properties');
          }
          if (data.properties && data.properties.token) {
            score += 0.1;
            reasons.push('body:properties.token');
          }
          if (data.$token) { score += 0.15; reasons.push('body:$token'); }
          if (data.$distinct_id) { score += 0.1; reasons.push('body:$distinct_id'); }
        }
      }

      // Query: data= (base64 encoded)
      if (ctx.query.data) {
        score += 0.1;
        reasons.push('query:data');
      }

      return matchResult(score >= 0.4, score, reasons);
    },

    parser: function (request) {
      var ctx = prepareRequestContext(request);
      var results = [];

      var items = [];
      if (Array.isArray(ctx.bodyParsed)) {
        items = ctx.bodyParsed;
      } else if (ctx.bodyParsed && typeof ctx.bodyParsed === 'object') {
        items = [ctx.bodyParsed];
      }

      // Also try base64-encoded data in query
      if (items.length === 0 && ctx.query.data) {
        try {
          var decoded = atob(ctx.query.data);
          var parsed = Core.tryParseJSON(decoded);
          if (parsed) items = Array.isArray(parsed) ? parsed : [parsed];
        } catch (e) { /* ignore */ }
      }

      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (!item) continue;

        var isEngage = ctx.path.indexOf('/engage') !== -1;

        if (isEngage) {
          results.push(Core.createNormalizedEvent({
            platform: 'mixpanel',
            eventName: '$set' in item ? '$set' : '$engage',
            userId: item.$distinct_id || '',
            anonymousId: '',
            distinctId: item.$distinct_id || '',
            eventTime: '',
            properties: item.$set || item.$add || item.$union || {},
            rawEvent: item
          }));
        } else {
          var props = item.properties || {};
          results.push(Core.createNormalizedEvent({
            platform: 'mixpanel',
            eventName: item.event || '',
            userId: props.$user_id || '',
            anonymousId: props.$device_id || '',
            distinctId: props.distinct_id || '',
            eventTime: Core.normalizeTimestamp(props.time),
            properties: props,
            rawEvent: item
          }));
        }
      }

      return results;
    }
  };

  // =========================================================================
  // ADAPTER: Segment
  // =========================================================================

  var segmentAdapter = {
    id: 'segment',

    matcher: function (request) {
      var ctx = prepareRequestContext(request);
      var score = 0;
      var reasons = [];

      // Host
      var segHosts = ['api.segment.io', 'cdn.segment.com', 'events.eu1.segmentapis.com'];
      for (var i = 0; i < segHosts.length; i++) {
        if (Core.hostMatches(ctx.host, segHosts[i])) {
          score += 0.4;
          reasons.push('host:' + segHosts[i]);
          break;
        }
      }

      // Path
      var segPaths = ['/v1/t', '/v1/p', '/v1/i', '/v1/batch', '/v1/track', '/v1/page', '/v1/identify'];
      for (var p = 0; p < segPaths.length; p++) {
        if (ctx.path === segPaths[p] || ctx.path.indexOf(segPaths[p]) === 0) {
          score += 0.3;
          reasons.push('path:' + segPaths[p]);
          break;
        }
      }

      // Auth header
      if (ctx.headers && Array.isArray(ctx.headers)) {
        for (var h = 0; h < ctx.headers.length; h++) {
          if (ctx.headers[h].name && ctx.headers[h].name.toLowerCase() === 'authorization' &&
              ctx.headers[h].value && ctx.headers[h].value.indexOf('Basic') !== -1) {
            score += 0.1;
            reasons.push('header:Authorization:Basic');
            break;
          }
        }
      }

      // Body
      if (ctx.bodyParsed && typeof ctx.bodyParsed === 'object') {
        if (ctx.bodyParsed.anonymousId) { score += 0.15; reasons.push('body:anonymousId'); }
        if (ctx.bodyParsed.writeKey) { score += 0.15; reasons.push('body:writeKey'); }
        if (ctx.bodyParsed.messageId) { score += 0.1; reasons.push('body:messageId'); }
        if (ctx.bodyParsed.type) { score += 0.05; reasons.push('body:type'); }
      }

      return matchResult(score >= 0.4, score, reasons);
    },

    parser: function (request) {
      var ctx = prepareRequestContext(request);
      var results = [];

      if (!ctx.bodyParsed) return results;

      // Batch endpoint
      if (ctx.bodyParsed.batch && Array.isArray(ctx.bodyParsed.batch)) {
        for (var i = 0; i < ctx.bodyParsed.batch.length; i++) {
          var item = ctx.bodyParsed.batch[i];
          results.push(parseSegmentItem(item));
        }
      } else {
        results.push(parseSegmentItem(ctx.bodyParsed));
      }

      return results;
    }
  };

  function parseSegmentItem(item) {
    if (!item || typeof item !== 'object') {
      return Core.createNormalizedEvent({ platform: 'segment', eventName: '' });
    }
    var eventName = item.event || item.type || '';
    if (item.type === 'page') eventName = 'page: ' + (item.name || item.properties && item.properties.name || '');
    if (item.type === 'identify') eventName = 'identify';

    return Core.createNormalizedEvent({
      platform: 'segment',
      eventName: eventName,
      userId: item.userId || '',
      anonymousId: item.anonymousId || '',
      distinctId: item.userId || item.anonymousId || '',
      eventTime: Core.normalizeTimestamp(item.timestamp),
      properties: item.properties || item.traits || item.context || {},
      rawEvent: item
    });
  }

  // =========================================================================
  // ADAPTER: Amplitude
  // =========================================================================

  var amplitudeAdapter = {
    id: 'amplitude',

    matcher: function (request) {
      var ctx = prepareRequestContext(request);
      var score = 0;
      var reasons = [];
      var hasHostMatch = false;

      // Host
      var ampHosts = ['api2.amplitude.com', 'api.amplitude.com', 'api.eu.amplitude.com'];
      for (var i = 0; i < ampHosts.length; i++) {
        if (Core.hostMatches(ctx.host, ampHosts[i])) {
          score += 0.4;
          reasons.push('host:' + ampHosts[i]);
          hasHostMatch = true;
          break;
        }
      }

      // Path — specific paths get full score; generic '/batch' only scores
      // when combined with host or api_key to avoid false positives
      if (Core.pathMatches(ctx.path, '/2/httpapi')) {
        score += 0.3;
        reasons.push('path:/2/httpapi');
      } else if (Core.pathMatches(ctx.path, '/groupidentify')) {
        score += 0.3;
        reasons.push('path:/groupidentify');
      } else if (ctx.path === '/batch' || ctx.path === '/identify') {
        // Exact path match for generic endpoints (not substring)
        score += 0.3;
        reasons.push('path:' + ctx.path);
      } else if (Core.pathMatches(ctx.path, '/batch') || Core.pathMatches(ctx.path, '/identify')) {
        // Substring match for /batch or /identify — lower score without host match
        score += hasHostMatch ? 0.25 : 0.15;
        reasons.push('path(partial):batch/identify');
      }

      // Body
      if (ctx.bodyParsed && typeof ctx.bodyParsed === 'object') {
        if (ctx.bodyParsed.api_key) { score += 0.2; reasons.push('body:api_key'); }
        if (ctx.bodyParsed.events && Array.isArray(ctx.bodyParsed.events)) {
          var evts = ctx.bodyParsed.events;
          if (evts.length > 0 && evts[0].event_type) {
            // Standard Amplitude format
            score += 0.2;
            reasons.push('body:events[].event_type');
          } else if (evts.length > 0 && evts[0].type && evts[0].ts) {
            // Amplitude-like SDK with type+ts fields (e.g. custom proxy batch)
            score += 0.15;
            reasons.push('body:events[].type+ts');
          } else {
            score += 0.05;
            reasons.push('body:events[]');
          }
        }
        // deviceId at top level (Amplitude or Amplitude-like SDK)
        if (ctx.bodyParsed.deviceId || ctx.bodyParsed.device_id) {
          score += 0.1;
          reasons.push('body:deviceId');
        }
      }

      // Form-encoded (identify endpoint)
      if (ctx.bodyStr && ctx.bodyStr.indexOf('api_key=') !== -1) {
        score += 0.15;
        reasons.push('body:api_key(form)');
      }

      return matchResult(score >= 0.4, score, reasons);
    },

    parser: function (request) {
      var ctx = prepareRequestContext(request);
      var results = [];

      var data = ctx.bodyParsed;

      // Form-encoded identify endpoint
      if (!data && ctx.bodyStr) {
        data = Core.tryParseFormData(ctx.bodyStr);
        if (data && data.identification) {
          try {
            var ident = JSON.parse(data.identification);
            var identArr = Array.isArray(ident) ? ident : [ident];
            for (var k = 0; k < identArr.length; k++) {
              results.push(Core.createNormalizedEvent({
                platform: 'amplitude',
                eventName: '$identify',
                userId: identArr[k].user_id || '',
                anonymousId: identArr[k].device_id || '',
                distinctId: identArr[k].user_id || identArr[k].device_id || '',
                eventTime: '',
                properties: identArr[k].user_properties || {},
                rawEvent: identArr[k]
              }));
            }
            return results;
          } catch (e) { /* ignore */ }
        }
      }

      if (!data) return results;

      // Top-level deviceId / userId (shared across events)
      var topDeviceId = data.device_id || data.deviceId || '';
      var topUserId = data.user_id || '';

      var events = data.events || [];
      for (var i = 0; i < events.length; i++) {
        var evt = events[i];

        // Parse nested JSON data string (e.g. Binance Pika SDK format)
        var evtProps = evt.event_properties || {};
        if (evt.data && typeof evt.data === 'string') {
          try {
            var parsedData = JSON.parse(evt.data);
            evtProps = parsedData;
          } catch(e) { /* keep original */ }
        }

        results.push(Core.createNormalizedEvent({
          platform: 'amplitude',
          eventName: evt.event_type || evt.type || '',
          userId: evt.user_id || topUserId || '',
          anonymousId: evt.device_id || topDeviceId || '',
          distinctId: evt.user_id || topUserId || evt.device_id || topDeviceId || '',
          eventTime: Core.normalizeTimestamp(evt.time || evt.ts),
          properties: Core.decodeObjectStrings(evtProps),
          rawEvent: evt
        }));
      }

      return results;
    }
  };

  // =========================================================================
  // ADAPTER: Matomo
  // =========================================================================

  var matomoAdapter = {
    id: 'matomo',

    matcher: function (request) {
      var ctx = prepareRequestContext(request);
      var score = 0;
      var reasons = [];

      // Path: matomo.php or piwik.php
      if (Core.pathMatches(ctx.path, 'matomo.php') || Core.pathMatches(ctx.path, '/matomo.php')) {
        score += 0.5;
        reasons.push('path:matomo.php');
      }
      if (Core.pathMatches(ctx.path, 'piwik.php') || Core.pathMatches(ctx.path, '/piwik.php')) {
        score += 0.5;
        reasons.push('path:piwik.php');
      }

      // Query: idsite= and rec=1
      if (ctx.query.idsite) { score += 0.2; reasons.push('query:idsite'); }
      if (ctx.query.rec === '1') { score += 0.2; reasons.push('query:rec=1'); }
      if (ctx.query.action_name) { score += 0.1; reasons.push('query:action_name'); }

      // Body: batch requests format { requests: [...] }
      if (ctx.bodyParsed && ctx.bodyParsed.requests && Array.isArray(ctx.bodyParsed.requests)) {
        score += 0.4;
        reasons.push('body:requests[]');
      }

      return matchResult(score >= 0.4, score, reasons);
    },

    parser: function (request) {
      var ctx = prepareRequestContext(request);
      var results = [];

      // Single request via query
      if (ctx.query.idsite) {
        results.push(parseMatomoParams(ctx.query));
      }

      // Batch requests
      if (ctx.bodyParsed && ctx.bodyParsed.requests && Array.isArray(ctx.bodyParsed.requests)) {
        for (var i = 0; i < ctx.bodyParsed.requests.length; i++) {
          var reqStr = ctx.bodyParsed.requests[i];
          if (typeof reqStr === 'string') {
            var params = Core.parseQueryString(reqStr);
            results.push(parseMatomoParams(params));
          }
        }
      }

      return results;
    }
  };

  function parseMatomoParams(params) {
    var eventName = 'pageview';
    if (params.e_c || params.e_a) eventName = 'event';
    if (params.ping === '1') eventName = 'heartbeat';
    if (params.c_n) eventName = 'content';

    return Core.createNormalizedEvent({
      platform: 'matomo',
      eventName: eventName,
      userId: '',
      anonymousId: params._id || '',
      distinctId: params._id || '',
      eventTime: '',
      properties: {
        siteId: params.idsite || '',
        actionName: params.action_name || '',
        url: params.url || '',
        referrer: params.urlref || '',
        eventCategory: params.e_c || '',
        eventAction: params.e_a || '',
        eventName: params.e_n || '',
        eventValue: params.e_v || ''
      },
      rawEvent: params
    });
  }

  // =========================================================================
  // ADAPTER: Plausible
  // =========================================================================

  var plausibleAdapter = {
    id: 'plausible',

    matcher: function (request) {
      var ctx = prepareRequestContext(request);
      var score = 0;
      var reasons = [];

      // Host
      if (Core.hostMatches(ctx.host, 'plausible.io')) {
        score += 0.4;
        reasons.push('host:plausible.io');
      }

      // Path: /api/event
      if (ctx.path === '/api/event') {
        score += 0.3;
        reasons.push('path:/api/event');
      }

      // Body: must have name, url, domain
      if (ctx.bodyParsed && typeof ctx.bodyParsed === 'object') {
        if (ctx.bodyParsed.name !== undefined) { score += 0.1; reasons.push('body:name'); }
        if (ctx.bodyParsed.url) { score += 0.05; reasons.push('body:url'); }
        if (ctx.bodyParsed.domain) { score += 0.15; reasons.push('body:domain'); }
      }

      return matchResult(score >= 0.35, score, reasons);
    },

    parser: function (request) {
      var ctx = prepareRequestContext(request);
      var results = [];

      if (!ctx.bodyParsed) return results;

      var props = ctx.bodyParsed.props || {};
      if (ctx.bodyParsed.revenue) {
        props._revenue = ctx.bodyParsed.revenue;
      }

      results.push(Core.createNormalizedEvent({
        platform: 'plausible',
        eventName: ctx.bodyParsed.name || 'pageview',
        userId: '',
        anonymousId: '',
        distinctId: '',
        eventTime: '',
        properties: {
          url: ctx.bodyParsed.url || '',
          domain: ctx.bodyParsed.domain || '',
          referrer: ctx.bodyParsed.referrer || '',
          props: props
        },
        rawEvent: ctx.bodyParsed
      }));

      return results;
    }
  };

  // =========================================================================
  // ADAPTER: Umami
  // =========================================================================

  var umamiAdapter = {
    id: 'umami',

    matcher: function (request) {
      var ctx = prepareRequestContext(request);
      var score = 0;
      var reasons = [];

      // Path: /api/send (v2) or /api/collect (v1)
      if (ctx.path === '/api/send') {
        score += 0.3;
        reasons.push('path:/api/send');
      }
      if (ctx.path === '/api/collect') {
        score += 0.25;
        reasons.push('path:/api/collect');
      }

      // Body: payload.website (UUID format)
      if (ctx.bodyParsed && typeof ctx.bodyParsed === 'object') {
        if (ctx.bodyParsed.payload) { score += 0.2; reasons.push('body:payload'); }
        if (ctx.bodyParsed.type) { score += 0.1; reasons.push('body:type'); }
        var payload = ctx.bodyParsed.payload || ctx.bodyParsed;
        if (payload.website) {
          score += 0.2;
          reasons.push('body:website');
          // UUID pattern check
          if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.website)) {
            score += 0.1;
            reasons.push('body:website(uuid)');
          }
        }
        if (payload.hostname) { score += 0.1; reasons.push('body:hostname'); }
      }

      return matchResult(score >= 0.4, score, reasons);
    },

    parser: function (request) {
      var ctx = prepareRequestContext(request);
      var results = [];

      if (!ctx.bodyParsed) return results;

      var payload = ctx.bodyParsed.payload || ctx.bodyParsed;
      var eventName = payload.name || 'pageview';
      if (ctx.bodyParsed.type === 'event' && !payload.name) {
        eventName = 'pageview';
      }

      results.push(Core.createNormalizedEvent({
        platform: 'umami',
        eventName: eventName,
        userId: '',
        anonymousId: '',
        distinctId: '',
        eventTime: '',
        properties: {
          website: payload.website || '',
          hostname: payload.hostname || '',
          url: payload.url || '',
          title: payload.title || '',
          referrer: payload.referrer || '',
          language: payload.language || '',
          screen: payload.screen || '',
          data: payload.data || {}
        },
        rawEvent: ctx.bodyParsed
      }));

      return results;
    }
  };

  // =========================================================================
  // ADAPTER: PostHog
  // =========================================================================

  var posthogAdapter = {
    id: 'posthog',

    matcher: function (request) {
      var ctx = prepareRequestContext(request);
      var score = 0;
      var reasons = [];

      // Host
      var phHosts = ['us.i.posthog.com', 'eu.i.posthog.com', 'app.posthog.com'];
      for (var i = 0; i < phHosts.length; i++) {
        if (Core.hostMatches(ctx.host, phHosts[i])) {
          score += 0.4;
          reasons.push('host:' + phHosts[i]);
          break;
        }
      }
      // Also match *.posthog.com
      if (Core.hostMatches(ctx.host, 'posthog.com')) {
        score += 0.3;
        reasons.push('host:*.posthog.com');
      }

      // Path
      var phPaths = ['/i/v0/e', '/capture', '/batch/', '/batch', '/e/', '/e', '/decide', '/s/'];
      for (var p = 0; p < phPaths.length; p++) {
        if (ctx.path === phPaths[p] || ctx.path.indexOf(phPaths[p]) === 0) {
          score += 0.25;
          reasons.push('path:' + phPaths[p]);
          break;
        }
      }

      // Body: api_key starts with phc_
      if (ctx.bodyParsed && typeof ctx.bodyParsed === 'object') {
        var apiKey = ctx.bodyParsed.api_key || ctx.bodyParsed.token || '';
        if (typeof apiKey === 'string' && apiKey.indexOf('phc_') === 0) {
          score += 0.3;
          reasons.push('body:api_key=phc_*');
        }
        if (ctx.bodyParsed.event) { score += 0.1; reasons.push('body:event'); }
        if (ctx.bodyParsed.distinct_id) { score += 0.1; reasons.push('body:distinct_id'); }
        if (ctx.bodyParsed.batch && Array.isArray(ctx.bodyParsed.batch)) {
          score += 0.15;
          reasons.push('body:batch[]');
        }
      }

      return matchResult(score >= 0.4, score, reasons);
    },

    parser: function (request) {
      var ctx = prepareRequestContext(request);
      var results = [];

      if (!ctx.bodyParsed) return results;

      // Batch endpoint
      if (ctx.bodyParsed.batch && Array.isArray(ctx.bodyParsed.batch)) {
        for (var i = 0; i < ctx.bodyParsed.batch.length; i++) {
          results.push(parsePostHogEvent(ctx.bodyParsed.batch[i]));
        }
      } else {
        results.push(parsePostHogEvent(ctx.bodyParsed));
      }

      return results;
    }
  };

  function parsePostHogEvent(data) {
    if (!data || typeof data !== 'object') {
      return Core.createNormalizedEvent({ platform: 'posthog', eventName: '' });
    }
    var props = data.properties || {};
    return Core.createNormalizedEvent({
      platform: 'posthog',
      eventName: data.event || '',
      userId: props.$user_id || '',
      anonymousId: props.$device_id || '',
      distinctId: data.distinct_id || props.distinct_id || '',
      eventTime: Core.normalizeTimestamp(data.timestamp),
      properties: props,
      rawEvent: data
    });
  }

  // =========================================================================
  // ADAPTER: TikTok Pixel
  // =========================================================================

  var tiktokAdapter = {
    id: 'tiktok',

    matcher: function (request) {
      var ctx = prepareRequestContext(request);
      var score = 0;
      var reasons = [];

      // Host
      if (Core.hostMatches(ctx.host, 'analytics.tiktok.com')) {
        score += 0.5;
        reasons.push('host:analytics.tiktok.com');
      }
      if (Core.hostMatches(ctx.host, 'business-api.tiktok.com')) {
        score += 0.4;
        reasons.push('host:business-api.tiktok.com');
      }

      // Path
      if (Core.pathMatches(ctx.path, '/api/v2/pixel')) {
        score += 0.3;
        reasons.push('path:/api/v2/pixel');
      }
      if (Core.pathMatches(ctx.path, '/i18n/pixel')) {
        score += 0.2;
        reasons.push('path:/i18n/pixel');
      }

      // Query: sdkid
      if (ctx.query.sdkid) { score += 0.1; reasons.push('query:sdkid'); }

      return matchResult(score >= 0.4, score, reasons);
    },

    parser: function (request) {
      var ctx = prepareRequestContext(request);
      var results = [];

      if (ctx.bodyParsed && typeof ctx.bodyParsed === 'object') {
        results.push(Core.createNormalizedEvent({
          platform: 'tiktok',
          eventName: ctx.bodyParsed.event || ctx.bodyParsed.event_name || 'pixel',
          userId: '',
          anonymousId: ctx.query.sdkid || '',
          distinctId: ctx.query.sdkid || '',
          eventTime: '',
          properties: ctx.bodyParsed.properties || ctx.bodyParsed,
          rawEvent: ctx.bodyParsed
        }));
      } else {
        results.push(Core.createNormalizedEvent({
          platform: 'tiktok',
          eventName: 'pixel_load',
          userId: '',
          anonymousId: ctx.query.sdkid || '',
          distinctId: '',
          eventTime: '',
          properties: ctx.query,
          rawEvent: ctx.query
        }));
      }

      return results;
    }
  };

  // =========================================================================
  // ADAPTER: Heap Analytics
  // =========================================================================

  var heapAdapter = {
    id: 'heap',

    matcher: function (request) {
      var ctx = prepareRequestContext(request);
      var score = 0;
      var reasons = [];

      // Host
      if (Core.hostMatches(ctx.host, 'heap-api.com')) {
        score += 0.6;
        reasons.push('host:heap-api.com');
      }

      // Specific subdomains
      var heapHosts = ['c.us.heap-api.com', 'c.eu.heap-api.com', 'cdn.us.heap-api.com', 'cdn.eu.heap-api.com'];
      for (var i = 0; i < heapHosts.length; i++) {
        if (ctx.host === heapHosts[i]) {
          score += 0.1;
          reasons.push('host:' + heapHosts[i]);
          break;
        }
      }

      return matchResult(score >= 0.4, score, reasons);
    },

    parser: function (request) {
      var ctx = prepareRequestContext(request);
      var results = [];

      results.push(Core.createNormalizedEvent({
        platform: 'heap',
        eventName: 'heap_event',
        userId: '',
        anonymousId: '',
        distinctId: '',
        eventTime: '',
        properties: ctx.bodyParsed || ctx.query || {},
        rawEvent: ctx.bodyParsed || ctx.query
      }));

      return results;
    }
  };

  // =========================================================================
  // ADAPTER: Hotjar
  // =========================================================================

  var hotjarAdapter = {
    id: 'hotjar',

    matcher: function (request) {
      var ctx = prepareRequestContext(request);
      var score = 0;
      var reasons = [];

      // Host
      var hjHosts = ['static.hotjar.com', 'in.hotjar.com', 'vc.hotjar.io', 'ws.hotjar.com'];
      for (var i = 0; i < hjHosts.length; i++) {
        if (Core.hostMatches(ctx.host, hjHosts[i])) {
          score += 0.6;
          reasons.push('host:' + hjHosts[i]);
          break;
        }
      }

      // Path: hotjar script
      if (Core.pathMatches(ctx.path, '/c/hotjar-')) {
        score += 0.2;
        reasons.push('path:/c/hotjar-*');
      }

      return matchResult(score >= 0.4, score, reasons);
    },

    parser: function (request) {
      var ctx = prepareRequestContext(request);
      var results = [];

      // Hotjar mostly uses WebSocket and binary data; limited parsing
      results.push(Core.createNormalizedEvent({
        platform: 'hotjar',
        eventName: 'hotjar_recording',
        userId: '',
        anonymousId: '',
        distinctId: '',
        eventTime: '',
        properties: { url: ctx.url },
        rawEvent: null
      }));

      return results;
    }
  };

  // =========================================================================
  // ADAPTER: Microsoft Clarity
  // =========================================================================

  var clarityAdapter = {
    id: 'clarity',

    matcher: function (request) {
      var ctx = prepareRequestContext(request);
      var score = 0;
      var reasons = [];

      // Host
      if (Core.hostMatches(ctx.host, 'www.clarity.ms') || Core.hostMatches(ctx.host, 'clarity.ms')) {
        score += 0.5;
        reasons.push('host:clarity.ms');
      }

      // Path
      if (Core.pathMatches(ctx.path, '/collect')) {
        score += 0.3;
        reasons.push('path:/collect');
      }
      if (Core.pathMatches(ctx.path, '/tag/')) {
        score += 0.2;
        reasons.push('path:/tag/');
      }

      return matchResult(score >= 0.4, score, reasons);
    },

    parser: function (request) {
      var ctx = prepareRequestContext(request);
      var results = [];

      // Clarity uses gzipped binary data; limited parsing
      results.push(Core.createNormalizedEvent({
        platform: 'clarity',
        eventName: 'clarity_data',
        userId: '',
        anonymousId: '',
        distinctId: '',
        eventTime: '',
        properties: { url: ctx.url },
        rawEvent: null
      }));

      return results;
    }
  };

  // =========================================================================
  // ADAPTER: Adobe Analytics
  // =========================================================================

  var adobeAdapter = {
    id: 'adobe',

    matcher: function (request) {
      var ctx = prepareRequestContext(request);
      var score = 0;
      var reasons = [];

      // Host: *.sc.omtrdc.net or edge.adobedc.net
      if (Core.hostMatches(ctx.host, 'sc.omtrdc.net')) {
        score += 0.5;
        reasons.push('host:sc.omtrdc.net');
      }
      if (Core.hostMatches(ctx.host, 'edge.adobedc.net')) {
        score += 0.5;
        reasons.push('host:edge.adobedc.net');
      }

      // Path: /b/ss/ (AppMeasurement)
      if (Core.pathMatches(ctx.path, '/b/ss/')) {
        score += 0.4;
        reasons.push('path:/b/ss/');
      }
      // Path: /ee/ (AEP Web SDK)
      if (Core.pathMatches(ctx.path, '/ee/')) {
        score += 0.3;
        reasons.push('path:/ee/');
      }

      // Body: XDM data
      if (ctx.bodyParsed && typeof ctx.bodyParsed === 'object') {
        if (ctx.bodyParsed.xdm) { score += 0.2; reasons.push('body:xdm'); }
        if (ctx.bodyParsed.__adobe) { score += 0.2; reasons.push('body:__adobe'); }
      }

      return matchResult(score >= 0.4, score, reasons);
    },

    parser: function (request) {
      var ctx = prepareRequestContext(request);
      var results = [];

      // AppMeasurement: GET with query params
      if (Core.pathMatches(ctx.path, '/b/ss/')) {
        var params = ctx.query;
        // Extract report suite from path: /b/ss/{rsid}/{type}/{cachebuster}
        var pathParts = ctx.path.split('/');
        var rsid = pathParts.length > 3 ? pathParts[3] : '';

        results.push(Core.createNormalizedEvent({
          platform: 'adobe',
          eventName: params.pageName || params.pe || 'pageview',
          userId: params.mid || '',
          anonymousId: params.aid || '',
          distinctId: params.mid || params.aid || '',
          eventTime: '',
          properties: {
            reportSuite: rsid,
            pageName: params.pageName || '',
            pageUrl: params.g || '',
            events: params.events || '',
            referrer: params.r || ''
          },
          rawEvent: params
        }));
      }

      // AEP Web SDK: POST JSON
      if (ctx.bodyParsed && ctx.bodyParsed.xdm) {
        var xdm = ctx.bodyParsed.xdm;
        results.push(Core.createNormalizedEvent({
          platform: 'adobe',
          eventName: xdm.eventType || 'aep_event',
          userId: '',
          anonymousId: '',
          distinctId: '',
          eventTime: Core.normalizeTimestamp(xdm.timestamp),
          properties: xdm,
          rawEvent: ctx.bodyParsed
        }));
      }

      if (results.length === 0) {
        results.push(Core.createNormalizedEvent({
          platform: 'adobe',
          eventName: 'adobe_request',
          userId: '',
          anonymousId: '',
          distinctId: '',
          eventTime: '',
          properties: ctx.query,
          rawEvent: ctx.query
        }));
      }

      return results;
    }
  };

  // =========================================================================
  // ALL ADAPTERS REGISTRY
  // =========================================================================

  /**
   * Ordered list of all platform adapters.
   * Order roughly follows priority from PlatformCatalog.
   */
  var ALL_ADAPTERS = [
    datarangersAdapter,   // P0
    sensorsAdapter,       // P1
    googleAdapter,        // P1
    baiduAdapter,         // P1
    growingioAdapter,      // P2
    mixpanelAdapter,      // P2
    segmentAdapter,       // P2
    amplitudeAdapter,     // P2
    matomoAdapter,        // P3
    plausibleAdapter,     // P3
    umamiAdapter,         // P3
    posthogAdapter,       // P3
    adobeAdapter,         // P4
    tiktokAdapter,        // P4
    heapAdapter,          // P4
    hotjarAdapter,        // P4
    clarityAdapter        // P4
  ];

  // =========================================================================
  // MAIN MATCHING FUNCTION
  // =========================================================================

  /**
   * Run all platform matchers against a request and return the best match.
   *
   * @param {Object} request - CapturedRequest-like object with url, method,
   *                           bodyRaw/requestData, headers, contentType
   * @returns {{
   *   platform: string,
   *   confidence: number,
   *   matchedBy: string[],
   *   allMatches: Array<{platform: string, confidence: number, matchedBy: string[]}>
   * }}
   */
  function matchPlatform(request) {
    // Prepare context once for reuse
    prepareRequestContext(request);

    var bestMatch = null;
    var bestScore = 0;
    var allMatches = [];

    for (var i = 0; i < ALL_ADAPTERS.length; i++) {
      var adapter = ALL_ADAPTERS[i];
      try {
        var result = adapter.matcher(request);
        if (result.matched) {
          allMatches.push({
            platform: adapter.id,
            confidence: result.confidence,
            matchedBy: result.matchedBy
          });
          if (result.confidence > bestScore) {
            bestScore = result.confidence;
            bestMatch = {
              platform: adapter.id,
              confidence: result.confidence,
              matchedBy: result.matchedBy
            };
          }
        }
      } catch (e) {
        // Skip failing matchers silently
      }
    }

    if (!bestMatch) {
      return {
        platform: 'unknown',
        confidence: 0,
        matchedBy: [],
        allMatches: []
      };
    }

    bestMatch.allMatches = allMatches;
    return bestMatch;
  }

  /**
   * Parse a request using the appropriate platform adapter.
   *
   * @param {string} platformId - Platform id from matchPlatform result
   * @param {Object} request - CapturedRequest-like object
   * @returns {Object[]} Array of NormalizedEvent
   */
  function parseRequest(platformId, request) {
    prepareRequestContext(request);

    for (var i = 0; i < ALL_ADAPTERS.length; i++) {
      if (ALL_ADAPTERS[i].id === platformId) {
        return safeParse(platformId, ALL_ADAPTERS[i].parser, request);
      }
    }

    // Unknown platform - return raw event
    return [Core.createNormalizedEvent({
      platform: platformId || 'unknown',
      eventName: '[unparsed]',
      properties: { url: request.url || '' },
      rawEvent: request.bodyRaw || request.requestData || null
    })];
  }

  /**
   * Combined match + parse in one call.
   *
   * @param {Object} request
   * @returns {{ match: Object, events: Object[] }}
   */
  function matchAndParse(request) {
    var match = matchPlatform(request);
    var events = parseRequest(match.platform, request);
    return { match: match, events: events };
  }

  /**
   * Get an adapter by platform id.
   * @param {string} id
   * @returns {Object|null}
   */
  function getAdapter(id) {
    for (var i = 0; i < ALL_ADAPTERS.length; i++) {
      if (ALL_ADAPTERS[i].id === id) return ALL_ADAPTERS[i];
    }
    return null;
  }

  // =========================================================================
  // Expose on global namespace
  // =========================================================================

  root.TeaRadar.PlatformAdapters = {
    ALL_ADAPTERS: ALL_ADAPTERS,
    matchPlatform: matchPlatform,
    parseRequest: parseRequest,
    matchAndParse: matchAndParse,
    getAdapter: getAdapter,
    prepareRequestContext: prepareRequestContext
  };
})();
