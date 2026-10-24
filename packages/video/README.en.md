# @khorsheed/dsh-video-suite

English | [中文](README.md)

A mode for editing podcasts and conversations: one mixed recording is split into each speaker, the transcript is your editing desk, and deleting a sentence deletes that stretch of audio.

Editing a chat among friends used to mean hunting through waveforms for who said what, and cutting filler words and long pauses one by one. In video mode, hand it the recording and it separates the voices and recognizes your regular hosts; the transcript is colored by speaker, and one click cuts a sentence. The agent scans for filler words, pauses and repetition and lists them as a set of suggestions, and nothing changes until you say yes. At the end you export podcast audio, a subtitled video and shownotes.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/suite-video-hero.png" width="640" alt="A video-mode session: a set of edit suggestions from the agent in the chat, and the Studio panel in the right sidebar showing the speaker-colored transcript and player">

## Things you can say to the agent

- "Import this episode, split out the speakers, and check whether they're our two regular hosts."
- "Find the filler words and the repeated bits and give me a set of suggestions."
- "The first ten minutes ramble. How would you cut them?"
- "Export an MP3 and a subtitled MP4, and write the shownotes."

## What's inside

- **Studio**: the "Studio" panel in the right sidebar. Click a sentence to cut it and again to bring it back, with undo if you slip; long pauses get shortened rather than removed; edit while you listen, with the current word highlighted; phone footage lines up with the audio by sound, no clapping needed; each show's intro and outro, subtitle style and voiceprints are saved once and reused every episode.
- **Local Transcription**: turns the recording into text on your own computer and works out who is speaking.
- **Your local coding tools** (Kimi, Codex, Claude Code, plus Local DSH Delegation, off by default): hand them part of the work when there's a lot to do.
- **Room**: bring several agents into one session to work on an episode together.

Exports run in the background, with progress in both the panel and the session: MP3, 1080p MP4 (subtitles burned in or as a track you can switch off), SRT subtitles and the transcript.

## Install

In DSH, open Plugins → Add plugin, enter this package name, and press Install:

```
@khorsheed/dsh-video-suite
```

It's best to also install `@khorsheed/dsh-basic` (Basic Essentials), which carries everyday things like editing messages and previewing files. Then start a new session, pick "剪辑模式" (video mode), and tell the agent where the recording is.

All of this only shows up in video-mode sessions; not seeing it in other modes is expected.

## Known limitations

- It needs ffmpeg on your computer; the first transcription downloads a speech model of about 360 MB.
- In a mixed recording, cutting a stretch cuts everyone speaking in it; multitrack recordings with one mic per person aren't supported yet.
- Media is imported by a path on your computer; dragging files into the browser isn't supported yet.

## Compatibility

Needs DSH 0.1.7 or later; verified on 0.2.1.

## For developers

Command-line install (same result as above):

<!-- collection:start -->
Recommended: install it together with the basic suite (the Video collection, one command):

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-video-suite
```
<!-- collection:end -->

- This package has no features of its own; it installs video mode and the members above together. Uninstalling (`dsh plugin --profile web remove @khorsheed/dsh-video-suite`) removes them together too; to turn off just one, switch it off on the suite's detail page.
- Each member's details are in its own README: [packages/](https://github.com/Khorsheed/dsh-plugins/tree/main/packages).
- Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins); open issues and contributions there. Changes: [CHANGELOG.md](CHANGELOG.md).
