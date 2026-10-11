# 🔐 Security Policy

NOAPI? runs on your own computer and sits between your coding agent and your browser, so security matters here. Thanks for taking the time to look at it.

## 🧭 What this project does and does not protect

Knowing the design helps you judge what counts as a real problem.

- The bridge listens on `127.0.0.1` only. It also **refuses requests and WebSocket connections that come from web pages**. Only the browser extension, local tools such as OpenCode, and the bridge's own dashboard are accepted.
- Nothing is sent to any server other than the AI website you already have open. There is no telemetry.
- The extension types into and reads from the chat page you opened. It does not read your passwords or cookies.
- 🛡️ **Tool calls come from a website's model.** When you use a browser model in OpenCode, its replies can turn into tool calls such as running a command or editing a file. That is how it works, so OpenCode's permission prompts are your safety net. **Keep them on** and read what you approve, especially if the conversation has pulled in text from untrusted places like web pages or files you did not write.

## 📮 Reporting a vulnerability

Please **do not open a public issue** for security problems.

Use GitHub's private reporting instead: open the **Security** tab of this repository and choose **Report a vulnerability**. If that option is not available, contact the maintainer privately through the contact details on their GitHub profile.

A useful report includes:

- what you found and why it matters
- the steps to reproduce it, or a small proof of concept
- the version or commit you tested, plus your browser and operating system

This is a small project maintained by a person in their free time. I will do my best to reply within a few days, to fix real problems quickly, and to credit you in the changelog if you would like that. Please give me a reasonable amount of time to fix things before sharing details publicly.

## ✅ In scope

- Any way for a web page or another machine to reach or control the bridge
- Anything that lets a site or another extension read prompts, answers or credentials it should not see
- Ways to make the bridge or the extension run commands or write files without OpenCode's own tool flow
- Mistakes in how requests are checked (origin, host or WebSocket handling)

## 🚫 Out of scope

- Websites changing their pages and breaking selectors (open a normal issue for that)
- The terms of service of the AI websites
- Attacks that need full control of your computer or browser already
- Prompt injection in general. It is a known property of letting a model call tools, covered by the permission prompts mentioned above

## 📦 Supported versions

Only the latest release and the current `main` branch receive fixes.
