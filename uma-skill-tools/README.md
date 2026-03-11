# uma-skill-tools

Tools and libraries for simulating races in ウマ娘 プリティーダービー and analyzing skill effects. See the readme in the tools/ folder for usage of the command-line tools.

Last updated 3/10/2026 by Andrew Shi

Setup:

```
git clone https://github.com/alpha123/uma-skill-tools.git
cd uma-skill-tools
npm install --dev
```

This will install `ts-node`, which you can use to run the CLI tools.

Charting features require Python and matplotlib.

# Design

Broadly, the framework is divided into two parts:

- Simulating a race
- Parsing skill conditions and turning them into points on a course where the skill will activate

The former is mostly contained in RaceSolver.ts, which numerically integrates your position and velocity over the course of a race. It is provided with effects that activate at specified times, which is used to implement skills. Activation is controlled by *static conditions* or a *trigger*, which is just a region on the track, and *dynamic conditions*, which is a boolean function dependent on the state of the race solver. Once a trigger is entered, the corresponding dynamic conditions are checked and if they return true the effect is activated for a specified duration.

The latter part is responsible for taking skill data mined from the game and generating the triggers and dynamic conditions. It can be further subdivided into two parts:

- ConditionParser.ts and ActivationConditions.ts, which parse the skill conditions into a tree and, given a course, reduce that to a list of regions on the course where the skill has the *potential* to activate, and its dynamic conditions (if any).
- ActivationSamplePolicy.ts, which samples the list of regions to determine triggers for where the skill will actually activate. Since many skills are either random or modeled as random, many samples are supposed to be taken and the race solver ran many times with different sampled trigger points.

Each skill condition has an associated *sample policy* such as immediate, random (of various types), or random according to a particular probability distribution. Immediate means all samples are the earliest point in their allowable regions, for example phase>=2 is immediate and all samples will be the start of phase 2. The difference between the two random types is the former is used for actually random conditions (i.e., ones that end in \_random, like phase_random, all_corner_random, etc) and the latter is used for conditions that are not actually random but involve other umas in some way and so are modeled as random. When skill conditions are combined with & or @ some sample policies dominate other ones, so something like is_lastspurt==1&phase_random==3 will be sampled randomly (is_lastspurt==1 would otherwise always be sampled as activating immediately).

The sample policy associated with a condition is more of just a default and technically the output of any condition tree can be sampled with any sample policy. This is intended to allow the user some choice in how certain conditions are modeled, since the sample policy is what controls where a given skill is "likely" to activate.

# Caveats

## Scope of simulation (single uma vs multi-uma)

Originally this library was written to simulate a **single uma** in isolation in order to estimate distance gain from individual skills under tightly controlled conditions. In that original setting, other umas are not explicitly present; many multi-uma-related conditions are instead modeled via probability distributions.

In the Umalator application, the same engine is also used for **Race Compare** and related features, which simulate:

- two main runners (Uma 1 and Uma 2), plus
- one or more pacers (depending on `pacemakerCount` / `PosKeepMode`).

These runners share a common RNG fork and interact through pacing, position keep, and some contested states (e.g. dueling, lead competition). The original “only one uma” caveat still applies if you use the library as a pure one-uma skill tester, but Umalator’s compare/optimizer flows do run multiple umas at once.

This hybrid design has some secondary effects:

- Many conditions that conceptually depend on a full 9–18 horse field (e.g. `order_rate`) are still approximated using parameters like `numUmas` and strategy-based bands rather than tracking a full race card.
- Some multi-uma phenomena (blocked lanes, full lane geometry, etc.) remain simplified or probabilistic.

### Position keep

The original README stated that position keep was “mostly not simulated except for pace down.” That is **no longer accurate** for Umalator’s usage:

- `RaceSolver` implements a full position-keep state machine with states **PaceUp**, **PaceDown**, **SpeedUp**, and **Overtake**, driven by:
  - gaps to a pacer,
  - current strategy (`Nige`, `Senkou`, `Sasi`, `Oikomi`, `Oonige`),
  - and wisdom-based random checks.
- These states affect target speed via a `posKeepSpeedCoef` and are tracked for UI as activation segments.

What is still relevant:

- Position keep behavior is still an approximation of the in-game system and depends on a small field (2 mains + pacer(s)), not a full 18-horse race.
- Some interactions that strongly depend on large fields or complex crowding patterns are not modeled in detail.

### Order conditions

The original note said that order conditions like `order` / `order_rate` are “meaningless” and “assumed to always be fulfilled” because no other umas exist. That is **partially out of date**:

- The engine now supports order-related conditions using:
  - `numUmas` (usually 9 for app charts), and
  - an `orderRange` derived from running style (e.g. `Nige: [1,1]`, `Sasi: [5,9]`).
- In modes where the caller provides an `orderRange`, `order` / `order_rate` conditions are enforced **statically** against that band during condition preprocessing (trigger-region generation).

However, two important caveats remain:

- These checks are **not live per-frame rank checks**; they are applied when building trigger regions, using a coarse proxy for “typical” positions for that strategy.
- In modes where `orderRange` is `null` (e.g. some compare flows), `order` / `order_rate` conditions effectively do **not** restrict activation (their filters become no-ops).

So order conditions are supported but approximated; they are not a perfect reflection of in-race placing.

