# Where, what, and who

Three conditions, each removing a class of false alarm:

- **Where**: the web root. Logs live under `\inetpub\logs\`, ASP.NET's compilation cache under
  `Temporary ASP.NET Files`. Neither is in `wwwroot`.
- **What**: script extensions only, matched at the **end** of the name (`endswith`). A compiled
  cache file such as `App_Web_default.aspx.cdcab7d2.dll` contains ".aspx" but ends in ".dll".
- **Who**: the web server writing its own pages is exactly what you want to see, so only the
  deployment tool is excluded, by **full path**.

Extension matching is case-insensitive, so `SHELL.ASPX` is the same finding. The strongest signal
of all is `w3wp.exe` itself creating a script: a web server should not rewrite its own application.

ATT&CK T1505.003, "Server Software Component: Web Shell".
