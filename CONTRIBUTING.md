<div align="center">

# 🤝 Contributing to NOAPI?

Thanks for wanting to help. This project is small, friendly and held together by CSS selectors, so every fix really does matter.

</div>

<br>

## 🧭 Pick your way in

You do not need to write code to be useful.

| I want to... | Go here |
|---|---|
| 🐛 Report something that broke | [Reporting a bug](#-reporting-a-bug) |
| 🛠️ Fix a site that stopped working | [Fixing or adding a site](#-fixing-or-adding-a-site) |
| ✨ Suggest or build a feature | [Suggesting a feature](#-suggesting-a-feature) |
| 📖 Improve the docs | Just open a pull request, typo fixes are always welcome |
| 🔐 Report a security problem | [Security](#-security) |

<br>

## 🛠️ Setting up

You need Node.js 18 or newer and a browser. There is nothing to install, because the bridge has no dependencies.

```bash
git clone https://github.com/YOUR_USERNAME/noapi.git
cd noapi

npm start        # run the bridge on 127.0.0.1:8787
npm test         # run the full test suite, no browser needed
```

Then load the extension from `extension/chrome` (or `extension/firefox/manifest.json` in Firefox). The steps are in the [README](README.md#-quick-start).

After you change anything inside `extension/`, reload the extension on `chrome://extensions` (or `about:debugging` in Firefox) **and** refresh the AI tab. Content scripts do not update on their own, which is the cause of a surprising number of "my fix does nothing" moments.

<br>

## 🗺️ A quick tour of the code

```text
bridge/      Local server in plain Node.js
             http.js        OpenAI compatible API and dashboard
             state.js       request queue, routing, progress, cancel
             toolproto.js   the TOOL_CALL text protocol
             mcp.js         MCP server over stdio
extension/   Chrome (Manifest V3) and Firefox versions
             content.js     runs on the AI site: types, sends, reads the reply
             background.js  keeps the WebSocket to the bridge alive
tools/       fake browser tab and tests
```

Most bugs live in `extension/*/content.js`, because that is where the code meets real, ever changing web pages.

<br>

## 🐛 Reporting a bug

A good report gets fixed faster, and it only takes a minute. Please include:

- **Which site** (ChatGPT, Gemini, DeepSeek...) and **which browser**
- **What you expected** and **what happened instead**
- **The status lines** OpenCode showed, or the last line in the `?` panel on the page. For a stall, that line contains a short technical summary, which is very useful
- **The bridge log**, meaning whatever `npm start` printed in the terminal
- Whether it is **every time** or only **sometimes**

If the problem is that the extension types the prompt but cannot find the send button or the reply, say so. That almost always means a selector needs updating.

Please remove anything private from logs and screenshots before posting them.

<br>

## 🛠️ Fixing or adding a site

Websites change their pages without warning, so this is the most common kind of contribution. Each site is just a small block of config.

### Fixing a selector

1. Open the site and right click the problem element (chat box, send button, stop button, or a reply message), then choose **Inspect**.
2. In `extension/chrome/content.js`, find the `SITES` object and the entry for that site. It lists CSS selectors for `input`, `send`, `stop` and `reply`.
3. Update or add a selector. Prefer stable attributes such as `data-testid`, `role` or `aria-label` over generated class names that look like random letters.
4. Copy your change to `extension/firefox/content.js`. The two files should stay identical, and you can check with:

   ```bash
   diff extension/chrome/content.js extension/firefox/content.js
   ```

5. Reload the extension, refresh the tab, and try at least **two prompts in a row**. Many bugs only show up on the second message.

> 💡 Sites whose send button is only an icon, with no label, can set `iconSend: true`. DeepSeek does this. It tells the extension to look for the button next to the chat box instead of anywhere on the page, so it never clicks an unrelated icon.

### Adding a brand new site

1. Add its selectors to `SITES` in both `content.js` files.
2. Add it to `bridge/sites.js`.
3. Add a model entry in `opencode.json`.
4. Add the address to `matches` and `host_permissions` in **both** manifests.
5. Add the site to the table in the README.
6. Test it for real, with a normal reply, a long reply, and a second message in the same chat.

<br>

## ✨ Suggesting a feature

Open an issue first for anything bigger than a small tweak, so we can talk about it before you spend a weekend on it. Say what problem you are trying to solve, not only what you want built.

A few things that shape what fits this project:

- 🪶 **Zero dependencies is a feature.** The bridge runs on plain Node.js with no `npm install`. Please do not add a package for something that a few lines can do.
- 🔒 **Local only.** Nothing should leave `127.0.0.1`, and there should be no tracking of any kind.
- 🤖 **Automatic by default.** The goal is that you type in OpenCode and it just works, with no extra clicks.

<br>

## 🔀 Sending a pull request

1. Fork the repo and create a branch with a clear name, such as `fix-gemini-send-button`.
2. Keep the change focused. One fix per pull request is much easier to review than five.
3. Run `npm test` and make sure it passes.
4. If you touched an extension, try it in a real browser, and say which site and browser you tested in.
5. Open the pull request and explain **what** changed and **why**. Screenshots or a short screen recording help a lot for anything visual.

### ✍️ Code style

- Plain modern JavaScript, ES modules in the bridge, no build step.
- Match the style of the file you are in. No big reformatting commits, please.
- Comments should explain **why**, not repeat what the code says. The odd workarounds for specific websites deserve a short note about the quirk they handle.
- Be careful with timing. Web pages are asynchronous and sometimes slow, so wait for something to be true rather than sleeping for a fixed time when you can.

### 💬 Commit messages

Short and in the imperative, for example `Fix DeepSeek send button` or `Retry when the chat box is cleared`. Nothing fancy is needed.

<br>

## 🧪 Tests

`npm test` starts a bridge and a **fake browser tab**, then checks plain replies, streaming, MCP in both modes, and a full tool call round trip. It does not need a real browser or any account.

The fake tab cannot know how a real website behaves, so changes to the extension still need a quick manual try. If you fix a bug in the bridge, a test that would have caught it is the best kind of pull request.

<br>

## 🔐 Security

The bridge only listens on `127.0.0.1`, but if you find a way around that, or any other security problem, please **do not open a public issue**. Use GitHub's private security advisory feature on the repository, or contact the maintainer directly, and give a little time to fix it before sharing details.

<br>

## 💚 Be kind

Be patient and respectful, especially with people who are new to open source. Assume good intentions, give feedback on the code and not the person, and remember that everybody here is doing this for free.

<br>

## 📄 License

By contributing, you agree that your work is released under the project's [MIT License](LICENSE).

<br>

<div align="center">

Thank you for helping keep NOAPI? working. 🙏

</div>
