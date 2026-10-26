# Badges

Public SVG badges for a monitor's status, uptime, and average response time. They are meant for a README or another site, in the flat style used by shields.io.

## Who can see a badge

A badge shows real numbers only when the monitor is public:

- it is listed on at least one **published** status page, or
- an editor turned on **Allow badges when this monitor is not on a public page** for that monitor.

The switch is off by default. A monitor that is only on an unpublished page stays private. Viewers can copy links. Changing the switch requires the same permission as editing a monitor.

If the monitor is missing, private, or the id is not a monitor id, the response is still `200` with a neutral **unknown** badge. It is not a 404 page, and the image does not include the monitor name. Two requests that differ only by whether the id exists return the same SVG when both are ineligible.

## URLs

| Badge | Path |
| ----- | ---- |
| Status | `/badge/<monitor-id>/status.svg` |
| Uptime | `/badge/<monitor-id>/uptime.svg` |
| Response time | `/badge/<monitor-id>/response.svg` |

`<monitor-id>` is the monitor's id from the console URL (`/console/monitors/<monitor-id>`).

The console monitor page has a Badges panel with a live preview and copy buttons for the URL, Markdown, and HTML. The preview is loaded from the signed-in API, so it updates as soon as you change the switch. The public image is cached.

### Query

| Name | Values | Default |
| ---- | ------ | ------- |
| `style` | `flat`, `flat-square`, `for-the-badge` | `flat` |
| `window` | `24h`, `7d`, `30d`, `90d` | `24h` |
| `label` | Up to 48 characters | `status`, `uptime 24h`, or `response 24h` |

`window` applies to uptime and response time. Unknown `style` and `window` values fall back to the defaults. Any other query parameter is ignored, so a random parameter cannot bypass the cache.

`flat` is 20px tall with slightly rounded corners. `flat-square` is the same layout with square corners. `for-the-badge` is 28px tall, bold, and uppercase.

### Status colors

| Stored state | Badge | Color |
| ------------ | ----- | ----- |
| up | up | green `#4c1` |
| down | down | red `#e05d44` |
| paused | paused | yellow `#dfb317` |
| pending, or a check that ended unknown | degraded | orange `#fe7d37` |
| not public, or no such monitor | unknown | gray `#9f9f9f` |

Pending is the console's "Checking" state. The badge uses **degraded** so a public monitor is never drawn with the same word as a private one. A fork can change the words in `brand/locale.json` (`badge_value_up`, `badge_value_down`, `badge_value_paused`, `badge_value_degraded`, `badge_value_unknown`).

Uptime is green at 99.9% and above, then yellow-green, yellow, and red as it falls. Response time is green under 100 ms and moves through yellow and orange to red at 500 ms and above. A public monitor with no samples in the window shows `n/a`, which is different from `unknown`.

### Window and history

Uptime and average response time use the same rollups as the status page: daily totals for past days, hourly totals for today, and the shard's unflushed hour. A requested window longer than Settings → check history is shortened to the days still kept. A one-day retention uses the 24 hour window. When the label is left blank, the badge label shows that effective window (`uptime 7d` when 90 days was requested and only 7 days are kept).

## Examples

```markdown
[![status](https://status.example/badge/MONITOR_ID/status.svg)](https://status.example/)
[![uptime](https://status.example/badge/MONITOR_ID/uptime.svg?window=30d)](https://status.example/)
```

```html
<img alt="status badge" src="https://status.example/badge/MONITOR_ID/status.svg">
<img alt="uptime badge" src="https://status.example/badge/MONITOR_ID/uptime.svg?window=7d&style=flat-square">
```

Replace the host and the monitor id. The Markdown link in the console points at the published status page, or at the site root when that page is served at `/`.

## Cache and the free plan

Public badge responses send `Cache-Control: public, max-age=120` and an `ETag`. The Worker also stores the response in the Cache API. A repeat view within two minutes does not read D1 or wake a Durable Object. `If-None-Match` returns `304` with an empty body.

An uncached request stays small:

- **Status:** one D1 read for the monitor and its stored state. If the badge switch is off, one indexed lookup for a published status-page row. No Durable Object call.
- **Uptime or response time:** those reads, one settings read for the history window, one daily query (at most the window length), one hourly query (today, or 24 hours), and one `getOne` on the monitor's shard for the unflushed hour. That is a handful of subrequests, inside the free plan's 50 per invocation. The queries do not read `samples_json`.
- **Unknown id:** ids that are not UUIDs skip D1. A UUID that does not match a public monitor still costs the one or two reads above, then the same unknown SVG, and that result is cached for two minutes. Repeating an id does not keep spending reads.

There is no extra cron and no write on a badge view. Turning the switch on writes one monitor row and one audit row (`monitor.badges`). Migration `0004_monitor_badges.sql` adds `monitors.badges_enabled` with default `0` and an index on `status_page_items.monitor_id`. It does not rewrite existing monitor rows beyond filling that default, and it does not delete history.

The public image can lag a status change by up to two minutes. The console preview is `Cache-Control: private, no-store` and is only available to someone who can read that monitor.
