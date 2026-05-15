# Agent Notes

## Windows Node/NPM Commands

In this workspace, `node`, `npm`, and `npm.cmd` may not be available on the default PowerShell `PATH`, even though Node is installed at `C:\Program Files\nodejs`.

Before running npm, tsx, or local Node binaries, prepend Node's install directory for the current command/session:

```powershell
$env:PATH = 'C:\Program Files\nodejs;' + $env:PATH
```

Use the full npm command path when invoking package scripts:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run typecheck
& 'C:\Program Files\nodejs\npm.cmd' run dev
```

If `npm.cmd run dev` exits unexpectedly under `Start-Process`, run `tsx.cmd` directly or use a PowerShell job for endpoint verification:

```powershell
$env:PATH = 'C:\Program Files\nodejs;' + $env:PATH
& .\node_modules\.bin\tsx.cmd src\index.ts
```
