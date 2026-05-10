# VRMA animations

Drop bundled `.vrma` files here.

Current convention:

- `greet.vrma` is used for the avatar startup greeting when present.
- If a mapped file is missing, the avatar falls back to the existing manual reaction.

To wire another reaction, add it to `vrmaReactionFiles` in `app/renderer/avatar-vrm.js`.
