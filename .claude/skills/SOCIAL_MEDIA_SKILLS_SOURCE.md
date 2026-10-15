# Social media skills provenance

- Source: `https://github.com/blacktwist/social-media-skills`
- Source commit: `4f85b07069983b3b0b9bbe6519fed7017edcce81`
- License: MIT; bundled at `_licenses/blacktwist-social-media.LICENSE`
- Installed: 2026-10-15
- Installed skills: `social-media-context-sms`, `caption-writer-sms`, `post-writer-sms`, `performance-analyzer-sms`, `content-pattern-analyzer-sms`, `optimization-advisor-sms`

## Security review

The six source skill directories were scanned before installation with NVIDIA SkillSpector 2.12.0, pinned to commit `240421219409dc0bafef9f618a10d80c2d7e83a3`.

- Mode: local static analysis (`--no-llm`)
- Files inspected: 100%
- Findings: 0 in every installed skill
- Risk score: 0 in every installed skill
- Recommendation: `CAUTION` because semantic LLM analysis was disabled and the skills contain runtime or sibling references that are not bundled inside each individual skill directory

The installed subset contains Markdown instructions only. Publishing integrations, browser automation, scripts, and MCP components from other projects were not installed.

The source files are installed under `.agents/skills/` for agent compatibility and mirrored under `.claude/skills/` for Claude Code compatibility. The project-specific voice profile is stored at `.agents/social-media-context-sms.md`.
