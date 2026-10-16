# Why this rule works

`certutil.exe` is a legitimate certificate tool, so alerting on the process name
alone would fire on every certificate job. The reliable signal is the switch
that makes it download: `-urlcache` together with a URL.

- Matching `OriginalFileName` as well as `Image` survives a renamed copy.
- Accepting `/urlcache` as well as `-urlcache` survives the slash-style switches
  that Windows tools also understand.
- Requiring a URL scheme keeps the cache-cleanup command (`-urlcache * delete`)
  quiet.
