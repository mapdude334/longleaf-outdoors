import type { Water } from './layers/waters';
import { esc } from './util';

export type FishingSeason = 'spring' | 'summer' | 'fall' | 'winter';
export type FishingTime = 'dawn' | 'day' | 'dusk' | 'night';
export type WaterClarity = 'all' | 'clear' | 'stained' | 'muddy';

type Group = 'largemouth' | 'riverBass' | 'crappie' | 'sunfish' | 'channelCat' | 'blueCat' | 'flathead' | 'striped' | 'trout' | 'pickerel' | 'walleye' | 'redfish' | 'flounder' | 'reef';
type Recipe = { lure: string; rig: string; retrieve: string; zone: string };
type GroupGuide = {
  seasons: Record<FishingSeason, Recipe>;
  time: Record<FishingTime, string>;
  colors: Record<Exclude<WaterClarity, 'all'>, string>;
};

const GROUPS: Record<Group, GroupGuide> = {
  largemouth: {
    seasons: {
      spring: { lure: 'Suspending jerkbait or 3/8-ounce spinnerbait; add a Texas-rigged stick worm around cover.', rig: 'Jerkbait on a medium spinning/casting setup; Texas rig with a 3/0 worm hook for wood or grass.', retrieve: 'Pause the jerkbait after each twitch in cool water; slow-roll the spinnerbait or let the worm fall beside cover.', zone: 'Warming pockets, gravel banks, secondary points and flooded wood.' },
      summer: { lure: 'Topwater early and late; a Texas-rigged worm, jig or deep-diving crankbait once the sun is high.', rig: 'Weightless or light Texas rig in shallow cover; heavier worm or football jig on deeper structure.', retrieve: 'Keep topwater moving along edges; drag or hop bottom baits slowly through shade and drop-offs.', zone: 'Shaded docks, grass edges, brush, creek-channel bends and offshore points.' },
      fall: { lure: 'Lipless crankbait, spinnerbait or shad-colored swimbait.', rig: 'Tie direct to moving bait; use a 3/8-ounce jig or Texas rig when fish are tight to cover.', retrieve: 'Cover water at a steady pace, then pause or change speed when baitfish are present.', zone: 'Creek arms, wind-blown banks, points and visible shad activity.' },
      winter: { lure: 'Suspending jerkbait, compact jig or finesse worm.', rig: 'Light line and a 1/8–3/8-ounce jig or drop-shot for deeper, clear water.', retrieve: 'Slow down; give suspending baits long pauses and keep soft plastics close to bottom.', zone: 'Deeper points, channel swings, bluff banks and the first nearby cover.' },
    },
    time: { dawn: 'Start shallow with a walking bait, popper or buzzbait along edges and points.', day: 'Move to shade, docks, brush or deeper channel edges; slow down with a worm or jig.', dusk: 'Return to shallow cover with a spinnerbait, swimbait or topwater as light fades.', night: 'A dark, slow spinnerbait or bulky worm can help fish track the bait. Keep casts controlled around docks and wood.' },
    colors: { clear: 'Green pumpkin, watermelon, translucent shad or natural bluegill.', stained: 'White/chartreuse, green pumpkin or a shad pattern with a little contrast.', muddy: 'Black/blue or white/chartreuse; favor vibration and a clear silhouette.' },
  },
  riverBass: {
    seasons: {
      spring: { lure: 'Small crawfish jig, compact spinnerbait or suspending minnow bait.', rig: '1/8–3/8-ounce jig with a craw trailer; use a finesse worm when fish are pressured.', retrieve: 'Cast across current seams and let the lure drift or crawl naturally with the flow.', zone: 'Rocky points, shoals, eddies and protected pockets near moving water.' },
      summer: { lure: 'Small swimbait, tube, finesse jig or topwater at low light.', rig: 'Light jighead or drop-shot for clear water; weedless Texas rig around wood.', retrieve: 'Work upstream or across the seam, keeping the bait near bottom without hanging in rocks.', zone: 'Current breaks, shaded banks, boulder edges and deeper pools.' },
      fall: { lure: 'Compact spinnerbait, minnow-shaped swimbait or craw jig.', rig: 'Use a 1/8–3/8-ounce head or jig matched to the current; downsize in low flow.', retrieve: 'Cover seams and rocky banks, changing speed to match the current and forage.', zone: 'Creek mouths, rocky runs, eddies and pools beside shallow shoals.' },
      winter: { lure: 'Small hair jig, tube or suspending jerkbait.', rig: 'Light fluorocarbon with a 1/8-ounce jig or drop-shot.', retrieve: 'Fish slowly and thoroughly; pause in deeper slack water between current pushes.', zone: 'Deep pools, protected eddies and the slow side of current breaks.' },
    },
    time: { dawn: 'Try a small topwater or minnow bait on shallow seams before bright sun.', day: 'Work shade, deeper pools and the slow side of current breaks with a compact jig.', dusk: 'Use a moving swimbait or spinnerbait along rocky banks and current edges.', night: 'Stay with familiar, safe access and use a slow dark-profile jig near slack water; avoid wading unfamiliar current.' },
    colors: { clear: 'Green pumpkin, brown/orange craw, olive or translucent shad.', stained: 'White, chartreuse, brown/orange or black with a bright trailer.', muddy: 'Black/blue, black/chartreuse or white with vibration.' },
  },
  crappie: {
    seasons: {
      spring: { lure: 'Small minnow or 1/16–1/8-ounce soft-plastic jig under a float.', rig: 'Slip float or fixed bobber; a light jighead lets the bait hover beside brush.', retrieve: 'Slowly swim or suspend the bait, adjusting depth until fish respond.', zone: 'Shallow brush, docks, bridge pilings and creek arms as water warms.' },
      summer: { lure: 'Small minnow, 1/16-ounce jig or tiny soft-plastic bait.', rig: 'Vertical jigging pole or slip-float rig; use light line and small hooks.', retrieve: 'Hold the bait steady at the fish depth or make very slow lifts.', zone: 'Brush piles, standing timber, bridge shade and channel edges.' },
      fall: { lure: 'Small minnow imitation or 1/16–1/8-ounce jig.', rig: 'Cast, troll slowly or suspend beneath a float around cover.', retrieve: 'Follow baitfish into creek arms and vary depth before changing color.', zone: 'Creek mouths, brush, docks and the edges of deeper channels.' },
      winter: { lure: 'Small jig, live minnow or compact vertical spoon.', rig: 'Vertical jig on light line; use a slip float when fish are suspended.', retrieve: 'Keep the bait near the school and use tiny lifts with long pauses.', zone: 'Deep brush, timber and channel bends.' },
    },
    time: { dawn: 'Start around shallow brush or docks; use a float to control depth.', day: 'Look for suspended fish beside deep cover, timber or bridge shade; vertical jig slowly.', dusk: 'Check nearby brush and creek-arm edges as fish move shallower.', night: 'Lighted docks can concentrate bait and crappie. Use a float or vertical jig and keep safe boat lighting.' },
    colors: { clear: 'Pearl, silver, smoke, or natural minnow.', stained: 'White/chartreuse, pink/white or a subtle chartreuse tail.', muddy: 'Black/chartreuse, bright pink or white with a visible profile.' },
  },
  sunfish: {
    seasons: {
      spring: { lure: 'Cricket, small worm or 1/32-ounce jig.', rig: 'Small hook under a bobber; use a light split shot only if needed.', retrieve: 'Keep the bait above the bottom and close to beds without dragging through them.', zone: 'Sandy or gravel pockets, shallow coves and protected shoreline cover.' },
      summer: { lure: 'Cricket, red worm or tiny grub.', rig: 'Small hook with a fixed float; a 1/32-ounce jig works for active fish.', retrieve: 'Present naturally and move to shade when the bank warms.', zone: 'Shaded docks, weed edges, brush and shallow beds.' },
      fall: { lure: 'Small jig, cricket or worm.', rig: 'Float rig for shallow edges; tiny split-shot rig near deeper cover.', retrieve: 'Fish slowly around cover and adjust depth before moving.', zone: 'Vegetation edges, docks and protected coves.' },
      winter: { lure: 'Small worm or tiny hair/plastic jig.', rig: 'Light line with a small hook or 1/32-ounce jig; keep it near the bottom.', retrieve: 'Use a slow, subtle presentation and let the bait rest longer.', zone: 'Deeper brush, docks and the nearest drop-off.' },
    },
    time: { dawn: 'Try a cricket or small popper around shallow cover as light comes up.', day: 'Sunfish often feed well in daylight; fish beds, shade and shallow cover with a float.', dusk: 'Work the warm edge of coves and shaded cover with a small natural bait.', night: 'Usually switch to a daytime plan; if fishing after dark, use a small bait near lit, familiar access.' },
    colors: { clear: 'Natural cricket/worm; tiny olive, black or bluegill-colored jig.', stained: 'Natural bait or a small chartreuse/white jig.', muddy: 'Use scented live bait or a bright tiny jig; keep the profile small.' },
  },
  channelCat: {
    seasons: {
      spring: { lure: 'Nightcrawler, cut shad or chicken liver.', rig: 'Slip-sinker/Carolina rig with a circle hook sized to bait and fish.', retrieve: 'Hold near bottom; keep enough weight to stay in place without burying the bait.', zone: 'Creek channels, outside bends and warming flats near deeper water.' },
      summer: { lure: 'Cut shad, nightcrawler, liver or prepared bait.', rig: 'Slip sinker or a slip float for suspended fish; use a circle hook when appropriate.', retrieve: 'Fish scent baits slowly and check them regularly in warm water.', zone: 'Channel edges, shaded banks, holes and current seams.' },
      fall: { lure: 'Cut bait, worms or prepared catfish bait.', rig: 'Carolina rig along a channel edge; drift when fish are spread out.', retrieve: 'Cover a little water, then anchor where bites or baitfish show.', zone: 'Creek mouths, channel bends, riprap and deeper flats.' },
      winter: { lure: 'Fresh cut bait or nightcrawler.', rig: 'Bottom rig with enough weight to hold in the channel.', retrieve: 'Keep bait near bottom and slow the move between spots.', zone: 'Deeper holes, channel bends and warm-water inflows where legal.' },
    },
    time: { dawn: 'Fish channel edges and nearby flats with a bottom rig.', day: 'Focus on deeper holes, shade and current seams; keep bait near bottom.', dusk: 'Move toward feeding flats and bank edges with cut bait or worms.', night: 'Often a productive window for catfish. Use a secure rod holder, navigation lights and familiar access.' },
    colors: { clear: 'Bait choice and scent matter more than lure color; use fresh, natural bait.', stained: 'Fresh cut bait, liver or prepared bait with strong scent.', muddy: 'Use a strong-scent bait and keep it still near the fish.' },
  },
  blueCat: {
    seasons: {
      spring: { lure: 'Fresh cut shad or other legal cut fish bait.', rig: 'Slip-sinker or three-way bottom rig with a circle hook.', retrieve: 'Drift slowly or anchor on a channel edge; keep the bait close to bottom.', zone: 'River channels, points below inflows and current breaks.' },
      summer: { lure: 'Cut shad, herring or other locally available legal baitfish.', rig: 'Drift rig or Carolina rig; match weight to current and depth.', retrieve: 'Drift along channel contours or suspend bait over deep water.', zone: 'Deep channels, ledges, river bends and dam tailwaters when safe.' },
      fall: { lure: 'Cut shad or fresh cut bait.', rig: 'Bottom drift rig with a circle hook.', retrieve: 'Follow baitfish and make controlled drifts across channel edges.', zone: 'Main-river channels, points and creek mouths.' },
      winter: { lure: 'Fresh cut bait fished slowly.', rig: 'Heavy enough bottom rig to hold the presentation in current.', retrieve: 'Make shorter drifts and pause over deep holes.', zone: 'Deep channel bends, holes and current seams.' },
    },
    time: { dawn: 'Drift channel edges as baitfish move; keep the bait near bottom.', day: 'Use deeper channels and ledges; vary depth before moving far.', dusk: 'Follow baitfish toward points and channel edges with a slow drift.', night: 'Can be productive on familiar channel edges. Keep boat positioning conservative around current and dams.' },
    colors: { clear: 'Color is secondary to fresh cut bait and location.', stained: 'Fresh cut shad gives scent and a visible natural profile.', muddy: 'Fresh, oily cut bait and a strong scent trail are useful.' },
  },
  flathead: {
    seasons: {
      spring: { lure: 'Fresh cut bait or legally caught live sunfish/minnow.', rig: 'Strong leader and a circle hook matched to the bait; secure the rod.', retrieve: 'Present near cover without pinning the bait into snags.', zone: 'Deep wood, outside bends and current breaks as water warms.' },
      summer: { lure: 'Live sunfish or other legal live bait; fresh cut bait is a backup.', rig: 'Slip-sinker or float rig near cover with stout tackle.', retrieve: 'Set the bait close to cover and let it swim naturally.', zone: 'Snags, logjams, undercut banks and deep holes.' },
      fall: { lure: 'Live or fresh cut bait.', rig: 'Bottom rig with a strong hook and abrasion-resistant leader.', retrieve: 'Fish near cover during low light; reposition carefully if snagged.', zone: 'Deep wood, current breaks and channel edges.' },
      winter: { lure: 'Fresh cut bait; expect a slower bite.', rig: 'Bottom rig with sturdy tackle and a secure rod holder.', retrieve: 'Keep the bait still near the deepest nearby cover.', zone: 'Deep holes and stable cover.' },
    },
    time: { dawn: 'Check deep wood and the quiet edge of current breaks.', day: 'Keep bait close to deep cover and avoid pulling it through snags.', dusk: 'Move a live bait near logjams and outside bends as light fades.', night: 'A common flathead window. Use secure tackle, safe access and legal bait; avoid standing in swift or unfamiliar water.' },
    colors: { clear: 'Natural live bait or cut bait; color is not the main trigger.', stained: 'Use fresh bait with scent and movement.', muddy: 'Keep fresh bait close to cover and rely on scent/vibration.' },
  },
  striped: {
    seasons: {
      spring: { lure: 'Shad-shaped swimbait, bucktail jig or small jigging spoon.', rig: '3–5-inch swimbait on a jighead; add a spoon for deeper schools.', retrieve: 'Cast to surface activity or count the lure down through a school.', zone: 'River channels, dam tailwaters and points with current or baitfish.' },
      summer: { lure: 'Jigging spoon, deep swimbait or trolled shad-colored lure.', rig: 'Vertical spoon or swimbait; use a depth-controlled trolling setup if equipped.', retrieve: 'Locate the depth of bait/schools; retrieve smoothly through them.', zone: 'Cooler, oxygenated open water, main-lake points and deep channels.' },
      fall: { lure: 'Walking topwater, swimbait or lipless crankbait that matches shad.', rig: 'Use a casting setup for surface schools; a jighead for deeper fish.', retrieve: 'Move quickly when fish chase bait, then slow down once they sound.', zone: 'Main-lake points, creek mouths and visible shad schools.' },
      winter: { lure: 'Jigging spoon, bucktail or compact shad swimbait.', rig: 'Vertical presentation with enough weight to reach the school.', retrieve: 'Use short lifts and pauses; keep contact with the target depth.', zone: 'Deep channels, dam areas and stable open-water schools.' },
    },
    time: { dawn: 'Watch for surface feeding and cast a shad-colored topwater or swimbait.', day: 'Use electronics or visible bait to find depth; jig through schools.', dusk: 'Follow baitfish toward points and creek mouths with a swimbait.', night: 'Stay with a slow shad profile near known open-water routes; avoid running at speed in darkness.' },
    colors: { clear: 'Pearl, silver, translucent shad or natural baitfish.', stained: 'White, chartreuse/white or silver with contrast.', muddy: 'Bright white/chartreuse or a dark high-contrast profile.' },
  },
  trout: {
    seasons: {
      spring: { lure: 'Small inline spinner, spoon, nymph or minnow-shaped plug.', rig: 'Light line and a small single hook where regulations require; use natural baits only where legal.', retrieve: 'Drift or retrieve across current at a natural speed; avoid dragging through redds.', zone: 'Cool riffles, runs and pool tails; in lakes, wind-blown banks and cool inflows.' },
      summer: { lure: 'Small nymph, soft-hackle fly or subtle spinner during cool periods.', rig: 'Light fly/ultralight setup and barbless or single hooks where required.', retrieve: 'Fish early in cool water; stop if water temperatures are stressful or unsafe.', zone: 'Cold, oxygenated water, shaded runs and spring-fed areas.' },
      fall: { lure: 'Small spinner, spoon, nymph or minnow imitation.', rig: 'Light line; match hook and bait to current regulations.', retrieve: 'Use a controlled drift and avoid spawning redds or visibly spawning fish.', zone: 'Pool heads, current seams and cool lake tributaries.' },
      winter: { lure: 'Small nymph, egg imitation or compact spoon where permitted.', rig: 'Light tackle; use a float or indicator to control depth.', retrieve: 'Slow the drift and keep the bait close to the bottom.', zone: 'Deeper pools and gentle seams with stable, cool water.' },
    },
    time: { dawn: 'Cool low light can suit small spinners and surface insects; keep a natural drift.', day: 'Focus on shade and deeper runs; avoid stressing trout in warm water.', dusk: 'Try a small dry fly or spinner near a pool tail as insects become active.', night: 'Usually not the first recommendation in small streams; use a daytime plan and prioritize safe access.' },
    colors: { clear: 'Olive, brown, black, silver and natural insect patterns.', stained: 'Gold/copper, black or a slightly brighter spinner.', muddy: 'Use a visible spinner or dark silhouette only where water remains safe for trout.' },
  },
  pickerel: {
    seasons: {
      spring: { lure: 'Small minnow jerkbait, inline spinner or weedless spoon.', rig: 'Light wire leader or bite-resistant leader; keep hooks clear of thick weeds.', retrieve: 'Use a steady retrieve with short pauses beside cover.', zone: 'Shallow vegetation, creek edges and warm backwater pockets.' },
      summer: { lure: 'Weedless spoon, soft jerkbait or compact spinnerbait.', rig: 'Texas-rigged soft bait or spoon through vegetation; wire leader helps prevent bite-offs.', retrieve: 'Work weed edges and pockets, speeding up if fish follow.', zone: 'Weed edges, shady coves and submerged vegetation.' },
      fall: { lure: 'Minnow jerkbait, spoon or swimbait.', rig: 'Use a bite-resistant leader and a controlled casting setup.', retrieve: 'Vary speed with short pauses around weed points.', zone: 'Vegetation edges, creek mouths and shallow baitfish areas.' },
      winter: { lure: 'Suspending minnow bait or small spoon.', rig: 'Light wire leader and slow, controlled retrieve.', retrieve: 'Pause longer and keep the lure near remaining vegetation.', zone: 'Deep weed edges and protected channels.' },
    },
    time: { dawn: 'Cast a minnow bait along weed edges before bright light.', day: 'Pick shaded pockets and vegetation edges; slow down around cover.', dusk: 'Work a spinner or spoon through shallow weed lines.', night: 'Usually less efficient than daylight; use a slow, weedless presentation if you continue.' },
    colors: { clear: 'Perch, silver, natural minnow or translucent green.', stained: 'Gold, white or chartreuse with a clear outline.', muddy: 'Black/white or bright chartreuse with vibration.' },
  },
  walleye: {
    seasons: {
      spring: { lure: 'Jig-and-minnow, hair jig or shallow-running minnow bait.', rig: '1/8–3/8-ounce jig matched to depth/current; use live bait only where legal.', retrieve: 'Crawl or hop slowly along bottom and avoid snagging spawning fish.', zone: 'Rocky/gravel points, tributary runs and tailwaters where open to fishing.' },
      summer: { lure: 'Crawler harness, minnow-shaped crankbait or jigging spoon.', rig: 'Bottom-bouncer/trolling harness or vertical jig matched to depth.', retrieve: 'Follow contour edges and change speed until the lure contacts the target zone.', zone: 'Deep points, ledges and cooler low-light water.' },
      fall: { lure: 'Jig-and-minnow, blade bait or deep minnow crankbait.', rig: 'Vertical jig for schools; bottom-bouncer for broad flats.', retrieve: 'Keep the lure near bottom with short hops.', zone: 'Rocky points, channel edges and deeper flats.' },
      winter: { lure: 'Jig-and-minnow or blade bait.', rig: 'Light jig in slack water; add weight only as needed for depth/current.', retrieve: 'Slow lift-and-drop with long pauses.', zone: 'Deep pools and stable channel edges.' },
    },
    time: { dawn: 'Low light can bring fish shallow; try a minnow bait along a point.', day: 'Work deeper breaks slowly with a jig or bottom-bouncer.', dusk: 'Try rocky points and edges with a minnow imitation.', night: 'Often a useful walleye window where legal and safe; fish familiar shorelines or controlled boat routes.' },
    colors: { clear: 'Perch, shiner, silver or natural brown/orange.', stained: 'Gold, chartreuse or white with a darker back.', muddy: 'Chartreuse/orange or a dark silhouette with vibration.' },
  },
  redfish: {
    seasons: {
      spring: { lure: 'Paddletail, jerk shad or shrimp under a popping cork.', rig: '3–4-inch soft plastic on a 1/8–3/8-ounce jighead; adjust weight to tide/current.', retrieve: 'Hop or swim over grass edges and oyster margins; follow moving tide.', zone: 'Tidal creeks, grass edges, oyster points and shallow flats.' },
      summer: { lure: 'Topwater at low light, paddletail or live shrimp under a popping cork.', rig: 'Light jighead or popping-cork leader; use circle hooks where appropriate.', retrieve: 'Work edges with a steady swim and pause; avoid hot, stagnant water.', zone: 'Early/late shallow flats, creek mouths and shaded docks.' },
      fall: { lure: 'Paddletail, gold spoon or live shrimp beneath a popping cork.', rig: 'Jighead or spoon over grass; cork rig when fish are feeding on shrimp.', retrieve: 'Cast ahead of moving fish and use a moderate retrieve.', zone: 'Creek mouths, marsh drains, oyster bars and current edges.' },
      winter: { lure: 'Slow paddletail, shrimp imitation or live shrimp.', rig: 'Light jighead or popping cork in shallow water; add weight for deeper bends.', retrieve: 'Slow down and keep the bait near the bottom or suspended above it.', zone: 'Deeper tidal creeks, mud flats on warming tides and protected bends.' },
    },
    time: { dawn: 'Work shallow flats and grass edges with a topwater or paddletail.', day: 'Use deeper creek bends, shade and moving water; slow the retrieve.', dusk: 'Follow the tide into marsh drains with a paddletail or shrimp under a cork.', night: 'Fish familiar dock or creek edges with safe navigation; tides and current matter more than clock time.' },
    colors: { clear: 'Pearl, natural shrimp, silver or translucent baitfish.', stained: 'Gold, root beer, chartreuse or white with contrast.', muddy: 'Dark purple/black or bright chartreuse; add vibration.' },
  },
  flounder: {
    seasons: {
      spring: { lure: 'Small paddletail or live mud minnow on a jighead.', rig: '1/4–1/2-ounce jighead or Carolina rig, adjusted to tide and depth.', retrieve: 'Drag or hop slowly along bottom; pause after contact.', zone: 'Creek mouths, sandy edges, oyster points and current seams.' },
      summer: { lure: 'Paddletail, shrimp imitation or live minnow.', rig: 'Bottom jighead or Carolina rig with a short leader.', retrieve: 'Keep contact with bottom and move slowly with the tide.', zone: 'Inlets, marsh drains, sandy pockets and channel edges.' },
      fall: { lure: 'Paddletail or live baitfish along a moving tide.', rig: 'Jighead or bottom rig sized for current.', retrieve: 'Make short hops, pausing on sand near structure.', zone: 'Creek mouths, passes and deeper edges near marsh drains.' },
      winter: { lure: 'Small minnow imitation or live bait where permitted.', rig: 'Light bottom rig in gentle current.', retrieve: 'Slowly drag the bait along protected channel edges.', zone: 'Deeper tidal creeks and protected bends.' },
    },
    time: { dawn: 'Fish the falling or incoming tide over sand near grass edges.', day: 'Work channel edges and passes with a slow bottom presentation.', dusk: 'Check creek mouths and marsh drains as bait moves with the tide.', night: 'Use a slow bottom rig in familiar tidal water; do not wade unknown channels in darkness.' },
    colors: { clear: 'Natural minnow, pearl or translucent shrimp.', stained: 'White/chartreuse, gold or root beer.', muddy: 'Dark purple/black or chartreuse with a strong silhouette.' },
  },
  reef: {
    seasons: {
      spring: { lure: 'Vertical jig, bucktail or natural bait matched to the reef species.', rig: 'Use a reef-appropriate jig or bottom rig; hook size and tackle strength matter.', retrieve: 'Work the structure vertically and keep contact without snagging.', zone: 'Reefs, ledges, hard bottom and current edges where open to harvest.' },
      summer: { lure: 'Vertical jig or live/dead bait on a bottom rig.', rig: 'Heavier leader and tackle sized to current and the target species.', retrieve: 'Drop to structure and lift steadily; avoid uncontrolled slack near the reef.', zone: 'Offshore reefs, ledges and hard bottom; respect seasonal closures.' },
      fall: { lure: 'Jig or natural bait around hard structure.', rig: 'Bottom rig or vertical jig sized to depth and current.', retrieve: 'Keep bait near structure and use enough weight to hold position.', zone: 'Reefs, ledges and current-swept hard bottom.' },
      winter: { lure: 'Slow vertical jig or natural bait on bottom.', rig: 'Bottom rig with leader and weight suited to depth/current.', retrieve: 'Use a measured lift-and-drop and hold close to structure.', zone: 'Stable hard bottom and deeper reef structure when seasons are open.' },
    },
    time: { dawn: 'Use the low-light window to locate bait on hard structure before moving deeper.', day: 'Hold position over structure and match jig weight to current.', dusk: 'Work reef edges before light fades; natural bait is a reliable starting option.', night: 'Not a default recommendation offshore. Use an established charter/boating plan and check current season rules.' },
    colors: { clear: 'Natural baitfish, white, silver or glow used sparingly.', stained: 'White, pink or chartreuse for visibility.', muddy: 'Glow, chartreuse or high-contrast colors; natural bait remains important.' },
  },
};

