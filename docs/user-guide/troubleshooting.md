# Troubleshooting

## Check the installation with the self-test

ParaWerk has a built-in self-test. It starts the geometry kernel, builds a filleted box, compares its
volume with the exact analytic value, exports STEP and checks the 3D graphics, then quits.

| System | Command |
|---|---|
| Windows | `"C:\Users\<you>\AppData\Local\Programs\ParaWerk\ParaWerk.exe" --self-test` |
| macOS | `/Applications/ParaWerk.app/Contents/MacOS/ParaWerk --self-test` |
| Linux (AppImage) | `./ParaWerk-<version>-linux-x86_64.AppImage --self-test` |

The result is printed as JSON; the exit code is `0` when every check passes. The self-test uses a
temporary profile and never changes your settings. The release pipeline runs the same self-test on
every package before it is published.

## The 3D view stays empty or is slow

ParaWerk needs WebGL 2. On machines without a usable GPU driver it falls back to software rendering,
which works but is slow. Update the graphics driver and enable **Settings → Show frame statistics** to
see the frame rate.

## A feature shows a red error

See [When a feature fails](features.md#when-a-feature-fails). The rest of the part stays intact; edit the
feature (for example reduce the fillet radius) or delete it.

## "The geometry kernel was restarted"

The geometry kernel runs in its own worker. If it crashes, ParaWerk restarts it automatically and
rebuilds your part; your document is not affected. Please report the steps that led to the crash in the
[issue tracker](https://github.com/Ujap1994/ParaWerk/issues).

## Known limitations of the preview

- Only box, cylinder, fillet and chamfer; the sketcher arrives in Phase 1.
- Edge references are stored by topological index; editing an early feature can make a later fillet
  lose its edges (shown as an error). Robust references follow in Phase 2
  ([ADR 0002](../adr/0002-persistent-naming.md)).
- Builds are not code-signed yet.
