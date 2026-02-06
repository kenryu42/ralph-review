# ralph-review

AI-powered code review CLI that automates review cycles using your choice of AI coding agents.

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
# Configure your reviewer and fixer agents
rr init
```

You'll be prompted to select:
- **Reviewer agent**: Which AI to use for code review
- **Reviewer thinking**: Thinking level for supported reviewer selections
- **Fixer agent**: Which AI to use for fixing issues
- **Fixer thinking**: Thinking level for supported fixer selections

`rr init` only asks for thinking level when the selected agent/model supports it.

### Running Reviews

```bash
# Start a full review cycle (background)
rr run
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

The tool runs in a tmux session so you can:
- Continue working in your terminal
- View results in HTML format

## Configuration

Configuration is stored at `~/.config/ralph-review/config.json`:

```json
{
  "reviewer": {
    "agent": "codex",
    "model": "gpt-5.2-codex",
    "thinking": "high"
  },
  "fixer": {
    "agent": "droid",
    "model": "gpt-5.2-codex",
    "thinking": "high"
  },
  "maxIterations": 10,
  "iterationTimeout": 600000,
  "defaultReview": {
    "type": "uncommitted"
  }
}
```

## Commands Reference

| Command | Description |
|---------|-------------|
| `rr init` | Configure agents |
| `rr run` | Start background review cycle |
| `rr status` | Show current status |
| `rr stop` | Graceful stop |
| `rr stop --force` | Force kill |
| `rr logs` | Open latest log |
| `rr logs --list` | List all logs |
| `rr --help` | Show help |
| `rr --version` | Show version |

## Development

```bash
# Install dependencies
bun install

# Run tests
bun test

# Run CLI directly (during development)
bun src/cli.ts --help

# Link package globally for testing
bun link
```

## License

MIT
