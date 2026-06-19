#!/usr/bin/env python3
"""
infrasight.py - InfraSight Python SDK

This file contains the InfraSight SDK: A lightweight, context-aware wrapper for OpenAI clients
and a zero-dependency HTTP client fallback to track completions, conversations,
and nested agent trace trees.
"""

import os
import uuid
import time
import json
import urllib.request
import urllib.error
import contextvars
from functools import wraps
from typing import Any, Dict, List, Optional

# ---------------------------------------------------------------------------
# InfraSight Context Tracking (Thread & Async-safe using ContextVars)
# ---------------------------------------------------------------------------
_trace_id_var = contextvars.ContextVar("infrasight_trace_id", default=None)
_parent_span_id_var = contextvars.ContextVar("infrasight_parent_span_id", default=None)
_current_span_id_var = contextvars.ContextVar("infrasight_current_span_id", default=None)
_conversation_id_var = contextvars.ContextVar("infrasight_conversation_id", default=None)
_user_id_var = contextvars.ContextVar("infrasight_user_id", default=None)
_span_name_var = contextvars.ContextVar("infrasight_span_name", default=None)
_span_type_var = contextvars.ContextVar("infrasight_span_type", default=None)

class span:
    """
    Context manager for tracking a span/node within a trace tree.
    Automatically manages parent-child relationships using thread-local context.
    """
    def __init__(self, name: str, span_type: str = "llm", span_id: Optional[str] = None):
        self.name = name
        self.span_type = span_type
        self.span_id = span_id or f"span_{uuid.uuid4().hex[:8]}"
        self._tokens = []

    def __enter__(self):
        # 1. Set trace ID if not already set (auto-starts a trace session)
        if not _trace_id_var.get():
            self._trace_token = _trace_id_var.set(f"trace_{uuid.uuid4().hex[:8]}")
        else:
            self._trace_token = None

        # 2. Determine parent span
        active_parent = _current_span_id_var.get()
        self._parent_token = _parent_span_id_var.set(active_parent or "root")

        # 3. Set current span context
        self._span_token = _current_span_id_var.set(self.span_id)
        self._name_token = _span_name_var.set(self.name)
        self._type_token = _span_type_var.set(self.span_type)
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        # Restore previous context states
        _current_span_id_var.reset(self._span_token)
        _parent_span_id_var.reset(self._parent_token)
        _span_name_var.reset(self._name_token)
        _span_type_var.reset(self._type_token)
        if self._trace_token:
            _trace_id_var.reset(self._trace_token)

class trace(span):
    """
    Context manager for starting a root trace (e.g. an entire Agent execution run).
    """
    def __init__(self, name: str, trace_id: Optional[str] = None):
        self.trace_id = trace_id or f"trace_{uuid.uuid4().hex[:8]}"
        # Generates a root span for the trace itself
        root_span_id = f"span_{uuid.uuid4().hex[:8]}"
        super().__init__(name=name, span_type="agent", span_id=root_span_id)

    def __enter__(self):
        # Force set the trace ID in context before setting up spans
        self._forced_trace_token = _trace_id_var.set(self.trace_id)
        super().__enter__()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        super().__exit__(exc_type, exc_val, exc_tb)
        _trace_id_var.reset(self._forced_trace_token)


# ---------------------------------------------------------------------------
# Global state configuration helpers
# ---------------------------------------------------------------------------
def set_user(user_id: Optional[str]) -> None:
    """Set the user ID globally for the current execution context."""
    _user_id_var.set(user_id)

def set_conversation(conversation_id: Optional[str]) -> None:
    """Set the conversation ID globally for the current execution context."""
    _conversation_id_var.set(conversation_id)

class conversation:
    """Context manager to scope a conversation ID block."""
    def __init__(self, conversation_id: str):
        self.conversation_id = conversation_id

    def __enter__(self):
        self._token = _conversation_id_var.set(self.conversation_id)
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        _conversation_id_var.reset(self._token)


