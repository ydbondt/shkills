/**
 * Copying a string to the clipboard, in a browser that may not let you.
 *
 * `navigator.clipboard` only exists in a *secure context*: https, or localhost.
 * A Shkills server on a LAN is neither, so on the deployment this was written
 * for the property is simply `undefined` — and `navigator.clipboard.writeText`
 * throws a TypeError before it ever asks for permission. The older
 * `document.execCommand('copy')` has no such requirement, which makes it the
 * fallback rather than the legacy path here.
 *
 * The environment is a parameter so this can be tested without a DOM, and so a
 * caller can be told the truth when neither route works.
 */

export interface CopyEnv {
  clipboard?: { writeText: (text: string) => Promise<void> };
  document: {
    body: HTMLElement;
    createElement: (tag: string) => HTMLTextAreaElement;
    execCommand: (command: string) => boolean;
  };
}

export function browserEnv(): CopyEnv {
  return {
    clipboard: navigator.clipboard,
    document: document as unknown as CopyEnv['document'],
  };
}

export async function copyText(text: string, env: CopyEnv = browserEnv()): Promise<boolean> {
  if (env.clipboard?.writeText) {
    try {
      await env.clipboard.writeText(text);
      return true;
    } catch {
      // Present but refused — permissions policy, or no user gesture. Fall through.
    }
  }
  return selectionCopy(text, env);
}

/**
 * Put the text in an off-screen textarea, select it, and ask the document to
 * copy the selection. Kept out of sight and out of the layout, so the page
 * neither jumps nor scrolls while it happens.
 */
function selectionCopy(text: string, env: CopyEnv): boolean {
  let area: HTMLTextAreaElement | null = null;
  try {
    area = env.document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.setAttribute('aria-hidden', 'true');
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.left = '0';
    area.style.width = '1px';
    area.style.height = '1px';
    area.style.padding = '0';
    area.style.border = 'none';
    area.style.opacity = '0';
    env.document.body.appendChild(area);
    area.focus();
    area.select();
    // iOS Safari ignores select() on a readonly field without an explicit range.
    area.setSelectionRange(0, text.length);
    return env.document.execCommand('copy') === true;
  } catch {
    return false;
  } finally {
    if (area) {
      try {
        env.document.body.removeChild(area);
      } catch {
        // Already gone; nothing to clean up.
      }
    }
  }
}
