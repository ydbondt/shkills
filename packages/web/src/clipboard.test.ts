import { describe, expect, it } from 'vitest';
import { copyText, type CopyEnv } from './clipboard';

/**
 * A stand-in for just enough of the DOM to copy a string. The real thing is not
 * available here — and the bug being pinned down is precisely that the *real*
 * environment does not always offer what the code assumed it would.
 */
function fakeEnv(options: {
  clipboard?: { writeText: (text: string) => Promise<void> };
  execCommand?: (command: string) => boolean;
}): CopyEnv & { copied: string[]; nodes: unknown[] } {
  const copied: string[] = [];
  const nodes: unknown[] = [];
  const body = {
    appendChild(node: unknown) {
      nodes.push(node);
    },
    removeChild(node: unknown) {
      const at = nodes.indexOf(node);
      if (at >= 0) nodes.splice(at, 1);
    },
  };
  return {
    copied,
    nodes,
    clipboard: options.clipboard,
    document: {
      body: body as unknown as HTMLElement,
      createElement: () =>
        ({
          value: '',
          style: {} as CSSStyleDeclaration,
          setAttribute() {},
          focus() {},
          select() {
            copied.push((this as { value: string }).value);
          },
          setSelectionRange() {},
        }) as unknown as HTMLTextAreaElement,
      execCommand:
        options.execCommand ??
        (() => {
          throw new Error('execCommand is not implemented');
        }),
    },
  };
}

describe('copying text', () => {
  it('uses the clipboard API when the browser offers one', async () => {
    const written: string[] = [];
    const env = fakeEnv({
      clipboard: {
        writeText: async (text) => {
          written.push(text);
        },
      },
    });
    expect(await copyText('curl -fsSL http://shkills.test/install.sh | sh', env)).toBe(true);
    expect(written).toEqual(['curl -fsSL http://shkills.test/install.sh | sh']);
    expect(env.copied).toEqual([]);
  });

  /**
   * The bug this whole module exists for. `navigator.clipboard` is undefined
   * outside a secure context, so on a plain-HTTP deployment — which is every
   * LAN install of this thing — the old one-liner threw a TypeError into an
   * empty catch and the button did nothing, for ever, with no way to tell.
   */
  it('still copies when there is no clipboard API at all', async () => {
    const env = fakeEnv({ clipboard: undefined, execCommand: () => true });
    expect(await copyText('hello', env)).toBe(true);
    expect(env.copied).toEqual(['hello']);
  });

  it('falls back when the clipboard API exists but refuses', async () => {
    const env = fakeEnv({
      clipboard: { writeText: async () => Promise.reject(new Error('denied')) },
      execCommand: () => true,
    });
    expect(await copyText('hello', env)).toBe(true);
    expect(env.copied).toEqual(['hello']);
  });

  it('reports failure rather than pretending, when nothing works', async () => {
    const env = fakeEnv({ clipboard: undefined, execCommand: () => false });
    expect(await copyText('hello', env)).toBe(false);
  });

  it('does not throw when the fallback itself throws', async () => {
    const env = fakeEnv({
      clipboard: undefined,
      execCommand: () => {
        throw new Error('nope');
      },
    });
    expect(await copyText('hello', env)).toBe(false);
  });

  it('never leaves its scratch element behind', async () => {
    for (const execCommand of [() => true, () => false]) {
      const env = fakeEnv({ clipboard: undefined, execCommand });
      await copyText('hello', env);
      expect(env.nodes).toEqual([]);
    }
  });
});
