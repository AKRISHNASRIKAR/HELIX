# ingestion-service

Connects to external data (Postgres, CSV first), discovers schema, and
produces basic profiling — behind the `DataSourceAdapter` interface
(`app/adapters/base.py`) so agents and the ingestion pipeline never hard-code
a specific source type (project brief, section 11).

**Status:** Phase 0 foundation only — health check and the adapter interface
exist; Postgres/CSV adapters arrive in Phase 2.
