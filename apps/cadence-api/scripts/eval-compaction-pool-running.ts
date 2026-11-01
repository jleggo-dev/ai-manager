/**
 * Ordinary talk for the half-marathon fixture (`eval-compaction-fixtures.ts`). Stays OFF every
 * planted topic: no weekdays, no race date, no knee, hills or stairs, no shoes, no busy weeks at
 * work, no early runs, and no "30" anywhere — `eval-compaction-fixtures.test.ts` checks every string
 * here against every planted fact's terms.
 */
import type { FillerPool } from './eval-compaction-fixtures.ts';

export const runningPool: FillerPool = {
  topics: [
    {
      asks: [
        'Water on long runs?',
        'How much should I be drinking on the longer runs?',
        'Do I need to carry water for a 12K, or is that overkill for the distance?',
        'Got home from the long run with a headache and a dry mouth. I only had a few sips the whole way. Should I be carrying more water than that?',
      ],
      opens: [
        'Good thing to sort out now, before the runs get longer.',
        'Fluid is easy to get wrong on longer runs, and easy to fix.',
      ],
      points: [
        'For anything under an hour, most people do fine drinking normally through the day and having a glass of water before they head out.',
        "Past about an hour, a small handheld bottle or a loop that passes a fountain is plenty — sip every fifteen to twenty minutes rather than waiting until you're thirsty.",
        "On warm days you'll sweat more than you think, so it's worth adding a pinch of salt or an electrolyte tab to one of the bottles.",
        'A simple check is the colour of your pee: pale straw is where you want to be, and darker than that means drink a bit more through the day.',
        "If you'd rather not carry anything, a belt with two small flasks sits better than one big bottle once you're used to it.",
        'Practise drinking on your easy runs too, so your stomach is used to it by the time the long ones need it.',
        'Have a proper glass of water with whatever you eat afterwards — that does more for recovery than any special drink.',
      ],
    },
    {
      asks: [
        'Is my easy pace too slow?',
        'My easy runs feel almost embarrassingly slow. Is that really right?',
        'People keep passing me on my easy runs and it bugs me. Am I actually going slow enough, or too slow to do any good?',
        "Checked my watch after today's easy run and the pace was a full minute slower than my 5K pace. It felt easy, but I'm worried it's not doing anything. How slow is too slow?",
      ],
      opens: [
        "Slow is the point on those days, and it's doing more than it feels like.",
        'If it felt easy, you got it right.',
      ],
      points: [
        'Easy running builds the engine — more blood vessels in the legs, a stronger heart, tendons that can take the load — and almost none of that needs speed.',
        "A good test is talking: if you can say a full sentence without gasping, you're in the right place, whatever the watch says.",
        "Being a minute or more slower than your 5K pace on easy days is normal, and for a lot of runners it's closer to two.",
        'The runs that need to be quicker are few, and they go better when the easy ones have actually been easy.',
        "Other people's pace tells you nothing about yours — they might be on a fast day, or just about to stop.",
        'If you want a number, keep your heart rate in the lower part of your range and let the pace be whatever it is that day.',
        'Heat, a poor night, or a busy stretch will all slow your easy pace without anything being wrong, so judge it by effort.',
      ],
    },
    {
      asks: [
        'Stitch again today.',
        'Why do I keep getting a stitch on the right side?',
        'Got a side stitch about two kilometres in again. What actually causes that, and can I stop it?',
        'Third run this week with a stitch under my ribs. I had to stop and walk for a bit each time. I eat about an hour before I go. Is that the problem?',
      ],
      opens: [
        'Stitches are common and annoying, and usually fixable.',
        'Nobody is completely sure what causes them, but a few things help most people.',
      ],
      points: [
        'Eating or drinking a lot in the hour or two before running is a frequent trigger, so try a smaller snack, or leave a bit longer after a meal.',
        'Shallow breathing can set it off too: try breathing out in time with every few steps, and let the belly move rather than the chest.',
        'When one starts, slow down, breathe out hard, and press your fingers gently into the sore spot until it eases.',
        "Some people find it goes away if they switch which foot lands as they breathe out — it sounds fussy, but it's worth a try.",
        'A few minutes of easy jogging before you get going properly gives your body a chance to settle into it.',
        'Core strength helps over time, so the plank and side plank in the strength session are doing double duty.',
        "If they keep coming back no matter what you change, it's worth mentioning to your doctor, just to rule anything else out.",
      ],
    },
    {
      asks: [
        'How should I breathe?',
        'Is it bad that I breathe through my mouth when I run?',
        "I feel like I can't get a proper breath once I speed up. Is there a technique I should be using?",
        'Tried breathing only through my nose like a video said and nearly passed out halfway round the park. Am I doing something wrong or is that just not for me?',
      ],
      opens: [
        'Mouth breathing is completely fine — most runners do it.',
        'Breathing is one of those things that mostly sorts itself out as you get fitter.',
      ],
      points: [
        "Your body needs a lot of air when you run, and the mouth lets more in; there's no prize for doing it the hard way.",
        "Nose breathing can be a useful check on easy days, because if you can't manage it you're probably going a bit fast, but it isn't a rule.",
        'If you feel short of breath, slow down until you can talk again, then build back up gradually.',
        'Some runners like a rhythm, breathing in for three steps and out for two, which can calm things down when you feel rushed.',
        'Breathe out fully — a lot of the gasping feeling comes from not emptying the lungs before the next breath.',
        'Relaxed shoulders and hands help more than people expect, since tension in the upper body makes every breath shallower.',
        'If you ever feel tight in the chest or wheezy rather than just puffed out, stop and get that checked.',
      ],
    },
    {
      asks: [
        'Snack before the long run?',
        'What should I eat before a long run?',
        'Do I need a snack before a 10K after work, or is lunch enough to get me through?',
        'I always feel flat on the long runs — heavy legs from the start. I have a sandwich at lunch and then nothing until after. Could that be it?',
      ],
      opens: [
        'Fuel makes a bigger difference on long runs than most people expect.',
        'What you eat in the few hours before shapes how the run feels.',
      ],
      points: [
        'Have something you know sits well an hour or two before: toast with banana, a bagel, a bowl of oats, a few crackers with honey.',
        'Keep it mostly carbohydrate and fairly low in fat and fibre, because those slow digestion and can sit heavy.',
        "If you're short on time, a banana or a couple of dates is enough to top things up without upsetting your stomach.",
        'For runs over ninety minutes, take something along — a gel, a few sweets, or dried fruit — and start on it around the forty-five minute mark.',
        'Nothing new on a long-run day; try new foods on a shorter run first, when it matters less if they disagree with you.',
        'Feeling flat from the first step is often a sign of a long gap since your last meal, and a small snack mid-afternoon usually fixes it.',
        "Coffee is fine if you're used to it, though it's worth having it early enough that you're not looking for a toilet halfway round.",
      ],
    },
    {
      asks: [
        'What should I do after the long run?',
        "Legs were wrecked after yesterday's long run. Normal?",
        "What's the best thing to eat after a long run? I usually just collapse on the sofa and forget about food for a couple of hours.",
        'Did the long run yesterday and today my calves and hips are really sore, more than usual. Should I still do my easy run today or rest?',
      ],
      opens: [
        'Sore legs the day after a long run are part of the deal, especially as the distance grows.',
        'What you do in the first hour after makes a real difference to how the next day feels.',
      ],
      points: [
        'Eat something with carbohydrate and some protein within an hour or so — a sandwich, eggs on toast, yoghurt and fruit, even chocolate milk.',
        'Keep moving gently for the rest of the day; a short walk does more for stiff legs than lying still.',
        'General soreness that eases as you warm up is fine to run on easy, but if it gets worse as you go, cut it short and walk home.',
        'Sharp pain in one spot is different from muscle soreness, and that one is worth resting and telling me about.',
        "A warm shower or bath helps some people loosen up, and a bit of light stretching afterwards feels good even if it doesn't do much for recovery.",
        'Sleep is where most of the repair happens, so turning in a little earlier after a long run is worth more than any gadget.',
        "If you're still very sore two days later, the long run probably went up too fast, and we can hold the distance steady for a week.",
      ],
    },
    {
      asks: [
        'Rest day today.',
        'Can I do something active on rest days, or should I stay still?',
        'Felt restless on my rest day and almost went for a run anyway. Is it okay to swap days around when I feel good?',
        "Rest day today, but I feel like I'm losing fitness every time I take one. How many rest days do I actually need right now, honestly?",
      ],
      opens: [
        'Rest days are when the training actually turns into fitness.',
        'Feeling restless on a rest day usually means the training is going well.',
      ],
      points: [
        'A walk, a bike ride to the shops, some gentle mobility work — all of that is fine, as long as it leaves you feeling fresher, not tired.',
        "You won't lose fitness in a day or two; it takes a couple of weeks of nothing before it really starts to slip.",
        "Swapping days is fine now and then, as long as you don't end up with two hard days back to back.",
        'Right now two rest days a week is about right for you, and we can look again once the long runs settle.',
        "If you feel great on a rest day, that's the plan working, and it's a reason to keep the rest, not skip it.",
        'Notice how your legs feel the day after a rest day compared to the day after a run — that difference is useful information.',
        "Use the time for things running doesn't give you: a stretch, a proper meal, a quiet hour with a book.",
      ],
    },
    {
      asks: [
        'Is cycling okay as cross-training?',
        'Can swimming count as one of my runs?',
        'A friend asked me to do a spin class with her. Will that mess up my running or could it actually help?',
        "There's a pool near work and I'm tempted to swim instead of one of the easy runs each week. Would I lose anything by doing that?",
      ],
      opens: [
        'Cross-training can help, as long as it supports the running rather than replacing too much of it.',
        'Yes, with a couple of things to keep in mind.',
      ],
      points: [
        'Cycling and swimming build your aerobic fitness without the pounding, which is useful on weeks when your legs need a break.',
        "They don't train the specific strength your legs need for running, so they work best alongside your runs rather than instead of them.",
        'A spin class can be hard work, so treat it as a harder day and keep the run after it easy.',
        "Swapping one easy run a week for a swim is fine at this stage, and you'll probably feel fresher for it.",
        "Keep the long run as a run, since that's the one most like what the half marathon will ask of you.",
        'If you enjoy it, that alone is a good reason to keep it in the week.',
        "Let me know which day suits and I'll fit it in so it doesn't land the day before a long run.",
      ],
    },
    {
      asks: [
        'Running in the rain okay?',
        "It's pouring. Run anyway or skip it?",
        "How do I deal with the heat this week? It's meant to be humid and over twenty-five every evening.",
        'First cold run of the season today and my lungs burned for the first couple of kilometres. Is that normal, and should I be wearing something over my mouth?',
      ],
      opens: [
        'Weather is one of those things you can work with rather than around.',
        'You can run in most weather with a bit of preparation.',
      ],
      points: [
        "Rain is fine as long as it isn't icy: wear a cap to keep it out of your eyes and something light that doesn't hold water.",
        "In heat, slow down by effort, not pace, and expect the same run to feel harder than usual — that's not lost fitness.",
        'Pick shaded routes when it is hot, carry water even on shorter runs, and go a bit later once the sun is lower.',
        'Cold air can make the lungs feel raw for the first few minutes; a buff or light scarf over the mouth warms the air a little and helps.',
        "Dress as if it's about ten degrees warmer than it is, because you'll heat up quickly once you're moving.",
        'Thunder and lightning are the one exception — those days, take it indoors or move the run.',
        'Wet weather tends to cause chafing, so a bit of balm on the usual places before you go saves a sore evening.',
      ],
    },
    {
      asks: [
        'My watch says my heart rate is way too high.',
        'Should I be training by heart rate?',
        'My watch keeps telling me I am in zone four on runs that feel easy. Do I trust it or how I feel?',
        'The heart rate on my watch jumped to something silly in the first few minutes and then settled back. Is my watch broken or is my heart doing something odd?',
      ],
      opens: [
        "Wrist heart rate is a useful guide, but it's not the last word.",
        'Watches get heart rate wrong more often than people think.',
      ],
      points: [
        'Wrist sensors often lock onto your step rate early in a run, which gives a big spike that settles after a few minutes.',
        'If the number says hard but you can chat easily, trust how you feel; a chest strap is much more reliable if you want to dig in.',
        'Zones from a watch are based on a formula, and formulas can be off by a lot for any one person.',
        "Feel is the best guide we have, and it's always with you — even when the battery isn't.",
        'Over a few weeks, the same easy run at a lower heart rate is a nice sign your fitness is growing.',
        'Heat, caffeine, stress and a short night will all push your heart rate up without anything being wrong.',
        "If you ever feel your heart racing or fluttering in a way that doesn't settle when you stop, get that checked by a doctor.",
      ],
    },
    {
      asks: [
        'What are strides?',
        'You put strides in the plan — how fast is that supposed to be?',
        "Did the strides at the end of today's run. Felt awkward and a bit silly. Am I doing them right?",
        'Strides are the bit of the week I actually look forward to. Could I add more of them, or do something faster as well?',
      ],
      opens: [
        'Strides are short, smooth pickups — quick, but never a sprint.',
        "They're one of the most useful small things in the week.",
      ],
      points: [
        "Run about twenty seconds, building up to a quick but relaxed pace, then walk or jog easily until you've fully got your breath back.",
        'Think tall and quick feet rather than pushing hard; if your face is tense, ease off a little.',
        "Four to six of them after an easy run is plenty, and they shouldn't leave you tired the next day.",
        'They teach your legs to move quickly without the cost of a hard session, which helps your easy pace feel smoother over time.',
        'A flat stretch of path or a quiet street is all you need; count steps or use a lamppost as your marker.',
        "We'll keep them as they are for a few weeks, then think about a short faster session once your long runs are steady.",
        "If you enjoy them, that matters — it's easier to keep doing things that are fun.",
      ],
    },
    {
      asks: [
        'Did the strength session.',
        'Do I really need to do the strength stuff?',
        'How heavy should the weights be for the strength session? I just used the little dumbbells.',
        "The strength session takes me ages and I'm not sure I'm doing the moves properly. Could we make it shorter, or is there a simpler version?",
      ],
      opens: [
        'Strength work is the quiet part of running well.',
        "Glad you're doing it — it's easy to skip and worth keeping.",
      ],
      points: [
        'Stronger hips, calves and core hold your form together late in a long run, when tired legs start to wobble.',
        'Light weights are fine to start; pick a weight where the last two reps of a set feel hard but your form stays clean.',
        'Two short sessions a week does the job, and twenty minutes is enough if you keep the rests short.',
        'Calf raises, glute bridges, planks and single-leg balance are the core of it, and none of them need a gym.',
        'Do the moves slowly; control matters more than load at this stage.',
        "If a move feels wrong or pinches anywhere, skip it and tell me, and I'll swap in something else.",
        'Put the strength on an easy day or a rest day, not right before a long run, so your legs are fresh when it counts.',
      ],
    },
    {
      asks: [
        'Tight calves today.',
        'Is foam rolling worth it?',
        'My calves are tight after every run lately. Is there something I should be doing before or after?',
        'Bought a foam roller and it absolutely kills on the outside of my thigh. Am I meant to roll through that, or is it doing more harm than good?',
      ],
      opens: [
        'Tight calves are really common as the mileage goes up.',
        "A foam roller can help, but it doesn't need to hurt to work.",
      ],
      points: [
        "Rolling mostly makes muscles feel looser for a while; it's a nice way to wind down, not something that fixes anything on its own.",
        'Go gently and slowly — painful rolling makes muscles tense up, which is the opposite of what you want.',
        "The outside of the thigh is a sore place for almost everyone, and you don't need to grind on it; the muscles around it matter more.",
        'For calves, a few slow calf raises and a gentle stretch against a wall after the run do a lot of the work.',
        "Drinking enough and eating enough on run days matters too; tight, crampy calves can be a sign you're running low.",
        "If one calf is much tighter than the other, or it's sore to press in one place, let me know so we can keep an eye on it.",
        'A short walk to cool down after a run, rather than stopping dead at the door, also helps the calves settle.',
      ],
    },
    {
      asks: [
        'Music or no music?',
        'Is it okay to listen to podcasts on my runs?',
        'Can I take the dog on my easy runs? She pulls a bit but she loves it.',
        "I've been running without headphones this week because they died, and honestly I think I liked it. Is there any reason to go one way or the other?",
      ],
      opens: [
        'Whatever keeps you going out the door is the right answer.',
        "There's no wrong answer here, just a few things to keep in mind.",
      ],
      points: [
        'Music can make hard efforts feel easier, and podcasts make long easy runs fly by, so both have their place.',
        'Without headphones you hear your breathing and your feet, which is a good way to learn what easy actually feels like.',
        'On roads, keep one ear free or the volume low so you can hear traffic and bikes.',
        'Dogs are great company on easy runs, but they set their own pace, so keep the faster bits for runs without her.',
        'Build her up gradually too — dogs can overdo it just like we can, especially in the heat.',
        'A hands-free lead around your waist stops the pulling from twisting your shoulders.',
        'Mixing it up is fine; some people keep music for the long run and go without on easy days.',
      ],
    },
    {
      asks: [
        'Chafing. Help.',
        'What should I wear for the longer runs?',
        'Got a bad bit of chafing under my arms on the long run. What do people do about that?',
        'My shorts ride up on the longer runs and I end up sore by the end. Is there a better kind I should be looking for?',
      ],
      opens: [
        "Chafing is one of running's less glamorous problems, and very fixable.",
        'Kit matters more as the runs get longer.',
      ],
      points: [
        'A bit of anti-chafe balm or plain petroleum jelly on the usual places before you go stops most of it.',
        'Technical fabrics that wick sweat are worth it for longer runs; cotton holds water and rubs.',
        'Shorts with a built-in liner, or a slightly longer leg, stop the riding up for a lot of people.',
        "Seams are the usual culprits, so check where it's rubbing and look for something with flat seams there.",
        'Wash new kit before a long run and wear it on a short one first, so there are no surprises.',
        "A light cap and sunglasses earn their place on bright days, even when it's not hot.",
        'After the run, rinse any sore patches with water and let them air out; they usually settle in a day or two.',
      ],
    },
    {
      asks: [
        'Felt great today!',
        'Legs felt heavy for the whole run today.',
        'Ran 8K after work, kept it easy like you said, and it felt really smooth for once. Not sure what was different.',
        'Bit of a rubbish run today. Felt flat from the start, cut it short at about 5K and walked the rest. Still counts I suppose?',
      ],
      opens: ['Thanks for telling me how it went.', 'Every run tells us something, good or flat.'],
      points: [
        "Some days just feel flat, and one flat run on its own doesn't tell us much; it's a pattern over a week or two that matters.",
        'Heavy legs often come from the training load catching up with you, a short night, or not eating enough earlier in the day.',
        'When a run feels great, it is worth noticing what was different — what you ate, how you slept, the time of day — so you can repeat it.',
        "Cutting a run short when it isn't happening is a good call, not a failure.",
        'Your body adapts in waves, so a great run often follows a few flat ones, once the work has had time to land.',
        "If flat runs start stacking up, tell me and we'll look at the week as a whole, rather than pushing through.",
        'Either way, an easy day tomorrow, and see how the legs feel.',
      ],
    },
  ],
  asides: [
    'Long day at work.',
    'Quick one.',
    'Sorry, random question.',
    'Weather was lovely, at least.',
    'Just got in.',
    'Still sweaty, typing this on the doorstep.',
    'Bit of a mixed day.',
    'Been thinking about this all afternoon.',
    'My partner says hi, by the way.',
    'Feeling pretty good overall this week.',
    'No rush on this.',
    'Ignore the typos, on my phone.',
    "Okay, here's one for you.",
    'Kids are finally down for the day.',
    "Sorry if I've asked this before, it keeps coming back to me on runs.",
    'Been reading conflicting things online about this and wanted your take.',
    "A friend from work asked me the same thing and I didn't know what to tell her.",
  ],
  followUps: [
    'How did the rest of the day feel?',
    'Does that sound doable this week?',
    'Want me to put that into the plan?',
    'How are the legs feeling now?',
    'Did anything feel different from last time?',
    'Let me know how the next one goes.',
    'Shall we try that on the next easy run?',
    'Anything else on your mind about it?',
  ],
  wider: [
    'Looking at the week as a whole, most of the runs went out as planned, and the easy ones mostly stayed easy, which is what builds the base.',
    "Nothing here needs fixing in a hurry; we're building slowly on purpose, and the steady weeks are the ones that add up.",
    "I'll keep the plan as it is for now, and we can look at it again once you've had a few more runs on these legs.",
    "If anything feels off between now and then, tell me and we'll adjust rather than push through it.",
    "It's worth jotting a line after each run — how it felt, what you ate, how you slept — because patterns show up faster than you'd think.",
    'Remember the aim at this stage is to arrive at each run feeling ready for it, not to win the week.',
    "You've asked good questions this week, and they're the kind that keep small problems small.",
    'Give it a week of trying and then tell me what you noticed, and we will keep what works.',
  ],
};
