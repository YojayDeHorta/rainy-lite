# VRMA animations

Drop bundled `.vrma` files here.

Current convention:

- `greet.vrma` is used for the avatar startup greeting when present.
- `idle1.vrma`, `idle2.vrma`, and `idle3.vrma` are picked randomly while the avatar is idle.
- `idle1.vrma` is treated as a short loop and repeats for about 6 seconds.
- If a mapped file is missing, the avatar falls back to the existing manual reaction.

To wire another reaction, add it to `vrmaReactionFiles` in `app/renderer/avatar-vrm.js`.
