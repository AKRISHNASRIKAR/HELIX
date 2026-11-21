"""Errors that map to HTTP responses with a readable `detail` string."""


class AnalyticsError(Exception):
    """A bad spec or unusable data (unknown column, too few points...): 422."""

    status_code = 422

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


class UpstreamUnavailable(AnalyticsError):
    """The ingestion service could not be reached or failed: 502."""

    status_code = 502
