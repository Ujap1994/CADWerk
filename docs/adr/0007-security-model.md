# 0007 – Electron security model

**Status:** accepted.

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`; no
  `<webview>`; new windows and navigation away from the app are blocked; all permission requests
  (camera, location, ...) are denied.
- The renderer is served from a custom `app://parawerk` protocol with path-traversal protection, a
  strict content security policy and cross-origin isolation headers.
- The preload script exposes one small, typed API (`window.parawerk`); every IPC handler checks that
  the sender is the app's own page and validates its input.
- The renderer cannot write arbitrary files: "Save" without a dialog is only allowed for paths the user
  picked in a dialog or opened before.
- External links open in the browser only for an allowlist of HTTPS hosts.
- Exception: the geometry kernel worker needs `'unsafe-eval'` (see ADR 0001); it never evaluates
  document data. A custom kernel build removes the exception.
- Single instance: a second start focuses the existing window and forwards files to open.
