/**
 * Minimal Chrome DevTools Protocol client over WebSocket (Node ≥ 22, global WebSocket).
 * Talks to a Chrome started with --remote-debugging-port (see chrome.mjs).
 */
export const PORT = Number(process.env.STORE_CDP_PORT || 9333);

export async function listTargets(port = PORT) {
  return (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
}

export async function connect(port = PORT) {
  let info;
  try {
    info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  } catch {
    throw new Error(`No Chrome on port ${port}. Start it with: node scripts/store/chrome.mjs start`);
  }
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('WebSocket connection to Chrome failed'));
  });
  let nextId = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(`${msg.error.message} (${msg.error.data || ''})`)) : res(msg.result);
    } else {
      for (const fn of listeners) fn(msg);
    }
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((res, rej) => {
      const id = ++nextId;
      pending.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

  /** Attach to a page target and return helpers bound to its session. */
  async function page(targetId) {
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, sessionId);
    await send('Runtime.enable', {}, sessionId);
    const call = (method, params) => send(method, params, sessionId);
    const evaluate = async (expression, { awaitPromise = true } = {}) => {
      const { result, exceptionDetails } = await call('Runtime.evaluate', {
        expression, returnByValue: true, awaitPromise
      });
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
      return result.value;
    };
    const waitForEvent = (name, timeout = 20000) =>
      new Promise((res) => {
        const t = setTimeout(() => { listeners.delete(fn); res(false); }, timeout);
        const fn = (msg) => {
          if (msg.sessionId === sessionId && msg.method === name) {
            clearTimeout(t); listeners.delete(fn); res(true);
          }
        };
        listeners.add(fn);
      });
    return { sessionId, call, evaluate, waitForEvent };
  }

  return { send, page, info, close: () => ws.close(), on: (fn) => listeners.add(fn) };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
