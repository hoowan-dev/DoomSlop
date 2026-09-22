// Every tunable number in one place. Gameplay modules read from here rather
// than hardcoding values, so balancing is a single-file edit.

export const WORLD = {
  arenaSize: 60, // floor is arenaSize x arenaSize, centered on the origin
  wallHeight: 8,
};

// Two squares of wall that lead to each other: walk into one and you come out of the
// other, facing into the arena. Re-picked at the start of every round (rounds.js), so
// the shortcut across the map is something to find each round rather than a fixture.
// Sized and placed against WORLD above, which is why it sits next to it.
export const PORTAL = {
  // The doorway, in world units — a square standing on the floor, `size` wide and
  // `size` tall. Wide enough to hit at a run, and short enough against a
  // WORLD.wallHeight of 8 to read as a door in a wall rather than as a painted wall.
  size: 3,

  // How close to the wall counts as stepping through, measured straight out from the
  // wall plane. It has to clear the gap the arena clamp leaves — the player stops
  // PLAYER.radius short of every wall, so anything under 0.4 could never fire at all —
  // and it's well over that so a portal takes at a run instead of needing to be
  // leaned into.
  depth: 1.2,

  // How far into the arena the player arrives, measured from the exit wall. **Must
  // stay above `depth`**, or arriving would immediately count as stepping into the
  // exit portal and the player would ping-pong between the two. That constraint is
  // what stands in for a cooldown: there is no travel state anywhere, because
  // coming out beyond the trigger is enough. A constraint noted here rather than a
  // clamp in code, same as the speed ladder's ceiling.
  exitOffset: 2.4,

  // Keep a portal's center this far from the corners. The aura spreads
  // size * glow.haloScale / 2 either side of it, so this is what keeps the glow on one
  // wall instead of being cut in half by the one beside it.
  margin: 5,

  // How far the light stands off the wall. A point light *in* the wall's own plane
  // lights it at grazing incidence and reads as nothing at all, so it has to be out
  // in the room to wash the surface it's mounted on — and standing off is also what
  // spills it onto the floor in front, which is the part you see from across the map.
  lightOffset: 0.9,

  // Blue, pushed toward cyan: PICKUP.armor already owns azure, and by the note on
  // PICKUP.boots the palette had run out of free hues. This is the deliberate bend of
  // that rule, and it's affordable because the two are never told apart by color in
  // the first place — one is a 3-unit square standing in a wall, the other a small
  // cube bobbing at knee height, and nothing that matters follows from mistaking them.
  //
  // Read exactly like an enemy's or a drop's glow, by the same code: one block for the
  // light and the aura so the pair can't drift apart. `haloScale` is the aura's size as
  // a multiple of `size` and has to stay over 1 for the reason it does there — the glow
  // is the part outside the square. `intensity` is candela at 1/d^2 against a wall
  // `lightOffset` away and a floor about size/2 below the light, which is why it's
  // nearer a drop's number than the boss's despite lighting a far bigger area.
  glow: { color: 0x35e0ff, intensity: 22, distance: 14, haloScale: 2.2, haloOpacity: 0.7 },
};

export const PLAYER = {
  eyeHeight: 1.7, // also the resting camera height, i.e. the ground for a jump
  moveSpeed: 7, // units per second
  lookSensitivity: 0.0022, // radians per pixel of mouse movement
  maxHealth: 100,
  // Armor points: a second pool that soaks damage before health does (see
  // player.js). Starts at zero and is only ever filled by an armor drop, so unlike
  // maxHealth this is a ceiling the player spends most of the game below — and one
  // a floater's 25-point touch eats in two hits, which is the point. It's here
  // rather than in PICKUP because it's the *player's* capacity; the drop that fills
  // it is one of several things that could.
  maxArmor: 50,
  radius: 0.4, // for wall collision

  // The jump, and the only vertical motion in the game. These two fully determine
  // it: the hop peaks at jumpSpeed^2 / (2 * gravity) — 1.06 units here — and lasts
  // 2 * jumpSpeed / gravity, or 0.65s. Raising jumpSpeed alone makes it both
  // higher and slower; raising gravity with it keeps it snappy.
  //
  // Two things to respect when retuning. `eyeHeight` plus that apex has to stay
  // under WORLD.wallHeight, or a jump lets the player see out over the arena. And
  // jumping is deliberately *not* a dodge — contact damage is measured on the XZ
  // plane (see enemies.js), so height buys nothing defensively no matter how high
  // this goes.
  jumpSpeed: 6.5, // initial upward velocity, units/sec
  gravity: 20, // units/sec^2

  // The lean when strafing: the camera rolls a little into a sideways press and
  // levels out when it's released (see player.js). Radians at a full press, so 0.045
  // is 2.6 degrees — and it has to stay in that neighbourhood. This is the one place
  // in the game where the *horizon* moves, so what's a lean at 3 degrees is a list at
  // 8 and reads as the camera being loose rather than the player leaning. There's
  // nothing to derive it from: it's a feel number, picked by strafing and looking.
  strafeRoll: 0.045,
  // How fast it eases in and out, as the rate of an exponential approach — roughly
  // "most of the way there in 1/this seconds". Fast enough that a tap of A registers
  // as a lean at all, slow enough that the horizon doesn't snap; the sharp stop is
  // what the tilt itself was meant to soften.
  strafeRollSpeed: 8,
};

