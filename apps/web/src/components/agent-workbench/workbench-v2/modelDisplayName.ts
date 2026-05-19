const MODEL_ACRONYMS: Record<string, string> = {
  ai: 'AI',
  api: 'API',
  cli: 'CLI',
  gpt: 'GPT',
  id: 'ID',
  oss: 'OSS',
  sdk: 'SDK',
  ui: 'UI',
};

const SPECIAL_MODEL_WORDS: Record<string, string> = {
  opusplan: 'Opus Plan',
};

function modelNameTokens(value: string): string[] {
  const rawTokens = value.split(/[-_:/\s]+/).filter(Boolean);
  const tokens: string[] = [];

  for (let index = 0; index < rawTokens.length; index += 1) {
    const token = rawTokens[index];
    const next = rawTokens[index + 1];
    if (
      next &&
      /^\d+$/.test(token) &&
      /^\d+$/.test(next) &&
      token.length <= 2 &&
      next.length <= 2
    ) {
      tokens.push(`${token}.${next}`);
      index += 1;
      continue;
    }
    tokens.push(token);
  }

  return tokens;
}

function formatToken(token: string): string {
  const lower = token.toLowerCase();
  if (SPECIAL_MODEL_WORDS[lower]) {
    return SPECIAL_MODEL_WORDS[lower];
  }
  if (MODEL_ACRONYMS[lower]) {
    return MODEL_ACRONYMS[lower];
  }
  if (/^o\d+[a-z]?$/i.test(token)) {
    return token.toUpperCase();
  }
  if (/^\d+(?:\.\d+)*[a-z]?$/i.test(token)) {
    return token;
  }
  return lower ? lower[0].toUpperCase() + lower.slice(1) : token;
}

export function formatModelDisplayName(value: string | undefined, fallback = ''): string {
  const source = value?.trim() || fallback.trim();
  if (!source) {
    return source;
  }

  const gptMatch = source.match(/^gpt[-_:\s]+(\d+(?:[.-]\d+)*[a-z]?)(?:[-_:\s]+(.+))?$/i);
  if (gptMatch) {
    const version = gptMatch[1].replace(/-/g, '.');
    const suffix = gptMatch[2] ? formatModelDisplayName(gptMatch[2]) : '';
    return suffix ? `GPT-${version} ${suffix}` : `GPT-${version}`;
  }

  return modelNameTokens(source).map(formatToken).join(' ');
}
