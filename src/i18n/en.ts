import type { Dictionary } from './index';

/**
 * English dictionary.
 *
 * Illusion names follow the established English terminology rather than a
 * literal translation of the Japanese (§5.5). Getting these wrong would be a
 * factual error in an educational exhibit, not just an awkward phrasing.
 */
export const en: Dictionary = {
  meta: {
    title: 'Optical Illusion Museum',
    description:
      'A browser-based 3D museum of optical illusions. Walk, stand still, and then find out why.',
    enter: 'Enter',
    loading: 'Loading',
  },
  ui: {
    hintButton: 'Show hint',
    revealButton: 'Show me why',
    closeButton: 'Put it back',
    standHere: 'View from here',
    leaveView: 'Leave this viewpoint',
    list: 'Exhibits',
    settings: 'Settings',
    back: 'Back',
    close: 'Close',
    appearanceHeading: 'What you see',
    explanationHeading: 'Why you see it',
    referenceHeading: 'Name and source',
    hintHiddenNotice: 'Hints stay hidden. Look with your own eyes first.',
    warpTo: 'Go to this exhibit',
    darkRoomAhead: 'It is dark ahead. Give your eyes a moment to adjust.',
    screenshotNotice: 'This exhibit does not survive a screenshot.',
    orientationTitle: 'Please turn your device sideways',
    orientationBody:
      'Landscape gives the exhibits more room. You can keep browsing in portrait if you prefer.',
    audioEnable: 'Enable sound',
    dialTurn: 'Turn the dial',
    entranceTitle: 'Optical Illusion Museum',
    entranceBody:
      'Stand on a glowing circle on the floor and you will be moved to the viewpoint where that exhibit works.\nHints stay hidden. Look with your own eyes first.',
    collapseHint: 'Collapse',
    expandHint: 'Expand',
    padMoveLabel: 'Move: drag the lower-left of the screen',
    padLookLabel: 'Look: drag the right of the screen',
    brightnessNotice: 'Please turn off automatic screen brightness.',
  },
  controls: {
    heading: 'Controls',
    move: 'Move',
    look: 'Look',
    interact: 'Select',
    hint: 'Hint',
    reveal: 'Show me why',
    list: 'Exhibits',
    settings: 'Settings',
    cursor: 'Free the cursor',
    leaveView: 'Leave this viewpoint',
    close: 'Close',
    moveKeys: 'W A S D / arrow keys (hold Shift to walk faster)',
    lookKeys: 'Mouse. Click the view to look around, press Esc to get the cursor back',
    actionKeys: 'F select / H hint / R show me why / Tab exhibits / O settings',
    touchMove: 'Drag on the left half of the screen',
    touchLook: 'Drag on the right half of the screen',
    clickToLook: 'Click the view to look around again',
  },
  rooms: {
    entrance: 'Entrance',
    plane: 'Illusions on a Flat Surface',
    impossible: 'Impossible Solids',
    space: 'Space and the Body',
    opus: 'The Opus Wing: Illusions That Cannot Be Photographed',
  },
  settings: {
    title: 'Settings',
    fov: 'Field of view',
    mouseSensitivity: 'Mouse sensitivity',
    touchSensitivity: 'Touch sensitivity',
    invertY: 'Invert vertical look',
    headBob: 'Head bob while walking',
    quality: 'Quality',
    qualityAuto: 'Auto',
    qualityLow: 'Low',
    qualityMid: 'Medium',
    qualityHigh: 'High',
    reducedMotion: 'Reduce motion',
    shrinkingRoom: 'The Shrinking Room effect',
    muted: 'Mute',
    close: 'Close',
    language: 'Language',
  },
  exhibits: {
    cafeWall: {
      title: 'Café Wall illusion',
      appearance:
        'The rows of black and white tiles tilt, one way and then the other. Every row is exactly horizontal.',
      explanation:
        'A thin line of mid-grey mortar runs across the boundary between each light and dark tile. Early stages of the visual system register those boundaries as short tilted segments, and those tilts are summed into a judgement about the whole row. Remove the mortar and the tilt vanishes at once. What is tilted is not the line but your estimate of it.',
      reference:
        'Café Wall illusion. Named by Richard Gregory in 1979 after a café wall in Bristol; a rediscovery of Münsterberg’s shifted chequerboard (1897).',
      caption: 'The brightness of the mortar is what creates the tilt.',
    },
    muellerLyer: {
      title: 'Müller-Lyer illusion',
      appearance:
        'Of the two horizontal lines, the one with outward fins looks longer. They are the same length.',
      explanation:
        'The visual system does not measure the line on its own; it measures the extent of the figure that contains it. Outward fins stretch that figure, inward fins compress it. The familiar explanation in terms of the corner of a room versus the corner of a building cannot be the whole story: the illusion survives when the fins are replaced by curves or circles.',
      reference: 'Müller-Lyer illusion. Franz Carl Müller-Lyer, 1889.',
      caption: 'What is measured is the figure, not the line.',
    },
    checkerShadow: {
      title: 'Checker shadow illusion',
      appearance:
        'A cylinder casts a shadow across a chequerboard. The light square inside the shadow and the dark square outside it are exactly the same shade.',
      explanation:
        'The visual system does not report how much light reached your eye; it estimates how reflective each surface really is. Where it recognises a shadow, it discounts the missing light and concludes that the surface underneath must be bright. That correction is almost always right in daily life, which is precisely why you cannot switch it off. Join the two squares with a band of the same shade and the correction has nothing to work on — and they look identical.',
      reference: 'Checker shadow illusion. Edward H. Adelson, 1995.',
      caption: 'You see surfaces, not light.',
    },
    ebbinghaus: {
      title: 'Ebbinghaus illusion',
      appearance:
        'The circle ringed by large circles looks small; the one ringed by small circles looks large. The two are identical.',
      explanation:
        'Size is judged as a ratio against the surroundings, never in absolute terms. The larger the neighbours, the more firmly the centre is encoded as “the small one”. Distance matters too: neighbours placed closer strengthen the effect. Fade the surroundings and the two circles snap to the same size.',
      reference:
        'Ebbinghaus illusion, also known as Titchener circles. Hermann Ebbinghaus, late 19th century; popularised in English by Edward Titchener.',
      caption: 'Size is never decided alone.',
    },
    hering: {
      title: 'Hering illusion',
      appearance:
        'Two parallel lines drawn over a fan of radiating lines bow outwards at the centre.',
      explanation:
        'Converging lines read as a space receding into depth. The visual system enlarges what it takes to be the distant region, and the straight lines bulge as a result. One account treats this as a by-product of predicting where you are heading while moving. Remove the radiating lines and the bowing disappears.',
      reference: 'Hering illusion. Ewald Hering, 1861.',
      caption: 'The background rewrites the shape of the line.',
    },
    peripheralDrift: {
      title: 'Rotating Snakes',
      appearance:
        'The rings turn slowly whenever your gaze moves. Nothing in the image is moving at all.',
      explanation:
        'A repeating sequence — black, dark, white, light — is misread by peripheral vision as motion in one direction. Bright and dark regions travel to the brain at slightly different speeds, and that timing difference is enough to trip the motion detectors. Fixate on one point and the motion stops; drain the saturation and it nearly disappears.',
      reference:
        'Rotating Snakes, a peripheral drift illusion. Akiyoshi Kitaoka, 2003; the underlying effect was described by Faubert & Herbert (1999) and others.',
      caption: 'What is moving is your gaze.',
    },
    penroseTriangle: {
      title: 'Penrose triangle',
      appearance: 'Three beams meet at right angles in a closed triangle. No such solid exists.',
      explanation:
        'One beam is in fact cut through, and the two separated faces line up only from this exact viewpoint. The visual system assumes strongly that surfaces which appear to touch lie at the same depth. That assumption is almost always right, which is why it goes unquestioned. One step sideways and the break is obvious.',
      reference:
        'Penrose triangle. Drawn by Oscar Reutersvärd in 1934 and published independently by Roger and Lionel Penrose in 1958.',
      caption: 'Overlapping is read as touching.',
    },
    penroseStairs: {
      title: 'Penrose stairs',
      appearance:
        'Climb all four flights and you are back where you started. Every step clearly goes up.',
      explanation:
        'The same trick as the triangle. One step is severed, and its cut face aligns with its neighbour only from here. The visual system accepts each local connection in turn and never audits the total height. Local consistency is checked; global consistency is not.',
      reference:
        'Penrose stairs. Lionel and Roger Penrose, 1958; the basis for M.C. Escher’s Ascending and Descending (1960).',
      caption: 'Every part is honest; only the whole lies.',
    },
    neckerCube: {
      title: 'Necker cube',
      appearance:
        'A cube drawn in outline keeps swapping which face is in front. Neither reading is the correct one.',
      explanation:
        'A line drawing carries no depth cues, yet the visual system insists on producing a single three-dimensional reading, so it alternates between two equally good ones. It is not that the figure has two appearances; it is that your brain keeps switching hypotheses. This exhibit is drawn in orthographic projection: under perspective, the added depth cues would lock the reading to one side.',
      reference: 'Necker cube. Louis Albert Necker, 1832.',
      caption: 'The brain keeps deciding what it cannot decide.',
    },
    anamorphosis: {
      title: 'Anamorphosis',
      appearance:
        'A smeared, meaningless pattern is stretched across the floor. From this one spot it stands up as a solid hanging in the air.',
      explanation:
        'The image was projected along the lines of sight from this eye position onto the floor. As long as the picture on your retina is right, the brain picks the most natural explanation for it — an object in space rather than paint on a floor. Move a metre and the object collapses back into a stain.',
      reference:
        'Anamorphosis. A technique used since the 16th century; the skull in Hans Holbein’s The Ambassadors (1533) is the best-known example.',
      caption: 'There is exactly one right place to stand.',
    },
    amesRoom: {
      title: 'Ames room',
      appearance:
        'Two identical figures stand in the corners. One looks like a child, the other like an adult.',
      explanation:
        'The room is not rectangular. Floor and ceiling slope, and one corner is nearly twice as far away as the other. The shape was worked backwards so that, from the peephole, the distortion cancels out and the room looks ordinary. The visual system commits to the rectangular room and computes the figures’ sizes on that assumption, so the distant one comes out small. Size and distance are always decided together.',
      reference: 'Ames room. Adelbert Ames Jr., 1946.',
      caption: 'Believe the room, or believe the figures.',
    },
    beuchetChair: {
      title: 'Beuchet chair',
      appearance: 'One chair. Whoever stands with it becomes a giant or a doll.',
      explanation:
        'The seat and the back are in different places — the seat close to you, the back and legs several metres behind. Only from here do they line up as a single chair. The moment the brain settles on “one chair”, the chair’s size becomes the ruler for the space, and a person is measured with it.',
      reference: 'Beuchet chair. Jean Beuchet, 1963.',
      caption: 'Use the wrong ruler and people change size.',
    },
    hollowMask: {
      title: 'Hollow-Face illusion',
      appearance:
        'A face turns slowly towards you. It is not a face at all: it is a mould, hollow on the inside.',
      explanation:
        'The knowledge that faces stick out is so strong that it overrules the shading and motion cues telling you this one caves in. A hollow face appears to follow you as it rotates — an unavoidable consequence of reading a concave surface as convex. Lighting from above rather than below makes the illusion stronger still.',
      reference: 'Hollow-Face illusion, widely reported by Richard Gregory and colleagues.',
      caption: 'Knowledge overrules the evidence of the eye.',
    },
    ponzoCorridor: {
      title: 'Ponzo illusion',
      appearance:
        'Two bars lie in a corridor that narrows into the distance. The far bar looks distinctly longer. The two take up exactly the same amount of your visual field.',
      explanation:
        'Converging lines are a depth cue. If something further away casts the same size on the retina, it must really be larger — and the visual system corrects accordingly. That correction, size constancy, is why distant people do not look like dolls. Here its reliability works against you. The reveal brings the far bar forward and undoes the scaling, so you can see that the two subtended the same angle all along.',
      reference: 'Ponzo illusion. Mario Ponzo, 1911.',
      caption: 'What is further away ought to be bigger.',
    },
    shrinkingRoom: {
      title: 'The Shrinking Room',
      appearance:
        'An unremarkable corridor, with a horizontal rail running the length of both walls. As you walk, the rail seems to curve upwards and the ceiling seems to rise higher and higher. There is a height gauge at the far end.',
      explanation:
        'Neither the ceiling nor the walls moved by a millimetre. While you walked, your eye height drifted from 1.60 m down to 1.15 m, slowly enough to go unnoticed. The rail sits at 1.60 m from end to end. On the way in it was exactly level with your eyes, so it read as dead straight; as you sank, it began to curve up away from you. Eye height is the baseline you measure a space against — lower the baseline and the same room becomes larger. Look at the gauge at the far end: the orange band is where your eyes were when you came in, the green marker is where they are now. The gap is the height you lost.',
      reference:
        'An original exhibit, built on eye-height scaling of size and distance (Sedgwick and others). The design of the experience is new; the perceptual effect is not.',
      caption: 'This exhibit does not survive a screenshot.',
      scale: 'Your eye height when you came in\nYour eye height now',
    },
    audibleCollision: {
      title: 'Audible Collision',
      appearance:
        'Two spheres approach, overlap and separate. In silence, they can only be passing each other.',
      explanation:
        'Press the button and a short click sounds at the moment they meet. Not one frame of the animation has changed, yet the spheres now bounce off each other. Vision alone cannot distinguish passing from colliding, and the brain picks the simpler reading: crossing. Add a sound and it is taken as evidence of contact, flipping the interpretation. You can operate the switch yourself.',
      reference:
        'An original exhibit, based on the bounce/stream illusion (Sekuler, Sekuler & Lau, 1997).',
      caption: 'This exhibit does not survive a screenshot.',
    },
    underTheStripes: {
      title: 'Under the Stripes',
      appearance:
        'Six spheres, plainly orange, pink, green and pale blue. All six are made of exactly the same material.',
      explanation:
        'Striped light falls from the ceiling. Where the narrow stripes cross a sphere, the visual system folds their colour into its estimate of the sphere’s own colour — an effect called assimilation, which averages towards neighbouring colours. In a picture you could dismiss it as “just how the image was made”. Here it is real light on real objects: walk around them, crouch, come closer, and the difference will not go away. With nowhere left to hide, the conviction only grows.',
      reference:
        'An original exhibit, applying the Munker–White illusion to real objects under real light.',
      caption: 'This exhibit does not survive a screenshot.',
    },
    behindYou: {
      title: 'Behind You',
      appearance:
        'Twelve small statues line a cloister. You walk past them one by one, and nothing happens.',
      explanation:
        'The statues only change while they are outside your view: they shift their pose, turn, and trade places with a neighbour. Each change completes in a single frame, so by the time you turn back they wear the face they have “always” had. We hold surprisingly little visual detail at once; most of what you think you saw has already been replaced by a summary the brain rebuilds on demand. That is why a change made while your gaze is elsewhere leaves no trace. Walk a full lap and the panel in the courtyard tells you how many of them moved.',
      reference:
        'An original exhibit, built on change blindness (Rensink, O’Regan & Clark 1997; Simons & Levin 1998). The design of the experience is new; the perceptual effect is not.',
      caption: 'This exhibit does not survive a screenshot.',
      counter: '{count} of {total} statues changed.',
    },
    lyingShadow: {
      title: 'The Lying Shadow',
      appearance:
        'A meaningless lump of metal on a plinth. The shadow it casts on one screen is a bird; the shadow on the other is a fish. One object, two lies at once.',
      explanation:
        'One lump, two shadows. A solid that satisfies both silhouettes at once is what remains after you carve away everything that falls outside either shadow — a shape called a visual hull. Turn the dial and the lights swing; at the angles in between, both shadows collapse into stains that mean nothing. The meaning was never in the lump. It is in the angle of the light, and in your reading of it. A shadow is a projection of a shape, not proof of one.',
      reference:
        'An original exhibit, built on shadow art (Mitra & Pauly 2009 and others). The design of the experience is new; the perceptual effect is not.',
      caption: 'This exhibit does not survive a screenshot.',
    },
    twoTruths: {
      title: 'Two Truths',
      appearance:
        'Hundreds of small fragments hang in mid-air — a cloud of dust, nothing more. Stand on marker A and they resolve into one Japanese character; stand on marker B, on the far side, and the very same fragments spell another.',
      explanation:
        'Not one fragment moved. The only thing that moved was you. Each piece sits where it overlaps a stroke of 真 (“true”) seen from A, and a stroke of 偽 (“false”) seen from B. Get the image on the retina right and the brain takes the most natural reading available: characters floating in the air. The characters are Japanese, and they are left that way on purpose — the subject of this piece is form, not language, and if you cannot read them you get the purer version of it: a shape rising out of dust, and a different shape when you walk. Two photographs would not carry any of this. You have to walk between the two viewpoints yourself, through the meaningless state in the middle, before it becomes one sculpture.',
      reference:
        'An original exhibit, built on distributed anamorphic sculpture (Michael Murphy, James Hopkins and others). The design of the experience is new; the perceptual effect is not.',
      caption: 'This exhibit does not survive a screenshot.',
      // 字が結ばれた直後に、字の脇へ出す（§5.4）。1 行目が視点 A、2 行目が視点 B
      glyphGloss: '真 — “true”\n偽 — “false”',
    },
  },
};