// Hardware-level input conditioning. Separate from PLAYER.lookSensitivity on
// purpose: that number is *interpretation* (pixels to radians) and belongs to
// player.js, while this one is noise rejection on the raw signal and belongs to
// input.js. Different owners, different blocks.
export const INPUT = {
  // Ceiling on a single mousemove's movementX/movementY, in pixels. An event over
  // this is discarded whole — see input.js. Chrome delivers at most one mousemove
  // per frame, so one event is ~10ms of hand movement: at PLAYER.lookSensitivity
  // 400px is a ~50 degree snap, already past what a human flick can produce in
  // that time. Pointer-lock cursor warps come in at half a screen width or more
  // (960px+ at 1920), so this sits with clear margin on both sides.
  maxLookDelta: 400,
};

export const ENEMY = {
  speed: 2.2, // units per second, straight at the player
  radius: 0.6,
  health: 1, // hits to kill
  touchDamage: 25, // damage dealt when an enemy reaches the player
  spawnInterval: 1.6, // seconds between spawns at the start of a round
  spawnIntervalMin: 0.45, // floor the interval ramps down to
  rampDuration: 90, // seconds to go from spawnInterval to spawnIntervalMin
  spawnDistance: 25, // how far from the player they appear
  // Where they *settle*, not where they appear: an enemy spawns somewhere in the
  // band below and levels out to this as it closes, so this is the height it
  // fights at.
  hoverHeight: 1.6,
  // The band they spawn in, so a wave arrives at mixed heights instead of all on
  // one plane — some dropping in from overhead, some skimming the floor. Both ends
  // have to clear the geometry: under `radius` the orb sinks into the floor, and
  // over WORLD.wallHeight - radius it pokes out above the walls.
  //
  // They converge on hoverHeight before they arrive, which is what keeps the
  // XZ-planar contact check honest — something still 6 units overhead landing a
  // hit would read as damage out of nowhere. Charging a fresh high spawn is the
  // one way to meet one before it has come down, and that's the player's doing.
  spawnHeightMin: 0.9,
  spawnHeightMax: 6,
  spin: 1, // multiplier on the cosmetic tumble rate
  scoreValue: 100,
  // The point light that rides along with it (see effects.js). `intensity` is
  // candela falling off as 1/d², so it only makes sense read against `radius` and
  // `hoverHeight` — the floor under a floater is ~1.5 units from the light, where
  // this lands as a pool of red a couple of units across. `distance` is where it
  // reaches zero, i.e. how far that pool can spread at most.
  //
  // The 1/d² is worth keeping rather than flattening the decay: it's what holds the
  // light in a pool *under each enemy*, which is how a wave stays countable in the
  // dark. A flatter falloff at this intensity turns the whole floor red instead.
  //
  // `distance` is the reach, and 16 is the pool spread over most of the ground a
  // floater is crossing rather than a puddle it carries under itself. Raising it
  // brightens the *middle* distances as well as extending the edge — the cutoff is
  // a window multiplied over the 1/d², so pulling it further out stops clipping the
  // falloff early — which is why `intensity` only had to come up a little with it.
  // What it costs is fill rate: this is the number that decides how much of the
  // screen every light in EFFECTS.glowPool is evaluated over.
  //
  // None of it lands on another enemy. The bodies are unlit (see enemies.js), which
  // is deliberate and load-bearing at this reach — a dozen lights carrying 16 units
  // each would otherwise wash a whole cluster flat red.
  //
  // `color` is shared by the light and the halo sprite around the body (enemies.js),
  // which is the whole point of them living in one block: the thing an enemy casts
  // on the floor and the thing burning around it are one glow, so one number. The
  // halo's own two fields are its size as a multiple of the body's *diameter* — it
  // has to be over 1 or there's no aura outside the silhouette — and how hard it
  // burns, which is additive on a dark scene and washes out the facets over ~0.7.
  //
  // 2.2 puts the silhouette's edge on the halo texture's bright knee, which is what
  // makes the aura hug the body: at 1.6 it's a thin rim light and at 2.8 it detaches
  // into a fog bank with a rock inside it. See BOSS.glow — the boss holds the same
  // number for that reason, not because the two tiers happen to want one size.
  glow: { color: 0xff2410, intensity: 30, distance: 16, haloScale: 2.2, haloOpacity: 0.55 },
};

