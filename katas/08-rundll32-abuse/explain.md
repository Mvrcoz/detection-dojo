# Allow-list the locations, not the tool

`rundll32.exe` alone is not interesting. What decides whether a command line is dangerous is **where
the DLL lives** and whether the argument is code instead of a file.

- System components name system DLLs (`shell32.dll`, `printui.dll`). They never need a path in a
  user-writable folder.
- `OneDrive` loads `FileSyncShell64.dll` from `AppData\Local`, which is why a plain `\AppData\`
  pattern is noisy. Attackers favor `Roaming`, `Temp` and the public profile.
- Quotes around the path and the export (`,Start` or `,#1` for an ordinal) vary, so match the folder
  and let the rest float.
- `url.dll,FileProtocolHandler https://...` contains a URL but only opens it in the default browser.

ATT&CK T1218.011, "System Binary Proxy Execution: Rundll32".
