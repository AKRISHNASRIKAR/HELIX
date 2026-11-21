from ..errors import AdapterError
from ..models import ConnectionSpec
from .base import DataSourceAdapter
from .csv import CsvAdapter
from .postgres import PostgresAdapter

ADAPTERS: dict[str, type[DataSourceAdapter]] = {
    "POSTGRESQL": PostgresAdapter,
    "CSV": CsvAdapter,
}


def adapter_for(spec: ConnectionSpec) -> DataSourceAdapter:
    """Build the adapter for a ConnectionSpec (raises AdapterError if unsupported)."""
    adapter_cls = ADAPTERS.get(spec.type)
    if adapter_cls is None:
        raise AdapterError(f"Unsupported data source type: {spec.type}")
    return adapter_cls(spec)


__all__ = ["ADAPTERS", "CsvAdapter", "DataSourceAdapter", "PostgresAdapter", "adapter_for"]