// The round boss. Every field ENEMY has, because enemies.js reads whichever of
// the two blocks an enemy was spawned from — add a per-enemy tunable to one and
// it has to exist in the other. `attackInterval` is the exception: only the boss
// survives contact, so only the boss needs a rate limit on its hits.
//
// Pulled out of the block because three fields have to be the same number — see
// spawnHeightMin below, where being equal to the hover height is the point.
const BOSS_HOVER = 3.4;

export const BOSS = {
  speed: 1.3, // slower than a floater, and outrunnable until ROUNDS.speedStep carries it past PLAYER.moveSpeed (round 10 as shipped)
  radius: 3,
  health: 50, // shots to kill
  touchDamage: 25,
  // Unlike a floater the boss isn't consumed when it reaches the player — it has
  // to be shot down. Without a cooldown it would land a hit every frame and
  // erase a full health bar in a fraction of a second.
  attackInterval: 1.2,
  // Must stay below arenaSize/2 - radius, or every bearing is out of bounds and
  // _spawnPoint() falls through to its center-ward fallback on every attempt.
  spawnDistance: 20,
  hoverHeight: BOSS_HOVER,
  // The boss deliberately doesn't get the floaters' height variety: its entrance
  // is staged — named by the flash, alone in a wiped arena — and a radius-3 orb
  // arriving at a random altitude reads as a glitch rather than as variety. There's
  // barely room for it anyway, between its radius and WORLD.wallHeight. Both ends
  // equal to hoverHeight makes the settle in enemies.js a no-op for this tier.
  // Present as real fields rather than omitted because every enemy reads its
  // tunables off `kind`, where a missing one is an undefined that means NaN.
  spawnHeightMin: BOSS_HOVER,
  spawnHeightMax: BOSS_HOVER,
  spin: 0.35, // a floater's tumble rate on something this big looks frantic
  scoreValue: 5000, // 50 shots, priced at a floater's 100 apiece
  // Purple rather than a floater's red, for the same reason the orb is a different
  // hue: the glow is one more thing saying which tier this is. Much brighter, and
  // that part is geometry rather than taste — the light sits at the center of a
  // radius-3 orb, so nothing it lights is nearer than 3 units where a floater's
  // light works at 1.6, and 1/d² over that gap alone is ~4.5x. The rest is on top
  // because this one is the whole fight and should light the room it happens in.
  //
  // `haloScale` matches a floater's, and matching is the point rather than a
  // coincidence: the silhouette edge lands at 1/haloScale of the halo texture's
  // radius, so that ratio is what decides where the body's edge falls on the
  // gradient. At 2.2 it sits on the bright knee and the aura reads; the 1.5 this
  // started at — picked because 1.5 units of overhang on a radius-3 orb is already
  // twice a floater's 0.7 — put the edge out in the dim tail, and the boss ended up
  // with a fainter aura than the floaters it towers over.
  //
  // Burning harder than a floater is the other half of that. One gradient stretched
  // over five times the width falls off five times more gently in screen space, so
  // the same opacity reads as haze rather than as a rim; 0.65 is what brings it back
  // to looking like the orb is radiating. Going wider instead (2.6) doesn't — the
  // aura stops belonging to the orb and just tints the wall behind it.
  glow: { color: 0xc23cff, intensity: 180, distance: 34, haloScale: 2.2, haloOpacity: 0.65 },
  healthBarLift: 1.4, // world units above the boss's crown to float the bar
  // The portrait sprite plastered on the orb (see bosses.js), as a fraction of the
  // orb's *diameter*. Well under 1 on purpose: the ring of purple left around the
  // face is what still reads as the boss orb underneath it, and at 0.8 the face
  // crowded the silhouette enough that the orb read as a frame rather than a body.
  portraitScale: 0.6,
};