# ---------------------------------------------------------------------------
# Helper function to compute headers to inject based on context variables
# ---------------------------------------------------------------------------
def _get_tracking_headers(model: str, extra_headers: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    headers = {}
    if extra_headers:
        headers.update(extra_headers)

    # 1. Propagate user & conversation
    user_id = _user_id_var.get()
    conv_id = _conversation_id_var.get()
    if user_id and "x-user-id" not in headers:
        headers["x-user-id"] = user_id
    if conv_id and "x-conversation-id" not in headers:
        headers["x-conversation-id"] = conv_id

    # 2. Propagate Trace hierarchy if a trace is active
    trace_id = _trace_id_var.get()
    if trace_id:
        if "x-trace-id" not in headers:
            headers["x-trace-id"] = trace_id

        active_span = _current_span_id_var.get()
        if "x-parent-span-id" not in headers:
            headers["x-parent-span-id"] = active_span or "root"

        if "x-span-id" not in headers:
            headers["x-span-id"] = f"span_{uuid.uuid4().hex[:8]}"

        if "x-span-name" not in headers:
            headers["x-span-name"] = f"LLM Call ({model})"
        if "x-span-type" not in headers:
            headers["x-span-type"] = "llm"

    return headers


# ---------------------------------------------------------------------------
# SDK OpenAI Client Wrapper (For when 'openai' is installed)
# ---------------------------------------------------------------------------
def wrap(client: Any) -> Any:
    """
    Wraps an OpenAI client instance's completions API to inject InfraSight headers automatically.
    """
    if getattr(client, "_infrasight_wrapped", False):
        return client

    original_create = client.chat.completions.create

    @wraps(original_create)
    def wrapped_create(*args, **kwargs):
        model = kwargs.get("model", "unknown")
        extra_headers = kwargs.get("extra_headers", {})
        if not isinstance(extra_headers, dict):
            extra_headers = dict(extra_headers)
        else:
            extra_headers = extra_headers.copy()

        kwargs["extra_headers"] = _get_tracking_headers(model, extra_headers)
        return original_create(*args, **kwargs)

    client.chat.completions.create = wrapped_create
    client._infrasight_wrapped = True
    return client


# ---------------------------------------------------------------------------
# Zero-Dependency Client fallback using Python's built-in urllib
# ---------------------------------------------------------------------------
class ResponseMessage:
    def __init__(self, content: str):
        self.content = content
        self.role = "assistant"

class ResponseChoice:
    def __init__(self, message: ResponseMessage):
        self.message = message
        self.finish_reason = "stop"

class ChatCompletionResponse:
    def __init__(self, data: dict):
        self.id = data.get("id", f"chatcmpl-{uuid.uuid4().hex[:8]}")
        self.object = "chat.completion"
        self.model = data.get("model", "unknown")
        choices = []
        for c in data.get("choices", []):
            msg_data = c.get("message", {})
            msg = ResponseMessage(content=msg_data.get("content", ""))
            choices.append(ResponseChoice(message=msg))
        self.choices = choices

class ChunkDelta:
    def __init__(self, content: str):
        self.content = content

class ChunkChoice:
    def __init__(self, delta: ChunkDelta):
        self.delta = delta
        self.finish_reason = None

class ChunkResponse:
    def __init__(self, data: dict):
        self.id = data.get("id", "")
        self.model = data.get("model", "")
        choices = []
        for c in data.get("choices", []):
            delta_data = c.get("delta", {})
            delta = ChunkDelta(content=delta_data.get("content", ""))
            choices.append(ChunkChoice(delta=delta))
        self.choices = choices

class SSEStream:
    def __init__(self, response: Any):
        self.response = response

    def __iter__(self):
        return self

    def __next__(self):
        while True:
            line = self.response.readline()
            if not line:
                self.response.close()
                raise StopIteration
            
            decoded = line.decode("utf-8").strip()
            if decoded.startswith("data: "):
                data_str = decoded[6:]
                if data_str == "[DONE]":
                    self.response.close()
                    raise StopIteration
                try:
                    data_json = json.loads(data_str)
                    return ChunkResponse(data_json)
                except Exception:
                    pass

class Completions:
    def __init__(self, client: "Client"):
        self.client = client

    def create(self, model: str, messages: List[Dict[str, str]], extra_headers: Optional[Dict[str, str]] = None, stream: bool = False, **kwargs) -> Any:
        # Prepare endpoint
        url = self.client.base_url
        if not url.endswith("/chat/completions"):
            url = url.rstrip("/")
            if url.endswith("/v1/openai"):
                url += "/chat/completions"
            else:
                url += "/v1/chat/completions"

        # Prepare request payload
        payload = {
            "model": model,
            "messages": messages,
            "stream": stream,
            **kwargs
        }

        # Build tracking headers
        tracking_headers = _get_tracking_headers(model, extra_headers)
        
        # Build HTTP headers
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.client.api_key}"
        }
        for k, v in tracking_headers.items():
            headers[k] = str(v)

        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST"
        )

        try:
            response = urllib.request.urlopen(req)
            if stream:
                return SSEStream(response)
            else:
                resp_bytes = response.read()
                resp_data = json.loads(resp_bytes.decode("utf-8"))
                return ChatCompletionResponse(resp_data)
        except urllib.error.HTTPError as e:
            try:
                err_body = e.read().decode("utf-8")
                raise Exception(f"HTTP Error {e.code}: {err_body}")
            except Exception:
                raise Exception(f"HTTP Error {e.code}: {e.reason}")
        except Exception as e:
            raise e

class Chat:
    def __init__(self, client: "Client"):
        self.completions = Completions(client)

class Client:
    """
    Lightweight, zero-dependency OpenAI-compatible Client class.
    Perfect drop-in replacement for the official OpenAI client to run without dependencies.
    """
    def __init__(self, api_key: str = "placeholder", base_url: str = "http://localhost:3000/api/proxy/v1/openai"):
        self.api_key = api_key
        self.base_url = base_url
        self.chat = Chat(self)


# ---------------------------------------------------------------------------
# Helper to log custom tool or system events
# ---------------------------------------------------------------------------
def log_event(client: Any, name: str, event_type: str = "tool", model: str = "custom-event", input_data: Any = "", output_data: Any = "", error_message: Optional[str] = None) -> None:
    """
    Log a non-LLM event (such as a database query or web search tool) to the trace.
    Uses the proxy completions endpoint with custom headers.
    """
    with span(name, span_type=event_type):
        headers = {
            "x-span-name": name,
            "x-span-type": event_type
        }
        if error_message:
            headers["x-simulate-error"] = "true"
            headers["x-error-message"] = error_message

        try:
            client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "user", "content": f"Input: {input_data}\nOutput: {output_data}"}
                ],
                extra_headers=headers
            )
        except Exception:
            pass
