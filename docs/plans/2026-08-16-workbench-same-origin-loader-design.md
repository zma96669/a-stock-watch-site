# Same-origin background loader

## Problem

VS Code 1.133 loads the injected `file://` background loader inconsistently. The local quote bridge is healthy, but the renderer does not mount the canvas.

## Decision

Install the generated loader alongside the active `workbench.html` and reference it with a relative script URL. This makes the loader same-origin with the VS Code workbench. The Content Security Policy only needs to permit the loopback bridge connection.

## Lifecycle

The installer records the copied loader path in its metadata. Disabling or repairing restores the workbench backup and removes that exact copied loader. Reinstalling replaces the loader through the existing write flow.

## Verification

Unit tests ensure the CSP grants the loopback connection without broadening script sources. Type checking, tests, packaging, and an installed-extension runtime probe verify the release.
