/**
 * Analytics Core - Common utilities for decode, parse, normalize
 *
 * Provides shared helpers used by platform adapters and the service worker
 * orchestrator: text decoding, URL parsing, body parsing, event normalization.
 */
(function () {
  var root = (typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this);
  root.TeaRadar = root.TeaRadar || {};

  // =========================================================================
  // 1. Text Decoding
  // =========================================================================

  /**
   * Decode Chinese text that may have been mangled through Latin-1 / UTF-8
   * round-trip. Adapted from panel.js decodeChineseText.
   *
   * @param {string} text
   * @returns {string}
   */
  function decodeChineseText(text) {
    if (typeof text !== 'string') return text;

    try {
      // Try URI-decode first
      if (text.indexOf('%') !== -1) {
        try {
          var decoded = decodeURIComponent(text);
          if (decoded !== text && decoded.indexOf('\uFFFD') === -1) {
            return decoded;
          }
        } catch (e) { /* ignore */ }
      }

      // Detect Latin-1 mangled UTF-8 bytes
      if (/[\u00C0-\u00FF]/.test(text)) {
        try {
          var bytes = [];
          for (var i = 0; i < text.length; i++) {
            var ch = text.charCodeAt(i);
            if (ch > 255) {
              bytes.push((ch >> 8) & 0xFF);
              bytes.push(ch & 0xFF);
            } else {
              bytes.push(ch);
            }
          }
          var dec = new TextDecoder('utf-8');
          var result = dec.decode(new Uint8Array(bytes));
          if (/[\u4e00-\u9fff]/.test(result)) return result;
        } catch (e) { /* ignore */ }
      }

      // Direct byte-to-UTF8 attempt
      try {
        var rawBytes = new Uint8Array(text.length);
        for (var j = 0; j < text.length; j++) {
          rawBytes[j] = text.charCodeAt(j) & 0xFF;
        }
        var dec2 = new TextDecoder('utf-8');
        var result2 = dec2.decode(rawBytes);
        if (/[\u4e00-\u9fff]/.test(result2) && result2.indexOf('\uFFFD') === -1) {
          return result2;
        }
      } catch (e) { /* ignore */ }

      return text;
    } catch (error) {
      return text;
    }
  }

  /**
   * Recursively decode all string values in an object / array.
   *
   * @param {*} obj
   * @returns {*}
   */
  function decodeObjectStrings(obj) {
    if (typeof obj === 'string') return decodeChineseText(obj);
    if (Array.isArray(obj)) return obj.map(decodeObjectStrings);
    if (obj && typeof obj === 'object') {
      var out = {};
      for (var key in obj) {
        if (obj.hasOwnProperty(key)) {
          out[decodeChineseText(key)] = decodeObjectStrings(obj[key]);
        }
      }
      return out;
    }
    return obj;
  }

  // =========================================================================
  // 2. URL Parsing
  // =========================================================================

  /**
   * Parse a URL string into components.
   *
   * @param {string} urlStr
   * @returns {{ host: string, hostname: string, pathname: string, search: string, query: Object, hash: string }}
   */
  function parseUrl(urlStr) {
    try {
      var u = new URL(urlStr);
      var query = {};
      u.searchParams.forEach(function (v, k) {
        query[k] = v;
      });
      return {
        host: u.host,
        hostname: u.hostname,
        pathname: u.pathname,
        search: u.search,
        query: query,
        hash: u.hash
      };
    } catch (e) {
      return { host: '', hostname: '', pathname: '', search: '', query: {}, hash: '' };
    }
  }

  /**
   * Parse query string (without leading ?) into key-value object.
   *
   * @param {string} qs
   * @returns {Object}
   */
  function parseQueryString(qs) {
    var result = {};
    if (!qs) return result;
    var str = qs.charAt(0) === '?' ? qs.slice(1) : qs;
    var pairs = str.split('&');
    for (var i = 0; i < pairs.length; i++) {
      var idx = pairs[i].indexOf('=');
      if (idx === -1) {
        result[decodeURIComponent(pairs[i])] = '';
      } else {
        try {
          result[decodeURIComponent(pairs[i].slice(0, idx))] = decodeURIComponent(pairs[i].slice(idx + 1));
        } catch (e) {
          result[pairs[i].slice(0, idx)] = pairs[i].slice(idx + 1);
        }
      }
    }
    return result;
  }

  // =========================================================================
  // 3. Request Body Decoding
  // =========================================================================

  /**
   * Decode raw bytes from chrome.webRequest requestBody into a string.
   * Handles UTF-8 with fallbacks.
   *
   * @param {ArrayBuffer} bytes
   * @returns {string}
   */
  function decodeRequestBytes(bytes) {
    if (!bytes) return '';
    try {
      return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
    } catch (e) {
      try {
        return decodeURIComponent(
          String.fromCharCode.apply(null, new Uint8Array(bytes))
        );
      } catch (e2) {
        return String.fromCharCode.apply(null, new Uint8Array(bytes));
      }
    }
  }

  /**
   * Try to parse a body string as JSON. Returns null on failure.
   *
   * @param {string} bodyStr
   * @returns {*|null}
   */
  function tryParseJSON(bodyStr) {
    if (!bodyStr || typeof bodyStr !== 'string') return null;
    var trimmed = bodyStr.trim();
    if ((trimmed.charAt(0) !== '{' && trimmed.charAt(0) !== '[')) return null;
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      return null;
    }
  }

  /**
   * Try to parse a body string as form-urlencoded.
   *
   * @param {string} bodyStr
   * @returns {Object|null}
   */
  function tryParseFormData(bodyStr) {
    if (!bodyStr || typeof bodyStr !== 'string') return null;
    // Heuristic: contains = and no { or [
    if (bodyStr.indexOf('=') === -1) return null;
    var trimmed = bodyStr.trim();
    if (trimmed.charAt(0) === '{' || trimmed.charAt(0) === '[') return null;
    return parseQueryString(trimmed);
  }

  /**
   * Attempt to decode and parse a request body string.
   * Returns { format: 'json'|'form'|'text', data: <parsed>, raw: <string> }
   *
   * @param {string} bodyStr
   * @returns {{ format: string, data: *, raw: string }}
   */
  function parseBody(bodyStr) {
    if (!bodyStr) return { format: 'empty', data: null, raw: '' };

    var jsonData = tryParseJSON(bodyStr);
    if (jsonData !== null) {
      return { format: 'json', data: jsonData, raw: bodyStr };
    }

    var formData = tryParseFormData(bodyStr);
    if (formData !== null) {
      return { format: 'form', data: formData, raw: bodyStr };
    }

    return { format: 'text', data: bodyStr, raw: bodyStr };
  }

  // =========================================================================
  // 4. Sensors Data specific decoding
  // =========================================================================

  /**
   * Decode Sensors Data payload: base64 → possibly gzip → JSON.
   * In the browser environment we cannot easily gunzip, so we attempt
   * plain base64 decode first.
   *
   * @param {string} encoded - The base64-encoded data string
   * @returns {*|null}
   */
  function decodeSensorsPayload(encoded) {
    if (!encoded) return null;
    try {
      // URL-decode first if needed (sensors SDK may URL-encode the base64)
      var cleaned = encoded;
      if (cleaned.indexOf('%') !== -1) {
        try { cleaned = decodeURIComponent(cleaned); } catch(e) { /* keep original */ }
      }
      // Fix base64 padding if missing
      while (cleaned.length % 4 !== 0) cleaned += '=';

      var decoded = atob(cleaned);
      var jsonResult = tryParseJSON(decoded);
      if (jsonResult) return jsonResult;
      // Might be gzip-compressed; try byte-level UTF-8 decode
      var bytes = new Uint8Array(decoded.length);
      for (var i = 0; i < decoded.length; i++) {
        bytes[i] = decoded.charCodeAt(i);
      }
      // Check gzip magic number (1f 8b)
      if (bytes.length > 2 && bytes[0] === 0x1F && bytes[1] === 0x8B) {
        // Gzipped data - try DecompressionStream if available
        if (typeof DecompressionStream !== 'undefined') {
          // Return a promise-based result marker for async callers
          return { __gzipped: true, bytes: bytes };
        }
        return null; // Cannot decompress
      }
      return tryParseJSON(new TextDecoder('utf-8').decode(bytes));
    } catch (e) {
      return null;
    }
  }

  /**
   * Async version of decodeSensorsPayload that can handle gzip.
   *
   * @param {string} encoded
   * @returns {Promise<*|null>}
   */
  function decodeSensorsPayloadAsync(encoded) {
    var sync = decodeSensorsPayload(encoded);
    if (!sync || !sync.__gzipped) {
      return Promise.resolve(sync);
    }
    // Try DecompressionStream
    try {
      var ds = new DecompressionStream('gzip');
      var blob = new Blob([sync.bytes]);
      var stream = blob.stream().pipeThrough(ds);
      return new Response(stream).text().then(function (text) {
        return tryParseJSON(text);
      });
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  // =========================================================================
  // 5. GA4 Query Parameter Parsing
  // =========================================================================

  /**
   * Parse GA4 measurement protocol parameters into structured data.
   * GA4 uses flat key=value parameters with dot-separated namespaces.
   *
   * @param {Object} params - Key-value query/form parameters
   * @returns {{ measurementId: string, clientId: string, events: Object[] }}
   */
  function parseGA4Params(params) {
    var result = {
      measurementId: params.tid || '',
      clientId: params.cid || '',
      userId: params.uid || '',
      sessionId: params.sid || '',
      protocolVersion: params.v || '',
      events: []
    };

    // GA4 single-event in query: en=event_name
    var eventName = params.en || '';
    if (eventName) {
      var eventParams = {};
      var userProps = {};
      for (var key in params) {
        if (!params.hasOwnProperty(key)) continue;
        if (key.indexOf('ep.') === 0) {
          eventParams[key.slice(3)] = params[key];
        } else if (key.indexOf('epn.') === 0) {
          eventParams[key.slice(4)] = parseFloat(params[key]) || params[key];
        } else if (key.indexOf('up.') === 0) {
          userProps[key.slice(3)] = params[key];
        } else if (key.indexOf('upn.') === 0) {
          userProps[key.slice(4)] = parseFloat(params[key]) || params[key];
        }
      }
      result.events.push({
        name: eventName,
        params: eventParams,
        userProperties: userProps
      });
    }

    return result;
  }

  // =========================================================================
  // 6. Event Normalization
  // =========================================================================

  /**
   * Create a NormalizedEvent.
   *
   * @param {Object} opts
   * @param {string} opts.platform
   * @param {string} opts.eventName
   * @param {string} [opts.userId]
   * @param {string} [opts.anonymousId]
   * @param {string} [opts.distinctId]
   * @param {string} [opts.eventTime]
   * @param {Object} [opts.properties]
   * @param {*} [opts.rawEvent]
   * @returns {Object}
   */
  function createNormalizedEvent(opts) {
    return {
      platform: opts.platform || 'unknown',
      eventName: opts.eventName || '',
      userId: opts.userId || '',
      anonymousId: opts.anonymousId || '',
      distinctId: opts.distinctId || '',
      eventTime: opts.eventTime || '',
      properties: opts.properties || {},
      rawEvent: opts.rawEvent || null
    };
  }

  // =========================================================================
  // 7. Confidence Scoring Helpers
  // =========================================================================

  /**
   * Check if a hostname matches a pattern.
   * Supports exact match, suffix match (*.example.com), and contains.
   *
   * @param {string} hostname
   * @param {string} pattern
   * @returns {boolean}
   */
  function hostMatches(hostname, pattern) {
    if (!hostname || !pattern) return false;
    // Exact match
    if (hostname === pattern) return true;
    // Suffix match: hostname ends with .pattern
    if (hostname.length > pattern.length && hostname.charAt(hostname.length - pattern.length - 1) === '.' &&
        hostname.slice(-pattern.length) === pattern) {
      return true;
    }
    // Contains (for patterns like "omtrdc.net")
    if (hostname.indexOf(pattern) !== -1) return true;
    return false;
  }

  /**
   * Check if a pathname starts with or contains a path pattern.
   *
   * @param {string} pathname
   * @param {string} pattern
   * @returns {boolean}
   */
  function pathMatches(pathname, pattern) {
    if (!pathname || !pattern) return false;
    return pathname.indexOf(pattern) !== -1;
  }

  /**
   * Safely access a nested property.
   *
   * @param {*} obj
   * @param {string} dotPath - e.g. 'user.user_unique_id'
   * @returns {*}
   */
  function getNestedValue(obj, dotPath) {
    if (!obj || typeof obj !== 'object') return undefined;
    var parts = dotPath.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  /**
   * Generate a unique local ID.
   * @returns {string}
   */
  function generateId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  /**
   * Safely convert a timestamp to ISO string.
   * Handles unix seconds, unix milliseconds, and date strings.
   *
   * @param {number|string} ts
   * @returns {string}
   */
  function normalizeTimestamp(ts) {
    if (!ts) return '';
    if (typeof ts === 'number') {
      // If it looks like seconds (before year 2100 in ms)
      if (ts < 1e12) ts = ts * 1000;
      try { return new Date(ts).toISOString(); } catch (e) { return ''; }
    }
    if (typeof ts === 'string') {
      try { return new Date(ts).toISOString(); } catch (e) { return ts; }
    }
    return '';
  }

  // =========================================================================
  // Expose on global namespace
  // =========================================================================

  root.TeaRadar.AnalyticsCore = {
    // Text
    decodeChineseText: decodeChineseText,
    decodeObjectStrings: decodeObjectStrings,

    // URL
    parseUrl: parseUrl,
    parseQueryString: parseQueryString,

    // Body
    decodeRequestBytes: decodeRequestBytes,
    tryParseJSON: tryParseJSON,
    tryParseFormData: tryParseFormData,
    parseBody: parseBody,

    // Platform-specific decoders
    decodeSensorsPayload: decodeSensorsPayload,
    decodeSensorsPayloadAsync: decodeSensorsPayloadAsync,
    parseGA4Params: parseGA4Params,

    // Normalization
    createNormalizedEvent: createNormalizedEvent,
    normalizeTimestamp: normalizeTimestamp,

    // Matching helpers
    hostMatches: hostMatches,
    pathMatches: pathMatches,
    getNestedValue: getNestedValue,

    // Utilities
    generateId: generateId
  };
})();
