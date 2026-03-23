"""
AI Quality Guard — Python SDK

Usage (OpenAI):
    from openai import OpenAI
    from ai_quality_guard import QualityGuard

    guard = QualityGuard(api_key="gk-xxx", base_url="http://localhost:3000")
    client = OpenAI(api_key="sk-...", **guard.openai_config())

    # or wrap an existing instance:
    client = guard.wrap(OpenAI(api_key="sk-..."))

Usage (Anthropic):
    from anthropic import Anthropic
    from ai_quality_guard import QualityGuard

    guard = QualityGuard(api_key="gk-xxx", base_url="http://localhost:3000")
    client = Anthropic(api_key="sk-ant-...", **guard.anthropic_config())
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional


class QualityGuard:
    """
    Routes any OpenAI- or Anthropic-compatible client through
    the AI Quality Guard proxy for logging, scoring, and alerting.
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = "http://localhost:3000",
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")

    # ------------------------------------------------------------------
    # Client wrappers
    # ------------------------------------------------------------------

    def wrap(self, client: Any) -> Any:
        """
        Mutate an existing OpenAI or Anthropic client instance so that
        all requests are routed through the Guard proxy.

        Works with openai.OpenAI, openai.AsyncOpenAI,
        anthropic.Anthropic, anthropic.AsyncAnthropic.
        """
        module = type(client).__module__.split(".")[0]

        if module == "openai":
            client.base_url = f"{self.base_url}/v1/"
            # OpenAI SDK stores default_headers as a dict-like object
            client.default_headers["x-guard-key"] = self.api_key

        elif module == "anthropic":
            client.base_url = f"{self.base_url}/"
            client.default_headers["x-guard-key"] = self.api_key

        else:
            raise TypeError(
                f"Unsupported client type '{type(client).__name__}'. "
                "Pass an openai.OpenAI or anthropic.Anthropic instance."
            )

        return client

    def openai_config(self) -> Dict[str, Any]:
        """
        Keyword arguments to pass directly to ``openai.OpenAI()``.

        Example::

            from openai import OpenAI
            client = OpenAI(api_key="sk-...", **guard.openai_config())
        """
        return {
            "base_url": f"{self.base_url}/v1/",
            "default_headers": {"x-guard-key": self.api_key},
        }

    def anthropic_config(self) -> Dict[str, Any]:
        """
        Keyword arguments to pass directly to ``anthropic.Anthropic()``.

        Example::

            from anthropic import Anthropic
            client = Anthropic(api_key="sk-ant-...", **guard.anthropic_config())
        """
        return {
            "base_url": f"{self.base_url}/",
            "default_headers": {"x-guard-key": self.api_key},
        }

    # ------------------------------------------------------------------
    # Management API helpers
    # ------------------------------------------------------------------

    def _request(
        self,
        method: str,
        path: str,
        body: Optional[Dict[str, Any]] = None,
    ) -> Any:
        url = f"{self.base_url}{path}"
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(
            url,
            data=data,
            method=method,
            headers={
                "Content-Type": "application/json",
                "X-Guard-Key": self.api_key,
            },
        )
        try:
            with urllib.request.urlopen(req) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            raise RuntimeError(
                f"Guard API error {e.code}: {e.read().decode()}"
            ) from e

    def traces(self, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
        """Fetch recent traces for this API key."""
        return self._request(
            "GET", f"/api/traces?limit={limit}&offset={offset}"
        )

    def stats(self, hours: int = 24) -> Dict[str, Any]:
        """
        Aggregated quality stats for the given time window.

        Returns dict with keys:
            total_traces, avg_quality, avg_latency, total_cost, total_tokens
        """
        return self._request("GET", f"/api/stats?hours={hours}")

    def configure_alerts(
        self,
        threshold: float = 0.2,
        window_hours: int = 24,
        webhook_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Configure quality drift alerting.

        Args:
            threshold:    Drop fraction that triggers an alert (0–1). Default 0.2 = 20%.
            window_hours: Comparison window in hours. Default 24.
            webhook_url:  Slack-compatible or generic webhook URL.
        """
        return self._request(
            "POST",
            "/api/alerts",
            {
                "threshold": threshold,
                "window_hours": window_hours,
                "webhook_url": webhook_url,
            },
        )

    def get_alert_config(self) -> Dict[str, Any]:
        """Return the current alert configuration."""
        return self._request("GET", "/api/alerts")

    def health(self) -> Dict[str, Any]:
        """Check proxy health."""
        return self._request("GET", "/api/health")

    def __repr__(self) -> str:
        return f"QualityGuard(base_url={self.base_url!r}, api_key={self.api_key[:8]}...)"
