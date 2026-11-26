"""McpAdapter: tools on a remote MCP server exposed as tables.

Config `{serverUrl, transport: "streamable_http", toolPrefixes?: ["list_", "get_"]}`,
credentials `{token?}` (sent as `Authorization: Bearer`). Uses the official
`mcp` client SDK over streamable HTTP.

Discovery: every tool whose name starts with one of `toolPrefixes` and whose
input schema has no required parameters becomes a table named after the tool
minus the prefix (`list_deployments` -> `deployments`). Its rows are whatever
the tool returns when called with no arguments: `structuredContent` (a list,
or `{"result": [...]}` as FastMCP wraps lists) or JSON text content (one
array, or one object per content block). Columns and semanticTypes are then
inferred exactly like a CSV (see RowSourceAdapter).

The adapter's methods are sync (they run in a worker thread), so each
operation opens one short MCP session with `anyio.run` inside that thread.
Every failure becomes an AdapterError with a readable message that never
contains the token.
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from typing import Any, TypeVar

import anyio
import httpx
from mcp import ClientSession, McpError
from mcp.client.streamable_http import streamable_http_client
from mcp.types import CallToolResult, TextContent, Tool

from ..config import settings
from ..errors import AdapterError
from .rows import RowSourceAdapter

T = TypeVar("T")
DEFAULT_PREFIXES = ("list_", "get_")
SUPPORTED_TRANSPORTS = ("streamable_http",)


def _leaf_errors(exc: BaseException) -> list[BaseException]:
    """Flatten (nested) exception groups raised by the SDK's task groups."""
    if isinstance(exc, BaseExceptionGroup):
        return [leaf for inner in exc.exceptions for leaf in _leaf_errors(inner)]
    return [exc]


def rows_from_result(tool: str, result: CallToolResult) -> list[dict[str, Any]]:
    """Turn a tool result into a list of JSON objects (AdapterError if impossible)."""
    texts = [block.text for block in result.content if isinstance(block, TextContent)]
    if result.isError:
        detail = " ".join(texts).strip()[:300] or "no details"
        raise AdapterError(f"MCP tool '{tool}' returned an error: {detail}")

    data: Any = None
    structured = result.structuredContent
    if isinstance(structured, dict):
        if isinstance(structured.get("result"), list):
            data = structured["result"]
        else:
            lists = [v for v in structured.values() if isinstance(v, list)]
            data = lists[0] if len(lists) == 1 and len(structured) == 1 else [structured]
    elif isinstance(structured, list):
        data = structured
    elif texts:
        try:
            parsed = [json.loads(text) for text in texts]
        except json.JSONDecodeError:
            raise AdapterError(
                f"MCP tool '{tool}' returned text that is not JSON, so it cannot be read as a "
                "table."
            ) from None
        if len(parsed) == 1:
            data = parsed[0]
            if isinstance(data, dict):
                lists = [v for v in data.values() if isinstance(v, list)]
                data = lists[0] if len(lists) == 1 and len(data) == 1 else [data]
        else:
            data = parsed
    else:
        data = []

    if not isinstance(data, list) or not all(isinstance(row, dict) for row in data):
        raise AdapterError(f"MCP tool '{tool}' did not return a list of objects.")
    return data


