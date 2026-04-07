import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const TOPICS: Record<string, string> = {
  concepts: 'concepts.md',
  config: 'config.md',
  schema: 'schemas.md',
  rules: 'rules.md',
};

export function docs(topic?: string): void {
  let filePath: string;
  if (!topic) {
    filePath = join(import.meta.dir, '..', '..', 'README.md');
  } else {
    const file = TOPICS[topic];
    if (!file) {
      const available = Object.keys(TOPICS).join(', ');
      console.error(`Unknown topic "${topic}". Available: ${available}`);
      process.exit(1);
    }
    filePath = join(import.meta.dir, '..', '..', 'docs', file);
  }

  const content = readFileSync(filePath, 'utf-8');
  const cols = process.stdout.columns ?? 80;
  const rendered = Bun.markdown.render(content, {
    heading: (children, { level }) => {
      const prefix = '#'.repeat(level);
      if (level === 1) return `\x1b[1;4m${prefix} ${children}\x1b[0m\n\n`;
      if (level === 2)
        return `\n\x1b[1m${prefix} ${children}\x1b[0m\n${'─'.repeat(Math.min(children.length + level + 1, cols))}\n`;
      return `\n\x1b[1m${prefix} ${children}\x1b[0m\n`;
    },
    paragraph: (children) => `${children}\n\n`,
    strong: (children) => `\x1b[1m**${children}**\x1b[22m`,
    emphasis: (children) => `\x1b[3m*${children}*\x1b[23m`,
    codespan: (children) => `\x1b[96m\`${children}\`\x1b[39m`,
    code: (children, meta) => {
      const lang = meta?.language ?? '';
      return `\x1b[96m\`\`\`${lang}\n${children}\`\`\`\x1b[0m\n`;
    },
    blockquote: (children) =>
      `${children
        .split('\n')
        .map((l) => `\x1b[2m> ${l}\x1b[0m`)
        .join('\n')}\n`,
    table: (children) => `${children}\n`,
    thead: (children) => {
      const colCount = (children.split('\n')[0] ?? '').split('|').length - 2;
      const sep = `\x1b[2m| ${Array(colCount).fill('---').join(' | ')} |\x1b[0m\n`;
      return `${children}${sep}`;
    },
    tbody: (children) => children,
    tr: (children) => `${children}|\n`,
    th: (children) => `| \x1b[1m${children}\x1b[22m `,
    td: (children) => `| ${children} `,
    list: (children) => `${children}\n`,
    listItem: (children, meta) => {
      const {
        depth = 0,
        ordered = false,
        index = 0,
      } = meta as unknown as {
        depth: number;
        ordered: boolean;
        index: number;
      };
      const indent = '  '.repeat(depth);
      const bullet = ordered ? `${index + 1}.` : '-';
      return `${indent}${bullet} ${children.trimEnd()}\n`;
    },
    hr: () => `\x1b[2m---\x1b[0m\n`,
    link: (children, { href }) =>
      children === href ? `\x1b[4;34m${href}\x1b[0m` : `[${children}](\x1b[4;34m${href}\x1b[0m)`,
  });
  process.stdout.write(rendered);
}
