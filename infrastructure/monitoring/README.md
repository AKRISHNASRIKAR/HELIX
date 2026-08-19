# infrastructure/monitoring

Not implemented yet. Planned: Prometheus scraping each service's `/health`
(and later `/metrics`) endpoint, plus a shared Grafana dashboard, once there
are enough moving parts (multiple agents, autonomous investigations) for
observability to earn its keep. Until then, `docker compose logs -f` and each
service's structured JSON logs (`@helix/logger` for Node, stdlib `logging`
for Python) are enough.