class McpAdapter(RowSourceAdapter):
    type = "MCP"

    def __init__(self, spec) -> None:
        super().__init__(spec)
        config = spec.config or {}
        url = str(config.get("serverUrl") or "").strip()
        if not url:
            raise AdapterError("MCP connection needs a `serverUrl`.")
        try:
            parsed = httpx.URL(url)
        except (httpx.InvalidURL, TypeError):
            raise AdapterError("The MCP `serverUrl` is not a valid URL.") from None
        if parsed.scheme not in ("http", "https") or not parsed.host:
            raise AdapterError("The MCP `serverUrl` must be an http(s) URL.")
        self.url = url
        # For messages: no credentials, query string or fragment.
        port = f":{parsed.port}" if parsed.port else ""
        self.display_url = f"{parsed.scheme}://{parsed.host}{port}{parsed.path}"

        transport = config.get("transport") or "streamable_http"
        if transport not in SUPPORTED_TRANSPORTS:
            raise AdapterError(
                f"Unsupported MCP transport '{transport}'. Supported: streamable_http."
            )
        prefixes = config.get("toolPrefixes") or list(DEFAULT_PREFIXES)
        if not isinstance(prefixes, list) or not all(isinstance(p, str) and p for p in prefixes):
            raise AdapterError("MCP `toolPrefixes` must be a list of non-empty strings.")
        self.prefixes = prefixes
        token = (spec.credentials or {}).get("token")
        self.headers = {"Authorization": f"Bearer {token}"} if token else {}
        self._tool_map: dict[str, str] | None = None

    # -- MCP session plumbing ------------------------------------------------

    def _run(self, op: Callable[[ClientSession], Awaitable[T]]) -> T:
        """Open a session, run `op`, close it; map every failure to AdapterError."""
        timeout = settings.mcp_timeout_seconds

        async def main() -> T:
            with anyio.fail_after(timeout):
                async with (
                    httpx.AsyncClient(headers=self.headers, timeout=timeout) as client,
                    streamable_http_client(self.url, http_client=client) as (read, write, _),
                    ClientSession(read, write) as session,
                ):
                    await session.initialize()
                    return await op(session)

        try:
            return anyio.run(main)
        except AdapterError:
            raise
        except Exception as exc:
            raise self._translate(exc) from None

    def _translate(self, exc: BaseException) -> AdapterError:
        leaves = _leaf_errors(exc)
        for leaf in leaves:
            if isinstance(leaf, AdapterError):
                return leaf
        for leaf in leaves:
            if isinstance(leaf, httpx.HTTPStatusError):
                code = leaf.response.status_code
                if code in (401, 403):
                    return AdapterError(
                        f"The MCP server rejected the credentials (HTTP {code}). Check the token."
                    )
                if code == 404:
                    return AdapterError(f"No MCP endpoint at {self.display_url} (HTTP 404).")
                return AdapterError(f"The MCP server at {self.display_url} returned HTTP {code}.")
            if isinstance(leaf, TimeoutError | httpx.TimeoutException):
                return AdapterError(
                    f"The MCP server at {self.display_url} did not respond within "
                    f"{settings.mcp_timeout_seconds:g}s."
                )
            if isinstance(leaf, httpx.ConnectError):
                return AdapterError(f"Could not connect to the MCP server at {self.display_url}.")
            if isinstance(leaf, httpx.HTTPError):
                return AdapterError(
                    f"HTTP error talking to the MCP server at {self.display_url} "
                    f"({type(leaf).__name__})."
                )
            if isinstance(leaf, McpError):
                return AdapterError(f"The MCP server returned an error: {leaf.error.message}")
        name = type(leaves[0]).__name__ if leaves else type(exc).__name__
        return AdapterError(
            f"Unexpected error talking to the MCP server at {self.display_url} ({name})."
        )

    @staticmethod
    async def _list_tools(session: ClientSession) -> list[Tool]:
        tools: list[Tool] = []
        cursor: str | None = None
        while True:
            page = await session.list_tools(cursor=cursor)
            tools.extend(page.tools)
            cursor = page.nextCursor
            if not cursor:
                return tools

    def _tables_from_tools(self, tools: list[Tool]) -> dict[str, str]:
        """{tableName: toolName} for argument-free tools with a matching prefix."""
        mapping: dict[str, str] = {}
        for tool in tools:
            prefix = next((p for p in self.prefixes if tool.name.startswith(p)), None)
            if prefix is None or (tool.inputSchema or {}).get("required"):
                continue
            table = tool.name[len(prefix) :]
            if table and table not in mapping:
                mapping[table] = tool.name
        return mapping

    def _remember(self, tools: list[Tool]) -> None:
        self._tool_map = self._tables_from_tools(tools)

    # -- DataSourceAdapter ---------------------------------------------------

    def _connect_sync(self) -> None:
        async def op(session: ClientSession) -> list[Tool]:
            return await self._list_tools(session)

        self._remember(self._run(op))

    def _disconnect_sync(self) -> None:
        return None

    def _table_names_sync(self) -> list[str]:
        if self._tool_map is None:
            self._connect_sync()
        return list(self._tool_map or {})

    def _fetch_rows_sync(self, table: str) -> list[dict[str, Any]]:
        self._table_names_sync()
        tool = (self._tool_map or {})[table]

        async def op(session: ClientSession) -> CallToolResult:
            return await session.call_tool(tool, {})

        rows = rows_from_result(tool, self._run(op))
        return rows[: settings.api_source_max_rows]

    def _discover_sync(self, sample: bool = True) -> list[dict[str, Any]]:
        if sample and self._tool_map is not None:
            missing = [t for t in self._tool_map if t not in self._frames]
            if missing:
                # Fetch every table in one session instead of one per table.
                self._prefetch(missing)
        return super()._discover_sync(sample)

    def _prefetch(self, tables: list[str]) -> None:
        tools = {table: (self._tool_map or {})[table] for table in tables}

        async def op(session: ClientSession) -> dict[str, CallToolResult]:
            return {table: await session.call_tool(tool, {}) for table, tool in tools.items()}

        for table, result in self._run(op).items():
            rows = rows_from_result(tools[table], result)[: settings.api_source_max_rows]
            self._frames[table] = self._frame_from_rows(table, rows)
