# VRMA animations

Drop bundled `.vrma` files here.

Current convention:

- `greet.vrma` is used for the avatar startup greeting when present.
- `Idle1-left-right.vrma`, `idle2-heart.vrma`, and `idle3-yawn.vrma` are picked randomly while the avatar is idle.
- `Idle1-left-right.vrma` is treated as a short loop and repeats for about 6 seconds.
- Idle animations are spaced roughly 50 to 75 seconds apart.
- If a mapped file is missing, the avatar falls back to the existing manual reaction.

To wire another reaction, add it to `vrmaReactionFiles` in `app/renderer/avatar-vrm.js`.
