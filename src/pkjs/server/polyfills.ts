const _global: any =
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof self !== 'undefined'
      ? self
      : typeof window !== 'undefined'
        ? window
        : {};

if (typeof _global.fetch === 'undefined') {
  _global.fetch = function (
    url: string,
    options?: { method?: string; headers?: Record<string, string> },
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(options?.method || 'GET', url, true);
      if (options?.headers) {
        for (const k of Object.keys(options.headers)) {
          xhr.setRequestHeader(k, options.headers[k]);
        }
      }
      xhr.responseType = 'arraybuffer';
      xhr.timeout = 20000;
      xhr.ontimeout = () => {
        console.error('fetch polyfill');
        return reject(new Error('fetch polyfill: timeout'));
      };
      xhr.onload = function () {
        resolve({
          ok: xhr.status >= 200 && xhr.status < 300,
          status: xhr.status,
          arrayBuffer: () => Promise.resolve(xhr.response),
          json: () => {
            const view = new Uint8Array(xhr.response);
            let text = '';
            for (let i = 0; i < view.length; i++) text += String.fromCharCode(view[i]);
            return Promise.resolve(JSON.parse(text));
          },
        });
      };
      xhr.onerror = () => {
        console.error('fetch polyfill');
        return reject(new Error('fetch polyfill: network error'));
      };
      xhr.send();
    });
  };
}

if (typeof btoa === 'undefined') {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  (globalThis as any).btoa = function (s: string) {
    let out = '';
    for (let i = 0; i < s.length; i += 3) {
      const a = s.charCodeAt(i),
        b = s.charCodeAt(i + 1) || 0,
        c = s.charCodeAt(i + 2) || 0;
      out +=
        chars[a >> 2] +
        chars[((a & 3) << 4) | (b >> 4)] +
        chars[((b & 15) << 2) | (c >> 6)] +
        chars[c & 63];
    }
    const m = s.length % 3;
    return m ? out.slice(0, m - 3 || undefined) + (m === 1 ? '==' : '=') : out;
  };
  (globalThis as any).atob = function (s: string) {
    s = s.replace(/=+$/, '');
    let out = '';
    for (let i = 0; i < s.length; i += 4) {
      const a = chars.indexOf(s[i]),
        b = chars.indexOf(s[i + 1]),
        c = chars.indexOf(s[i + 2]),
        d = chars.indexOf(s[i + 3]);
      out += String.fromCharCode((a << 2) | (b >> 4));
      if (c >= 0) out += String.fromCharCode(((b & 15) << 4) | (c >> 2));
      if (d >= 0) out += String.fromCharCode(((c & 3) << 6) | d);
    }
    return out;
  };
}
