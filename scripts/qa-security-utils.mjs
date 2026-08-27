function lineNumberAt(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function readSimpleQuotedLiteral(text, start) {
  const quote = text[start];
  if (!['\'', '"'].includes(quote)) return null;
  let escaped = false;
  for (let index = start + 1; index < text.length; index += 1) {
    const ch = text[index];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === quote) return { literal: text.slice(start, index + 1), expressions: [], end: index + 1 };
  }
  return null;
}

function skipQuoted(text, start) {
  const quote = text[start];
  if (quote === '`') return readTemplateLiteral(text, start)?.end ?? text.length;
  return readSimpleQuotedLiteral(text, start)?.end ?? text.length;
}

function readExpression(text, start) {
  let depth = 1;
  let index = start;
  while (index < text.length) {
    const ch = text[index];
    if (ch === '\'' || ch === '"' || ch === '`') { index = skipQuoted(text, index); continue; }
    if (ch === '/' && text[index + 1] === '/') {
      const end = text.indexOf('\n', index + 2);
      index = end < 0 ? text.length : end + 1;
      continue;
    }
    if (ch === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2);
      index = end < 0 ? text.length : end + 2;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return { expression: text.slice(start, index), end: index + 1 };
    }
    index += 1;
  }
  return null;
}

function readTemplateLiteral(text, start) {
  if (text[start] !== '`') return null;
  const expressions = [];
  let escaped = false;
  let index = start + 1;
  while (index < text.length) {
    const ch = text[index];
    if (escaped) { escaped = false; index += 1; continue; }
    if (ch === '\\') { escaped = true; index += 1; continue; }
    if (ch === '`') return { literal: text.slice(start, index + 1), expressions, end: index + 1 };
    if (ch === '$' && text[index + 1] === '{') {
      const parsed = readExpression(text, index + 2);
      if (!parsed) return null;
      expressions.push(parsed.expression);
      index = parsed.end;
      continue;
    }
    index += 1;
  }
  return null;
}

function readLiteral(text, start) {
  return text[start] === '`' ? readTemplateLiteral(text, start) : readSimpleQuotedLiteral(text, start);
}

function isSafeExpression(expr) {
  const value = expr.trim();
  if (/^(?:escapeHtml|escapeAttribute|icon)\s*\(/.test(value)) return true;
  if (/^(?:Number|String|Boolean)\s*\(/.test(value)) return true;
  if (/^(?:true|false|null|undefined|\d+(?:\.\d+)?)$/.test(value)) return true;
  if (/^(?:content|actions|body|rows|warningMarkup|scopeControl|gatewayCard|tabs|contentByTab)$/.test(value)) return true;
  if (/\.map\([\s\S]*escapeHtml\(/.test(value)) return true;
  if (/^[A-Za-z_$][\w$]*(?:Markup|Banner|Card|Row|View|Pill|Options|List|Grid|Summary|Field|Strip|Mark)\s*\(/.test(value)) return true;
  if (/^[A-Za-z_$][\w$]*\s*\([^)]*\)$/.test(value) && !/^(?:accessInitials|renderUnsafe)\s*\(/.test(value)) return true;
  if (/\?\s*['"`][\s\S]*['"`]\s*:\s*['"`][\s\S]*['"`]$/.test(value)) return true;

  const riskyMember = /(?:^|\.)\s*(?:title|displayName|label|role|email|body|note|text|description|subject|name|schoolLogoUrl|manualUrl|aiStudioUrl)\b/;
  const riskyBare = /^(?:message|value|response|unsafeValue|userInput|html)$/;
  return !riskyMember.test(value) && !riskyBare.test(value);
}

function hasSafeHtmlComment(source, start, end) {
  return /qa-safe-html/.test(source.slice(Math.max(0, start - 180), Math.min(source.length, end + 40)));
}

function findingForLiteral(source, start, parsed) {
  if (!parsed?.literal?.includes('<') || !parsed.expressions?.length) return null;
  if (hasSafeHtmlComment(source, start, parsed.end)) return null;
  const unsafe = parsed.expressions.filter((expression) => !isSafeExpression(expression));
  if (!unsafe.length) return null;
  return {
    line: lineNumberAt(source, start),
    statement: source.slice(start, Math.min(parsed.end, start + 700)),
    expressions: unsafe,
  };
}

function matchingBrace(text, openIndex) {
  let depth = 1;
  let index = openIndex + 1;
  while (index < text.length) {
    const ch = text[index];
    if (ch === '\'' || ch === '"' || ch === '`') { index = skipQuoted(text, index); continue; }
    if (ch === '/' && text[index + 1] === '/') {
      const end = text.indexOf('\n', index + 2);
      index = end < 0 ? text.length : end + 1;
      continue;
    }
    if (ch === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2);
      index = end < 0 ? text.length : end + 2;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return index;
    index += 1;
  }
  return text.length;
}

function findUnsafeRendererTemplates(source) {
  const findings = [];
  const functionPattern = /(?:export\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g;
  let match;
  while ((match = functionPattern.exec(source))) {
    const name = match[1];
    if (!/^(?:render|.*(?:Markup|Banner))/.test(name)) continue;
    const open = functionPattern.lastIndex - 1;
    const close = matchingBrace(source, open);
    const bodyStart = open + 1;
    const body = source.slice(bodyStart, close);
    let index = 0;
    while (index < body.length) {
      if (body[index] !== '`') { index += 1; continue; }
      const parsed = readTemplateLiteral(body, index);
      if (!parsed) break;
      const issue = findingForLiteral(body, index, parsed);
      if (issue) findings.push({ ...issue, line: lineNumberAt(source, bodyStart + index), renderer: name });
      index = parsed.end;
    }
    functionPattern.lastIndex = close + 1;
  }
  return findings;
}


export function findUnsafeHtmlAssignments(text, { scanRenderFunctions = false } = {}) {
  const source = String(text || '');
  const findings = [];
  const patterns = [
    /\.(?:innerHTML|outerHTML)\s*=\s*/g,
    /insertAdjacentHTML\s*\([^,]+,\s*/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) {
      let start = pattern.lastIndex;
      while (/\s/.test(source[start] || '')) start += 1;
      const parsed = readLiteral(source, start);
      if (!parsed) continue;
      const issue = findingForLiteral(source, match.index, parsed);
      if (issue) findings.push(issue);
      pattern.lastIndex = parsed.end;
    }
  }
  if (scanRenderFunctions) findings.push(...findUnsafeRendererTemplates(source));

  const seen = new Set();
  return findings.filter((item) => {
    const key = `${item.line}:${item.statement}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function findUnsafeLocalStorage(text) {
  const source = String(text || '');
  const lines = source.split(/\r?\n/);
  return lines
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => /localStorage\.(?:setItem|getItem)/.test(line))
    .filter(({ lineNumber }) => {
      const context = lines.slice(Math.max(0, lineNumber - 5), Math.min(lines.length, lineNumber + 3)).join('\n');
      return !/(?:QuotaExceededError|safeStorage|storageError|try\s*\{)/.test(context);
    })
    .map(({ lineNumber, line }) => ({ line: lineNumber, statement: line.trim() }));
}
