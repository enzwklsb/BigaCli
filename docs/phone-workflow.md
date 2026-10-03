# Let a long Codex task wait for quota, then continue — from your phone

I built BigaCli because a long-running coding task should not need someone watching a quota countdown and pressing Continue when it ends.

Switching accounts helps when another signed-in account still has quota. But there is a second, less flashy case: every eligible account is exhausted. BigaCli can keep the task paused, wait for the selected account's quota to recover, check it again, and automatically continue the conversation. You can cancel automatic continuation at any time.

The work runs on your own Windows PC. Your phone is a browser interface for checking progress, sending instructions, managing the queue, and opening the files the agent produces.

I'm the maintainer. This guide covers BigaCli v1.2.1, an open-source Codex client based on CloudCLI. It does not add quota or remove account limits. Automatic continuation also does not guarantee that an agent will finish an arbitrarily large task without questions, approvals, or other interruptions.

## 1. Start BigaCli on your Windows PC

Download **BigaCli-win-x64.zip** from the [latest GitHub release](https://github.com/enzwklsb/BigaCli/releases/latest). Extract it to a writable folder and run `start.cmd`. The ZIP includes the runtime, so this path does not require a separate Node.js installation.

Keep the service window open, then open `http://localhost:3101` on the PC. Add your own Codex account using the account control. No accounts or credentials are included in the download. Login and any verification remain the account owner's steps.

If you already use Node.js 22 or later, the alternative is:

```powershell
npm i -g bigacli
bigacli start
```

The npm package is a small launcher. Its first launch downloads and verifies the matching Windows application; it is not a tiny download of the entire program. Once installed, use Settings → Check for updates for app updates.

## 2. Open the same workspace on your phone

On the same trusted LAN, open `http://YOUR-COMPUTER-LAN-IP:3101` in your phone's browser. `localhost` on the phone refers to the phone, not the PC.

For access away from home, use your own [Tailscale setup](https://tailscale.com/download) on both devices and open `http://YOUR-COMPUTER-TAILSCALE-IP:3101`. BigaCli does not provide a tunnel, and you do not join my network.

Keep the PC awake, online, and running BigaCli. Its firewall must permit the connection. The web interface has no separate sign-in gate: use a trusted LAN or private VPN, and do not expose this port directly to the public internet.

Select your project and conversation. You are controlling the same service from both devices, so you can leave the desk and reopen the task from your phone.

## 3. Give the task a clear finish line

For example:

> Review the mobile layout of this project. Fix the navigation and file-preview issues you can reproduce, run the relevant checks, and leave a short report of what changed and what still needs my input. Continue through the necessary steps until those goals are met.

Use the model and permission controls appropriate to your task. A long instruction is not a way to override permissions or make every later decision automatic.

While the agent works, you can queue a follow-up instead of interrupting it. Open a queued message to edit it. The top-right folder control lists files referenced or produced in the conversation, with previews and downloads for supported formats.

## 4. Choose how to handle quota pauses

There are two useful cases:

- **Another account is eligible:** enable automatic account switching. BigaCli checks that the account is signed in, has available quota, and supports the selected model and reasoning level, then continues the same conversation.
- **No eligible account has quota:** keep automatic continuation enabled. The task waits for the selected account's recovery instead of needing a manual click later. You can still prepare queued instructions while waiting.

This is the feature I particularly wanted for long tasks: exhausting all accounts does not have to mean the task waits indefinitely for me to notice.

It is not a pooled or unlimited quota system. Each account retains its own limits. Exhausting either the 5-hour or 7-day window can block that account, and a 5-hour reset does not help if the weekly limit is still exhausted. Unknown quota or unsupported models can also prevent automatic switching.

Recovery is not promised at the exact second shown by the provider. The current implementation schedules continuation shortly after the reported recovery time and checks quota again. The PC and service must remain available for the task to resume.

Cancel the recovery reservation if you want the task to remain paused. Waiting is a choice you can turn off.

## 5. Check results when you return

Review the conversation, inspect the changes, and open the resulting report or files on the phone. A completed agent response is still something to review before deploying or publishing your own work.

If the phone cannot connect, first check that the PC can open `localhost:3101`, then check the address, network/VPN connection, firewall, and whether the PC went to sleep. If a task remains paused, check both quota windows and whether automatic continuation was cancelled; do not repeatedly reset quota as a troubleshooting step.

[Source and download](https://github.com/enzwklsb/BigaCli) · [Short simulated UI demos](https://enzwklsb.github.io/BigaCli/?lang=en)

The existing quota-switching videos are simulated demos using the UI, not footage of real accounts exhausting quota. They illustrate the intended interaction without consuming reset credits or publishing account information.

If you try this workflow, I'd especially like to hear what still sends you back to your desk: approvals, file review, queue management, or recovering a long task.
