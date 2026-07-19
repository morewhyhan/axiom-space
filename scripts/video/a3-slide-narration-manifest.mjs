import { A3_STORY } from '../../local-tests/a3-golden-video-card/story.js'

// Match the slower, lower-pitched voice used by the existing video narration.
export const A3_NARRATION_VOICE = 'zh-CN-XiaoxiaoNeural'

export const A3_NARRATION_RATE = '-4%'

export const A3_NARRATION_PITCH = '-2Hz'

export const A3_NARRATION_VOLUME = '+0%'

export const A3_SLIDE_NARRATIONS = A3_STORY.map((item) => ({
  id: item.id,
  scene: item.scene,
  kind: item.kind,
  fileName: `scene-${item.scene}-${item.kind}.mp3`,
  text: item.narration,
}))