// The core loop: clear killsPerRound floaters, fight the boss, next round. See
// rounds.js, which owns the state machine.
export const ROUNDS = {
  killsPerRound: 25, // shot kills that summon the boss; contact deaths don't count
  // Dead air around the announcements, in seconds. Both are a little longer than
  // the 1.2s flash animation in style.css, so the text has landed before the boss
  // walks in / the floaters come back. They're also the only breather the player
  // gets in the whole game, so don't trim them much.
  bossDelay: 1.5, // BOSS ROUND flash -> boss appears
  roundDelay: 1.5, // boss dies -> floaters resume
  // Per-round difficulty step, *added* rather than compounded: round N moves at
  // 1 + speedStep * (N - 1), so the ladder is 1.00x, 1.50x, 2.00x, 2.50x. Named a
  // step rather than a growth rate because 0.5 here is half of round 1's speed
  // added every round, not 50% of the previous round's.
  //
  // It drives floater speed, boss speed, and the floater *spawn rate* (the
  // interval divides by it), so one number covers both how fast they come and how
  // many. The only thing that scales with the round — killsPerRound and boss
  // health deliberately don't. Note there's no ceiling: at 0.5 floaters pass
  // PLAYER.moveSpeed in round 6 and the boss in round 10, after which neither can
  // be outrun.
  speedStep: 0.5,
};

