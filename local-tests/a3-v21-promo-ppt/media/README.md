# 连续演示母片

把最终一镜到底录屏放在本目录，并命名为：

`axiom-one-take.mp4`

页面会自动读取 `./media/axiom-one-take.mp4`。整套 PPT 只使用这一个视频元素；第 04—16 页通过 `data-video-time` 对齐母片时间点，并在翻页时连续改变同一画面的位置、尺寸与裁切。

建议编码：H.264 MP4、16:9、关键帧间隔约 1—2 秒。母片重新剪辑后，只需同步调整 `index.html` 各页的 `data-video-time`。
