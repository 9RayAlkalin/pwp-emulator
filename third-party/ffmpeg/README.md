# FFmpeg.wasm notices

The application's original code is released under its existing Unlicense. These separately bundled third-party components retain their own licenses:

| Package | Version | Declared package license |
| --- | --- | --- |
| `@ffmpeg/ffmpeg` | 0.12.15 | MIT |
| `@ffmpeg/core` | 0.12.10 | GPL-2.0-or-later |
| `@ffmpeg/core-mt` | 0.12.10 | GPL-2.0-or-later |

`LICENSE-MIT` and `LICENSE-GPL` preserve the respective license texts. The core includes FFmpeg and its enabled codec libraries; it is not relicensed under the application's Unlicense.

Upstream source and build recipes: https://github.com/ffmpegwasm/ffmpeg.wasm . The `@ffmpeg/core-mt@0.12.10` published metadata records source commit `63ea4ccb6c58e127cc1767f88c508371936178c2` in that repository. Package versions and integrity digests are pinned in `pnpm-lock.yaml`; upstream release information and source build configuration should be retained when redistributing the core.

The JavaScript and Wasm binaries are copied unchanged from the installed packages during the build. These notices are copied to `dist/third-party/ffmpeg/` alongside the deployment.