// The drop system: what a dead enemy leaves behind. Everything from `dropChance`
// down to `shrinkTime` is the *system* — there is one drop shape and every item
// shares it — and the blocks at the bottom are its faces: the health cube, the
// armor cube and the super boots.
//
// A drop's `kind` points at one of those faces, exactly as an enemy's points at
// ENEMY or BOSS, which is what lets effects.js read `item.kind.glow` without
// knowing which it was handed. Same rule as those two blocks: a new per-face field
// has to be added to *both*, or one of them is an undefined that silently means 0.
// What deliberately *isn't* duplicated down there is the physics — size, reach,
// hover height, bob, spin, life. The items are one cube with a different picture on
// it, and giving armor its own radius or bob speed would be inventing a difference
// the game doesn't have. The boots' two *effect* numbers do live on their face,
// because a duration is genuinely that item's and nothing else in the game has one:
// the rule is "what differs goes on the face", not "faces hold only colors".
//
// Colors in the faces are CSS strings rather than the 0x literals the rest of this
// file uses, like MINIMAP's: the icon is drawn into a canvas with the 2D API (see
// pickups.js), not handed to a three.js material. `glow.color` is a 0x literal
// because that one does go to a three light and material, so the faces carry both
// conventions on purpose.
export const PICKUP = {
  // Chance a defeated enemy drops one. Rolled per *shot* kill only — the roll hangs
  // off enemies.onDefeat, which never fires for a contact death or a between-rounds
  // sweep, so suiciding floaters and the round wipe can't pay out. At 0.15 against
  // ROUNDS.killsPerRound that's between three and four a round.
  dropChance: 0.15,
  // Of the drops that do happen, which one it is: a second roll after dropChance
  // rather than a chance per item, so the overall drop rate stays the one number
  // above and adding an item moves the split instead of diluting it.
  //
  // Health is deliberately the *remainder* rather than a third field — the three
  // shares have to sum to 1, and a healthShare would be a second place to get that
  // wrong. pickups.js walks these cumulatively in the order written here, so health
  // gets whatever's left (0.50 as shipped).
  //
  // Health has the plurality on purpose: it's what gets the player out of trouble
  // they're already in, where the other two buffer trouble they haven't met yet — a
  // table weighted the other way would mostly hand shields to a player at 20 HP. The
  // boots are rarest because they're the only drop that changes how the game *plays*
  // rather than how much of it you can take; at this share they land about every
  // other round.
  armorShare: 0.35,
  bootsShare: 0.15,

  size: 0.8, // cube edge, in world units — a little smaller than a floater's 1.2 across
  radius: 0.6, // collection radius; the player walks over it at this plus PLAYER.radius
  // Where it floats. Under PLAYER.eyeHeight so the player looks slightly *down* at
  // it, which is what makes it read as something lying in the arena rather than as
  // another thing at eye level coming for them.
  hoverHeight: 1,

  // The float, and the spin, and the two things that make it read as an item rather
  // than as scenery. Each drop gets a random phase, so a cluster doesn't bob in
  // lockstep. Spin is radians per second about Y only — tumbling it like an enemy
  // would hide the cross half the time.
  bobAmplitude: 0.15,
  bobSpeed: 2,
  spin: 1.1,

  // Drops expire. Nothing in the spec says they should, but at ~3.5 a round and no
  // expiry the arena silently fills with medkits and the health bar stops mattering.
  // A life makes collecting one a decision about *when* to break off and go get it.
  life: 22,
  // It shrinks away over the last of that life instead of blinking out of existence.
  // Scaling the mesh scales the halo with it for free, since a sprite takes scale off
  // its world matrix — the light is the one part that doesn't follow, and it's gone
  // within a frame of the cube.
  shrinkTime: 1.2,

  // The health cube: refills the bar outright. `iconColor` is the cross painted on
  // every face — named for the job rather than the shape, since the armor face below
  // paints a shield through the same field.
  health: {
    bodyColor: '#e9f1ea', // the box: near-white, so the icon is what you see
    iconColor: '#27c953',
    edgeColor: '#9fb3a4', // a painted-on border, so the cube's faces read apart

    // Green, and the one green light in the game bar the armor blue below: the
    // enemies are red and the boss is purple, so color alone says "this one is for
    // you". Same two halves as an enemy's glow — the point light in effects.js and
    // the halo in glow.js — and the same reason they share a block.
    //
    // Dimmer than a floater's 20 despite reading as bright, which is 1/d²: this
    // hovers at 1 unit where a floater sits at 1.6, so the floor under it is 2.5x
    // closer to the light. `haloScale` matches the enemies' 2.2 for the reason
    // spelled out in BOSS.glow — that ratio, not the world size, is what decides
    // how the aura reads.
    glow: { color: 0x2bff6a, intensity: 9, distance: 7, haloScale: 2.2, haloOpacity: 0.6 },
  },

  // The armor cube: fills PLAYER.maxArmor, which then soaks damage ahead of health.
  // A shield instead of a cross, on a cooler body, because the two are the same
  // object at a glance otherwise — and the blue has to survive being seen inside its
  // own glow, which is why the body is tinted toward it rather than left the health
  // cube's near-white.
  armor: {
    bodyColor: '#e5ecf6',
    iconColor: '#1f6fd0',
    edgeColor: '#98a6bd',

    // Blue: the fourth and last hue in the game, and the only one that isn't a
    // threat or a heal. Slightly hotter than the health cube's 9 at the same
    // distance, because blue at equal candela reads dimmer than green against a dark
    // floor — the two drops should look equally *present* from across the arena,
    // which is a matter of what the eye does rather than of what the number says.
    glow: { color: 0x2f8bff, intensity: 11, distance: 7, haloScale: 2.2, haloOpacity: 0.6 },
  },

  // SUPER BOOTS: the one drop that isn't a resource. It doesn't fill a pool, it runs
  // a timer — triple move speed and triple jump height for `duration` seconds — which
  // is why this face carries two numbers the other two don't. Yellow because it's the
  // fifth and last hue, and the only one that's neither a threat nor a pool: red and
  // purple are trying to kill you, green and blue are levels on the bars.
  boots: {
    bodyColor: '#f7efd8', // warm off-white, tinted toward the icon like the armor cube
    iconColor: '#d8961a', // a darker gold than the glow, or the boot vanishes into it
    edgeColor: '#bcab7e',

    // Same intensity as the armor cube rather than the health cube's 9, and for the
    // same reason: at equal candela yellow sits between them against a dark floor, and
    // what the three drops should match is how *present* they look from across the
    // arena. haloScale is the 2.2 every glowing thing in the game holds — see BOSS.glow.
    glow: { color: 0xffd11a, intensity: 11, distance: 7, haloScale: 2.2, haloOpacity: 0.6 },

    // How long the buff runs, from the moment of collection. player.js counts it down
    // in update(), so it pauses with the game.
    duration: 15,

    // The multiplier, and it means move speed *and jump height* — not jump speed. The
    // apex is jumpSpeed^2 / (2 * gravity), so tripling the height means multiplying
    // jumpSpeed by sqrt(3); tripling jumpSpeed itself would be a *nine*-fold hop.
    // player.js takes that root, which is the one place this number is interpreted
    // rather than just applied.
    //
    // The same balance constraint PLAYER.jumpSpeed carries applies here and is what
    // caps this number: eyeHeight plus the boosted apex has to stay under
    // WORLD.wallHeight or a jump sees out over the arena. At 3 that's 1.7 + 3.17 =
    // 4.87 against a wall of 8, so there's room — but at 8 the player clears them.
    boost: 3,
  },
};

