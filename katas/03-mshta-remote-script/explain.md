# Where does the code come from?

The tool is the same in every event; the **source of the script** is what separates an installer from
an attack. A local path such as `C:\Program Files\Vendor\setup.hta` is how real software uses mshta.
A URL, a UNC share or an inline `vbscript:`/`javascript:` string means the code arrives from somewhere
else.

- Several benign events here contain URLs or `.hta` names but are **not** mshta (a browser, curl,
  Explorer). Keying on the image keeps them quiet.
- In Sigma a literal backslash in a value needs care: `'\\\\'` (four characters) matches the two
  backslashes that start a UNC path.
- Renamed copies keep `OriginalFileName: MSHTA.EXE`.

ATT&CK T1218.005, "System Binary Proxy Execution: Mshta".
