### A Umalator fork of https://github.com/kachi-dev/uma-tools.

# Improvements

### Global Compare

A new Compare simulator that performs a Monte-Carlo simulation of all combinations of racetracks and conditions for a given Distance and Terrain type. Included are additional aggregate data tables showing min/max/mean/median based on Location, Distance, Terrain Condition, Weather, and Season. 

### Uma Database

One of my biggest pet peeves with the original Umalator was the need to re-input the characteristics of a uma every time I wanted to use it. The "copy link" function did alleviate the problem a bit, but it was still direly lacking in terms of real import/saving capability. This version allows you to save and load your umas into a locally saved `.json` database and includes a handy dialog menu to search for and select umas from your database. Upon first save/load, the simulator will open up Explorer and ask you for a save location, and then it will read/write from that file. If the simulator somehow can't detect the database file, then it will open up Explorer again upon which just select the existing `.json`. When saving a uma, you can give it whatever name you'd like, but by default it gives it a ID number starting from 1. (For me, I just use this ID in the memo section inside the game). 

### Skill/Uma Chart Improved Parallelization

By default, the Skill/Uma Chart modes used four parallel workers for processing. You can now change it from 1-16 based on your preferences or system specifications. 

### Real-time Simulation UI Updates

Previously, performing a simulation would update the UI at several steps (usually at 20, 120, and 360, then 500, etc.), presumably to first give rough results while finer results are being calculated in the background. I thought this was clunky. In replacement, I've changed the logic to update the UI every 20 samples, so you can now actively see the numbers and histogram update as more samples come in. I've also added a progress bar to the right to indicate how many samples have been processed.

For Skill/Uma Chart modes, the progress bar now shows the progress of individual workers in terms of number of skills.

## Commands for syncing with upstream repo for updates:

To fetch updates from the original repo:
git fetch upstream  

To merge updates into your private repo’s main branch:
git merge upstream/main  
 
To push merged changes to your private repo:
git push origin main  
