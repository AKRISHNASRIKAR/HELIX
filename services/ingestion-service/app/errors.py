"""Errors adapters raise for expected, user-facing failures (bad credentials,
unreachable host, malformed CSV, unknown table...). The message is shown to
users verbatim, so it must be readable and must never contain secrets."""


class AdapterError(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message
