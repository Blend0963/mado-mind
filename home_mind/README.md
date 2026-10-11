# Home Mind

Assistant for Home Assistant with persistent memory and an optional household Sentinel.

- Uses Home Assistant's Supervisor proxy by default; no long-lived token is needed for the local instance.
- Keeps memory and conversation data in `/data`, included in Home Assistant backups.
- The optional Sentinel observes only configured entities, keeps a local event journal, and can send rate-limited notifications. It does not control devices.

See [DOCS.md](DOCS.md) for installation and configuration.
