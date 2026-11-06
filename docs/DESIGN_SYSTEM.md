# Design System: Slate × Ice Blue
## Emergency Resource Allocation & Response Management System

---

### 1. Theme Philosophy
The interface follows an **enterprise-grade, mission-critical dashboard aesthetic**. It prioritizes readability, calm focus under high-stress emergency operations, distinct contrast ratios, and deliberate color-coding for rapid situational awareness.

---

### 2. Core Color Palette Tokens

| Token Name | Hex Code | Visual Preview / Description | Usage in Interface |
| :--- | :--- | :--- | :--- |
| **Main Background** | `#F4F6F8` | Light cool slate gray | Overall page canvas, viewport background |
| **Sidebar Background** | `#252F3B` | Deep enterprise slate | Navigation sidebars, top security banners, primary command buttons |
| **Cards & Panels** | `#FFFFFF` | Pure crisp white | Content containers, modal windows, metric cards |
| **Secondary Background** | `#E8EDF2` | Soft ice-gray tint | Table header rows, icon badge backgrounds, search inputs |
| **Primary Accent** | `#789CB8` | Soft steel blue | Active navigation items, primary tabs, focus rings, link text |
| **Secondary Accent** | `#B6CAD9` | Powder ice blue | Secondary badges, borders on hovered cards, inactive state indicators |
| **Headings & Primary Text**| `#27313D` | Dark slate navy | Main page titles, modal headings, prominent metrics |
| **Borders & Dividers** | `#D9E0E7` | Subtle cool gray | Card outlines, table cell borders, section separators |

---

### 3. Emergency Status & Triage Palette

| Status / Urgency | Hex Code | Visual Role | Application |
| :--- | :--- | :--- | :--- |
| **Critical** | `#DC4545` | High-urgency ruby red | Critical severity badge, trauma emergency indicator, out-of-area alert |
| **High** | `#E89543` | Urgent amber orange | High severity badge, on-scene pending indicator |
| **Medium** | `#D5B34F` | Warning golden yellow | Medium severity badge, pending hospital verification |
| **Available** | `#56866B` | Calm spruce green | Resource available status, online health indicators, resolved incident |
| **Dispatched** | `#5685B5` | Royal steel blue | Dispatched vehicle route polyline, active transit state |

---

### 4. Typography & Layout Principles

- **Font Family**: Inter, system-ui, -apple-system, sans-serif.
- **Visual Hierarchy**:
  - Page Titles: 20px / 24px, Bold (`font-bold text-theme-heading`)
  - Section Headers: 16px, Semi-Bold (`font-semibold text-theme-heading`)
  - Body Text: 14px, Regular (`text-sm text-gray-600`)
  - Micro-copy & Badges: 11px / 12px, Medium (`text-xs font-medium`)
- **Spacing System**: Consistent 4px grid (e.g. `p-2` = 8px, `p-4` = 16px, `p-6` = 24px).
- **Cards**: Rounded borders (`rounded-xl`), subtle single-layer shadow (`shadow-sm`), and clean border separation (`border border-theme-border`).
- **Gradients & Distractions**: Avoid neon colors, excessive multi-color gradients, or disruptive pulsing animations. Use subtle, purposeful motion only for live operational states.
