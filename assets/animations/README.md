# VRMA animations

Drop bundled `.vrma` files here.

Current convention:

- `greet.vrma` is used for the avatar startup greeting when present.
- `Idle1-left-right.vrma`, `idle2-heart.vrma`, `idle3-yawn.vrma`, `idle4-break.vrma`, `idle5-idle-happy.vrma`, and `idle6-penguin.vrma` are picked randomly while the avatar is idle.
- `Idle1-left-right.vrma` is treated as a short loop and repeats for about 6 seconds.
- Idle animations are spaced roughly 50 to 75 seconds apart.
- `dance-left-right.vrma` is part of the normal Spotify dance pool.
- `dance1-doodle.vrma`, `dance2-toothless.vrma`, `dance3-poke.vrma`, `dance4-smug.vrma`, `dance6-dare.vrma`, and `dance7-popular.vrma` are rare Spotify dance styles.
- `dance5-arona.vrma` is a super rare Spotify dance style.
- Spotify picks one dance style per song: usually a procedural dance or `dance-left-right.vrma`, sometimes a rare VRMA loop.
- If a mapped file is missing, the avatar falls back to the existing manual reaction.

To wire another reaction, add it to `vrmaReactionFiles` in `app/renderer/avatar-vrm.js`.
