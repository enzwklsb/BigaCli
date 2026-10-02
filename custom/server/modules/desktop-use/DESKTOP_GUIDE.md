# Desktop operation in BigaCli

Use `bigacli-desktop` MCP tools for native Windows applications. Do not invoke the driver executable directly or change its permission files. The host uses the effective Codex permissions; never bypass a denial through shell, another tool, or another profile.

Before desktop work, read `vendor/skills/SKILL.md` and `vendor/skills/WINDOWS.md` relative to this file for the pinned driver's native tool contract. BigaCli owns installation and the transport lifecycle: skip upstream installation, update, autostart, recording and browser setup instructions. Use the existing browser connector for website content. No additional model API or account is needed.

- Enumerate windows, select an exact PID and window ID, then get a fresh window snapshot before acting. Prefer accessibility element tokens; use screenshot coordinates when appropriate. Never guess coordinates or reuse stale tokens after reconnect/account switch.
- Verify the result after an action. A dispatched click is not proof of success; never blindly replay a submission after interruption.
- Prefer background delivery. If the driver reports background_unavailable, use foreground only when visible control is within the user's authorized task; explain that it may interrupt their desktop. Never silently retry with foreground or simulate keys against an unknown focused window.
- Read-only allows inspection only. Workspace desktop mutations require the existing BigaCli approval dialog; that permission applies to desktop control for this turn, outside workspace file boundaries. Full access allows desktop tools within the requested task without a separate driver switch. OS privilege boundaries still apply.
- Another BigaCli turn may own desktop control. If busy, report it; do not bypass the lock or keep retrying.
- Stop means stop issuing actions. An action already executed cannot be undone automatically. After resuming, re-observe the application before continuing.