const SPECIES_GROUP: Record<string, Group> = {
  'largemouth bass': 'largemouth', 'spotted bass': 'riverBass', 'alabama bass': 'riverBass', 'shoal bass': 'riverBass', 'tallapoosa bass': 'riverBass', 'altamaha bass': 'riverBass', 'bartrams bass': 'riverBass', 'chattahoochee bass': 'riverBass', 'smallmouth bass': 'riverBass',
  'black crappie': 'crappie', 'white crappie': 'crappie', 'black & white crappie': 'crappie', crappie: 'crappie',
  bluegill: 'sunfish', 'redear sunfish': 'sunfish', 'redbreast sunfish': 'sunfish', warmouth: 'sunfish',
  'channel catfish': 'channelCat', 'blue catfish': 'blueCat', 'flathead catfish': 'flathead',
  'hybrid striped bass': 'striped', 'striped bass': 'striped', 'striped bass (seasonal)': 'striped', 'white bass': 'striped',
  'brook trout': 'trout', 'brown trout': 'trout', 'rainbow trout': 'trout',
  'chain pickerel': 'pickerel', walleye: 'walleye', sauger: 'walleye', 'yellow perch': 'walleye',
  'red drum': 'redfish', 'spotted seatrout': 'redfish', flounder: 'flounder', 'southern flounder': 'flounder', 'summer flounder': 'flounder',
  sheepshead: 'reef', 'red snapper': 'reef', 'vermilion snapper': 'reef', 'gray triggerfish': 'reef', 'greater amberjack': 'reef',
};

