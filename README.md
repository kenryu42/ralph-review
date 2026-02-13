# ralph-review

A CLI that automates review cycles using your choice of AI coding agents.

## Features

- 🤖 **Multi-agent support**: Use Codex, Claude, or OpenCode for reviewing and implementing fixes
- 🔄 **Automated review cycles**: Reviewer finds issues → Fixer fixes → repeat until clean
- 📺 **Background execution**: Runs in tmux so you can continue working
- 📊 **HTML log viewer**: Browse review history in your browser
- ⚡ **Simple CLI**: Just `rr run` to start

## Installation

### Prerequisites

- [Bun](https://bun.sh/) runtime (v1.0.0+)
- [tmux](https://github.com/tmux/tmux) for background sessions
- At least one AI coding agent installed:
  - [Codex](https://github.com/openai/codex) (`codex`)
  - [Claude Code](https://github.com/anthropics/claude-code) (`claude`)
  - [OpenCode](https://github.com/opencode-ai/opencode) (`opencode`)

### Install from npm

```bash
# Install globally with bun
bun install -g ralph-review

# Or with npm (requires bun runtime)
npm install -g ralph-review
```

### Install from source

```bash
# Clone the repository
git clone https://github.com/yourusername/ralph-review.git
cd ralph-review

# Install dependencies
bun install

# Link globally for development
bun link
```

### Uninstall

```bash
# If installed via npm/bun
bun remove -g ralph-review
# or
npm uninstall -g ralph-review
```

## Usage

### Initial Setup

```bash
# Configure your reviewer, fixer, and simplifier agents
rr init
```

`rr init` starts with a setup mode choice:
- **Auto Setup (recommended)**: Detects installed agents/models and creates a full config automatically.
- **Customize Setup**: Prompts for reviewer, fixer, and code simplifier settings in detail.

Auto setup defaults:
- `maxIterations`: current `DEFAULT_CONFIG.maxIterations` (fallback `5`)
- `iterationTimeout`: current `DEFAULT_CONFIG.iterationTimeout` (fallback `30` minutes)
- `defaultReview`: `uncommitted`

Both setup modes show the proposed config and ask for confirmation before saving.
Reasoning is only prompted for selections that support reasoning.
Setup also prompts whether to play a sound when a background review session finishes.

### Running Reviews

```bash
# Start a full review cycle (background)
rr run

# One-off override: force sound on/off for this run
rr run --sound
rr run --no-sound
```

### Diagnostics

```bash
# Check environment, config, binaries, and model availability
rr doctor
```

### Managing Sessions

```bash
# Check current status
rr status

# Stop the review
rr stop
rr stop --force  # Force kill immediately
```

### Viewing Logs

```bash
# Open latest log in browser
rr logs

# List all log sessions
rr logs --list

# Open specific log session
rr logs <timestamp>
```

## How It Works

1. **Review Phase**: The reviewer agent analyzes your uncommitted changes
2. **Implementation Phase**: If issues found, the fixer agent fixes them
3. **Repeat**: Continue until no issues or max iterations reached (default: 10)

Fixer safety net:
- A git checkpoint is captured before each fixer pass.
- On fixer failure/incomplete output, changes are rolled back automatically.
- If fixer returns `NEED_INFO` with no changes, run stops as warning without rollback.

The tool runs in a tmux session so you can:
- Continue working in your terminal
- View results in HTML format

## Configuration

Configuration is stored at `~/.config/ralph-review/config.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/kenryu42/ralph-review/main/assets/ralph-review.schema.json",
  "version": 1,
  "reviewer": {
    "agent": "codex",
    "model": "gpt-5.2-codex",
    "reasoning": "high"
  },
  "fixer": {
    "agent": "droid",
    "model": "gpt-5.2-codex",
    "reasoning": "high"
  },
  "code-simplifier": {
    "agent": "claude",
    "model": "claude-opus-4-6",
    "reasoning": "high"
  },
  "maxIterations": 5,
  "iterationTimeout": 1800000,
  "notifications": {
    "sound": {
      "enabled": false
    }
  },
  "defaultReview": {
    "type": "uncommitted"
  }
}
```

Edit configuration directly in your preferred editor:

```bash
rr config edit
```

## Commands Reference

| Command | Description |
|---------|-------------|
| `rr init` | Configure reviewer/fixer/simplifier (auto or custom) |
| `rr run` | Start background review cycle |
| `rr status` | Show current status |
| `rr stop` | Graceful stop |
| `rr stop --force` | Force kill |
| `rr logs` | Open latest log |
| `rr logs --list` | List all logs |
| `rr doctor` | Run setup and runtime diagnostics |
| `rr --help` | Show help |
| `rr --version` | Show version |

## Development

```bash
# Install dependencies
bun install

# Regenerate config JSON schema
bun run build:schema

# Run tests
bun test

# Run CLI directly (during development)
bun src/cli.ts --help

# Link package globally for testing
bun link
```

## License

MIT
