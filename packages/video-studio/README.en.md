# @khorsheed/dsh-video-studio

English | [中文](README.md)

Edit podcasts and conversations: your recording becomes a transcript, deleting a sentence cuts that bit of audio, and the agent finds the ums and long pauses for you.

A few friends talk for an hour around one recorder, and editing it used to mean staring at waveforms to work out who's speaking and slicing out filler words one by one. With this plugin you hand over the recording; it turns it into a transcript and works out who is who. You click a sentence in the transcript to cut it, talk over what else to cut with the agent in the session, and nothing it finds is cut until you agree. At the end you export the finished audio, a video with subtitles, and a subtitle file.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/video-studio-transcript.png" width="640" alt="The transcript in the right sidebar's Studio panel: paragraphs colored by speaker, cuts struck through, pending suggestions dashed, the player at the bottom">

## What it does

- **Tells voices apart in one mixed recording**: everyone on one mic is fine; it separates the voices, and once you name a new voice, the same show recognizes it next time.
- **Delete words to cut audio**: click a sentence to cut it, click again to bring it back; your original recording is never touched.
- **It finds the rambling for you**: the agent collects filler words, long pauses and repeats into a set, and nothing changes until you press "Accept"; long pauses get shortened, not cut out completely.
- **Listen while you edit**: the player plays either the "Edited" cut or the "Original", highlighting the sentence it's on; fix mistranscribed words in place, which changes the text and subtitles but not the sound.
- **Have the agent go over it**: press "Agent assist" and it writes a request into the session's input box; add what you most want fixed and send. Its changes still wait for your OK.
- **Export in one go**: tick podcast audio, full video, subtitles or transcript, whichever you need; for shownotes, just ask the agent to write them in the session.
- **The show remembers your habits**: intro and outro, loudness, subtitle style and your regulars' voices are saved with the show, so each new episode starts from them.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/video-studio-proposals.png" width="640" alt="A set of pending suggestions in the transcript, filler words and long pauses, each with Accept and Reject">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/video-studio-speakers.png" width="640" alt="Telling speakers apart: one row per voice, recognized ones named, new ones with ▶ to listen before naming">

## Install

In DSH, open Plugins → Add plugin, enter this package name, and press Install:

```
@khorsheed/dsh-video-suite
```

The studio comes with the Video Editing Suite. Then start a new session, pick "Editing mode", and tell the agent where your recording is.

The Studio panel only appears in Editing-mode sessions; not seeing it in other modes is expected.

## Known limitations

- In a mixed recording, cutting a stretch cuts everyone in it; you can't cut just one person.
- You can't drag a recording in to upload it; pick a folder or give a path on this computer.
- It needs `ffmpeg` on this computer, and the first transcription downloads about 360 MB of speech models first.

## Compatibility

Needs DSH 0.1.5 or later; verified on 0.2.1.

## For developers

- Entry points: `src/index.ts` (service), `src/client/` (sidebar), `src/tool.ts` (the agent's tools and skill).
- You can install this package alone (`dsh plugin --profile web add @khorsheed/dsh-video-studio`), but its tools must be granted by a mode, so on its own the sidebar does not appear; speaker separation and transcription also need [Local Transcription](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/transcribe/README.en.md).
- Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins); open issues and contributions there. Changes: [CHANGELOG.md](CHANGELOG.md).