const normalize = (name: string) => name.replace(/\s*\(seasonal\)/i, '').trim().toLocaleLowerCase().replace(/\s+/g, ' ');

export function currentFishingSeason(date = new Date()): FishingSeason {
  const month = date.getMonth();
  if (month >= 2 && month <= 4) return 'spring';
  if (month >= 5 && month <= 7) return 'summer';
  if (month >= 8 && month <= 10) return 'fall';
  return 'winter';
}

export function currentFishingTime(date = new Date()): FishingTime {
  const hour = date.getHours();
  if (hour >= 5 && hour < 9) return 'dawn';
  if (hour >= 9 && hour < 16) return 'day';
  if (hour >= 16 && hour < 20) return 'dusk';
  return 'night';
}

function waterStartZone(water: Water | undefined, recipe: Recipe): string {
  if (!water) return recipe.zone;
  const type = water.type.toLocaleLowerCase();
  if (type.includes('river') || type.includes('creek')) return `${recipe.zone} On this flowing water, prioritize current seams, eddies and the slower side of moving water.`;
  if (type.includes('reservoir') || type.includes('lake')) return `${recipe.zone} On this lake, connect nearby cover to creek-channel edges and points.`;
  return recipe.zone;
}

function sourceLinks(water: Water | undefined): { label: string; url: string }[] {
  const specific = water?.links.filter((link) => /fishing|forecast|fish/i.test(link.label));
  if (specific?.length) return specific.slice(0, 2);
  const state = water?.state ?? '';
  const links: { label: string; url: string }[] = [];
  if (/\bGA\b/i.test(state)) links.push({ label: 'Georgia DNR · fishing forecasts and maps', url: 'https://georgiawildlife.com/fishing-forecasts' });
  if (/\bAL\b/i.test(state)) links.push({ label: 'Outdoor Alabama · seasonal freshwater tips', url: 'https://www.outdooralabama.com/learn-freshwater-fish-resources/freshwater-spring-fishing-tips' });
  if (/\bSC\b/i.test(state)) links.push({ label: 'South Carolina DNR · freshwater fishing', url: 'https://www.dnr.sc.gov/fish/' });
  return links;
}

