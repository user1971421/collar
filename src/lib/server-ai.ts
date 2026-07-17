type Message = {
  role: "system" | "user";
  content: string;
};

function proxyConfig() {
  return {
    baseURL: String(process.env.COLLAR_API_BASE_URL || "").replace(/\/+$/, ""),
    apiKey: String(process.env.COLLAR_API_KEY || ""),
    model: String(process.env.COLLAR_MODEL || ""),
    temperature: Math.max(0, Math.min(2, Number(process.env.COLLAR_TEMPERATURE) || 0.85)),
    maxTokens: Math.max(256, Math.min(8000, Number(process.env.COLLAR_MAX_TOKENS) || 2400))
  };
}

export async function serverCompletion(messages: Message[], maxTokens?: number) {
  const config = proxyConfig();
  if (!config.baseURL || !config.apiKey || !config.model) {
    throw new Error("backend-proxy is not configured");
  }

  const response = await fetch(`${config.baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: false,
      temperature: config.temperature,
      max_tokens: Math.min(config.maxTokens, maxTokens || config.maxTokens)
    }),
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`provider returned ${response.status}`);
  }
  return response.json() as Promise<unknown>;
}
