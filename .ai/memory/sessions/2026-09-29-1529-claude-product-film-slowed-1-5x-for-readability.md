# Product film slowed 1.5x for readability

- **Fecha**: 2026-09-29 15:29
- **Agente**: claude
- **Rama**: claude/youthful-ramanujan-uu6y6t @ 8454cc4

Product film v2: owner said v1 was too fast to read. Added a global slow-down (FILM_SLOW=1.5): audio grid 80 BPM, scene time = t/K, cues divided by K. Loop frame 0 == last frame verified (diff 0).

## Retro
- Worked: closed-form scene + measured audio cues made a global retime a 5-line change.
- Failed: a long foreground wait got the render killed (exit 137); run renders detached with setsid and poll.
- Improve: expose per-scene dwell times instead of one global factor.
