import { h } from 'preact';

import './IntroText.css';



export function INTRO(props){
	return(
		<div id="REALINTROTEXT">

			
		</div>


	)


}




export function IntroText(props) {
	return (
		<div id="introtext">
			<details>
				<summary>Caveats</summary>
				The simulator is fairly complete and implements nearly all relevant game mechanics, with the following exceptions:
				<ul>
					<li>
						<details>
							<summary>Spot Struggle ignores LaneGap activation condition and is based solely on the distance between umas.</summary>
							<p>Due to the difficulty of accurately simulating lane movement, Spot Struggle is activated when two or more Front Runner umas are within 3.75m of one another (5m for Runaway).</p>
							<p>We do simulate lane movement, however, this is simply an approximation for the purpose of determining the effectiveness of lane movement skills post 1st-anniversary.</p>
						</details>
					</li>

					<li>
						<details>
							<summary>Early-race lane movement is simulated approximately as this mechanic is dependent on other umas in the race.</summary>
							<p>Specifically, your lane movement largely depends on overtake targets and blocking.</p>
							<p>We have used logic from the mee1080 race simulator to approximate lane movement for the purposes of observing the effect of certain lane movement skills, however, it is not accurate enough to use for mechanics like Spot Struggle and Dueling.</p>
						</details>
					</li>

					<li>
						<details>
							<summary>Pseudo-random skills based on the location of other umas use a best-effort estimation for the distribution of their activation locations which may not be perfectly reflective of in-game behavior in all circumstances.</summary>
							<p>Skills that have conditions that require you to be blocked, are based on other umas in your proximity, etc, are modeled according to statistical distributions intended to simulate their in-game behavior but may not be perfectly accurate. It should always find the correct minimum and maximum but the reported mean and median should sometimes be taken with a grain of salt. For example skills with blocked conditions are generally better in races with more umas and worse with fewer. Use your better judgement.</p>
							<p>Skills with conditions with <code>_random</code> in the name (e.g. <code>phase_random</code>, <code>corner_random</code>, <code>straight_random</code>) are implemented identically to the in-game logic and will have more accurate mean/median values, as are skills based purely on the course geometry with no blocked front/side/surrounded conditions.</p>
						</details>
					</li>

					<li>
						<details>
							<summary>Skill cooldowns are not implemented.</summary>
							Skills only ever activate once even if they have a cooldown like Professor of Curvature or Beeline Burst. 
						</details>
					</li>
				</ul>
				By and large it should be highly accurate. It has been battle-tested on the JP server for several years.
			</details>
			<details>
				<summary>Credits</summary>
					<p>This is a fork of the Umalator released by Kachi-dev. All credits to the original Umalator go to Kachi and everyone before him that made his version possible!</p>
			</details>
			<footer id="sourcelinks">
			Source Code: <a href="https://github.com/Andrew123Shi/Umalator/">https://github.com/Andrew123Shi/Umalator/</a>. Original Umalator: <a href="https://kachi-dev.github.io/uma-tools/umalator-global/">Simulator</a>, <a href="https://github.com/kachi-dev/uma-tools">GitHub</a>
			</footer>
		</div>
	);
	;}
