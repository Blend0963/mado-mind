# Home Mind Sentinel

The first Sentinel release is deliberately read-only: it polls only explicitly configured Home Assistant entity IDs, records state changes in a JSON Lines journal, and can optionally send notifications. It never calls services to control devices; the only service call is the explicitly configured `notify.*` service.

## Configuration

- `SENTINEL_ENABLED`: `true` to enable, otherwise off.
- `SENTINEL_ENTITIES`: comma-separated entity IDs, e.g. `binary_sensor.front_door,sensor.living_room_temperature`. Only entities visible to Home Mind's Home Assistant exposure filter can be observed.
- `SENTINEL_INTERVAL_SECONDS`: polling interval, 30–300 seconds.
- `SENTINEL_NOTIFY_SERVICE`: optional Home Assistant notify service, e.g. `notify.mobile_app_phone`. Leave blank to journal without notifications.

The first poll establishes a baseline and does not notify about pre-existing states. Each subsequent state change is recorded in `/data/sentinel-events.jsonl`. Notifications are rate-limited per entity to one per 15 minutes. The journal is available through authenticated `GET /api/sentinel/events`; status is at `GET /api/sentinel/status`.
