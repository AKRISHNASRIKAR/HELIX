"""Live progress reporting for a running investigation.

The Coordinator only knows this Protocol; agent-runtime injects an HTTP
implementation that POSTs to the API's internal progress endpoint (spec A2).
Reporting is best effort: the Coordinator swallows and logs any failure.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol
from uuid import UUID


class ProgressReporter(Protocol):
    async def report(
        self,
        investigation_id: UUID,
        *,
        status: str | None = None,
        event_type: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> None: ...


class NullProgressReporter:
    async def report(self, investigation_id: UUID, **_: Any) -> None:
        return None


@dataclass
class RecordingProgressReporter:
    """Keeps every report in memory; handy for tests and local debugging."""

    reports: list[dict[str, Any]] = field(default_factory=list)

    async def report(
        self,
        investigation_id: UUID,
        *,
        status: str | None = None,
        event_type: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> None:
        self.reports.append(
            {
                "investigationId": str(investigation_id),
                "status": status,
                "eventType": event_type,
                "payload": payload,
            }
        )

    def sequence(self) -> list[str]:
        """Compact 'status:X' / event-type list, in order."""
        out: list[str] = []
        for item in self.reports:
            if item["status"]:
                out.append(f"status:{item['status']}")
            if item["eventType"]:
                out.append(item["eventType"])
        return out
