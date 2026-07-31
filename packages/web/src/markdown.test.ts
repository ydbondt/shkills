import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

describe('rendering a skill body', () => {
  it('keeps a wrapped bullet as one list item', () => {
    const html = renderMarkdown(
      '1. **Correctness** — does it do what the ticket asked?\n   Look for the case the author missed.',
    );
    expect(html).toBe(
      '<ol><li><strong>Correctness</strong> — does it do what the ticket asked? Look for the case the author missed.</li></ol>',
    );
  });

  it('handles headings, bold, code and rules', () => {
    const html = renderMarkdown('# Title\n\nUse `npm test` and **stop**.\n\n---\n');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<code>npm test</code>');
    expect(html).toContain('<strong>stop</strong>');
    expect(html).toContain('<hr />');
  });

  it('keeps fenced code verbatim', () => {
    const html = renderMarkdown('```\n- not a list\n**not bold**\n```');
    expect(html).toContain('<pre><code>');
    expect(html).toContain('- not a list\n');
    expect(html).toContain('**not bold**\n');
    expect(html).not.toContain('<strong>');
  });

  it('closes an unterminated code fence rather than leaking markup', () => {
    expect(renderMarkdown('```\nstill open')).toBe('<pre><code>still open\n</code></pre>');
  });

  it('never lets a skill body inject HTML', () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)"> and <script>bad()</script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes HTML inside code spans and fences too', () => {
    expect(renderMarkdown('`<b>x</b>`')).toBe('<p><code>&lt;b&gt;x&lt;/b&gt;</code></p>');
    expect(renderMarkdown('```\n<b>x</b>\n```')).toBe('<pre><code>&lt;b&gt;x&lt;/b&gt;\n</code></pre>');
  });

  it('switches cleanly between ordered and unordered lists', () => {
    const html = renderMarkdown('- one\n- two\n\n1. first\n2. second');
    expect(html).toBe('<ul><li>one</li><li>two</li></ul><ol><li>first</li><li>second</li></ol>');
  });

  it('joins wrapped paragraph lines', () => {
    expect(renderMarkdown('a line\nand its continuation')).toBe('<p>a line and its continuation</p>');
  });
});