export const WEAPON = {
  fireInterval: 0.15, // seconds between shots
  range: 100,

  // Where the tracer starts, in normalized screen coordinates: (0, 0) is the
  // crosshair, -1 is the bottom/left edge of the view. Specified in screen
  // space rather than world units so the muzzle stays put on screen if the FOV
  // or window aspect changes — weapon.js converts it using the live camera.
  muzzleOffset: {
    screenX: 0, // horizontally centered
    screenY: -1.08, // just past the bottom edge, so tracers rise from off-screen
    forward: 1.6, // distance in front of the camera; sets depth, not screen position
    // The screen offset puts the muzzle ~1.3 units below eye level, which pitches
    // it under the floor once you aim down more than ~15° — the floor then clips
    // the start of the tracer. Clamping world Y to just above the floor trades
    // exact bottom-center placement (only while aiming steeply down) for a tracer
    // that stays visible.
    minHeight: 0.05,
  },
};

// Colors here are CSS strings, not the 0x literals the rest of this file uses —
// the minimap is a 2D canvas in the HUD, not three.js geometry.
export const MINIMAP = {
  size: 148, // diameter in CSS pixels
  range: 32, // world units from the center to the rim; enemies spawn at 25, so
  // they appear just inside the edge rather than popping in from nowhere
  background: 'rgba(12, 14, 20, 0.55)',

  coneRange: 26, // how far the view cone reaches, in world units
  coneColor: 'rgba(200, 220, 255, 0.16)',

  playerColor: '#ffffff',
  playerRadius: 3.5, // CSS pixels
  enemyColor: '#e2604a',
  enemyRadius: 2.6,
  // The boss is 5x a floater's world radius, so drawing it as an identical dot
  // would misrepresent the fight it is.
  bossColor: '#b957d9',
  bossRadius: 6,

  // Drops. None of them is a dot, and that's the rule rather than a style choice:
  // both dots above are things trying to kill you, so the things on the map that
  // aren't shouldn't be told apart from them by hue alone. Each blip is the same icon
  // that's painted on its cube (each PICKUP face's iconColor), which is what ties it
  // to the object you go and stand on — a cross for health, a shield for armor, a
  // boot for the boots.
  //
  // Hence the naming: `arm` is the half-length of a cross stroke and `thickness` its
  // width, `armorArm` the shield's half-width, `bootsArm` the boot's half-*height*
  // (it's the one glyph whose width follows from its height rather than the other way
  // round). None of them is a radius, so none shares the dots' naming. Every glyph's
  // proportions are in minimap.js with the cube icons', since they're the shape
  // rather than a tunable.
  healthColor: '#3ddc6a',
  healthArm: 3.4,
  healthThickness: 1.8,
  // A touch narrower than the cross's arm: the shield is a filled shape where the
  // cross is two strokes, so matching their extents would leave it much the heavier
  // of the two.
  armorColor: '#4aa8ff',
  armorArm: 3,
  // Half the boot's height; minimap.js derives its width from that, a little under the
  // full height so the glyph stays obviously taller than it is wide.
  //
  // Deliberately the largest of the three glyphs, which is a legibility call and not an
  // importance one: a cross is two bars and a shield is one tapering outline, where a
  // boot is a collar, a leg and a sole that only read as a boot *together* (see
  // minimap.js). At the cross's 3.4 all three parts land inside about six pixels and it
  // comes out a yellow smudge. This is the smallest it survives at, and it's still small
  // enough that an enemy dot drawn over it wins the spot.
  bootsColor: '#ffd12e',
  bootsArm: 4.8,
};

// Floating "+100" over a kill. Timing lives here rather than in a CSS animation
// because hud.js has to drive the rise and the fade itself anyway — it's moving a
// world-anchored point every frame — and splitting the duration across two files
// is how the two copies drift apart. The color and font are in style.css.
export const POPUP = {
  pool: 12, // preallocated divs; a kill with the pool full recycles the oldest,
  // same rule as the tracer pool. At fireInterval 0.18 a single stream of kills
  // can only have ~5 alive at once, so this has plenty of slack.
  life: 0.9, // seconds on screen
  lift: 0.5, // world units above the kill point where it starts
  rise: 1.8, // further world units it drifts up over its life
  fadeAt: 0.45, // fraction of life left when it starts fading; holds opaque above this
};

// The wedges that flick up around the crosshair pointing at whatever just hit the
// player. One field, and the split is deliberate: hud.js builds the pool, so the
// count has to be a number something reads, while the wedges' size, distance from
// the reticle, color and lifetime are pure appearance and live in style.css — the
// same division POPUP makes, where the timing is here because JS drives the rise
// and the color and font are CSS.
//
// Six because floaters arrive in a swarm and several can land in the same second
// from different sides, which is exactly when the indicator earns its keep. Unlike
// the popups these don't track anything, so a slot needs no lifetime here: the CSS
// animation is the lifetime, and the pool is walked round-robin.
export const HITMARK = {
  pool: 6,
};

