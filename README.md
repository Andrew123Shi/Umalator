### A Umalator fork.

# Improvements

### Global Compare

A new Compare simulator that performs a Monte-Carlo simulation of all combinations of racetracks and conditions for a given Distance and Terrain type. Included are additional aggregate data tables showing min/max/mean/median based on Location, Distance, Terrain Condition, Weather, and Season. 

### Uma Database

One of my biggest pet peeves with the original Umalator was the need to re-input the characteristics of a uma every time I wanted to use it. The "copy link" function did alleviate the problem a bit, but it was still direly lacking in terms of real import/saving capability. This version allows you to save and load your umas into a locally saved `.json` database and includes a handy dialog menu to search for and select umas from your database. Upon first save/load, the simulator will open up Explorer and ask you for a save location, and then it will read/write from that file. If the simulator somehow can't detect the database file, then it will open up Explorer again upon which just select the existing `.json`. When saving a uma, you can give it whatever name you'd like, but by default it gives it a ID number starting from 1. (In the future, I'd like to have it automatically calculate the career rating and use that as the default name.)

### Race Optimization

The new Race Optimization mode will optimize for the best set of stats for a selected race and rating constraint (for, say, a certain league in a certain mode). The optimization approach is a simulated annealing algorithm that handles the RNG and large search space pretty well. What the optimizer does is compare the margin with the provided reference uma, and you can select between a cost function based on the median margin, mean, or the aggregate (sum of the median and mean). To select an initial condition, it first runs a Monte-Carlo simulation on 100 random umas, and chooses the best one. For now, it does not have skill optimization capability, but perhaps that can be added in the future.

As part of the Optimization implementation, the Umalator now has a built in career rating calculator. While I've tested it to be accurate with the actual game, there are some edge cases that may produce minor inaccuracies, such as if you have skills you don't have the aptitude for. For example, if you have a Green skill for End closers, but you normally run as a Pace chaser and you have an F aptitude in End chasing, the rating calculator might not calculate the correct rating contribution for that Green skill. But to be honest, should you really getting skills you don't have the aptitude for?

### Skill/Uma Chart Improved Parallelization

By default, the Skill/Uma Chart modes used four parallel workers for processing. You can now change it from 1-16 based on your preferences or system specifications. 

### Real-time Simulation UI Updates

Previously, performing a simulation would update the UI at several steps (usually at 20, 120, and 360, then 500, etc.), presumably to first give rough results while finer results are being calculated in the background. I thought this was clunky. In replacement, I've changed the logic to update the UI every 20 samples, so you can now actively see the numbers and histogram update as more samples come in. I've also added a progress bar to the right to indicate how many samples have been processed.

For Skill/Uma Chart modes, the progress bar now shows the progress of individual workers in terms of number of skills.

### Minor Bug Fixes

Stamina skills are now correctly simulated in Skill Chart mode. Previously, all stamina skills showed 0.00 change Skill Chart used to run in NoopHpPolicy and ignores HP/stamina consumption, whereas normal comparison mode uses GameHpPolicy. For those who'd like to ignore HP consumption, the option has been added as a toggle.  

The UI has been refined and polished. 

## Updating game data

To refresh game data from your local game install, run:

```
npm run update:data
```

Prerequisites:
- Perl is required in `PATH` (e.g. Strawberry Perl on Windows).
- `master.mdb` is expected at `%USERPROFILE%\AppData\LocalLow\Cygames\Umamusume\master\master.mdb`.
  - You can pass a custom path with `npm run update:data -- "C:\path\to\master.mdb"`.

The build scripts now run this update step automatically before rebuilding app artifacts.
