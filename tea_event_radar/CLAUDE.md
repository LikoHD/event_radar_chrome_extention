# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tea Event Radar is a Chrome extension (Manifest V3) that monitors and captures website event tracking data in real-time. It displays captured events in a browser side panel with search, filtering, and detailed inspection capabilities.

## Architecture

### Core Components

- **service-worker.js**: Background script that intercepts network requests using webRequest API, captures POST requests containing "list", handles event storage and state management
- **content-script.js**: Injected into web pages to handle UI notifications and communication between extension and web pages  
- **panel.html/js/css**: Side panel UI that displays captured events with search/filter functionality and resizable interface
- **in-page-panel.css**: Styles for the injected in-page panel overlay

### Data Flow

1. Service worker intercepts POST requests with "list" in URL
2. Request body is decoded (UTF-8 with fallback mechanisms for Chinese characters)
3. Events stored in `capturedEvents` array with timestamp, URL, request data, headers, and status
4. Panel UI updates via message passing between service worker and panel
5. Users can start/pause capture, search/filter events, and inspect detailed event data

### Key Features

- **Network Interception**: Captures埋点 (tracking/analytics) data from POST requests
- **Chinese Character Support**: Multi-layer decoding (UTF-8 → URL decode → Latin-1 fallback)
- **Expandable Cards**: Event list with collapsible detailed views
- **Search & Filter**: Multi-keyword search with include/exclude modes
- **Resizable Panel**: Draggable width adjustment (280px-800px range)
- **Clipboard Integration**: Copy event data with fallback mechanisms

## Development Commands

This is a vanilla JavaScript Chrome extension with no build process. Development workflow:

1. **Load Extension**: Chrome → Extensions → Developer Mode → "Load unpacked" → select project folder
2. **Reload Extension**: After code changes, click reload button in chrome://extensions/
3. **Debug**: Use Chrome DevTools on extension pages, check service worker logs in Extensions page
4. **Test**: Install extension, navigate to websites with tracking, verify events are captured

## Manifest V3 Permissions

- `webRequest`: Intercept network requests for埋点 data
- `sidePanel`: Display extension UI in browser side panel  
- `scripting`: Inject content scripts and CSS
- `activeTab`: Access current tab for notifications
- `clipboardWrite`: Copy event data to clipboard
- `host_permissions: ["<all_urls>"]`: Monitor requests on all websites

## Message Passing

Extension uses Chrome's runtime messaging:
- Service worker ↔ Panel: Event data updates, capture control
- Service worker ↔ Content script: UI notifications, panel operations
- Actions: `getEvents`, `clearEvents`, `startCapturing`, `stopCapturing`, `updateEvents`

## State Management

- `capturedEvents[]`: Array of event objects with ID, timestamp, URL, request data, headers, status
- `isCapturing`: Boolean flag controlling request interception
- `expandedCards`: UI state for which event cards are expanded
- `searchKeywords[]`: Active search terms for filtering events

---

# Doc Sync Protocol

## Trigger

Any time one of the following happens, execute the doc sync workflow below **before moving on to other work**:

1. Code is merged into `main` (via `git merge`, `git pull`, or PR merge)
2. Code is pushed to remote (`git push`)

**Deduplication**: If a merge and push happen in the same operation, only run the doc sync workflow **once** after the push completes.

## Steps

1. **Run change report**
   ```bash
   bash scripts/doc-sync.sh
   ```
   This outputs: changed files, diffs, doc freshness, and broken links.

2. **Review freshness & broken links**
   - Fix all `BROKEN LINKS` immediately.
   - Prioritize reviewing `STALE` and `AGING` documents.

3. **Map changes to docs** using the mapping table below. For each changed source file, identify the corresponding document(s) and section(s).

4. **Read & compare** each affected document against the code changes. A doc is **outdated** if any of:
   - Described behavior no longer matches the code
   - Referenced file paths, function names, or class names are stale
   - Feature scope has grown/shrunk without doc update
   - Code examples or API signatures are out of date
   - Freshness is `STALE`

5. **Update outdated docs:**
   - Fix the inaccurate content in-place
   - Update the `Last synced` date to today
   - Update the `Freshness` badge to `FRESH`
   - Append an entry to the `## Evolution Log` section (create it if missing)

6. **Create new docs** when a merge introduces a new independent module, major architectural refactor, new permissions, or new entry points. Naming: `docs/<module-name>-<MMDD>.md`

7. **Commit** doc updates in a separate commit:
   ```
   docs: sync documentation after merge to main
   ```

## Module to Document Mapping

| Source files | Document | Key sections |
|---|---|---|
| `tea_event_radar/service-worker.js`, `background.js` | `docs/product-technical-spec.md` | Architecture, Data Flow, State Management |
| `tea_event_radar/content-script.js` | `docs/product-technical-spec.md` | Message Passing, UI Notifications |
| `tea_event_radar/panel.js`, `panel.html`, `panel.css` | `docs/product-technical-spec.md` | Panel UI, Search & Filter |
| `tea_event_radar/analytics-core.js` | `docs/event-parsing-enhancement-spec.md` | Event Parsing, Decoding Pipeline |
| `tea_event_radar/platform-adapters.js` | `docs/analytics-platform-tracking-spec.md`, `docs/analytics-platform-tracking-reference.md` | Platform Matchers, Parsers |
| `tea_event_radar/platform-catalog.js` | `docs/analytics-platform-tracking-reference.md` | Platform Catalog, Icon Paths |
| `tea_event_radar/manifest.json` | `docs/product-technical-spec.md` | Permissions, Manifest V3 |
| `build.js`, `package.json` | `docs/performance-optimization-spec.md` | Build Process, Bundle Size |
| `tea_event_radar/in-page-panel.css` | `docs/product-technical-spec.md` | In-page Panel Styles |
| **Unmapped new modules** | **Create new doc from template** | — |

## Document Freshness Badges

Every doc must include a `Freshness` field in its header metadata:

```markdown
> Status: Implemented
> Last synced: YYYY-MM-DD
> Freshness: FRESH
```

Thresholds (days since last `git log` modification):
- FRESH — 0-14 days
- AGING — 15-30 days
- STALE — >30 days

## Evolution Log Format

When updating a doc, append to `## Evolution Log`:

```markdown
### YYYY-MM-DD Change title
**Scope:** source files involved
**Before:**
- old behavior
**After:**
- new behavior
**Reason:** why
**Impact:** impact on other modules/docs
```

## New Document Template

```markdown
# <Module Name> Design Doc

> Status: Implemented
> Last synced: YYYY-MM-DD
> Freshness: FRESH
> Scope: <brief scope description>

## 1. Overview
## 2. Architecture
## 3. Key Implementation Details
## 4. API / Interface
## 5. Edge Cases & Error Handling
## 6. Testing
## 7. Evolution Log
```