// Every *effect* is a pitch-swept oscillator, most with a noise burst layered
// under it for attack. Durations in seconds, pitches in Hz, gains 0..1 before the
// master. See sound.js — none of the effects is a file path; they're synthesized.
// The music bed at the bottom is the one exception, and the only audio asset.
export const SOUND = {
  masterVolume: 0.35, // leaves headroom for several effects at once

  shoot: {
    duration: 0.09, // short: at fireInterval 0.18 these would otherwise pile up
    gain: 0.35,
    pitchFrom: 160,
    pitchTo: 55,
    noiseGain: 0.3,
    cutoff: 2600,
  },
  kill: {
    duration: 0.22,
    gain: 0.3,
    pitchFrom: 640,
    pitchTo: 180,
    noiseDuration: 0.06, // just a tick of grit on the attack
    noiseGain: 0.15,
    cutoff: 4200,
  },
  damage: {
    duration: 0.35, // longest of the four — taking a hit should land
    gain: 0.45,
    pitchFrom: 200,
    pitchTo: 60,
    noiseGain: 0.4,
    cutoff: 900,
  },
  click: {
    duration: 0.06,
    gain: 0.25,
    pitchLow: 440, // swept low->high to resume, high->low to pause
    pitchHigh: 880,
  },

  // Collecting a drop of either kind: a short choir chord, and the one sound here with no
  // noise layer and no pitch sweep. Everything else in the game is percussive —
  // cracks, blips, hits — so a chord that *swells* is the only one that could read
  // as a blessing rather than as another event.
  //
  // The voices are a major triad plus the octave, each one doubled a few cents
  // either side of pitch. That doubling is what makes eight sines sound like a
  // section instead of an organ: the pairs beat slowly against each other, which is
  // the chorusing a real unison has. `stagger` then starts them low to high so the
  // chord blooms upward over ~135ms rather than landing as a block.
  //
  // `gain` is *per voice* and there are eight, so the effective ceiling is
  // masterVolume * gain * 8 = 0.17 — in line with `damage`, and only reached if all
  // eight happen to align in phase, which the detuning is actively preventing.
  pickup: {
    root: 392, // G4
    ratios: [1, 1.25, 1.5, 2], // major triad + octave
    detune: 7, // cents, applied +/- to the two voices of each pair
    stagger: 0.045, // seconds between entries, low voice first
    attack: 0.12, // long enough that there's no click; this one has no transient
    duration: 0.9,
    gain: 0.06,
  },

  // The looping music bed — assets/audio/doom.mp3, the one audio file in the
  // project, because a minute and a half of music is not something oscillators
  // produce. Everything else in this block is still synthesized.
  //
  // `gain` is deliberately *not* under masterVolume: the music hangs off its own
  // node straight to the destination (see sound.js), so this is an absolute level
  // and has to be read against an effect's *effective* peak — masterVolume times
  // that effect's gain, which is 0.16 for the loudest of them, `damage`. Sitting
  // just under that is what keeps a sustained bed from burying transients that are
  // louder on paper: a gunshot peaks for 90ms, music holds its level forever.
  //
  // The loop window trims a lead-in off the front and stops well before the file's
  // 100.8s end. loopEnd has to stay inside that duration — past it the Web Audio
  // spec quietly loops to the end of the buffer instead, so an over-long window
  // reads as the trim not working rather than as an error. sound.js clamps it and
  // the sound driver asserts the decoded buffer is longer than this.
  music: {
    // Silent until the player asks for it with M. This is the *default*, not the
    // live state — sound.toggleMusic() flips its own flag at runtime and never
    // writes back here, like every other number in this file. Off because a bed
    // that starts itself on the first click is the one sound most likely to be
    // killed at the OS level and then never heard again; opting in also means the
    // start screen is silent for anyone playing where they shouldn't be.
    enabled: false,
    gain: 0.15,
    loopStart: 1, // 0:01 — skips the lead-in, and never plays it, not even once
    loopEnd: 94, // 1:34
  },
};