## Does not take inner/outer lane differences into account

This caveat is **still accurate** with respect to distance traveled:

- The simulator tracks `currentLane` and `targetLane` and applies lane movement rules (side blocking, overtake moves, lane-change speed, etc.), so some aspects of lateral positioning are modeled.
- However, **distance cost from being in outer lanes is not applied to `pos`**. Lane primarily affects lane movement and some skill effects, not total path length.

In practice this means inner vs outer lane choice does not directly change the simulated distance traveled, even though lane changes themselves and lane-based conditions still exist.

## Skills that combine accumulatetime with a condition modeled by a probability distribution activate too early a lot of the time

This is a bug but somewhat hard to fix with the current architecture. Basically, they activate immediately after the accumulatetime condition is satisfied more than would be predicted by the distribution used to model them. Fixing this is kind of non-trivial and in practice I think it's not really that important.

List of skills affected:

- ウマ好み / ウママニア
- 先頭プライド / トップランナー
- 遊びはおしまいっ！ / お先に失礼っ！
- スリップストリーム
- 負けん気 / 姉御肌
- 砂浴び○ / 優雅な砂浴び
- possibly others

## Not yet implemented

All of these were originally listed as “planned soon.” Some have since been implemented or partially implemented; others remain open tasks. See the “Historical caveats” section below for the original wording.

### Downhill speedup mode

**Now implemented.**

- Downhill-mode logic exists in `RaceSolver`:
  - `isDownhillMode`, `downhillTimer`, `downhillRng`, `downhillActivations`.
  - `downhillCheck()` and `updateHills()` decide when downhill mode starts/stops.
  - `updateTargetSpeed()` adds a speed bonus while in downhill mode.

Downhill remains stochastic and simplified but is present and affects both speed and logged activations.

### Kakari (rushed state)

**Now implemented.**

- A “rushed/kakari” state is modeled via:
  - `isRushed`, `hasBeenRushed`, `rushedSection`, `rushedEnterPosition`,
  - a wisdom-based chance (`initRushedState()`), Self-Control skill mitigation, and
  - `updateRushedState()` controlling entry, random recovery, and maximum duration.
- Activations are tracked for UI as `rushedActivations`.

This uses HP via `GameHpPolicy` in compare mode and interacts with last spurt timing and stamina.

### Scaling effects

**Partially implemented.**

- Unique-level scaling for unique skills is implemented in `RaceSolverBuilder`:
  - `uniqueLevelMultiplier()` and `applyUniqueLevelScaling()` adjust effect modifiers based on unique level.
- Other kinds of complex scaling (e.g. certain stack-based or contextually-scaling buffs) may still be missing or simplified.

So the blanket statement “scaling effects are not implemented” is no longer true; at least unique level scaling is supported.

### Skill cooldowns

At the moment skills can only activate once and skills with a cooldown (like 弧線のプロフェッサー or ハヤテ一文字) only activate once. This is hard to implement without some relatively major organizational changes (currently pending).

This remains accurate in the current implementation: skills are tracked in `usedSkills` and do not re-trigger with cooldowns.

# Historical caveats (original text, now outdated or partially addressed)

The following sections preserve the original README wording for reference. They describe the design and limitations of earlier versions of the library; see the main “Caveats” section above for how they map onto the current implementation.

## Original: single-uma-only simulation

> Does not fully simulate a race, only simulates one uma  
>  
> This is by design. The intention is to determine the distance gain of skills which requires as controlled of an environment as possible. Trying to simulate a full race with other umas makes it too difficult to isolate the effects of a single skill.  
>  
> This has a lot of secondary effects. Many skill conditions involve other umas in some way. Those conditions are instead modeled by probability distributions based mainly on guessing where they tend to activate.

## Original: position keep caveat

> Position keep  
>  
> Due to obviously involving other umas, position keep is mostly not simulated except for pace down for non-runners at the beginning of a race. In this case the pace down is fairly predictable and has effects on the efficiency of certain skills, so it is simulated.  
>  
> Runner speed up mode/overtake mode is probably relatively predictable early in the race and may be implemented in the future.

## Original: order conditions caveat

> Order conditions  
>  
> Obviously since no other umas exist conditions like order, order_rate, etc are meaningless. By default these are assumed to always be fulfilled, which I think is the expected behavior in most cases since you only really care about things like angling, anabolic, etc activating immediately. It's possible to use one of the random sample policies with these anyway, which may be useful for modeling anabolic+gear combo or something.

## Original: downhill speedup mode not implemented

> Does not simulate downhill speedup mode  
>  
> The architecture now allows it to be doable in a way to usefully allow comparisons even though the effects are random.

## Original: kakari not implemented

> Does not simulate kakari  
>  
> Easily doable but no real point without tracking hp consumption since both simulations would always kakari at the same point during a comparison.  
>  
> If it is implemented would probably have the effect of increasing int decreasing average バ身 gain due to less kakari, since position keep effects aren't simulated which would otherwise counteract it.

## Original: scaling effects not implemented

> Scaling effects are not implemented yet  
>  
> Some of these are going to be a real pain.

# Credit

English skill names are from [GameTora](https://gametora.com/umamusume).

KuromiAK#4505 on Discord let me hassle him about various minutiae of game mechanics.

# License

Copyright (C) 2026 Andrew Shi

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
