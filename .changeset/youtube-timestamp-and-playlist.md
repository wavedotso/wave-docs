---
'@waveso/docs': patch
---

**A YouTube link's timestamp and playlist are no longer dropped.** Only the video id survived the substitution, so `https://youtu.be/x?t=754` — a link to one moment in a two-hour talk, which is most of why anyone deep-links a video — opened at zero. And because the facade passes `autoplay=1`, it did not merely start in the wrong place: it started *playing* there, leaving the reader to work out that the author had meant somewhere else.

Every spelling YouTube's own share dialog produces is understood — `t=754`, `t=90s`, `t=1m30s`, `t=1h2m3s`, the older `#t=` fragment, and `start=` on an embed URL — along with `list=`.

Both go into a URL, so both are checked: a playlist id has to look like one, a timestamp has to parse to a positive number of seconds, and the embed URL is built with `URLSearchParams` rather than by concatenation. Hand-built, a crafted `list=x%26autoplay%3D0` would have decoded into a real `&autoplay=0` and silently turned off the one interaction the facade exists to own.

`YouTube` takes `start` and `list` props to match. `parseYouTubeId` is now `parseYouTubeRef` and returns the whole reference; it is private, so nothing outside the package moves.
