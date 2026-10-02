# Desktop operation in BigaCli

Use `bigacli-desktop` MCP tools for native Windows applications. BigaCli maps the user's selected permission profile to each tool; sharing a permission profile does not make their capabilities identical. Do not invoke the driver executable directly or change its permission files.

- Tools may complement each other within the user's authorized scope. An unsupported operation, application error, timeout, or unavailable browser interface does not by itself prohibit using another tool. Inspect the current state before switching tools, especially after a timeout where the first action may already have happened.
- Distinguish an execution failure from an explicit permission or security-policy denial. For a denial, diagnose and report the enforcing layer and reason when available; do not relabel it as a capability failure or bypass it with another tool. Do not infer a permission denial from an ordinary tool error.
- Permission changes belong to the user. Never modify BigaCli, Codex, Cua, or another tool's permission settings, approval records, or policy files to grant yourself access. Read-only remains read-only even when another tool could technically perform the write. Full access needs no additional BigaCli desktop approval, but does not override host policies or OS privileges.

Before desktop work, read `vendor/skills/SKILL.md` and `vendor/skills/WINDOWS.md` relative to this file for the pinned driver's native tool contract. BigaCli owns installation and the transport lifecycle: skip upstream installation, update, autostart, recording and browser setup instructions. Use the existing browser connector for website content. No additional model API or account is needed.

- Enumerate windows, select an exact PID and window ID, then get a fresh window snapshot before acting. Prefer accessibility element tokens; use screenshot coordinates when appropriate. Never guess coordinates or reuse stale tokens after reconnect/account switch.
- Verify the result after an action. A dispatched click is not proof of success; never blindly replay a submission after interruption.
- Prefer background delivery. If the driver reports background_unavailable, use foreground only when visible control is within the user's authorized task; explain that it may interrupt their desktop. Never silently retry with foreground or simulate keys against an unknown focused window.
- Read-only allows inspection only. Workspace desktop mutations require the existing BigaCli approval dialog; that permission applies to desktop control for this turn, outside workspace file boundaries. Full access allows desktop tools within the requested task without a separate driver switch. OS privilege boundaries still apply.
- Another BigaCli turn may own desktop control. If busy, report it; do not bypass the lock or keep retrying.
- Stop means stop issuing actions. An action already executed cannot be undone automatically. After resuming, re-observe the application before continuing.
