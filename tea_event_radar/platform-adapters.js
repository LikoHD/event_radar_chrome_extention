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

  function hasPlatformSignal(signals, platformId) {
    return Array.isArray(signals) && signals.indexOf(platformId) !== -1;
  }

  function applyPageContextBoost(platformId, baseResult, pageContext) {
    if (!baseResult || !baseResult.matched || !pageContext) {
      return baseResult;
    }

    var matchedBy = Array.isArray(baseResult.matchedBy)
      ? baseResult.matchedBy.slice()
      : [];
    var bonus = 0;
    var cap = 0.15;

    if (hasPlatformSignal(pageContext.detectedGlobals, platformId)) {
      bonus += Math.min(cap - bonus, 0.12);
      matchedBy.push('pageContext:global');
    }

    if (hasPlatformSignal(pageContext.detectedScripts, platformId)) {
      bonus += Math.min(cap - bonus, 0.08);
      matchedBy.push('pageContext:script');
    }

    if (hasPlatformSignal(pageContext.detectedCookies, platformId)) {
      bonus += Math.min(cap - bonus, 0.05);
      matchedBy.push('pageContext:cookie');
    }

    return matchResult(
      true,
      Math.min(1, baseResult.confidence + bonus),
      matchedBy
    );
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
      bodyBase64: request.bodyBase64 || request.requestBodyBase64 || '',
      bodyParsed: bodyParsed,
      contentType: request.contentType || '',
      headers: request.headers || []
    };

    request._ctx = ctx;
    return ctx;
  }

  function firstNonEmptyValue() {
    for (var i = 0; i < arguments.length; i++) {
      if (arguments[i] !== undefined && arguments[i] !== null && arguments[i] !== '') {
        return arguments[i];
      }
    }
    return '';
  }

  function basenameFromPath(path) {
    if (!path) return '';
    var cleaned = path.replace(/\?.*$/, '').replace(/\/$/, '');
    var parts = cleaned.split('/');
    return parts.length ? parts[parts.length - 1] : cleaned;
  }

  function safeDecodeURIComponentLoose(text) {
    if (typeof text !== 'string') return '';
    try {
      return decodeURIComponent(text);
    } catch (e) {
      try {
        return decodeURIComponent(text.replace(/\+/g, '%20'));
      } catch (e2) {
        return text;
      }
    }
  }

  function extractJsonFromText(text) {
    if (typeof text !== 'string' || !text) return null;

    var attempts = [];
    function pushAttempt(value) {
      if (typeof value === 'string' && value && attempts.indexOf(value) === -1) {
        attempts.push(value);
      }
    }

    pushAttempt(text.trim());
    pushAttempt(safeDecodeURIComponentLoose(text).trim());

    for (var i = 0; i < attempts.length; i++) {
      var candidate = attempts[i].replace(/^\?+/, '');
      var direct = Core.tryParseJSON(candidate);
      if (direct !== null) return direct;

      var braceStart = candidate.indexOf('{');
      if (braceStart !== -1) {
        for (var braceEnd = candidate.lastIndexOf('}'); braceEnd > braceStart; braceEnd = candidate.lastIndexOf('}', braceEnd - 1)) {
          var objParsed = Core.tryParseJSON(candidate.slice(braceStart, braceEnd + 1));
          if (objParsed !== null) return objParsed;
        }
      }

      var arrayStart = candidate.indexOf('[');
      if (arrayStart !== -1) {
        for (var arrayEnd = candidate.lastIndexOf(']'); arrayEnd > arrayStart; arrayEnd = candidate.lastIndexOf(']', arrayEnd - 1)) {
          var arrParsed = Core.tryParseJSON(candidate.slice(arrayStart, arrayEnd + 1));
          if (arrParsed !== null) return arrParsed;
        }
      }
    }

    return null;
  }

  function parseStructuredKey(key) {
    if (!key) return [];
    var normalized = key.replace(/\]/g, '');
    var rawSegments = normalized.split('[');
    var segments = [];

    for (var i = 0; i < rawSegments.length; i++) {
      if (!rawSegments[i]) continue;
      var dotSegments = rawSegments[i].split('.');
      for (var j = 0; j < dotSegments.length; j++) {
        if (dotSegments[j] !== '') segments.push(dotSegments[j]);
      }
    }

    return segments;
  }

  function assignNestedValue(target, segments, value) {
    if (!target || !segments || !segments.length) return;

    var cur = target;
    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      var isIndex = /^\d+$/.test(seg);
      var last = i === segments.length - 1;
      var nextSeg = segments[i + 1];
      var nextIsIndex = /^\d+$/.test(nextSeg || '');

      if (last) {
        if (Array.isArray(cur) && isIndex) {
          cur[parseInt(seg, 10)] = value;
        } else {
          cur[seg] = value;
        }
        return;
      }

      if (Array.isArray(cur) && isIndex) {
        var index = parseInt(seg, 10);
        if (cur[index] == null || typeof cur[index] !== 'object') {
          cur[index] = nextIsIndex ? [] : {};
        }
        cur = cur[index];
      } else {
        if (cur[seg] == null || typeof cur[seg] !== 'object') {
          cur[seg] = nextIsIndex ? [] : {};
        }
        cur = cur[seg];
      }
    }
  }

  function expandStructuredParams(params, rootKeys) {
    var out = {};
    if (!params || typeof params !== 'object') return out;

    for (var key in params) {
      if (!params.hasOwnProperty(key)) continue;
      if (key.indexOf('[') === -1 && key.indexOf('.') === -1) continue;

      var segments = parseStructuredKey(key);
      if (!segments.length) continue;
      if (Array.isArray(rootKeys) && rootKeys.length > 0 && rootKeys.indexOf(segments[0]) === -1) {
        continue;
      }

      assignNestedValue(out, segments, params[key]);
    }

    return out;
  }

  function decodeBase64Utf8(encoded) {
    if (!encoded || typeof encoded !== 'string') return '';
    var cleaned = safeDecodeURIComponentLoose(encoded)
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .replace(/\s+/g, '');

    while (cleaned.length % 4 !== 0) cleaned += '=';

    try {
      var binary = atob(cleaned);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i) & 0xFF;
      }
      return new TextDecoder('utf-8').decode(bytes);
    } catch (e) {
      return '';
    }
  }

  function decodeBase64ToBytes(encoded) {
    if (!encoded || typeof encoded !== 'string') return new Uint8Array(0);
    var cleaned = safeDecodeURIComponentLoose(encoded)
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .replace(/\s+/g, '');

    while (cleaned.length % 4 !== 0) cleaned += '=';

    try {
      var binary = atob(cleaned);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i) & 0xFF;
      }
      return bytes;
    } catch (e) {
      return new Uint8Array(0);
    }
  }

  function extractPrintableStringsFromBytes(bytes, minLen, maxItems) {
    var result = [];
    if (!bytes || !bytes.length) return result;

    var current = '';
    var minLength = minLen || 4;
    var limit = maxItems || 40;

    function flush() {
      var text = current.replace(/\u0000/g, '').trim();
      if (text.length >= minLength && result.indexOf(text) === -1) {
        result.push(text);
        if (result.length > limit) result.length = limit;
      }
      current = '';
    }

    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i];
      if ((b >= 32 && b <= 126) || b === 9 || b === 10 || b === 13) {
        current += String.fromCharCode(b);
      } else {
        flush();
        if (result.length >= limit) break;
      }
    }
    flush();

    return result;
  }

  function parseDollarKeyValue(text) {
    var decoded = safeDecodeURIComponentLoose(text || '');
    var parsedJson = extractJsonFromText(decoded);
    if (parsedJson && typeof parsedJson === 'object') {
      if (parsedJson.p0 && typeof parsedJson.p0 === 'string') {
        var nested = extractJsonFromText(parsedJson.p0);
        if (nested) parsedJson.p0 = nested;
      }
      return parsedJson;
    }

    var result = {};
    var parts = decoded.split('$');
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      var index = parts[i].indexOf('=');
      if (index === -1) continue;
      result[parts[i].slice(0, index)] = parts[i].slice(index + 1);
    }

    if (result.p0 && typeof result.p0 === 'string') {
      var p0Json = extractJsonFromText(result.p0);
      if (p0Json) result.p0 = p0Json;
    }

    return result;
  }

  function deepFindValue(obj, matcher) {
    function visit(value) {
      if (value == null) return '';

      if (Array.isArray(value)) {
        for (var i = 0; i < value.length; i++) {
          var foundInArray = visit(value[i]);
          if (foundInArray !== '' && foundInArray !== null && foundInArray !== undefined) {
            return foundInArray;
          }
        }
        return '';
      }

      if (typeof value === 'object') {
        for (var key in value) {
          if (!value.hasOwnProperty(key)) continue;
          if (matcher(key, value[key])) return value[key];
          var found = visit(value[key]);
          if (found !== '' && found !== null && found !== undefined) {
            return found;
          }
        }
      }

      return '';
    }

    return visit(obj);
  }

  function getHeaderValue(headers, name) {
    if (!Array.isArray(headers) || !name) return '';
    var lowerName = String(name).toLowerCase();
    for (var i = 0; i < headers.length; i++) {
      var header = headers[i];
      if (!header || !header.name) continue;
      if (String(header.name).toLowerCase() === lowerName) {
        return header.value || '';
      }
    }
    return '';
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
  // ADAPTER: Microsoft Advertising UET
  // =========================================================================

  var microsoftUetAdapter = {
    id: 'microsoft_uet',

    matcher: function (request) {
      var ctx = prepareRequestContext(request);
      var score = 0;
      var reasons = [];

      if (Core.hostMatches(ctx.host, 'bat.bing.com')) {
        score += 0.55;
        reasons.push('host:bat.bing.com');
      }
      if (Core.pathMatches(ctx.path, '/action/0')) {
        score += 0.3;
        reasons.push('path:/action/0');
      }
      if (ctx.query.ti || ctx.query.evt || ctx.query.u || ctx.query.mid) {
        score += 0.15;
        reasons.push('query:ti/evt/u/mid');
      }

      return matchResult(score >= 0.45, score, reasons);
    },

    parser: function (request) {
      var ctx = prepareRequestContext(request);
      var eventName = firstNonEmptyValue(
        ctx.query.evt,
        ctx.query.event_name,
        ctx.query.ea,
        Core.pathMatches(ctx.path, '/action/0') ? 'page_load' : '',
        'microsoft_uet'
      );

      return [Core.createNormalizedEvent({
        platform: 'microsoft_uet',
        eventName: eventName,
        userId: '',
        anonymousId: firstNonEmptyValue(ctx.query.mid, ctx.query._uetvid, ''),
        distinctId: firstNonEmptyValue(ctx.query.mid, ctx.query.msclkid, ctx.query.ti, ''),
        eventTime: '',
        properties: Core.decodeObjectStrings({
          tagId: ctx.query.ti || '',
          pageUrl: firstNonEmptyValue(ctx.query.u, ctx.query.url, ''),
          referrer: firstNonEmptyValue(ctx.query.r, ctx.query.referrer, ''),
          msclkid: ctx.query.msclkid || '',
          eventCategory: firstNonEmptyValue(ctx.query.ec, ctx.query.event_category, ''),
          eventAction: firstNonEmptyValue(ctx.query.ea, ctx.query.event_action, ''),
          eventLabel: firstNonEmptyValue(ctx.query.el, ctx.query.event_label, ''),
          eventValue: firstNonEmptyValue(ctx.query.ev, ctx.query.event_value, ''),
          currency: ctx.query.currency || '',
          params: ctx.query
        }),
        rawEvent: ctx.query
      })];
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
  // ADAPTER: Alibaba / Taobao Goldlog & ARMS
  // =========================================================================

  var alibabaAdapter = {
    id: 'alibaba',

    matcher: function (request) {
      var ctx = prepareRequestContext(request);
      var score = 0;
      var reasons = [];

      var hosts = ['gm.mmstat.com', 's-gm.mmstat.com', 'log.mmstat.com', 'g.aplus.taobao.com'];
      for (var i = 0; i < hosts.length; i++) {
        if (Core.hostMatches(ctx.host, hosts[i])) {
          score += 0.45;
          reasons.push('host:' + hosts[i]);
          break;
        }
      }

      var paths = ['/arms.1.1', '/jstracker.3', '/y.gif', '/aplus.monitor.intercept_expect'];
      for (var p = 0; p < paths.length; p++) {
        if (Core.pathMatches(ctx.path, paths[p])) {
          score += 0.3;
          reasons.push('path:' + paths[p]);
          break;
        }
      }

      if (ctx.query.gokey || ctx.query.gmkey || ctx.query.logtype) {
        score += 0.15;
        reasons.push('query:gokey/gmkey/logtype');
      }

      if (ctx.bodyParsed && typeof ctx.bodyParsed === 'object' &&
          (ctx.bodyParsed.gokey || ctx.bodyParsed.gmkey || ctx.bodyParsed.logtype)) {
        score += 0.2;
        reasons.push('body:gokey/gmkey/logtype');
      }

      return matchResult(score >= 0.45, score, reasons);
    },

    parser: function (request) {
      var ctx = prepareRequestContext(request);
      var payload = (ctx.bodyParsed && typeof ctx.bodyParsed === 'object' && !Array.isArray(ctx.bodyParsed))
        ? ctx.bodyParsed
        : ctx.query;
      var gokeyText = firstNonEmptyValue(payload.gokey, ctx.query.gokey, '');
      var gokeyParams = gokeyText ? Core.parseQueryString(safeDecodeURIComponentLoose(gokeyText)) : {};
      var eventName = firstNonEmptyValue(
        gokeyParams.type,
        gokeyParams.code,
        gokeyParams.p1,
        ctx.query.logtype,
        payload.gmkey,
        basenameFromPath(ctx.path),
        'ali_event'
      );
      var pageUrl = firstNonEmptyValue(
        gokeyParams.url,
        gokeyParams.origin_url,
        gokeyParams._p_url,
        ctx.query._p_url,
        payload.url
      );
      var anonymousId = firstNonEmptyValue(
        gokeyParams.uid,
        gokeyParams.asid,
        ctx.query.asid,
        ctx.query.trid,
        ctx.query.cna,
        payload.cna
      );
      var distinctId = firstNonEmptyValue(gokeyParams.pv_id, gokeyParams.sid, anonymousId);
      var properties = {
        endpoint: basenameFromPath(ctx.path),
        gmkey: firstNonEmptyValue(payload.gmkey, ctx.query.gmkey, ''),
        logtype: firstNonEmptyValue(payload.logtype, ctx.query.logtype, ''),
        pageUrl: pageUrl,
        title: firstNonEmptyValue(gokeyParams.title, ctx.query.title, ''),
        pid: firstNonEmptyValue(gokeyParams.pid, payload.pid, ''),
        sdkVersion: firstNonEmptyValue(gokeyParams.sdk_version, payload.sdk_version, ''),
        gokey: gokeyParams
      };

      if (ctx.query['spm-cnt']) properties.spm = ctx.query['spm-cnt'];
      if (ctx.query.pre) properties.referrer = ctx.query.pre;
      if (ctx.query.trid) properties.traceId = ctx.query.trid;

      return [Core.createNormalizedEvent({
        platform: 'alibaba',
        eventName: eventName,
        userId: '',
        anonymousId: anonymousId,
        distinctId: distinctId,
        eventTime: Core.normalizeTimestamp(firstNonEmptyValue(gokeyParams.ts, payload.ts, ctx.query.ts)),
        properties: Core.decodeObjectStrings(properties),
        rawEvent: {
          payload: payload,
          gokey: gokeyParams,
          query: ctx.query
        }
      })];
    }
  };

  // =========================================================================
  // ADAPTER: Tencent Beacon / QQ
  // =========================================================================

  var tencentAdapter = {
    id: 'tencent',

    matcher: function (request) {
      var ctx = prepareRequestContext(request);
      var score = 0;
      var reasons = [];

      if (Core.hostMatches(ctx.host, 'otheve.beacon.qq.com')) {
        score += 0.55;
        reasons.push('host:otheve.beacon.qq.com');
      }
      if (Core.pathMatches(ctx.path, '/analytics/v2_upload')) {
        score += 0.3;
        reasons.push('path:/analytics/v2_upload');
      }
      if (ctx.query.appkey) {
        score += 0.1;
        reasons.push('query:appkey');
      }
      if (ctx.bodyParsed && typeof ctx.bodyParsed === 'object' && ctx.bodyParsed.events) {
        score += 0.2;
        reasons.push('body:events[]');
      }

      return matchResult(score >= 0.45, score, reasons);
    },

    parser: function (request) {
      var ctx = prepareRequestContext(request);
      var body = (ctx.bodyParsed && typeof ctx.bodyParsed === 'object')
        ? ctx.bodyParsed
        : (extractJsonFromText(ctx.bodyStr) || {});
      var common = body.common || {};
      var events = Array.isArray(body.events) ? body.events : [];
      var results = [];

      for (var i = 0; i < events.length; i++) {
        var evt = events[i] || {};
        var properties = {
          appKey: firstNonEmptyValue(body.mainAppKey, ctx.query.appkey, ''),
          sdkId: body.sdkId || '',
          sdkVersion: body.sdkVersion || '',
          platformId: body.platformId || '',
          pageUrl: common.A102 || '',
          common: common,
          mapValue: evt.mapValue || {}
        };

        results.push(Core.createNormalizedEvent({
          platform: 'tencent',
          eventName: evt.eventCode || 'qq_beacon_event',
          userId: '',
          anonymousId: firstNonEmptyValue(common.A76, common.A2, ''),
          distinctId: firstNonEmptyValue(common.A76, common.A2, evt.eventCode),
          eventTime: Core.normalizeTimestamp(evt.eventTime),
          properties: Core.decodeObjectStrings(properties),
          rawEvent: evt
        }));
      }

      if (results.length === 0) {
        results.push(Core.createNormalizedEvent({
          platform: 'tencent',
          eventName: 'qq_beacon',
          userId: '',
          anonymousId: firstNonEmptyValue(common.A76, common.A2, ''),
          distinctId: firstNonEmptyValue(common.A76, common.A2, ''),
          eventTime: '',
          properties: Core.decodeObjectStrings({
            appKey: firstNonEmptyValue(body.mainAppKey, ctx.query.appkey, ''),
            pageUrl: common.A102 || '',
            common: common
          }),
          rawEvent: body
        }));
      }

      return results;
    }
  };

  // =========================================================================
  // ADAPTER: NetEase NTM / VMonitor
  // =========================================================================

  var neteaseAdapter = {
    id: 'netease',

    matcher: function (request) {
      var ctx = prepareRequestContext(request);
      var score = 0;
      var reasons = [];

      if (Core.hostMatches(ctx.host, 'h5.analytics.126.net')) {
        score += 0.55;
        reasons.push('host:h5.analytics.126.net');
      } else if (Core.hostMatches(ctx.host, 'vmonitor.ws.netease.com')) {
        score += 0.55;
        reasons.push('host:vmonitor.ws.netease.com');
      }

      if (Core.pathMatches(ctx.path, '/news/c') ||
          Core.pathMatches(ctx.path, '/web/performance') ||
          Core.pathMatches(ctx.path, '/web/resource')) {
        score += 0.3;
        reasons.push('path:netease-collector');
      }

      if (ctx.query.param || (ctx.search && ctx.search.indexOf('{') !== -1)) {
        score += 0.15;
        reasons.push('query:param/json');
      }

      return matchResult(score >= 0.45, score, reasons);
    },

    parser: function (request) {
      var ctx = prepareRequestContext(request);
      var payload = null;

      if (ctx.query.param) payload = extractJsonFromText(ctx.query.param);
      if (!payload && ctx.search) payload = extractJsonFromText(ctx.search.slice(1));
      if (!payload && ctx.bodyStr) payload = extractJsonFromText(ctx.bodyStr);
      if (!payload) payload = {};

      return [Core.createNormalizedEvent({
        platform: 'netease',
        eventName: firstNonEmptyValue(payload.val_act, payload.val_nm, basenameFromPath(ctx.path), 'netease_event'),
        userId: payload.uid || '',
        anonymousId: firstNonEmptyValue(payload.uuid, payload.session_id, ''),
        distinctId: firstNonEmptyValue(payload.uid, payload.uuid, payload.session_id, ''),
        eventTime: Core.normalizeTimestamp(firstNonEmptyValue(payload.tm, payload.timestamp, payload.ts)),
        properties: Core.decodeObjectStrings(payload),
        rawEvent: payload
      })];
    }
  };

  // =========================================================================
  // ADAPTER: DiDi Omega
  // =========================================================================

  var didiAdapter = {
    id: 'didi',

    matcher: function (request) {
      var ctx = prepareRequestContext(request);
      var score = 0;
      var reasons = [];

      if (Core.hostMatches(ctx.host, 'omgup.didiglobal.com')) {
        score += 0.6;
        reasons.push('host:omgup.didiglobal.com');
      }
      if (Core.pathMatches(ctx.path, '/api/web/stat')) {
        score += 0.25;
        reasons.push('path:/api/web/stat');
      }
      if (ctx.query.e || (ctx.bodyParsed && ctx.bodyParsed.attrs)) {
        score += 0.15;
        reasons.push('query/body:event+attrs');
      }

      return matchResult(score >= 0.45, score, reasons);
    },

    parser: function (request) {
      var ctx = prepareRequestContext(request);
      var form = (ctx.bodyParsed && typeof ctx.bodyParsed === 'object' && !Array.isArray(ctx.bodyParsed))
        ? ctx.bodyParsed
        : {};
      var attrs = extractJsonFromText(form.attrs || '') || {};
      var eventName = firstNonEmptyValue(ctx.query.e, form.e, 'didi_event');

      return [Core.createNormalizedEvent({
        platform: 'didi',
        eventName: eventName,
        userId: '',
        anonymousId: firstNonEmptyValue(form.oid, form.uwid, ''),
        distinctId: firstNonEmptyValue(form.oid, form.uwid, form.seq, ''),
        eventTime: Core.normalizeTimestamp(firstNonEmptyValue(form.ts, form.timestamp, '')),
        properties: Core.decodeObjectStrings({
          appKey: form.ak || '',
          appName: form.an || '',
          pageUrl: form.v || '',
          seq: form.seq || '',
          version: form.ov || form.vr || '',
          attrs: attrs
        }),
        rawEvent: {
          form: form,
          attrs: attrs
        }
      })];
    }
  };

  // =========================================================================
  // ADAPTER: Meituan LX / Owl
  // =========================================================================

  var meituanAdapter = {
    id: 'meituan',

    matcher: function (request) {
      var ctx = prepareRequestContext(request);
      var score = 0;
      var reasons = [];

      if (Core.hostMatches(ctx.host, 'lx1.meituan.net') ||
          Core.hostMatches(ctx.host, 'lx2.meituan.net') ||
          Core.hostMatches(ctx.host, 'lx.meituan.net')) {
        score += 0.55;
        reasons.push('host:meituan-lx');
      }
      if (Core.hostMatches(ctx.host, 'catfront.dianping.com')) {
        score += 0.55;
        reasons.push('host:catfront.dianping.com');
      }
      if (ctx.query.d) {
        score += 0.2;
        reasons.push('query:d(base64)');
      }
      if (Core.pathMatches(ctx.path, '/api/pv') ||
          Core.pathMatches(ctx.path, '/batch') ||
          Core.pathMatches(ctx.path, '/api/metric') ||
          Core.pathMatches(ctx.path, '/raptorapi/fstSpeed')) {
        score += 0.2;
        reasons.push('path:owl');
      }

      return matchResult(score >= 0.45, score, reasons);
    },

    parser: function (request) {
      var ctx = prepareRequestContext(request);
      var results = [];

      if ((Core.hostMatches(ctx.host, 'lx1.meituan.net') ||
           Core.hostMatches(ctx.host, 'lx2.meituan.net') ||
           Core.hostMatches(ctx.host, 'lx.meituan.net')) && ctx.query.d) {
        var decoded = decodeBase64Utf8(ctx.query.d);
        var batches = extractJsonFromText(decoded);
        if (!Array.isArray(batches)) batches = batches ? [batches] : [];

        for (var i = 0; i < batches.length; i++) {
          var batch = batches[i] || {};
          var evs = Array.isArray(batch.evs) ? batch.evs : [];
          for (var j = 0; j < evs.length; j++) {
            var evt = evs[j] || {};
            var properties = Core.decodeObjectStrings(evt);
            properties.appName = batch.appnm || properties.appName || '';
            properties.lxid = batch.lxid || properties.lxid || '';

            results.push(Core.createNormalizedEvent({
              platform: 'meituan',
              eventName: evt.nm || 'mt_lx_event',
              userId: '',
              anonymousId: firstNonEmptyValue(batch.lxid, evt.lxid, ''),
              distinctId: firstNonEmptyValue(batch.lxid, deepFindValue(evt, function (key) {
                return key === 'pvid';
              }), ''),
              eventTime: Core.normalizeTimestamp(firstNonEmptyValue(evt.tm, batch.tm, '')),
              properties: properties,
              rawEvent: evt
            }));
          }
        }
      }

      if (results.length > 0) return results;

      var body = (ctx.bodyParsed && typeof ctx.bodyParsed === 'object')
        ? ctx.bodyParsed
        : (extractJsonFromText(ctx.bodyStr) || {});
      var pathName = basenameFromPath(ctx.path);

      if (Array.isArray(body.infos)) {
        for (var k = 0; k < body.infos.length; k++) {
          var info = body.infos[k] || {};
          results.push(Core.createNormalizedEvent({
            platform: 'meituan',
            eventName: info.type ? ('resource_' + info.type) : 'owl_batch',
            userId: '',
            anonymousId: firstNonEmptyValue(body.unionId, info.unionId, ''),
            distinctId: firstNonEmptyValue(body.pageId, info.pageId, body.unionId, ''),
            eventTime: Core.normalizeTimestamp(firstNonEmptyValue(info.timestamp, body.timestamp, '')),
            properties: Core.decodeObjectStrings({
              project: body.project || '',
              pageUrl: firstNonEmptyValue(info.pageUrl, body.pageUrl, ''),
              realUrl: firstNonEmptyValue(info.realUrl, body.realUrl, ''),
              info: info
            }),
            rawEvent: info
          }));
        }
      } else {
        results.push(Core.createNormalizedEvent({
          platform: 'meituan',
          eventName: pathName === 'pv' ? 'page_view' : (pathName || 'meituan_event'),
          userId: '',
          anonymousId: firstNonEmptyValue(body.unionId, body.lxid, ''),
          distinctId: firstNonEmptyValue(body.pageId, body.unionId, ''),
          eventTime: Core.normalizeTimestamp(firstNonEmptyValue(body.timestamp, body.ts, '')),
          properties: Core.decodeObjectStrings(body),
          rawEvent: body
        }));
      }

      return results;
    }
  };

  // =========================================================================
  // ADAPTER: JD Mercury
  // =========================================================================

  var jdAdapter = {
    id: 'jd',

    matcher: function (request) {
      var ctx = prepareRequestContext(request);
      var score = 0;
      var reasons = [];

      if (Core.hostMatches(ctx.host, 'mercury.jd.com')) {
        score += 0.6;
        reasons.push('host:mercury.jd.com');
      }
      if (Core.pathMatches(ctx.path, '/log.gif')) {
        score += 0.25;
        reasons.push('path:/log.gif');
      }
      if (ctx.query.v && (ctx.query.uid || ctx.query.sid || ctx.query.t)) {
        score += 0.15;
        reasons.push('query:v+uid/sid/t');
      }

      return matchResult(score >= 0.45, score, reasons);
    },

    parser: function (request) {
      var ctx = prepareRequestContext(request);
      var data = parseDollarKeyValue(ctx.query.v || '');
      var pageUrl = firstNonEmptyValue(data.url_full, data.url, data.page_url, '');

      return [Core.createNormalizedEvent({
        platform: 'jd',
        eventName: firstNonEmptyValue(data.t2, data.t, ctx.query.t, 'jd_event'),
        userId: ctx.query.pin || '',
        anonymousId: firstNonEmptyValue(ctx.query.uid, data.pinid, ''),
        distinctId: firstNonEmptyValue(ctx.query.pin, ctx.query.uid, ctx.query.sid, data.pinid, ''),
        eventTime: Core.normalizeTimestamp(firstNonEmptyValue(data.tm, data.ts, '')),
        properties: Core.decodeObjectStrings({
          module: ctx.query.m || '',
          referrer: ctx.query.ref || '',
          pageUrl: pageUrl,
          payload: data
        }),
        rawEvent: {
          query: ctx.query,
          payload: data
        }
      })];
    }
  };

  // =========================================================================
  // ADAPTER: Bilibili Web Logger
  // =========================================================================

  var bilibiliAdapter = {
    id: 'bilibili',

    matcher: function (request) {
      var ctx = prepareRequestContext(request);
      var score = 0;
      var reasons = [];

      if (Core.hostMatches(ctx.host, 'data.bilibili.com')) {
        score += 0.55;
        reasons.push('host:data.bilibili.com');
      }
      if (Core.pathMatches(ctx.path, '/log/web') || Core.pathMatches(ctx.path, '/v2/log/web')) {
        score += 0.3;
        reasons.push('path:bili-log');
      }
      if (ctx.query.content_type || ctx.query.spm_id_from) {
        score += 0.1;
        reasons.push('query:content_type/spm');
      }

      return matchResult(score >= 0.45, score, reasons);
    },

    parser: function (request) {
      var ctx = prepareRequestContext(request);

      function findLikelyEventName(segments) {
        var fallback = '';
        for (var i = 0; i < segments.length; i++) {
          var seg = (segments[i] || '').trim();
          if (!seg || seg.length < 3) continue;
          if (/^https?:\/\//i.test(seg)) continue;
          if (/^\d+(\.\d+)+$/.test(seg)) continue;
          if (/^\d{10,13}$/.test(seg)) continue;
          if (seg.charAt(0) === '{' || seg.charAt(0) === '[') continue;
          if (/^(web|pc|main|null|undefined)$/i.test(seg)) continue;
          if (/^(page_(load|show)|fp\.risk|promotion_card\.content\.show)$/i.test(seg)) return seg;
          if (/^[a-z][a-z0-9_.-]{3,}$/i.test(seg)) fallback = seg;
        }
        return fallback;
      }

      function trimUrlCandidate(url) {
        if (typeof url !== 'string') return '';
        return url
          .replace(/\u0000/g, '')
          .replace(/[)"'\\\],};]+$/g, '')
          .trim();
      }

      function findBiliFieldValue(source, key, pattern) {
        if (bodyJson) {
          var jsonValue = deepFindValue(bodyJson, function (candidateKey, value) {
            if (!value && value !== false) return false;
            return candidateKey === key;
          });
          if (jsonValue || jsonValue === false) return jsonValue;
        }

        var match = source.match(pattern);
        return match ? match[1] : '';
      }

      function findBiliPbEventName(strings, rawText) {
        var taggedEventMatch = rawText.match(/\b\d{3}\.\d{4}(?:\.\d+){0,2}\.[a-z][a-z0-9_.-]+\b/i);
        if (taggedEventMatch) {
          return taggedEventMatch[0].replace(/^\d{3}\.\d{4}(?:\.\d+){0,2}\./i, '');
        }

        var knownMatch = rawText.match(/page_(?:load|show|hide|unload)|promotion_card\.content\.show|fp\.risk|unload|laputa\.[a-z0-9_.-]+/i);
        if (knownMatch) return knownMatch[0];

        for (var i = 0; i < strings.length; i++) {
          var seg = (strings[i] || '').trim();
          if (!seg || seg.length < 4) continue;
          if (/^https?:\/\//i.test(seg)) continue;
          if (/^\d+(\.\d+)+$/.test(seg)) continue;
          if (/^\d{10,13}$/.test(seg)) continue;
          if (/^(web|pc|main|null|undefined)$/i.test(seg)) continue;
          if (/^[a-z][a-z0-9_.-]{3,}$/i.test(seg) && (seg.indexOf('_') !== -1 || seg.indexOf('.') !== -1)) {
            return seg;
          }
        }

        return '';
      }

      function extractBiliPbEventCandidates(rawText) {
        var candidates = [];
        var matches = rawText.match(/\b\d{3}\.\d{4}\.[A-Za-z][A-Za-z0-9_.-]{3,}\b/g) || [];

        for (var i = 0; i < matches.length; i++) {
          var clean = (matches[i] || '')
            .replace(/^[^0-9]+/, '')
            .replace(/[^A-Za-z0-9_.-]+$/g, '');
          clean = clean.replace(/^\d(?=\d{3}\.\d{4}\.)/, '');
          if (!clean || candidates.indexOf(clean) !== -1) continue;
          candidates.push(clean);
          if (candidates.length >= 12) break;
        }

        return candidates;
      }

      if (!Core.pathMatches(ctx.path, '/v2/log/web') && Core.pathMatches(ctx.path, '/log/web')) {
        var rawSearch = ctx.search ? ctx.search.slice(1) : '';
        var decodedSearch = safeDecodeURIComponentLoose(rawSearch);
        var segments = decodedSearch.split('|');
        var jsonObjects = [];

        for (var i = 0; i < segments.length; i++) {
          var parsed = extractJsonFromText(segments[i]);
          if (parsed) jsonObjects.push(parsed);
        }

        var eventName = firstNonEmptyValue(
          deepFindValue(jsonObjects, function (key, value) {
            return (key === 'event' || key === 'eventName') && typeof value === 'string';
          }),
          findLikelyEventName(segments),
          'bili_web_log'
        );
        var pageUrl = firstNonEmptyValue(
          deepFindValue(jsonObjects, function (key, value) {
            return (key === 'url' || key === 'pageUrl' || key === 'page_url') && typeof value === 'string';
          }),
          (decodedSearch.match(/https?:\/\/[^\s|]+/i) || [])[0],
          ''
        );
        var anonymousId = firstNonEmptyValue(
          deepFindValue(jsonObjects, function (key) {
            return /^(buvid_fp|buvid4|buvid3|_uuid|uuid)$/.test(key);
          }),
          ''
        );
        var eventTime = firstNonEmptyValue(
          deepFindValue(jsonObjects, function (key, value) {
            return /^(ts|timestamp|ctime|time)$/.test(key) && value;
          }),
          (decodedSearch.match(/\b\d{13}\b/) || [])[0],
          ''
        );

        return [Core.createNormalizedEvent({
          platform: 'bilibili',
          eventName: eventName,
          userId: '',
          anonymousId: anonymousId,
          distinctId: anonymousId,
          eventTime: Core.normalizeTimestamp(eventTime),
          properties: Core.decodeObjectStrings({
            pageUrl: pageUrl,
            spm: ctx.query.spm_id_from || '',
            contentType: ctx.query.content_type || '',
            parsedPayload: jsonObjects.length === 1 ? jsonObjects[0] : jsonObjects.slice(0, 3),
            rawSegments: segments.slice(0, 16)
          }),
          rawEvent: {
            segments: segments,
            parsedPayload: jsonObjects
          }
        })];
      }

      var bodyBytes = ctx.bodyBase64 ? decodeBase64ToBytes(ctx.bodyBase64) : new Uint8Array(0);
      var printableStrings = bodyBytes.length ? extractPrintableStringsFromBytes(bodyBytes, 4, 60) : [];
      var bodyText = [ctx.bodyStr || '', printableStrings.join(' ')].join(' ');
      var bodyJson = extractJsonFromText(bodyText) || extractJsonFromText(ctx.bodyStr || '');
      var cookieHeader = getHeaderValue(ctx.headers, 'cookie') || '';
      var pageUrlMatch = bodyText.match(/https?:\/\/[^\s\u0000"'\\<>{}]+/i);
      var appIdMatch = bodyText.match(/\b\d{3}\.\d{4}\.\d+\.\d+\b/);
      var sdkVersionMatch = bodyText.match(/\b\d{1,2}\.\d{1,2}\.\d{1,2}\b(?!\.\d)/);
      var eventCandidates = extractBiliPbEventCandidates(bodyText);
      var browserSessionId = firstNonEmptyValue(
        (cookieHeader.match(/(?:^|;\s*)b_lsid=([^;]+)/i) || [])[1],
        (bodyText.match(/\b[A-F0-9]{8}_[A-F0-9]{10,}\b/i) || [])[0],
        ''
      );
      var screenResolution = firstNonEmptyValue(
        (bodyText.match(/\b\d{3,4}\*\d{3,4}\b/) || [])[0],
        ''
      );
      var browserResolution = firstNonEmptyValue(
        (cookieHeader.match(/(?:^|;\s*)browser_resolution=([0-9-]+)/i) || [])[1],
        ''
      );
      var bNut = firstNonEmptyValue(
        (cookieHeader.match(/(?:^|;\s*)b_nut=([^;]+)/i) || [])[1],
        ''
      );
      var buvid3 = firstNonEmptyValue(
        bodyJson && deepFindValue(bodyJson, function (key) { return /^buvid3$/i.test(key); }),
        (bodyText.match(/buvid3[^A-Za-z0-9]{0,8}([A-Za-z0-9._-]{8,})/i) || [])[1],
        (cookieHeader.match(/(?:^|;\s*)buvid3=([^;]+)/i) || [])[1],
        ''
      );
      var buvid4 = firstNonEmptyValue(
        bodyJson && deepFindValue(bodyJson, function (key) { return /^buvid4$/i.test(key); }),
        (bodyText.match(/buvid4[^A-Za-z0-9]{0,8}([A-Za-z0-9._-]{8,})/i) || [])[1],
        (cookieHeader.match(/(?:^|;\s*)buvid4=([^;]+)/i) || [])[1],
        ''
      );
      var buvidFp = firstNonEmptyValue(
        bodyJson && deepFindValue(bodyJson, function (key) { return /^buvid_fp$/i.test(key); }),
        (bodyText.match(/buvid_fp[^A-Za-z0-9]{0,8}([A-Za-z0-9._-]{8,})/i) || [])[1],
        (cookieHeader.match(/(?:^|;\s*)buvid_fp=([^;]+)/i) || [])[1],
        ''
      );
      var uuid = firstNonEmptyValue(
        bodyJson && deepFindValue(bodyJson, function (key) { return /^(_uuid|uuid)$/i.test(key); }),
        (bodyText.match(/(?:_uuid|uuid)[^A-Za-z0-9]{0,8}([A-Za-z0-9._-]{8,})/i) || [])[1],
        (cookieHeader.match(/(?:^|;\s*)_uuid=([^;]+)/i) || [])[1],
        ''
      );
      var pageUrl = trimUrlCandidate(firstNonEmptyValue(
        bodyJson && deepFindValue(bodyJson, function (key, value) {
          return (key === 'url' || key === 'pageUrl' || key === 'page_url') && typeof value === 'string';
        }),
        pageUrlMatch ? pageUrlMatch[0] : '',
        ''
      ));
      var bvid = firstNonEmptyValue(
        (pageUrl.match(/\/video\/(BV[0-9A-Za-z]+)/i) || [])[1],
        (bodyText.match(/\b(BV[0-9A-Za-z]{10,})\b/) || [])[1],
        ''
      );
      var aid = firstNonEmptyValue(
        (pageUrl.match(/\/video\/av(\d+)/i) || [])[1],
        (bodyText.match(/\bav(\d{5,})\b/i) || [])[1],
        ''
      );
      var uniqPageId = firstNonEmptyValue(
        findBiliFieldValue(bodyText, 'uniq_page_id', /uniq_page_id[^A-Za-z0-9]{0,8}"?(\d{6,})/i),
        ''
      );
      var homeVersion = firstNonEmptyValue(
        findBiliFieldValue(bodyText, 'home_version', /home_version[^A-Za-z0-9]{0,8}"?([A-Za-z0-9._-]{1,24})/i),
        ''
      );
      var bUt = firstNonEmptyValue(
        findBiliFieldValue(bodyText, 'b_ut', /b_ut[^A-Za-z0-9]{0,8}"?([A-Za-z0-9._-]{1,12})/i),
        ''
      );
      var isModern = findBiliFieldValue(bodyText, 'is_modern', /is_modern[^A-Za-z0-9]{0,8}(true|false|1|0)/i);
      var metaEventName = firstNonEmptyValue(
        findBiliFieldValue(bodyText, 'name', /name[^A-Za-z0-9]{0,8}([a-z][a-z0-9_-]{2,48})/i),
        eventCandidates.length ? eventCandidates[0].split('.').pop() : '',
        ''
      );
      var metaEventCategory = firstNonEmptyValue(
        findBiliFieldValue(bodyText, 'metaEventCategory', /metaEventCategory[^A-Za-z0-9]{0,8}([A-Za-z][A-Za-z0-9_.-]{2,32})/i),
        ''
      );
      var metaEventValue = firstNonEmptyValue(
        findBiliFieldValue(bodyText, 'value', /value[^0-9]{0,8}(\d{1,8})/i),
        ''
      );
      var pbEventName = firstNonEmptyValue(
        bodyJson && deepFindValue(bodyJson, function (key, value) {
          return (key === 'event' || key === 'eventName') && typeof value === 'string';
        }),
        metaEventName,
        findBiliPbEventName(printableStrings, bodyText),
        eventCandidates.length ? eventCandidates[0] : '',
        appIdMatch ? appIdMatch[0] : '',
        'bili_pbrequest'
      );

      return [Core.createNormalizedEvent({
        platform: 'bilibili',
        eventName: pbEventName,
        userId: '',
        anonymousId: firstNonEmptyValue(buvid3, buvid4, buvidFp, uuid, ''),
        distinctId: firstNonEmptyValue(buvid3, buvid4, buvidFp, uuid, ''),
        eventTime: '',
        properties: Core.decodeObjectStrings({
          pageUrl: pageUrl,
          appId: appIdMatch ? appIdMatch[0] : '',
          buvid3: buvid3,
          buvid4: buvid4,
          buvidFp: buvidFp,
          uuid: uuid,
          bvid: bvid,
          aid: aid,
          logId: ctx.query.logid || '',
          disableCompression: ctx.query.disable_compression || '',
          sdkVersion: sdkVersionMatch ? sdkVersionMatch[0] : '',
          bUt: bUt,
          homeVersion: homeVersion,
          uniqPageId: uniqPageId,
          isModern: isModern,
          browserSessionId: browserSessionId,
          browserResolution: browserResolution ? browserResolution.replace(/-/g, 'x') : '',
          screenResolution: screenResolution ? screenResolution.replace(/\*/g, 'x') : '',
          bNut: bNut,
          metaEventName: metaEventName,
          metaEventCategory: metaEventCategory,
          metaEventValue: metaEventValue,
          eventCandidates: eventCandidates,
          spm: ctx.query.spm_id_from || '',
          contentType: ctx.query.content_type || '',
          payloadLength: bodyBytes.length || bodyText.length,
          extractedPayload: bodyJson || null,
          extractedStrings: printableStrings.slice(0, 20)
        }),
        rawEvent: bodyText
      })];
    }
  };

  // =========================================================================
  // ADAPTER: Ctrip UBT / Bee (partial parser)
  // =========================================================================

  var ctripAdapter = {
    id: 'ctrip',

    matcher: function (request) {
      var ctx = prepareRequestContext(request);
      var score = 0;
      var reasons = [];

      if (Core.hostMatches(ctx.host, 's.c-ctrip.com') || Core.hostMatches(ctx.host, 'ma-adx.ctrip.com')) {
        score += 0.55;
        reasons.push('host:ctrip-collector');
      }
      if (Core.pathMatches(ctx.path, '/bee/collect') || Core.pathMatches(ctx.path, '/_ma.gif')) {
        score += 0.25;
        reasons.push('path:bee/_ma.gif');
      }
      if (ctx.query.vid || ctx.query.sid || ctx.query.appId || ctx.query.key) {
        score += 0.15;
        reasons.push('query:vid/sid/appId/key');
      }

      return matchResult(score >= 0.45, score, reasons);
    },

    parser: function (request) {
      var ctx = prepareRequestContext(request);
      var pathName = basenameFromPath(ctx.path);
      var body = (ctx.bodyParsed && typeof ctx.bodyParsed === 'object' && !Array.isArray(ctx.bodyParsed))
        ? ctx.bodyParsed
        : {};
      var opaquePayload = firstNonEmptyValue(body.d, body.c, ctx.query.c, '');
      var payloadCandidates = [];
      var payloadDecoded = extractJsonFromText(ctx.bodyStr || '') || null;
      var payloadRaw = payloadDecoded ? (ctx.bodyStr || '') : '';

      function pushPayloadCandidate(value) {
        if (typeof value !== 'string' || !value || payloadCandidates.indexOf(value) !== -1) return;
        payloadCandidates.push(value);
      }

      function extractPayloadValue(keyPattern) {
        var fromDecoded = payloadDecoded && deepFindValue(payloadDecoded, function (key, value) {
          return keyPattern.test(key) && typeof value === 'string';
        });
        if (fromDecoded) return fromDecoded;

        for (var i = 0; i < payloadCandidates.length; i++) {
          var match = payloadCandidates[i].match(new RegExp(keyPattern.source + '[=:]"?([^"&|,;\\s]+)', 'i'));
          if (match && match[1]) return match[1];
        }

        return '';
      }

      pushPayloadCandidate(ctx.bodyStr || '');
      pushPayloadCandidate(opaquePayload);
      pushPayloadCandidate(safeDecodeURIComponentLoose(opaquePayload));
      pushPayloadCandidate(decodeBase64Utf8(opaquePayload));
      pushPayloadCandidate(safeDecodeURIComponentLoose(decodeBase64Utf8(opaquePayload)));

      for (var i = 0; i < payloadCandidates.length; i++) {
        var parsedPayload = extractJsonFromText(payloadCandidates[i]);
        if (parsedPayload && typeof parsedPayload === 'object') {
          payloadDecoded = parsedPayload;
          payloadRaw = payloadCandidates[i];
          break;
        }

        var parsedForm = Core.parseBody(payloadCandidates[i]);
        if (parsedForm && parsedForm.data && typeof parsedForm.data === 'object' &&
            Object.keys(parsedForm.data).length > 0) {
          payloadDecoded = parsedForm.data;
          payloadRaw = payloadCandidates[i];
          break;
        }
      }

      var nestedOpaquePayload = payloadDecoded && typeof payloadDecoded === 'object'
        ? firstNonEmptyValue(payloadDecoded.d, payloadDecoded.c, '')
        : '';
      if (nestedOpaquePayload) {
        var nestedCandidates = [
          nestedOpaquePayload,
          safeDecodeURIComponentLoose(nestedOpaquePayload),
          decodeBase64Utf8(nestedOpaquePayload),
          safeDecodeURIComponentLoose(decodeBase64Utf8(nestedOpaquePayload))
        ];

        for (var n = 0; n < nestedCandidates.length; n++) {
          var nestedParsed = extractJsonFromText(nestedCandidates[n]);
          if (nestedParsed && typeof nestedParsed === 'object') {
            payloadDecoded = nestedParsed;
            payloadRaw = nestedCandidates[n];
            break;
          }

          var nestedForm = Core.parseBody(nestedCandidates[n]);
          if (nestedForm && nestedForm.data && typeof nestedForm.data === 'object' &&
              Object.keys(nestedForm.data).length > 0 &&
              !firstNonEmptyValue(nestedForm.data.d, nestedForm.data.c, '')) {
            payloadDecoded = nestedForm.data;
            payloadRaw = nestedCandidates[n];
            break;
          }
        }
      }

      if (!payloadRaw && payloadCandidates.length > 0) {
        payloadRaw = payloadCandidates[0];
      }

      var pageUrlMatch = opaquePayload.match(/https?:\/\/[^\s"'\\<>{}]+/i);
      var productIdMatch = firstNonEmptyValue(
        ctx.query.productId,
        (opaquePayload.match(/productId[^A-Za-z0-9]{0,8}([A-Za-z0-9._-]{6,})/i) || [])[1],
        ''
      );
      var localeMatch = firstNonEmptyValue(
        (opaquePayload.match(/\b(?:zh-CN|zh-cn|en-US|en-us|zh-TW|zh-tw)\b/) || [])[0],
        ''
      );
      var traceIdMatch = firstNonEmptyValue(
        (opaquePayload.match(/\b\d{8,}\.\w{6,}\b/) || [])[0],
        ''
      );
      var eventName = Core.pathMatches(ctx.path, '/bee/collect')
        ? firstNonEmptyValue(
            body.ac,
            payloadDecoded && deepFindValue(payloadDecoded, function (key, value) {
              return /^(event|eventName|action|actionName|pageName|act|ac)$/i.test(key) && typeof value === 'string';
            }),
            'bee_collect'
          )
        : firstNonEmptyValue(ctx.query.key, pathName, 'ctrip_event');
      var pageUrl = firstNonEmptyValue(
        payloadDecoded && deepFindValue(payloadDecoded, function (key, value) {
          return /^(url|pageUrl|page_url|referPage|referer|referrer)$/i.test(key) && typeof value === 'string';
        }),
        extractPayloadValue(/(?:url|pageUrl|page_url)/),
        pageUrlMatch ? pageUrlMatch[0] : '',
        ''
      );
      var instKey = firstNonEmptyValue(
        payloadDecoded && deepFindValue(payloadDecoded, function (key, value) {
          return /^instKey$/i.test(key) && typeof value === 'string';
        }),
        extractPayloadValue(/instKey/),
        ''
      );
      var session = firstNonEmptyValue(
        payloadDecoded && deepFindValue(payloadDecoded, function (key, value) {
          return /^(session|sessionId|sid)$/i.test(key) && typeof value === 'string';
        }),
        extractPayloadValue(/(?:session|sessionId|sid)/),
        ''
      );
      var lang = firstNonEmptyValue(
        payloadDecoded && deepFindValue(payloadDecoded, function (key, value) {
          return /^(lang|language)$/i.test(key) && typeof value === 'string';
        }),
        extractPayloadValue(/(?:lang|language)/),
        localeMatch,
        ''
      );
      var domain = firstNonEmptyValue(
        payloadDecoded && deepFindValue(payloadDecoded, function (key, value) {
          return /^(domain|host)$/i.test(key) && typeof value === 'string';
        }),
        extractPayloadValue(/(?:domain|host)/),
        (pageUrl.match(/^https?:\/\/([^/?#]+)/i) || [])[1],
        ''
      );
      var contextValue = firstNonEmptyValue(
        payloadDecoded && deepFindValue(payloadDecoded, function (key, value) {
          return /^context$/i.test(key) && typeof value === 'string';
        }),
        extractPayloadValue(/context/),
        ''
      );

      return [Core.createNormalizedEvent({
        platform: 'ctrip',
        eventName: eventName,
        userId: '',
        anonymousId: firstNonEmptyValue(
          payloadDecoded && firstNonEmptyValue(payloadDecoded.vid, payloadDecoded.uid, ''),
          ctx.query.vid,
          ctx.query.sid,
          session,
          ''
        ),
        distinctId: firstNonEmptyValue(
          payloadDecoded && firstNonEmptyValue(payloadDecoded.requestid, payloadDecoded.impid, ''),
          ctx.query.pvId,
          ctx.query.sid,
          ctx.query.vid,
          session,
          ''
        ),
        eventTime: Core.normalizeTimestamp(firstNonEmptyValue(ctx.query.ts, ctx.query.contextTs, '')),
        properties: Core.decodeObjectStrings({
          pageUrl: pageUrl,
          metaSender: ctx.query.metaSender || '',
          contextTs: ctx.query.contextTs || '',
          vid: ctx.query.vid || '',
          sid: ctx.query.sid || '',
          pvId: ctx.query.pvId || '',
          appId: ctx.query.appId || '',
          key: ctx.query.key || '',
          productId: productIdMatch,
          instKey: instKey,
          session: session,
          lang: lang,
          domain: domain,
          context: contextValue,
          firstImp: firstNonEmptyValue(ctx.query.firstImp, ''),
          locale: lang,
          traceId: traceIdMatch,
          requestId: payloadDecoded && firstNonEmptyValue(payloadDecoded.requestid, payloadDecoded.impid, ''),
          impId: payloadDecoded && firstNonEmptyValue(payloadDecoded.impid, ''),
          impType: payloadDecoded && firstNonEmptyValue(payloadDecoded.impType, ''),
          campaignId: payloadDecoded && firstNonEmptyValue(payloadDecoded.campaignid, ''),
          creativeId: payloadDecoded && firstNonEmptyValue(payloadDecoded.creativeid, ''),
          dealId: payloadDecoded && firstNonEmptyValue(payloadDecoded.dealid, ''),
          planId: payloadDecoded && firstNonEmptyValue(payloadDecoded.planid, ''),
          strategyId: payloadDecoded && firstNonEmptyValue(payloadDecoded.strategyid, ''),
          price: payloadDecoded && firstNonEmptyValue(payloadDecoded.price, ''),
          payloadAction: body.ac || '',
          payloadMode: opaquePayload.indexOf('m1Legacy') !== -1 ? 'm1Legacy' : '',
          payloadLength: opaquePayload.length,
          payloadDecoded: payloadDecoded || null
        }),
        rawEvent: {
          query: ctx.query,
          body: body,
          payloadRaw: payloadRaw
        }
      })];
    }
  };

  // =========================================================================
  // ADAPTER: Amazon Internal Telemetry
  // =========================================================================

  var amazonAdapter = {
    id: 'amazon',

    matcher: function (request) {
      var ctx = prepareRequestContext(request);
      var score = 0;
      var reasons = [];

      if (Core.hostMatches(ctx.host, 'fls-na.amazon.com') ||
          Core.hostMatches(ctx.host, 'unagi.amazon.com')) {
        score += 0.5;
        reasons.push('host:amazon-telemetry');
      } else if (Core.hostMatches(ctx.host, 'www.amazon.com') && Core.pathMatches(ctx.path, '/tt/i')) {
        score += 0.25;
        reasons.push('host:www.amazon.com+tt_i');
      }
      if (Core.pathMatches(ctx.path, '/1/batch/1/OP/') ||
          Core.pathMatches(ctx.path, '/1/events/com.amazon.csm.nexusclient.prod')) {
        score += 0.35;
        reasons.push('path:batch/unagi');
      } else if (Core.pathMatches(ctx.path, '/tt/i')) {
        score += 0.3;
        reasons.push('path:tt_i');
      }
      if (ctx.query.productId || ctx.query.firstImp || extractJsonFromText(ctx.bodyStr || '')) {
        score += 0.1;
        reasons.push('query/body:productId/firstImp/json');
      }

      return matchResult(score >= 0.45, score, reasons);
    },

    parser: function (request) {
      var ctx = prepareRequestContext(request);
      var cookieHeader = getHeaderValue(ctx.headers, 'cookie');
      var cookies = {};
      var csmHitParsed = {};

      if (cookieHeader) {
        var cookieParts = cookieHeader.split(/;\s*/);
        for (var cookieIndex = 0; cookieIndex < cookieParts.length; cookieIndex++) {
          var cookieSep = cookieParts[cookieIndex].indexOf('=');
          if (cookieSep === -1) continue;
          cookies[cookieParts[cookieIndex].slice(0, cookieSep)] = cookieParts[cookieIndex].slice(cookieSep + 1);
        }
      }

      if (cookies['csm-hit']) {
        var hitParts = cookies['csm-hit'].split('&');
        for (var hitIndex = 0; hitIndex < hitParts.length; hitIndex++) {
          var colonIndex = hitParts[hitIndex].indexOf(':');
          if (colonIndex === -1) continue;
          csmHitParsed[hitParts[hitIndex].slice(0, colonIndex)] = hitParts[hitIndex].slice(colonIndex + 1);
        }
      }

      function resolveAmazonToken(value, dict, depth) {
        var out = value;
        var level = depth || 0;
        if (level > 8) return out;

        if (typeof out === 'string') {
          if (/^#\d+$/.test(out) && dict && dict.hasOwnProperty(out)) {
            return resolveAmazonToken(dict[out], dict, level + 1);
          }
          var parsed = extractJsonFromText(out);
          return parsed !== null ? parsed : out;
        }

        if (Array.isArray(out)) {
          var arr = [];
          for (var i = 0; i < out.length; i++) arr.push(resolveAmazonToken(out[i], dict, level + 1));
          return arr;
        }

        if (out && typeof out === 'object') {
          var obj = {};
          for (var key in out) {
            if (!out.hasOwnProperty(key)) continue;
            obj[resolveAmazonToken(key, dict, level + 1)] = resolveAmazonToken(out[key], dict, level + 1);
          }
          return obj;
        }

        return out;
      }

      if (Core.pathMatches(ctx.path, '/1/events/com.amazon.csm.nexusclient.prod')) {
        var bodyJson = extractJsonFromText(ctx.bodyStr || '') || {};
        var dict = bodyJson && bodyJson.cs && bodyJson.cs.dct && typeof bodyJson.cs.dct === 'object'
          ? bodyJson.cs.dct
          : {};
        var events = Array.isArray(bodyJson.events) ? bodyJson.events : [];
        var resolvedEvents = [];

        for (var i = 0; i < events.length; i++) {
          var rawEvent = events[i] && events[i].data ? events[i].data : events[i];
          var resolved = resolveAmazonToken(rawEvent, dict, 0);
          var eventName = firstNonEmptyValue(
            resolved.schemaId,
            resolved.producerId,
            'amazon_unagi'
          );

          resolvedEvents.push(Core.createNormalizedEvent({
            platform: 'amazon',
            eventName: eventName,
            userId: '',
            anonymousId: firstNonEmptyValue(resolved.sessionId, ''),
            distinctId: firstNonEmptyValue(resolved.requestId, resolved.messageId, resolved.sessionId, ''),
            eventTime: Core.normalizeTimestamp(firstNonEmptyValue(resolved.timestamp, '')),
            properties: Core.decodeObjectStrings({
              requestId: firstNonEmptyValue(resolved.requestId, ''),
              messageId: firstNonEmptyValue(resolved.messageId, ''),
              sessionId: firstNonEmptyValue(resolved.sessionId, ''),
              server: firstNonEmptyValue(resolved.server, ''),
              producerId: firstNonEmptyValue(resolved.producerId, ''),
              schemaId: firstNonEmptyValue(resolved.schemaId, ''),
              obfuscatedMarketplaceId: firstNonEmptyValue(resolved.obfuscatedMarketplaceId, ''),
              fmp: resolved.fmp || null,
              info: resolved.info || null,
              referer: getHeaderValue(ctx.headers, 'referer')
            }),
            rawEvent: resolved
          }));
        }

        if (resolvedEvents.length > 0) return resolvedEvents;
      }

      if (Core.pathMatches(ctx.path, '/1/batch/1/OP/')) {
        var flsMatch = ctx.path.match(/\/1\/batch\/(\d+)\/OP\/([^:$]+):([^:$]+):([^$]+)\$uedata=([^:]+)(?::(\d+))?/i);
        var decodedUedata = safeDecodeURIComponentLoose(flsMatch ? flsMatch[5] : '');
        return [Core.createNormalizedEvent({
          platform: 'amazon',
          eventName: 'amazon_uedata_batch',
          userId: '',
          anonymousId: flsMatch ? flsMatch[2] : '',
          distinctId: flsMatch ? flsMatch[4] : '',
          eventTime: '',
          properties: Core.decodeObjectStrings({
            marketplaceId: flsMatch ? flsMatch[2] : '',
            sessionId: flsMatch ? flsMatch[3] : '',
            requestId: flsMatch ? flsMatch[4] : '',
            uedata: decodedUedata,
            batchIndex: flsMatch ? flsMatch[6] || '' : '',
            referer: getHeaderValue(ctx.headers, 'referer')
          }),
          rawEvent: {
            path: ctx.path,
            uedata: decodedUedata
          }
        })];
      }

      return [Core.createNormalizedEvent({
        platform: 'amazon',
        eventName: Core.pathMatches(ctx.path, '/rd/uedata')
          ? 'amazon_uedata'
          : (Core.pathMatches(ctx.path, '/tt/i') ? 'amazon_tt_i' : 'amazon_telemetry'),
        userId: '',
        anonymousId: firstNonEmptyValue(ctx.query.sid, cookies['session-id'], cookies['ubid-main'], ''),
        distinctId: firstNonEmptyValue(ctx.query.rid, ctx.query.sid, cookies['session-id'], cookies['ubid-main'], ''),
        eventTime: '',
        properties: Core.decodeObjectStrings({
          pageUrl: getHeaderValue(ctx.headers, 'referer'),
          path: ctx.path,
          requestId: ctx.query.rid || '',
          sessionId: firstNonEmptyValue(ctx.query.sid, cookies['session-id'], ''),
          ubidMain: cookies['ubid-main'] || '',
          rx: ctx.query.rx || '',
          csmHit: cookies['csm-hit'] || '',
          csmHitParsed: csmHitParsed
        }),
        rawEvent: {
          url: ctx.url,
          headers: ctx.headers
        }
      })];
    }
  };

  // =========================================================================
  // ADAPTER: Meta / Facebook Pixel
  // =========================================================================

  var metaAdapter = {
    id: 'meta',

    matcher: function (request) {
      var ctx = prepareRequestContext(request);
      var score = 0;
      var reasons = [];

      if (Core.hostMatches(ctx.host, 'www.facebook.com') ||
          Core.hostMatches(ctx.host, 'facebook.com') ||
          Core.hostMatches(ctx.host, 'www.instagram.com')) {
        score += 0.45;
        reasons.push('host:meta-pixel');
      }
      if (Core.pathMatches(ctx.path, '/tr')) {
        score += 0.35;
        reasons.push('path:/tr');
      }
      if (ctx.query.id && ctx.query.ev) {
        score += 0.2;
        reasons.push('query:id+ev');
      }

      return matchResult(score >= 0.45, score, reasons);
    },

    parser: function (request) {
      var ctx = prepareRequestContext(request);
      var params = {};
      for (var key in ctx.query) {
        if (ctx.query.hasOwnProperty(key)) params[key] = ctx.query[key];
      }
      if (ctx.bodyParsed && typeof ctx.bodyParsed === 'object' && !Array.isArray(ctx.bodyParsed)) {
        for (var bodyKey in ctx.bodyParsed) {
          if (ctx.bodyParsed.hasOwnProperty(bodyKey)) params[bodyKey] = ctx.bodyParsed[bodyKey];
        }
      }

      var structured = expandStructuredParams(params, ['cd', 'ud']);
      var customData = structured.cd || {};
      var userData = structured.ud || {};

      return [Core.createNormalizedEvent({
        platform: 'meta',
        eventName: firstNonEmptyValue(params.ev, 'PageView'),
        userId: '',
        anonymousId: firstNonEmptyValue(params.fbp, params.fbc, ''),
        distinctId: firstNonEmptyValue(params.eventID, params.fbp, params.fbc, ''),
        eventTime: Core.normalizeTimestamp(firstNonEmptyValue(params.ts, '')),
        properties: Core.decodeObjectStrings({
          pixelId: params.id || '',
          pageUrl: params.dl || '',
          referrer: params.rl || '',
          iframe: params.if || '',
          screenWidth: params.sw || '',
          screenHeight: params.sh || '',
          customData: customData,
          userData: userData
        }),
        rawEvent: params
      })];
    }
  };

  // =========================================================================
  // ADAPTER: LinkedIn Insight Tag
  // =========================================================================

  var linkedinAdapter = {
    id: 'linkedin',

    matcher: function (request) {
      var ctx = prepareRequestContext(request);
      var score = 0;
      var reasons = [];

      if (Core.hostMatches(ctx.host, 'px.ads.linkedin.com')) {
        score += 0.55;
        reasons.push('host:px.ads.linkedin.com');
      }
      if (Core.pathMatches(ctx.path, '/collect') || Core.pathMatches(ctx.path, '/db_sync')) {
        score += 0.25;
        reasons.push('path:/collect|/db_sync');
      }
      if (ctx.query.pid && (ctx.query.url || ctx.query.conversionId || ctx.query.eventId)) {
        score += 0.2;
        reasons.push('query:pid+url/conversionId/eventId');
      }

      return matchResult(score >= 0.45, score, reasons);
    },

    parser: function (request) {
      var ctx = prepareRequestContext(request);
      var eventName = ctx.query.conversionId
        ? 'linkedin_conversion'
        : (Core.pathMatches(ctx.path, '/db_sync') ? 'linkedin_db_sync' : 'page_view');

      return [Core.createNormalizedEvent({
        platform: 'linkedin',
        eventName: eventName,
        userId: '',
        anonymousId: firstNonEmptyValue(ctx.query.li_fat_id, ctx.query.li_giant, ''),
        distinctId: firstNonEmptyValue(ctx.query.eventId, ctx.query.conversionId, ctx.query.li_fat_id, ''),
        eventTime: Core.normalizeTimestamp(firstNonEmptyValue(ctx.query.ts, '')),
        properties: Core.decodeObjectStrings({
          partnerId: ctx.query.pid || '',
          pageUrl: ctx.query.url || '',
          conversionId: ctx.query.conversionId || '',
          eventId: ctx.query.eventId || '',
          liFatId: ctx.query.li_fat_id || '',
          liGiant: ctx.query.li_giant || ''
        }),
        rawEvent: ctx.query
      })];
    }
  };

  // =========================================================================
  // ADAPTER: Pinterest Tag
  // =========================================================================

  var pinterestAdapter = {
    id: 'pinterest',

    matcher: function (request) {
      var ctx = prepareRequestContext(request);
      var score = 0;
      var reasons = [];

      if (Core.hostMatches(ctx.host, 'ct.pinterest.com')) {
        score += 0.55;
        reasons.push('host:ct.pinterest.com');
      }
      if (Core.pathMatches(ctx.path, '/v3/')) {
        score += 0.3;
        reasons.push('path:/v3/');
      }
      if (ctx.query.tid && ctx.query.event) {
        score += 0.15;
        reasons.push('query:tid+event');
      }

      return matchResult(score >= 0.45, score, reasons);
    },

    parser: function (request) {
      var ctx = prepareRequestContext(request);
      var structured = expandStructuredParams(ctx.query, ['ed']);
      var eventData = structured.ed || {};

      return [Core.createNormalizedEvent({
        platform: 'pinterest',
        eventName: firstNonEmptyValue(ctx.query.event, 'pagevisit'),
        userId: '',
        anonymousId: firstNonEmptyValue(ctx.query.em, ''),
        distinctId: firstNonEmptyValue(eventData.event_id, eventData.order_id, ctx.query.tid, ''),
        eventTime: Core.normalizeTimestamp(firstNonEmptyValue(ctx.query.ts, '')),
        properties: Core.decodeObjectStrings({
          tagId: ctx.query.tid || '',
          eventData: eventData,
          emailHash: ctx.query.em || '',
          noscript: ctx.query.noscript || ''
        }),
        rawEvent: ctx.query
      })];
    }
  };

  // =========================================================================
  // ADAPTER: Reddit Pixel
  // =========================================================================

  var redditAdapter = {
    id: 'reddit',

    matcher: function (request) {
      var ctx = prepareRequestContext(request);
      var score = 0;
      var reasons = [];

      if (Core.hostMatches(ctx.host, 'alb.reddit.com')) {
        score += 0.55;
        reasons.push('host:alb.reddit.com');
      }
      if (Core.pathMatches(ctx.path, '/rp.gif')) {
        score += 0.3;
        reasons.push('path:/rp.gif');
      }
      if (ctx.query.id && ctx.query.event) {
        score += 0.15;
        reasons.push('query:id+event');
      }

      return matchResult(score >= 0.45, score, reasons);
    },

    parser: function (request) {
      var ctx = prepareRequestContext(request);
      var structured = expandStructuredParams(ctx.query, ['m']);
      var metrics = structured.m || {};
      var eventName = firstNonEmptyValue(ctx.query.event, 'PageVisit');
      if (eventName === 'Custom' && metrics.customEventName) {
        eventName = metrics.customEventName;
      }

      return [Core.createNormalizedEvent({
        platform: 'reddit',
        eventName: eventName,
        userId: '',
        anonymousId: firstNonEmptyValue(ctx.query.uuid, ctx.query.aaid, ''),
        distinctId: firstNonEmptyValue(metrics.conversionId, metrics.transactionId, ctx.query.uuid, ''),
        eventTime: Core.normalizeTimestamp(firstNonEmptyValue(ctx.query.ts, '')),
        properties: Core.decodeObjectStrings({
          pixelId: ctx.query.id || '',
          integration: ctx.query.integration || '',
          metrics: metrics,
          emailHash: ctx.query.em || '',
          phoneHash: ctx.query.pn || '',
          externalId: ctx.query.external_id || '',
          screenWidth: ctx.query.sw || '',
          screenHeight: ctx.query.sh || ''
        }),
        rawEvent: ctx.query
      })];
    }
  };

  // =========================================================================
  // ADAPTER: X Pixel
  // =========================================================================

  var xAdapter = {
    id: 'x',

    matcher: function (request) {
      var ctx = prepareRequestContext(request);
      var score = 0;
      var reasons = [];

      if (Core.hostMatches(ctx.host, 'analytics.twitter.com')) {
        score += 0.55;
        reasons.push('host:analytics.twitter.com');
      }
      if (Core.pathMatches(ctx.path, '/i/adsct') || Core.pathMatches(ctx.path, '/i/adsctp')) {
        score += 0.3;
        reasons.push('path:/i/adsct|adsctp');
      }
      if (ctx.query.event || ctx.query.events || ctx.query.event_id || ctx.query.txn_id) {
        score += 0.15;
        reasons.push('query:event/event_id/txn_id');
      }

      return matchResult(score >= 0.45, score, reasons);
    },

    parser: function (request) {
      var ctx = prepareRequestContext(request);
      var params = {};
      var contents = null;

      for (var key in ctx.query) {
        if (ctx.query.hasOwnProperty(key)) params[key] = ctx.query[key];
      }
      if (ctx.bodyParsed && typeof ctx.bodyParsed === 'object' && !Array.isArray(ctx.bodyParsed)) {
        for (var bodyKey in ctx.bodyParsed) {
          if (ctx.bodyParsed.hasOwnProperty(bodyKey)) params[bodyKey] = ctx.bodyParsed[bodyKey];
        }
      }
      contents = extractJsonFromText(firstNonEmptyValue(params.contents, params.tw_contents, ''));

      var eventName = firstNonEmptyValue(
        params.event,
        params.events,
        params.tw_event,
        params.tw_event_name,
        Core.pathMatches(ctx.path, '/i/adsctp') ? 'x_pixel_post' : '',
        'x_pixel'
      );

      return [Core.createNormalizedEvent({
        platform: 'x',
        eventName: eventName,
        userId: '',
        anonymousId: firstNonEmptyValue(params.twclid, params.personalization_id, ''),
        distinctId: firstNonEmptyValue(params.event_id, params.txn_id, params.twclid, ''),
        eventTime: Core.normalizeTimestamp(firstNonEmptyValue(params.ts, '')),
        properties: Core.decodeObjectStrings({
          pageUrl: firstNonEmptyValue(params.tw_document_href, params.url, ''),
          referrer: firstNonEmptyValue(params.tw_document_referrer, params.referrer, ''),
          conversionId: firstNonEmptyValue(params.conversion_id, params.tw_conversion_id, ''),
          saleAmount: firstNonEmptyValue(params.tw_sale_amount, params.value, ''),
          currency: firstNonEmptyValue(params.currency, params.tw_currency, ''),
          orderQuantity: firstNonEmptyValue(params.tw_order_quantity, params.quantity, ''),
          productId: firstNonEmptyValue(params.tw_product_id, params.product_id, ''),
          contentIds: firstNonEmptyValue(params.content_ids, params.content_id, ''),
          contents: contents || firstNonEmptyValue(params.contents, params.tw_contents, ''),
          emailAddress: firstNonEmptyValue(params.email_address, params.tw_email_address, ''),
          phoneNumber: firstNonEmptyValue(params.phone_number, params.tw_phone_number, ''),
          transactionId: params.txn_id || '',
          params: params
        }),
        rawEvent: params
      })];
    }
  };

  // =========================================================================
  // ADAPTER: Zhihu ZA (stable-field parser)
  // =========================================================================

  var zhihuAdapter = {
    id: 'zhihu',

    matcher: function (request) {
      var ctx = prepareRequestContext(request);
      var score = 0;
      var reasons = [];

      if (Core.hostMatches(ctx.host, 'zhihu-web-analytics.zhihu.com')) {
        score += 0.6;
        reasons.push('host:zhihu-web-analytics.zhihu.com');
      } else if (Core.hostMatches(ctx.host, 'datahub.zhihu.com') || Core.hostMatches(ctx.host, 'apm.zhihu.com')) {
        score += 0.5;
        reasons.push('host:zhihu-datahub/apm');
      }

      if (Core.pathMatches(ctx.path, '/api/v2/za/logs/batch') ||
          Core.pathMatches(ctx.path, '/api/v3inv2/za/logs/batch') ||
          Core.pathMatches(ctx.path, '/collector/zlab') ||
          Core.pathMatches(ctx.path, '/collector/apm')) {
        score += 0.3;
        reasons.push('path:zhihu-collector');
      }

      return matchResult(score >= 0.45, score, reasons);
    },

    parser: function (request) {
      var ctx = prepareRequestContext(request);
      var eventName = 'zhihu_event';
      var refererUrl = getHeaderValue(ctx.headers, 'referer');

      function inferPageViewEvent(pageType) {
        if (pageType === 'answer') return 'answer_view';
        if (pageType === 'question') return 'question_view';
        if (pageType === 'article') return 'article_view';
        if (pageType === 'zvideo') return 'zvideo_view';
        if (pageType === 'pin') return 'pin_view';
        if (pageType === 'search') return 'search_view';
        if (pageType === 'signin') return 'signin_view';
        if (pageType === 'signup') return 'signup_view';
        return '';
      }

      function inferPageTypeFromUrl(url) {
        if (!url || typeof url !== 'string') return '';
        if (/zhihu\.com\/signin/i.test(url)) return 'signin';
        if (/zhihu\.com\/signup/i.test(url)) return 'signup';
        if (/zhihu\.com\/search/i.test(url)) return 'search';
        if (/zhihu\.com\/question\/\d+\/answer\/\d+/i.test(url)) return 'answer';
        if (/zhihu\.com\/question\/\d+/i.test(url)) return 'question';
        if (/zhuanlan\.zhihu\.com\/p\/\d+/i.test(url)) return 'article';
        if (/zhihu\.com\/zvideo\/\d+/i.test(url)) return 'zvideo';
        if (/zhihu\.com\/pin\/\d+/i.test(url)) return 'pin';
        return '';
      }

      var collector = '';
      var apiVersion = '';
      if (Core.pathMatches(ctx.path, '/za/logs/batch')) {
        eventName = 'za_batch';
        collector = 'za';
        apiVersion = Core.pathMatches(ctx.path, '/api/v3inv2/za/logs/batch') ? 'v3inv2' : 'v2';
      } else if (Core.pathMatches(ctx.path, '/collector/zlab')) {
        eventName = 'zlab';
        collector = 'zlab';
      } else if (Core.pathMatches(ctx.path, '/collector/apm')) {
        eventName = 'apm';
        collector = 'apm';
      }

      var decodedHints = extractJsonFromText(ctx.bodyStr || '') || {};
      var pageUrl = firstNonEmptyValue(decodedHints.pageUrl, refererUrl, ctx.query.url, '');
      var pageType = firstNonEmptyValue(decodedHints.pageType, inferPageTypeFromUrl(pageUrl), '');
      var pagePath = firstNonEmptyValue(decodedHints.pagePath, '');
      var nextPath = firstNonEmptyValue(decodedHints.nextPath, '');

      if (pageUrl && (!pagePath || !nextPath)) {
        try {
          var pageUrlObj = new URL(pageUrl);
          if (!pagePath) pagePath = pageUrlObj.pathname || '';
          if (!nextPath) nextPath = pageUrlObj.searchParams.get('next') || '';
        } catch (e) { /* ignore invalid page url */ }
      }

      var stableEventName = firstNonEmptyValue(
        decodedHints.stableEventCandidates && decodedHints.stableEventCandidates.length > 0
          ? decodedHints.stableEventCandidates[0]
          : '',
        inferPageViewEvent(pageType),
        ''
      );
      var properties = {
        pageUrl: pageUrl,
        pagePath: pagePath,
        nextPath: nextPath,
        pageType: pageType,
        questionId: firstNonEmptyValue(decodedHints.questionId, ''),
        answerId: firstNonEmptyValue(decodedHints.answerId, ''),
        articleId: firstNonEmptyValue(decodedHints.articleId, ''),
        zvideoId: firstNonEmptyValue(decodedHints.zvideoId, ''),
        pinId: firstNonEmptyValue(decodedHints.pinId, ''),
        collector: collector,
        apiVersion: apiVersion,
        decodedBy: firstNonEmptyValue(decodedHints.__decodedBy, ''),
        referer: refererUrl,
        zaPlatform: getHeaderValue(ctx.headers, 'x-za-platform'),
        zaClientId: getHeaderValue(ctx.headers, 'x-za-clientid'),
        zaProduct: getHeaderValue(ctx.headers, 'x-za-product'),
        zaLogVersion: getHeaderValue(ctx.headers, 'x-za-log-version'),
        zaBatchSize: getHeaderValue(ctx.headers, 'x-za-batch-size'),
        contentType: getHeaderValue(ctx.headers, 'content-type'),
        contentEncoding: getHeaderValue(ctx.headers, 'content-encoding'),
        payloadLength: firstNonEmptyValue(decodedHints.payloadLength, (ctx.bodyStr || '').length, ''),
        decodedHints: decodedHints
      };

      if (stableEventName) {
        eventName = stableEventName;
      } else if (decodedHints.eventCandidates && decodedHints.eventCandidates.length > 0) {
        eventName = decodedHints.eventCandidates[0];
      }

      return [Core.createNormalizedEvent({
        platform: 'zhihu',
        eventName: eventName,
        userId: '',
        anonymousId: properties.zaClientId || '',
        distinctId: properties.zaClientId || '',
        eventTime: '',
        properties: Core.decodeObjectStrings(properties),
        rawEvent: {
          url: ctx.url,
          headers: ctx.headers,
          bodyLength: (ctx.bodyStr || '').length
        }
      })];
    }
  };

  // =========================================================================
  // ADAPTER: Weibo Log
  // =========================================================================

  var weiboAdapter = {
    id: 'weibo',

    matcher: function (request) {
      var ctx = prepareRequestContext(request);
      var score = 0;
      var reasons = [];

      if (Core.hostMatches(ctx.host, 'weibo.com') || Core.hostMatches(ctx.host, 'www.weibo.com')) {
        score += 0.2;
        reasons.push('host:weibo.com');
      }
      if (Core.pathMatches(ctx.path, '/ajax/log/action') ||
          Core.pathMatches(ctx.path, '/ajax/log/read') ||
          Core.pathMatches(ctx.path, '/ajax/log/detectVideoCodecSupport')) {
        score += 0.35;
        reasons.push('path:weibo-log');
      }
      if (ctx.query.act_code || ctx.query.type || ctx.query.data ||
          (ctx.bodyParsed && ctx.bodyParsed.data)) {
        score += 0.15;
        reasons.push('query/body:act_code/type/data');
      }

      return matchResult(score >= 0.45, score, reasons);
    },

    parser: function (request) {
      var ctx = prepareRequestContext(request);
      var referer = getHeaderValue(ctx.headers, 'referer');
      var cookieHeader = getHeaderValue(ctx.headers, 'cookie');
      var subCookie = '';

      if (cookieHeader) {
        var subMatch = cookieHeader.match(/(?:^|;\s*)SUB=([^;]+)/);
        subCookie = subMatch ? subMatch[1] : '';
      }

      function parsePipeFields(text) {
        var out = {};
        if (typeof text !== 'string' || !text) return out;
        var parts = text.split('|');
        for (var i = 0; i < parts.length; i++) {
          var item = parts[i];
          var idx = item.indexOf(':');
          if (idx === -1) continue;
          out[item.slice(0, idx)] = item.slice(idx + 1);
        }
        return out;
      }

      if (Core.pathMatches(ctx.path, '/ajax/log/read')) {
        var bodyJson = extractJsonFromText(ctx.bodyStr || '') || {};
        var items = [];

        if (bodyJson.data && typeof bodyJson.data === 'string') {
          var parsedItems = extractJsonFromText(bodyJson.data);
          if (Array.isArray(parsedItems)) items = parsedItems;
          else if (parsedItems && typeof parsedItems === 'object') items = [parsedItems];
        } else if (Array.isArray(bodyJson.data)) {
          items = bodyJson.data;
        }

        if (items.length > 0) {
          var events = [];
          for (var i = 0; i < items.length; i++) {
            var item = items[i] || {};
            events.push(Core.createNormalizedEvent({
              platform: 'weibo',
              eventName: firstNonEmptyValue(item.act, item.type ? 'read_' + item.type : '', 'weibo_read'),
              userId: firstNonEmptyValue(item.uid, ''),
              anonymousId: subCookie,
              distinctId: firstNonEmptyValue(item.itemid, item.root_id, item.rid, subCookie, ''),
              eventTime: Core.normalizeTimestamp(firstNonEmptyValue(item.__date, '')),
              properties: Core.decodeObjectStrings({
                itemId: item.itemid || '',
                rootId: item.root_id || '',
                type: item.type || '',
                rid: item.rid || '',
                page: item.page,
                uicode: item.uicode || '',
                groupId: item.groupid || '',
                fid: item.fid || '',
                duration: item.duration || '',
                readDuration: item.read_duration || '',
                ext: parsePipeFields(item.ext || ''),
                analysisExtra: parsePipeFields(item.analysis_extra || ''),
                referer: referer
              }),
              rawEvent: item
            }));
          }
          return events;
        }
      }

      if (Core.pathMatches(ctx.path, '/ajax/log/detectVideoCodecSupport')) {
        var codecPayload = extractJsonFromText(ctx.query.data || '') || {};
        return [Core.createNormalizedEvent({
          platform: 'weibo',
          eventName: 'detectVideoCodecSupport',
          userId: '',
          anonymousId: subCookie,
          distinctId: subCookie,
          eventTime: '',
          properties: Core.decodeObjectStrings({
            browser: codecPayload.browser || null,
            h264: codecPayload.h264 || null,
            hevc: codecPayload.hevc || null,
            referer: referer
          }),
          rawEvent: codecPayload
        })];
      }

      return [Core.createNormalizedEvent({
        platform: 'weibo',
        eventName: firstNonEmptyValue(
          ctx.query.type ? 'action_' + ctx.query.type : '',
          ctx.query.act_code ? 'action_' + ctx.query.act_code : '',
          'weibo_action'
        ),
        userId: '',
        anonymousId: subCookie,
        distinctId: firstNonEmptyValue(ctx.query.act_code, ctx.query.fid, subCookie, ''),
        eventTime: Core.normalizeTimestamp(firstNonEmptyValue(ctx.query.t, '')),
        properties: Core.decodeObjectStrings({
          type: ctx.query.type || '',
          uicode: ctx.query.uicode || '',
          fid: ctx.query.fid || '',
          actCode: ctx.query.act_code || '',
          luicode: ctx.query.luicode || '',
          ext: parsePipeFields(ctx.query.ext || ''),
          referer: referer
        }),
        rawEvent: ctx.query
      })];
    }
  };

  // =========================================================================
  // ADAPTER: Snap Pixel (conservative parser)
  // =========================================================================

  var snapAdapter = {
    id: 'snap',

    matcher: function (request) {
      var ctx = prepareRequestContext(request);
      var score = 0;
      var reasons = [];

      if (Core.hostMatches(ctx.host, 'tr.snapchat.com')) {
        score += 0.6;
        reasons.push('host:tr.snapchat.com');
      }
      if (Core.pathMatches(ctx.path, '/p') || Core.pathMatches(ctx.path, '/cm/i') || Core.pathMatches(ctx.path, '/cm/p')) {
        score += 0.3;
        reasons.push('path:/p|/cm/i|/cm/p');
      }

      return matchResult(score >= 0.45, score, reasons);
    },

    parser: function (request) {
      var ctx = prepareRequestContext(request);
      var params = {};
      var itemIds = '';
      var contents = null;

      for (var key in ctx.query) {
        if (ctx.query.hasOwnProperty(key)) params[key] = ctx.query[key];
      }
      if (ctx.bodyParsed && typeof ctx.bodyParsed === 'object' && !Array.isArray(ctx.bodyParsed)) {
        for (var bodyKey in ctx.bodyParsed) {
          if (ctx.bodyParsed.hasOwnProperty(bodyKey)) params[bodyKey] = ctx.bodyParsed[bodyKey];
        }
      }
      contents = extractJsonFromText(firstNonEmptyValue(params.contents, params.content, ''));
      itemIds = firstNonEmptyValue(params.item_ids, params.item_id, '');
      if (!contents && itemIds) {
        var parsedItemIds = extractJsonFromText(itemIds);
        if (parsedItemIds) itemIds = parsedItemIds;
      }

      var pathEvent = basenameFromPath(ctx.path);
      var eventName = firstNonEmptyValue(
        params.event,
        params.ev,
        params.event_name,
        params.transaction_type,
        pathEvent === 'p' ? 'PAGE_VIEW' : ('snap_' + pathEvent.replace(/\//g, '_'))
      );

      return [Core.createNormalizedEvent({
        platform: 'snap',
        eventName: eventName,
        userId: '',
        anonymousId: firstNonEmptyValue(params.sc_cookie, params.scid, params.snap_click_id, ''),
        distinctId: firstNonEmptyValue(params.transaction_id, params.event_id, params.snap_click_id, ''),
        eventTime: Core.normalizeTimestamp(firstNonEmptyValue(params.ts, '')),
        properties: Core.decodeObjectStrings({
          pixelId: firstNonEmptyValue(params.pid, params.pixel_id, params.snap_pixel_id, params.bt, ''),
          pageUrl: firstNonEmptyValue(params.url, params.page_url, params.u, ''),
          referrer: firstNonEmptyValue(params.referrer, params.r, ''),
          price: firstNonEmptyValue(params.price, params.value, ''),
          currency: params.currency || '',
          itemIds: itemIds,
          contents: contents || '',
          itemCategory: firstNonEmptyValue(params.item_category, params.category, ''),
          description: firstNonEmptyValue(params.description, params.desc, ''),
          numberItems: firstNonEmptyValue(params.number_items, params.num_items, ''),
          searchString: firstNonEmptyValue(params.search_string, params.search_term, ''),
          signUpMethod: firstNonEmptyValue(params.sign_up_method, params.signup_method, ''),
          clientDedupId: firstNonEmptyValue(params.client_dedup_id, params.dedup_id, ''),
          uuidC1: params.uuid_c1 || '',
          params: params
        }),
        rawEvent: params
      })];
    }
  };

  // =========================================================================
  // ADAPTER: Xiaohongshu (小红书) Ranger Analytics
  // =========================================================================
  //
  // XHS sends a base64-encoded protobuf binary string as the HTTP body.
  // Decoded protobuf structure:
  //   field[1]  nested proto  App context: scene (subfield 2), platform (subfield 7), sdkVersion (subfield 8)
  //   field[3]  nested proto  User session: userId (subfield 1)
  //   field[7]  nested proto  Session context: sessionId (subfield 1)
  //   field[8]  nested proto  Event payload: JSON embedded in raw bytes (url, navigationStart, ...)
  //   field[9]  nested proto  Device context: deviceId (subfield 1), pageUrl (subfield 3), route (subfield 4)
  // =========================================================================

  var xhsAdapter = {
    id: 'xhs',

    matcher: function (request) {
      var ctx = prepareRequestContext(request);
      var score = 0;
      var reasons = [];

      if (Core.hostMatches(ctx.host, 't2.xiaohongshu.com')) {
        score += 0.6;
        reasons.push('host:t2.xiaohongshu.com');
      }
      if (ctx.path.indexOf('/api/v2/collect') !== -1) {
        score += 0.4;
        reasons.push('path:/api/v2/collect');
      }

      return matchResult(score >= 0.4, score, reasons);
    },

    parser: function (request) {
      var ctx = prepareRequestContext(request);

      // XHS Ranger body = base64-encoded protobuf binary
      var bodyStr = (ctx.bodyStr || '').trim();
      var cleanedBody = bodyStr.replace(/^"|"$/g, '').replace(/\s+/g, '');
      if (cleanedBody.indexOf('%') !== -1) {
        try { cleanedBody = decodeURIComponent(cleanedBody); } catch (e) { /* keep original */ }
      }
      cleanedBody = cleanedBody.replace(/-/g, '+').replace(/_/g, '/');
      while (cleanedBody.length % 4 !== 0) cleanedBody += '=';

      var binaryStr = '';
      try {
        binaryStr = atob(cleanedBody);
      } catch (e) {
        return [Core.createNormalizedEvent({
          platform: 'xhs',
          eventName: 'xhs_collect',
          properties: { requestUrl: ctx.url },
          rawEvent: null
        })];
      }

      // Binary string -> Uint8Array
      var bytes = new Uint8Array(binaryStr.length);
      for (var i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i) & 0xFF;
      }

      // Minimal protobuf parser
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
        var fields = {};
        var entries = [];
        var pos = (start === undefined) ? 0 : start;
        var end = (endPos === undefined) ? buf.length : endPos;
        while (pos < end && pos < buf.length) {
          var fieldStart = pos;
          var tagR = readVarint(buf, pos);
          pos = tagR.pos;
          if (tagR.value === 0) break;
          var fn = tagR.value >>> 3;
          var wt = tagR.value & 7;
          if (wt === 0) {
            var vr = readVarint(buf, pos);
            pos = vr.pos;
            if (!fields[fn]) fields[fn] = [];
            fields[fn].push({ type: 'varint', value: vr.value });
            entries.push({
              fieldNumber: fn,
              wireType: wt,
              type: 'varint',
              value: vr.value,
              start: fieldStart,
              end: pos
            });
          } else if (wt === 1) {
            pos += 8;
          } else if (wt === 2) {
            var lr = readVarint(buf, pos);
            pos = lr.pos;
            if (lr.value < 0 || pos + lr.value > buf.length) break;
            var raw = buf.slice(pos, pos + lr.value);
            pos += lr.value;
            if (!fields[fn]) fields[fn] = [];
            fields[fn].push({ type: 'bytes', raw: raw });
            entries.push({
              fieldNumber: fn,
              wireType: wt,
              type: 'bytes',
              raw: raw,
              start: fieldStart,
              end: pos
            });
          } else if (wt === 5) {
            pos += 4;
          } else {
            break;
          }
        }
        return { fields: fields, entries: entries };
      }

      function bytesToUtf8(raw) {
        try { return new TextDecoder('utf-8').decode(raw); } catch (e) { return ''; }
      }

      function getString(fields, fn) {
        return (fields[fn] && fields[fn][0] && fields[fn][0].raw)
          ? bytesToUtf8(fields[fn][0].raw) : '';
      }

      function trimProtoText(text) {
        if (!text || typeof text !== 'string') return '';
        return text.replace(/\u0000/g, '').replace(/\s+/g, ' ').trim();
      }

      function isMostlyPrintable(text) {
        if (!text) return false;
        var printable = 0;
        for (var k = 0; k < text.length; k++) {
          var code = text.charCodeAt(k);
          if ((code >= 32 && code !== 127) || code === 9 || code === 10 || code === 13) {
            printable++;
          }
        }
        return printable / text.length >= 0.85;
      }

      function pushUnique(arr, value) {
        if (!value) return;
        if (arr.indexOf(value) === -1) arr.push(value);
      }

      function looksLikeTimestamp(value) {
        var num = Number(value);
        if (!isFinite(num)) return 0;
        if (num >= 1000000000000 && num <= 9999999999999) return Math.floor(num);
        return 0;
      }

      function looksLikeRoutePattern(text) {
        return /^\/[A-Za-z0-9_:/-]+$/.test(text) &&
          (text.indexOf('/:') !== -1 || text.indexOf('/explore/') === 0 || text.indexOf('/user/') === 0);
      }

      function looksLikeScene(text) {
        return /^[a-z0-9_-]+(?:-[a-z0-9_-]+)+$/i.test(text) &&
          text.indexOf('http') !== 0 &&
          text.indexOf('/') === -1 &&
          text.indexOf('.') === -1;
      }

      function looksLikeSdkVersion(text) {
        return /^\d+\.\d+(?:\.\d+){0,2}(?:[-+._A-Za-z0-9]+)?$/.test(text);
      }

      function looksLikePlatform(text) {
        return /^(web|h5|ios|android|miniapp|wx|pc)$/i.test(text);
      }

      function tryExtractJson(text) {
        if (!text) return null;
        var start = text.indexOf('{');
        if (start === -1) return null;
        for (var end = text.lastIndexOf('}'); end > start; end = text.lastIndexOf('}', end - 1)) {
          try {
            return JSON.parse(text.slice(start, end + 1));
          } catch (e) { /* keep scanning */ }
        }
        return null;
      }

      function createHintBag() {
        return {
          strings: [],
          urls: [],
          apiUrls: [],
          pageUrls: [],
          routePatterns: [],
          scenes: [],
          platforms: [],
          sdkVersions: [],
          directTimestamps: [],
          timestamps: []
        };
      }

      function addTextHint(hints, text) {
        var clean = trimProtoText(text);
        if (!clean || !isMostlyPrintable(clean) || clean.indexOf('\uFFFD') !== -1) return;

        pushUnique(hints.strings, clean);

        if (/^https?:\/\//i.test(clean)) {
          pushUnique(hints.urls, clean);
          if (/t2\.xiaohongshu\.com/i.test(clean) || /\/api\//i.test(clean)) {
            pushUnique(hints.apiUrls, clean);
          } else if (/xiaohongshu\.com/i.test(clean)) {
            pushUnique(hints.pageUrls, clean);
          }
          return;
        }

        if (looksLikeRoutePattern(clean)) pushUnique(hints.routePatterns, clean);
        if (looksLikeScene(clean)) pushUnique(hints.scenes, clean);
        if (looksLikePlatform(clean)) pushUnique(hints.platforms, clean.toLowerCase());
        if (looksLikeSdkVersion(clean)) pushUnique(hints.sdkVersions, clean);

        var ts = looksLikeTimestamp(clean);
        if (ts) pushUnique(hints.timestamps, ts);
      }

      function collectHintsFromJson(value, hints, keyHint) {
        if (value == null) return;

        if (typeof value === 'string') {
          addTextHint(hints, value);
          var loweredKey = (keyHint || '').toLowerCase();
          if (loweredKey.indexOf('route') !== -1 || loweredKey.indexOf('path') !== -1) {
            if (looksLikeRoutePattern(value)) pushUnique(hints.routePatterns, trimProtoText(value));
          }
          if (loweredKey.indexOf('scene') !== -1) {
            if (looksLikeScene(value)) pushUnique(hints.scenes, trimProtoText(value));
          }
          return;
        }

        if (typeof value === 'number') {
          var ts = looksLikeTimestamp(value);
          if (ts) pushUnique(hints.timestamps, ts);
          return;
        }

        if (Array.isArray(value)) {
          for (var m = 0; m < value.length; m++) {
            collectHintsFromJson(value[m], hints, keyHint);
          }
          return;
        }

        if (typeof value === 'object') {
          for (var jsonKey in value) {
            if (!value.hasOwnProperty(jsonKey)) continue;
            var child = value[jsonKey];
            var lowerKey = jsonKey.toLowerCase();

            if (typeof child === 'string') {
              if (lowerKey === 'scene' && looksLikeScene(child)) {
                pushUnique(hints.scenes, trimProtoText(child));
              }
              if (lowerKey === 'pageurl' || lowerKey === 'page_url') {
                pushUnique(hints.pageUrls, trimProtoText(child));
              }
              if (lowerKey === 'routepattern' || lowerKey === 'route_pattern' || lowerKey === 'route') {
                pushUnique(hints.routePatterns, trimProtoText(child));
              }
              if (lowerKey === 'sdkversion' || lowerKey === 'sdk_version') {
                pushUnique(hints.sdkVersions, trimProtoText(child));
              }
              if (lowerKey === 'platform') {
                pushUnique(hints.platforms, trimProtoText(child).toLowerCase());
              }
              if (lowerKey === 'url') {
                var cleanUrl = trimProtoText(child);
                if (/t2\.xiaohongshu\.com/i.test(cleanUrl) || /\/api\//i.test(cleanUrl)) {
                  pushUnique(hints.apiUrls, cleanUrl);
                } else if (/xiaohongshu\.com/i.test(cleanUrl)) {
                  pushUnique(hints.pageUrls, cleanUrl);
                }
              }
              var nestedJson = tryExtractJson(child);
              if (nestedJson) collectHintsFromJson(nestedJson, hints, jsonKey);
            } else if (typeof child === 'number') {
              if (lowerKey.indexOf('time') !== -1 || lowerKey.indexOf('ts') !== -1 || lowerKey.indexOf('navigationstart') !== -1) {
                var childTs = looksLikeTimestamp(child);
                if (childTs) pushUnique(hints.directTimestamps, childTs);
              }
            }

            collectHintsFromJson(child, hints, jsonKey);
          }
        }
      }

      function collectProtoHints(raw, hints, depth) {
        if (!raw || !raw.length || depth > 4) return;

        var text = bytesToUtf8(raw);
        var cleanText = trimProtoText(text);
        if (cleanText) {
          addTextHint(hints, cleanText);
          var json = tryExtractJson(cleanText);
          if (json) collectHintsFromJson(json, hints, '');
        }

        var parsed = parseFields(raw);
        if (!parsed.entries.length) return;

        for (var n = 0; n < parsed.entries.length; n++) {
          var entry = parsed.entries[n];
          if (entry.type === 'varint') {
            var entryTs = looksLikeTimestamp(entry.value);
            if (entryTs) pushUnique(hints.timestamps, entryTs);
            continue;
          }
          if (!entry.raw || !entry.raw.length) continue;

          var childText = trimProtoText(bytesToUtf8(entry.raw));
          if (childText) {
            addTextHint(hints, childText);
            var childJson = tryExtractJson(childText);
            if (childJson) collectHintsFromJson(childJson, hints, '');
          }

          collectProtoHints(entry.raw, hints, depth + 1);
        }
      }

      function firstNonEmpty() {
        for (var p = 0; p < arguments.length; p++) {
          if (arguments[p]) return arguments[p];
        }
        return '';
      }

      function inferApiUrl(hints) {
        if (hints.apiUrls.length > 0) return hints.apiUrls[0];
        return '';
      }

      function inferPageUrl(hints) {
        if (hints.pageUrls.length > 0) return hints.pageUrls[0];
        return '';
      }

      function inferEventName(apiUrl) {
        if (!apiUrl) return 'xhs_collect';
        try {
          var pathname = new URL(apiUrl).pathname.replace(/\/$/, '');
          var parts = pathname.split('/').filter(Boolean);
          return parts.length ? parts[parts.length - 1] : 'xhs_collect';
        } catch (e) {
          var cleaned = apiUrl.replace(/\?.*$/, '').replace(/\/$/, '');
          var segments = cleaned.split('/');
          return segments[segments.length - 1] || 'xhs_collect';
        }
      }

      var outerParsed = parseFields(bytes);
      var outer = outerParsed.fields;

      // field[1]: app header → scene, platform, sdkVersion
      var scene = '', platform = '', sdkVersion = '';
      if (outer[1] && outer[1][0] && outer[1][0].raw) {
        var hdr = parseFields(outer[1][0].raw).fields;
        scene      = getString(hdr, 2);
        platform   = getString(hdr, 7);
        sdkVersion = getString(hdr, 8);
      }

      // field[3]: user session → userId
      var userId = '';
      if (outer[3] && outer[3][0] && outer[3][0].raw) {
        var sess = parseFields(outer[3][0].raw).fields;
        userId = getString(sess, 1);
      }

      // field[7]: session context → sessionId
      var sessionId = '';
      if (outer[7] && outer[7][0] && outer[7][0].raw) {
        var sess7 = parseFields(outer[7][0].raw).fields;
        sessionId = getString(sess7, 1);
      }

      // field[9]: device/browser context → deviceId, pageUrl, routePattern
      var deviceId = '', pageUrl = '', routePattern = '';
      if (outer[9] && outer[9][0] && outer[9][0].raw) {
        var dev = parseFields(outer[9][0].raw).fields;
        deviceId     = getString(dev, 1);
        pageUrl      = getString(dev, 3);
        routePattern = getString(dev, 4);
      }

      // Recursively walk the protobuf tree to recover fields even when the
      // nested structure shifts between builds.
      var hints = createHintBag();
      collectProtoHints(bytes, hints, 0);

      var eventUrl = inferApiUrl(hints);
      pageUrl = firstNonEmpty(pageUrl, inferPageUrl(hints));
      routePattern = firstNonEmpty(routePattern, hints.routePatterns[0] || '');
      scene = firstNonEmpty(scene, hints.scenes[0] || '');
      platform = firstNonEmpty(platform, hints.platforms[0] || '');
      sdkVersion = firstNonEmpty(sdkVersion, hints.sdkVersions[0] || '');
      var eventTime = 0;
      if (hints.directTimestamps.length > 0) {
        eventTime = Math.max.apply(null, hints.directTimestamps);
      } else if (hints.timestamps.length > 0) {
        eventTime = Math.max.apply(null, hints.timestamps);
      }

      // Derive event name from the tracked API URL's last path segment.
      var eventName = inferEventName(eventUrl);

      var props = {};
      if (scene)        props.scene        = scene;
      if (platform)     props.platform     = platform;
      if (sdkVersion)   props.sdkVersion   = sdkVersion;
      if (eventUrl)     props.apiUrl       = eventUrl;
      if (pageUrl)      props.pageUrl      = pageUrl;
      if (routePattern) props.routePattern = routePattern;
      if (eventTime)    props.eventTime    = eventTime;

      return [Core.createNormalizedEvent({
        platform: 'xhs',
        eventName: eventName,
        userId: userId,
        anonymousId: deviceId || sessionId,
        distinctId: userId || deviceId || sessionId,
        eventTime: eventTime ? String(eventTime) : '',
        properties: props,
        rawEvent: props
      })];
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
    alibabaAdapter,       // P1
    tencentAdapter,       // P1
    neteaseAdapter,       // P1
    didiAdapter,          // P1
    meituanAdapter,       // P1
    jdAdapter,            // P1
    bilibiliAdapter,      // P1
    xhsAdapter,           // P1
    ctripAdapter,         // P2 (partial parser)
    amazonAdapter,        // P2
    metaAdapter,          // P2
    linkedinAdapter,      // P2
    pinterestAdapter,     // P2
    redditAdapter,        // P2
    xAdapter,             // P2
    zhihuAdapter,         // P2 (partial parser)
    weiboAdapter,         // P2
    snapAdapter,          // P2 (conservative parser)
    microsoftUetAdapter,  // P2
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
  function matchPlatform(request, pageContext) {
    // Prepare context once for reuse
    prepareRequestContext(request);

    var bestMatch = null;
    var bestScore = 0;
    var allMatches = [];

    for (var i = 0; i < ALL_ADAPTERS.length; i++) {
      var adapter = ALL_ADAPTERS[i];
      try {
        var result = applyPageContextBoost(
          adapter.id,
          adapter.matcher(request),
          pageContext
        );
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
  function matchAndParse(request, pageContext) {
    var match = matchPlatform(request, pageContext);
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
