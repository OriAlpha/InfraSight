# Contributing to InfraSight

Thank you for your interest in contributing to InfraSight! We welcome contributions of all kinds — bug reports, feature requests, documentation improvements, and code contributions.

## Getting Started

1. **Fork the repository** and clone your fork locally.
2. **Install dependencies**:
   ```bash
   npm install
   cd server && npm install
   cd ../client && npm install
   ```
3. **Copy the environment file**:
   ```bash
   cp .env.example .env
   ```
4. **Start the development servers**:
   ```bash
   npm run dev
   ```

## Development Workflow

### Branch Naming

- `feature/short-description` — New features
- `fix/short-description` — Bug fixes
- `docs/short-description` — Documentation updates
- `refactor/short-description` — Code refactoring

### Making Changes

1. Create a new branch from `main`.
2. Make your changes in small, focused commits.
3. Write clear commit messages following [Conventional Commits](https://www.conventionalcommits.org/):
   ```
   feat: add support for Anthropic provider
   fix: correct token estimation for streaming responses
   docs: update Docker deployment instructions
   ```
4. Test your changes locally (see below).
5. Push your branch and open a Pull Request.

### Running Tests

#### Node.js (Server & Client)
```bash
# Build the client to verify no compilation errors
cd client && npm run build

# Start the server and verify it boots
npm run dev:server
```

#### Python Integration Tests
```bash
# Run the full test suite (requires the server to be running)
uv run --with openai tests/run_all.py

# Or run individual test modules
uv run --with openai tests/test_integration.py
uv run --with openai tests/test_guardrails.py
uv run tests/test_sdk.py
```

## Code Style

- **JavaScript**: Use `'use strict'` in all server modules. Use JSDoc comments for exported functions.
- **React**: Functional components with hooks. No class components.
- **CSS**: Vanilla CSS using the design tokens defined in `client/src/index.css`.
- **Python**: Follow PEP 8. Use type hints where practical.

## What to Contribute

### Good First Issues

Look for issues labeled [`good first issue`](../../labels/good%20first%20issue) — these are smaller, well-scoped tasks ideal for new contributors.

### Areas We'd Love Help With

- **New provider integrations** — Testing with additional OpenAI-compatible providers
- **Dashboard improvements** — UI/UX enhancements, accessibility, responsive design
- **Evaluation metrics** — Additional NLP metrics or evaluation strategies
- **Documentation** — Tutorials, deployment guides, API documentation
- **Testing** — Unit tests, integration tests, edge case coverage

## Reporting Bugs

Please [open an issue](../../issues/new?template=bug_report.md) with:
- A clear title and description
- Steps to reproduce
- Expected vs. actual behavior
- Your environment (OS, Node.js version, browser)

## Requesting Features

Please [open an issue](../../issues/new?template=feature_request.md) describing:
- The problem you're trying to solve
- Your proposed solution
- Any alternatives you've considered

## Code of Conduct

This project follows our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold these standards.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