export const EFFECTS = {
  // Tracers are pooled; a shot fired while the pool is full reuses the oldest.
  tracerPool: 12,
  tracerLife: 0.07, // seconds — deliberately brief, it should read as a flash
  tracerColor: 0xffdca8,

  maxParticles: 500, // hard ceiling on live sparks
  muzzleSparks: 6,
  impactSparks: 20, // hitting an enemy
  worldImpactSparks: 14, // hitting floor or wall — smaller, so kills still read louder
  particleLife: 0.35,
  particleLifeJitter: 0.25, // fraction of life randomized per particle
  particleSpeed: 7, // units/sec, before jitter
  particleGravity: 11,
  particleSize: 3, // pixels — screen-space, not world units (see effects.js)
  sparkColor: 0xffc978, // muzzle
  impactColor: 0xff7a4a, // enemy hits — warm, tinted toward the enemy color
  worldImpactColor: 0xc3d5ff, // floor/wall hits — cool and pale, reads as stone chips

  // Dynamic point lights: a glow riding each enemy and a flash when the player
  // shoots. The per-enemy color and reach are on ENEMY/BOSS instead of here,
  // because they're read off `kind` like every other per-enemy tunable.
  //
  // A budget rather than one light per enemy. Every light in the scene is evaluated
  // by every material for every fragment it covers — a late round's worth of them
  // would be paid for across the whole floor — and the *count* is compiled into
  // those shader programs, so spawning and killing enemies would rebuild every
  // shader in the game mid-fight. The nearest `glowPool` enemies get one.
  //
  // 12 is most of a mid-round field, so a wave arrives lit rather than with the
  // back half of it dark. This is the knob to turn down if a machine struggles:
  // the cost is fill rate, not the count as such (see effects.js), so it's paid
  // where the lit floor covers the screen — and it's paid *with* the reach on
  // ENEMY.glow.distance, since a wider pool of light covers more fragments.
  glowPool: 12,

  // A second, separate budget for the drops, rather than letting them into
  // the pool above. The pools have different jobs and different tenancy: an enemy's
  // light is there to make a closing threat countable, while a drop just lies on the
  // floor — and lies there for PICKUP.life. On a shared pool two drops near the
  // player would hold lights that the enemies in their face need, which is exactly
  // the arrangement the nearest-wins rule exists to prevent. Small because drops are
  // few: three on the floor at once is already a slow round.
  pickupGlowPool: 3,

  // Enemy bodies are unlit, so the lights they *are* meant to read — the muzzle
  // flash and the drops, never another enemy's glow — are evaluated on the CPU and
  // added to the body color instead (see effects.js lightBodies). A gain turns a
  // light's candela into that added color and `max` caps the sum of them, or a
  // point-blank flash would wash a floater to white.
  //
  // It needs a gain of its own rather than the candela the floor sees, because this
  // term stands in for a per-fragment N·L that isn't there: it's flat across the
  // body and then multiplied down by the facet bake.
  //
  // **Two gains rather than one, and the split is the numbers being honest about what
  // they were each set against.** A drop's candela is aimed at a floor one unit under
  // it at inverse-square, where the flash's is aimed across a room at a decay of 1.2 —
  // so at the same distance one gain over both makes the drop term about four times
  // the flash's. The term is also added in three's *linear* working space, where a
  // floater's base is (0.58, 0.08, 0.05): a green term of 0.6 doesn't tint that body,
  // it replaces it, and a floater passing a health cube comes out olive. Reading as a
  // red enemy the cube is lighting — rather than as a green one — is the whole point,
  // and it's also what keeps yellow the boots' hue and nothing else's.
  //
  // All three were set by looking at the matched flash and drop pairs in
  // doomslop-lighting.mjs. Turn `flashGain` up and a shot reads as a camera flash on
  // the enemy rather than a room lighting up around it; turn `dropGain` up and the
  // body stops being red before the cube is close enough to matter.
  bodyLight: { flashGain: 0.3, dropGain: 0.08, max: 1.1 },

  muzzleFlash: {
    color: 0xffd9a0, // the tracer's warm white
    // Enough to throw the floor, a near wall and the drops into relief for a frame.
    // The enemies catch it too, but not off this number: their bodies read no lights
    // at all (see enemies.js), so what they pick up is the bodyLight term above —
    // the same falloff, with its own gain.
    intensity: 14,
    distance: 18, // where it reaches zero — how much of the room the flash touches
    // Deliberately not the physical 2. The muzzle sits ~0.4 units off the floor,
    // and nearly on it when aiming down (see WEAPON.muzzleOffset.minHeight), where
    // inverse-square puts a blown-out white spot at the barrel and leaves the rest
    // of the room untouched. A flatter falloff reads as the place lighting up for a
    // frame, which is the effect.
    decay: 1.2,
    life: 0.07, // seconds; under WEAPON.fireInterval, so two flashes can't overlap
  },
};
