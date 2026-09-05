# A/B panel design adaptation

Source: https://console.volcengine.com/datafinder/project/2111833/event-analysis
Destination: existing tea_event_radar/ab-panel.css. Preserve all functionality.
The user requested style migration into an existing vanilla JS extension, not a Next.js clone.

Observed computed styles: primary link rgb(48,115,242); text rgb(47,47,63);
secondary button background rgb(250,251,252), border 1px solid rgba(27,31,35,.12),
radius 4px, padding 0 12px, font size 14px. Inputs use 13px. Font stack:
Inter, -apple-system, system-ui, PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif.
White data panels, subtle neutral borders, blue selected navigation, muted workspace.

Adapted layout: retain four statistic cells, toolbars wrap at narrow widths, white cards
on #f8f9fc workspace, 8px panel radii, 4px controls, 32px control height.
Use #3073f2 for active/primary controls, #2f2f3f body, #737a87 secondary text,
#e5e6eb borders, #fafbfc neutral surfaces, #eef4ff selected surfaces.
No new data or features. Keep existing display rules and hidden attribute behavior.
Top tabs are now inside header-bar: no top border/margin; underline blue active item,
transparent background, equal prominence. Font 13px, gap 16px, min-height 48px.
Tabs contain the product logo inside first button. Header responsive handled by parent.
Subnav selection uses aria-selected. Hover blue text/light blue surface, 150ms transition.
Focus visible blue outline. Preserve semantic error red and disabled states.
API settings form will also appear inside .settings-panel .ai-settings; compact spacing,
full width, no max-width or outer margin there. Standalone .ai-settings max-width 700px,
white panel on gray body via body.ai-settings-page. Preserve all IDs and JS handlers.
No remote assets needed: retain existing plugin identity and local icons.
