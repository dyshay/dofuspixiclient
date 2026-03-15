import { System, system } from "@lastolivegames/becsy";
import { Sprite } from "pixi.js";

import { ActorTag, FrameTime, SpriteState } from "@/ecs/components";

@system
export class SpriteAnimationSystem extends System {
  private actors = this.query(
    (q) => q.current.with(ActorTag).read.with(SpriteState).write
  );
  private frameTime = this.singleton.read(FrameTime);

  execute(): void {
    const deltaS = this.frameTime.data.deltaMs / 1000;
    if (deltaS <= 0) return;

    for (const entity of this.actors.current) {
      const state = entity.write(SpriteState);
      if (!state.container || !state.currentAnimData) continue;

      const anim = state.currentAnimData;
      if (anim.textures.length <= 1) continue;

      state.frameTimer += deltaS;

      const frameDuration = 1 / anim.fps;
      if (state.frameTimer >= frameDuration) {
        state.frameTimer -= frameDuration;
        state.frameIndex = (state.frameIndex + 1) % anim.textures.length;

        // Find the sprite in the container and update its texture
        for (const child of state.container.children) {
          if (child instanceof Sprite) {
            child.texture = anim.textures[state.frameIndex];
            break;
          }
        }
      }
    }
  }
}
