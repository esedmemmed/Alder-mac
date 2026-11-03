# Testing Alder on your TV

The first run on a real TV is how we learn what a Samsung TV really does, and Alder was built without one. This is a
checklist of ten things to try. Tick what works. For anything that does not, **take the photos listed under it** and send them.
You need the TV remote and your phone (to photograph the screen).

## Before you start

- Install `Alder.wgt` as in [SETUP.md](SETUP.md), open Alder and sign in.
- Have a movie that plays fine in Stremio on your phone, a TV series, and, if you can, a 4K HDR movie.
- Have the phone ready to take photos of the TV.

## How to open Diagnostics (and how to photograph it)

Diagnostics is Alder's black box. It lists what the TV reported about the video and sound, what Alder decided and why, and the
last 200 lines of what the app did.

1. On Home press **Up** to the top bar, move **Left** to your round **profile** picture, press **OK**, choose **Settings**.
2. Press **Down** to **About** in the list on the left, press **Right**, go **Down** to **Diagnostics**, press **OK**.
   (Shortcut: in About, hold **OK** on the **Version** line.)
3. Photograph the screen. Press **Right** to go one page down and photograph again. Keep going until you reach the end
   (the line at the bottom shows how far you are). Usually 3 photos are enough. **Up** and **Down** scroll by a few lines,
   **OK** jumps to the top or the end, **Back** closes it.
4. **Do this right after the problem, before you play anything else and before you close Alder.** It only remembers the last
   stream and the last 200 log lines, and everything is cleared when Alder closes.

Photograph the whole screen straight on, with the room lights dim, so the text is readable. Never mind glare: take two.

If Alder will not even start, photograph the TV screen as it is, and say what you pressed last.

---

## The checklist

### 1. It starts quickly, you can sign in, you can make a profile

- [ ] Alder opens in under about 5 seconds.
- [ ] You can name a profile, a QR code and a code appear, you sign in with your phone, and Home opens.

If not, photograph: the screen where it stopped. If it showed an error message, photograph that.

### 2. Home loads and the remote feels instant

- [ ] The Continue Watching and other rows appear with pictures.
- [ ] Moving with the arrow keys feels immediate, with no lag.
- [ ] **Back** on Home leaves Alder cleanly (back to the TV's Apps), and opening it again works.

If something is slow or empty, photograph: the screen, then Diagnostics (page 1 and the last page).

### 3. A normal film plays: a 1080p WEB-DL with Dolby Digital Plus sound

- [ ] Choose the film, press **Play** (or **Resume**).
- [ ] Picture and sound start within about 8 seconds.

If it fails, photograph: Diagnostics, all pages. Also say how long you waited and what the screen said ("Starting", "That
source failed", and so on).

### 4. A 4K HDR10 film

- [ ] It plays in 4K, and the TV shows its HDR label when playback starts (many Samsung TVs show a small "HDR" note; if
      yours does not, skip this point and say so).
- [ ] The sound is fine.

Photograph in any case: Diagnostics page 1 (it lists the video as the TV reported it), plus the TV's picture-info screen
if your remote has an Info button.

### 5. A title whose best-looking sources have DTS or TrueHD sound only

- [ ] Hold **OK** on **Play** to see the list of sources. DTS or TrueHD releases sit at the bottom, tagged **No sound on
      this TV**.
- [ ] Back out and press **Play**: Alder starts a source that has sound, and you hear it.

Photograph: the sources list (the whole screen), and Diagnostics, the stream section (it names the file that is playing: it
should not say DTS or TrueHD).

### 6. A file with several sound tracks (for example DTS and Dolby Digital in one file)

- [ ] It plays with sound. Alder picks the Dolby Digital track by itself.
- [ ] While it plays press **OK** (this pauses and shows the controls), press **Left** twice to the **Audio & subtitles**
      button, press **OK**: the DTS track is greyed with **No sound on this TV** and the Dolby Digital one is ticked.

Photograph: the Audio & subtitles panel, and Diagnostics (the "audio decisions" part has the choice and the reason).
This is also the one that tells us the exact shape of the TV's track information: photograph all pages.

### 7. A stream that breaks in the middle

- [ ] While a film is playing, switch off the router (or take the TV's network cable out) for about 5 seconds, then switch
      it on again. The picture waits, then plays on from the same place.
- [ ] If you keep the network off for more than about half a minute, Alder tries the next source at the same second, or
      shows the sources list with a message.

If the picture is stuck for good, photograph: the screen, then Diagnostics (last page: the log shows what it tried).

### 8. Your progress reaches Stremio

- [ ] Watch a few minutes of a film, then press **Back** until you are on Home.
- [ ] Within about a minute, the same title shows in **Continue Watching** in Stremio on your phone, at about the same point.
- [ ] Open it in Alder again: it resumes where you stopped.

Photograph: Home with the title in Continue Watching (shows the "Stopped at" time), and the Stremio screen on the phone.

### 9. A series: the next episode

- [ ] Play an episode and let it run to the credits, or press **OK**, **Up** to the bar, and hold **Right** to move quickly
      towards the end.
- [ ] An **Up next** card appears. **Play now** starts the next episode.
- [ ] In Stremio on your phone the watched episode is ticked.

Photograph: the Up next card, and the screen when the next episode starts (or fails to).

### 10. Subtitles

- [ ] While a film plays press **OK**, press **Left** twice to **Audio & subtitles**, press **OK**, and choose an English
      subtitle from the list. It shows on the picture, and the text is readable.
- [ ] Use **Subtitle timing** to move it later or earlier: the text shifts.

If subtitles do not show, photograph: the panel, and Diagnostics (log part).

---

## When something fails

Send:
1. A short note: which number on the list, what you pressed, what you expected, what happened, and how long you waited.
2. **Diagnostics photos**, all pages, taken straight after the problem (see "How to open Diagnostics").
3. A photo of the screen as it looked when it went wrong.
4. For picture or HDR problems: the model of the TV (it is on a sticker at the back, for example UE55TU8000) and, if
   you know it, the TV's software version (Settings, Support, About This TV).

Then the problem goes to a fix, and you get a new `Alder.wgt` to install the way you did the first one.
