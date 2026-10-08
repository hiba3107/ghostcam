# GhostCam

A privacy camera for video calls. It runs in the browser on your own machine,
and no video is uploaded anywhere.

The idea it is built around is that the face you usually want to hide is not
your own. It is the housemate walking behind you, or the stranger at the next
table. So GhostCam learns which face is yours, and hides everyone else.

## What it does

**Hides other people, not you.** Press "This is me" once with your face in the
middle of the frame. After that, any other face that appears is blurred,
pixelated or blocked out, while you stay visible.

**Vanish.** Hold up one finger on each hand and you disappear, with the room
showing through where you were. It needs a picture of the empty room first,
because the camera cannot see through you. Press "Save the empty room" while
you are out of shot.

**Draw with your finger.** Point one finger at the camera and move it. Four
colours, and a button to rub it out.

**An emoji on your face.** Pick one and it sticks to your face, follows it and
tilts when you tilt your head. There is a "Blur me" option instead if you
would rather not be seen at all.

**Hide screens and papers.** A phone, laptop, book or monitor held up to the
camera gets blurred on its own.

**Focus area.** Click four corners and everything outside that region is
blurred and dimmed, so you can show a document without showing the room.

**Panic hide.** One key, or an open palm held up to the camera, blurs the
whole frame instantly.

**Record.** Saves what the app is showing as a video file.

## Hand signals and keys

| Signal | Action |
|---|---|
| One finger pointed at the camera | Draw |
| One finger on each hand | Vanish |
| Open palm | Hide everything |

| Key | Action |
|---|---|
| M | This is me |
| P | Hide everything |
| V | Record |
| C | Rub out the drawing |

## The part worth reading the code for

The whole privacy model depends on knowing which face is yours. If the app
loses track of that, it does not guess. It reports the uncertainty and hides
every face in the frame, including yours, until it is confident again.

That matters because the two ways this can fail are not equal. Failing to
recognise you is annoying and you press one button. Wrongly deciding a
stranger is you exposes the exact face the tool exists to hide. So the code
takes the annoying failure over the dangerous one, every time.

Faces are tracked by position between frames, which means stepping out of shot
and coming back gives you a new tracking id. Left alone that would blur your
own face permanently after you leaned out of frame once. So the tracker
remembers where the owner was last seen and how large their face was, and can
hand the identity back to a returning face. The reclaim is deliberately
narrow: the returning face has to appear near where the owner left, at a
similar size, within a limited window. Anything less certain is refused and
you press the button again.

Every model loads in its own try/catch, so one download failing costs the
feature that needs it rather than the whole app. If the background model does
not load, Vanish is greyed out and everything else still works.

## Running it

Open `index.html` with Live Server in VS Code. It has to be served over http,
not opened by double clicking, because browsers block the camera and module
imports on `file://`.

The first run downloads the models from a CDN, so you need to be online once.

## Tests

```
npm install playwright
node test.mjs
node degrade.mjs
```

`test.mjs` runs 40 checks in a real browser. Most of them are on the identity
logic, including the cases that must be refused: a stranger appearing far from
where the owner left, a very differently sized face in roughly the right
place, and a face returning after the memory window has closed. It also checks
that every control renders and that nothing throws when clicked before a
camera exists, which is how I found that pressing Record with the camera off
used to start recording an empty canvas.

`degrade.mjs` breaks the model downloads on purpose and checks that the page
explains what went wrong and offers a retry, rather than sitting on a blank
screen.

## Limitations

Identity is by position and size, not face recognition. Two people of similar
build swapping places quickly can confuse it, which is why losing confidence
falls back to hiding everyone rather than guessing.

Tested against synthetic geometry rather than a labelled dataset, so there are
no accuracy numbers yet. Measuring how often the owner is lost during normal
movement, and how often a stranger gets through, is the next thing worth
doing.

Screen detection runs every eighth frame and hands every third frame, to keep
the frame rate up, so there is a short lag before a phone gets blurred.

Not a security product. It is a convenience tool for ordinary video calls, and
should not be relied on where a privacy failure would genuinely matter.

## Built with

JavaScript, MediaPipe Tasks Vision, and the canvas API. One file, no build
step, no dependencies to install for the app itself.
