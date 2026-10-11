export const SITES = [
  {
    key: "chatgpt",
    name: "ChatGPT",
    url: "https://chatgpt.com",
    hosts: ["chatgpt.com", "chat.openai.com"],
  },
  {
    key: "claude",
    name: "Claude",
    url: "https://claude.ai",
    hosts: ["claude.ai"],
  },
  {
    key: "gemini",
    name: "Gemini",
    url: "https://gemini.google.com",
    hosts: ["gemini.google.com", "gemini.google"],
  },
  {
    key: "deepseek",
    name: "DeepSeek",
    url: "https://chat.deepseek.com",
    hosts: ["chat.deepseek.com", "deepseek.com"],
  },
  {
    key: "perplexity",
    name: "Perplexity",
    url: "https://www.perplexity.ai",
    hosts: ["perplexity.ai"],
  },
  {
    key: "grok",
    name: "Grok",
    url: "https://grok.com",
    hosts: ["grok.com"],
  },
  {
    key: "mistral",
    name: "Mistral Chat",
    url: "https://chat.mistral.ai",
    hosts: ["chat.mistral.ai"],
  },
];

export const SITE_KEYS = SITES.map((s) => s.key);

export function siteByKey(key) {
  return SITES.find((s) => s.key === key);
}

export function siteUrl(key) {
  const s = siteByKey(key);
  return s ? s.url : "the AI site";
}
