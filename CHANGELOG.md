# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-06-19

### Added
- Initial release of InfraSight.
- Provider-agnostic LLM proxy routing supporting any OpenAI-compatible API.
- Real-time logging of prompts, completions, tokens, latency, cost, and HTTP status codes.
- Privacy mode to easily toggle prompt/response text payload logging.
- Advanced Guardrails: keyword blocking and regex/PII masking for request payloads.
- Hierarchical Agent Trace system for tracking nested agent execution flows.
- Human-in-the-loop (HITL) manual review and approval checkpoints.
- Custom SQLite-backed local storage with automatic table schemas and migration checks.
- Zero-dependency Python client examples.
- Docker and Docker Compose setup for instant deployment of server, client, and DB.