function colorsFor(group: Group, clarity: WaterClarity): string {
  const colors = GROUPS[group].colors;
  if (clarity !== 'all') return colors[clarity];
  return `Clear: ${colors.clear} Stained: ${colors.stained} Muddy: ${colors.muddy}`;
}

function adviceHtml(speciesName: string, water: Water | undefined, season: FishingSeason, time: FishingTime, clarity: WaterClarity): string {
  const group = SPECIES_GROUP[normalize(speciesName)];
  if (!group) return '<p class="muted">A reviewed lure and rig profile is not available for this species yet. Check its diet and habitat notes above, then use the linked state forecast for current advice.</p>';
  const guide = GROUPS[group];
  const recipe = guide.seasons[season];
  const localNote = water?.notes?.trim();
  const placeholder = /^(SCDNR lists \d+ public access|access points are not|fish species are compiled|no detailed fishery|species list)/i.test(localNote ?? '');
  const links = sourceLinks(water);
  const clarityLabel = clarity === 'all' ? 'Color by water clarity' : `${clarity[0].toLocaleUpperCase()}${clarity.slice(1)}-water color`;
  return `<div class="bite-result" aria-live="polite">
    <div class="bite-card"><b>Try this</b><p>${esc(recipe.lure)}</p></div>
    <div class="bite-card"><b>Rig &amp; work it</b><p>${esc(recipe.rig)} ${esc(recipe.retrieve)}</p></div>
    <div class="bite-card"><b>${esc(clarityLabel)}</b><p>${esc(colorsFor(group, clarity))}</p></div>
    <div class="bite-card"><b>Where to start</b><p>${esc(waterStartZone(water, recipe))}</p></div>
    <div class="bite-card"><b>${esc(time[0].toLocaleUpperCase() + time.slice(1))}</b><p>${esc(guide.time[time])}</p></div>
    ${localNote && !placeholder ? `<div class="bite-local"><b>${esc(water?.name ?? 'Local')} water note</b><p>${esc(localNote)}</p></div>` : ''}
    ${links.length ? `<p class="bite-sources">${links.map((link) => `<a href="${esc(link.url)}" target="_blank" rel="noopener">${esc(link.label)} ↗</a>`).join(' · ')}</p>` : ''}
    <p class="muted small bite-disclaimer">Longleaf starting suggestions, not a guaranteed bite or a live report. Calendar seasons are approximate; water temperature, clarity, forage and releases can shift the pattern. Check local rules, weather, access and dam conditions before fishing. Marine seasons and limits can change.</p>
  </div>`;
}

export function fishingGuideHtml(speciesName: string, water?: Water): string {
  const season = currentFishingSeason();
  const time = currentFishingTime();
  const clarity: WaterClarity = 'all';
  return `<section class="fishing-guide" data-fishing-guide data-species-name="${esc(speciesName)}" data-water-id="${esc(water?.id ?? '')}">
    <span class="destination-eyebrow">WHAT TO TIE ON</span>
    <h3>${esc(water ? `Fishing ${water.name}` : 'Seasonal fishing starting point')}</h3>
    <p class="muted small">Species: ${esc(speciesName)}. Adjust the suggestions for your outing.</p>
    <div class="bite-controls">
      <label>Season<select data-bite-season><option value="spring" ${season === 'spring' ? 'selected' : ''}>Spring</option><option value="summer" ${season === 'summer' ? 'selected' : ''}>Summer</option><option value="fall" ${season === 'fall' ? 'selected' : ''}>Fall</option><option value="winter" ${season === 'winter' ? 'selected' : ''}>Winter</option></select></label>
      <label>Time of day<select data-bite-time><option value="dawn" ${time === 'dawn' ? 'selected' : ''}>Dawn</option><option value="day" ${time === 'day' ? 'selected' : ''}>Day</option><option value="dusk" ${time === 'dusk' ? 'selected' : ''}>Dusk</option><option value="night" ${time === 'night' ? 'selected' : ''}>Night</option></select></label>
      <label>Water clarity<select data-bite-clarity><option value="all" selected>Show all</option><option value="clear">Clear</option><option value="stained">Stained</option><option value="muddy">Muddy</option></select></label>
    </div>
    <p class="muted small">Season and time default to this device’s calendar and local clock. Water temperature and tide/current are better cues than the calendar alone.</p>
    <div data-bite-result>${adviceHtml(speciesName, water, season, time, clarity)}</div>
  </section>`;
}

export function wireFishingGuide(root: HTMLElement, water?: Water): void {
  const section = root.querySelector<HTMLElement>('[data-fishing-guide]');
  if (!section) return;
  const speciesName = section.dataset.speciesName ?? '';
  const season = section.querySelector<HTMLSelectElement>('[data-bite-season]');
  const time = section.querySelector<HTMLSelectElement>('[data-bite-time]');
  const clarity = section.querySelector<HTMLSelectElement>('[data-bite-clarity]');
  const result = section.querySelector<HTMLElement>('[data-bite-result]');
  if (!season || !time || !clarity || !result) return;
  const update = () => { result.innerHTML = adviceHtml(speciesName, water, season.value as FishingSeason, time.value as FishingTime, clarity.value as WaterClarity); };
  season.onchange = update;
  time.onchange = update;
  clarity.onchange = update;
}
