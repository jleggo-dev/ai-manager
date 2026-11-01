/**
 * Ordinary talk for the meditation-and-piano fixture (`eval-compaction-fixtures.ts`). Stays OFF
 * every planted topic: no time of day or length for the sit, no named pieces or composers, no sound
 * or silence in the room, no name for racing thoughts, no classes or groups, nothing about sitting
 * late or being sleepy. Watch the hidden substrings too — "bed" (described, climbed), "night"
 * (tonight), "drop" (let your shoulders drop) — `eval-compaction-fixtures.test.ts` checks every
 * string here against every planted fact's terms.
 */
import type { FillerPool } from './eval-compaction-fixtures.ts';

export const practicePool: FillerPool = {
  topics: [
    {
      asks: [
        'Chair or cushion?',
        'Does it matter how I sit?',
        'My back starts aching after a few minutes of sitting. Am I doing something wrong with my posture?',
        "I've been sitting cross-legged on the floor because that's what the pictures show, but my feet go numb halfway through. Is a chair cheating?",
      ],
      opens: [
        "A chair isn't cheating; it's a perfectly good seat.",
        'Posture matters a little, and comfort matters more.',
      ],
      points: [
        'Sit so your back can be upright without straining — a chair with your feet flat on the floor does that for most people.',
        'On the floor, a firm cushion under your hips so your knees are lower than them takes the pressure off your back and legs.',
        'Numb feet usually mean the position is cutting off circulation; shift whenever you need to, gently.',
        "Let your hands rest wherever they're comfortable — on your thighs, or loosely in your lap.",
        "An aching back often means you're holding yourself up too hard; imagine the top of your head being lifted, and let everything else hang.",
        'You can move during a sit; noticing the urge, then moving slowly and deliberately, is part of the practice.',
        'Try a few positions over the next week and keep the one you forget about the fastest.',
      ],
    },
    {
      asks: [
        'Eyes open or shut?',
        'Do I have to close my eyes?',
        'Closing my eyes makes me feel a bit uneasy. Is it okay to keep them open?',
        'When I close my eyes I start daydreaming almost straight away. Would keeping them open help, or is that against the point?',
      ],
      opens: ['Open is completely fine; plenty of traditions practise that way.', "You don't have to close them."],
      points: [
        'Rest your gaze softly on the floor a little way in front of you, without really looking at anything.',
        'Open eyes can help you stay alert and present, especially if closing them makes you uneasy.',
        'Half-closed eyes are a middle ground some people like: enough light to stay alert, little enough to settle.',
        'Daydreams turn up with eyes open or closed; the practice is noticing them and coming back, not stopping them.',
        "There's no wrong answer here, so pick whichever lets you settle in more easily.",
        'If you feel uneasy, a candle or a plant to rest your eyes on can give them somewhere kind to land.',
        'Try a week with them open and see how it compares.',
      ],
    },
    {
      asks: [
        'Counting breaths helps.',
        'Should I count my breaths?',
        'I keep losing count somewhere around four or five and starting over. Is that normal?',
        'Someone suggested counting breaths up to ten and starting again. I never get past three without my mind wandering off. Am I just bad at this?',
      ],
      opens: [
        'Breath counting suits a lot of people.',
        'Counting is a good anchor, and almost nobody gets far at first.',
      ],
      points: [
        "Each time you notice you've lost count and come back to one, that's the moment of training — the noticing is the rep.",
        'Counting out-breaths only, one to ten, gives the mind just enough to do without effort.',
        'If counting starts to feel like a test, let it go and just feel the breath at the nose or belly.',
        "Getting to three and starting again is completely normal, even for people who've practised for years.",
        "Some days counting helps and some days it gets in the way; it's a tool, not a rule.",
        "You might try saying 'in' and 'out' quietly in your head instead of numbers, which is gentler for some people.",
        "There's no being bad at this; there's just sitting, and you're doing it.",
      ],
    },
    {
      asks: [
        'Tried a body scan.',
        "What's a body scan, and is it worth trying?",
        "Did a body scan from an app and kept getting stuck on my shoulders. They just wouldn't relax.",
        'The body scan recording I tried was much longer than I usually sit, and I lost the thread halfway through. Is there a shorter way to do it?',
      ],
      opens: ['Body scans are a lovely change from the breath.', 'A body scan is a good thing to have in the mix.'],
      points: [
        "You move your attention slowly through the body, feet to head, noticing whatever's there without trying to change it.",
        "The point isn't to relax each part; it's to notice it — tight shoulders noticed are part of a good scan.",
        'A short version works: feet, legs, belly, chest, shoulders, face, a few breaths each.',
        "If you lose the thread, pick it up wherever you are; there's no need to start again from the feet.",
        "Some people find a body scan easier than breath work because there's more to notice.",
        'It can be a nice way to start a sit before settling on the breath.',
        'Try it a couple of times this week and tell me how it compares to your usual sit.',
      ],
    },
    {
      asks: [
        'So fidgety today.',
        'What do I do when I get an itch while sitting?',
        'I was really restless today and kept wanting to get up. Should I push through or stop?',
        'Every time I sit, after a couple of minutes I get an itch or an urge to shift or check my phone. Does that ever stop?',
      ],
      opens: [
        'Restlessness is one of the most common things that turns up in a sit.',
        'Itches and urges are part of the territory.',
      ],
      points: [
        'When an itch comes, try noticing it for a few breaths before scratching; often it fades on its own.',
        "If you do scratch, do it slowly and on purpose, then come back — that's still practice.",
        'Restless days happen, often after coffee or a busy start to the day; a shorter sit on those days is fine.',
        'Put the phone in another room before you start, so the urge to check it has nowhere to go.',
        'Restlessness tends to ease as the habit settles, though some days it will always be louder than others.',
        'You can also turn toward it: where in the body do you feel the restlessness? That makes it something to watch rather than fight.',
        "Stopping early on a hard day is fine; it's still a day you sat.",
      ],
    },
    {
      asks: [
        'Walking meditation — is that a thing?',
        'Can I meditate while walking?',
        "On days when I can't sit still at all, could I do a walking practice instead?",
        'I read about walking meditation and tried it in the garden. It felt a bit silly going so slowly, but also quite calming. Is it a proper practice or a lesser version?',
      ],
      opens: [
        'Walking practice is a real practice, not a lesser one.',
        'Yes — and on restless days it can be the better choice.',
      ],
      points: [
        'Walk slowly, paying attention to each step: the lift, the movement, the foot meeting the ground.',
        'A short path of a dozen steps, back and forth, is all you need; the garden is perfect.',
        'Feeling a bit silly is normal at first, and it passes.',
        'It counts as your sit for the day, and on restless days it can settle you better than sitting still would.',
        'If walking slowly feels strange in public, a normal pace with attention on your feet works too.',
        'Some people do a few minutes of walking before sitting, which takes the edge off restlessness.',
        "Let me know if you'd like to have it as an option in the plan for restless days.",
      ],
    },
    {
      asks: [
        'Not sure this is doing anything.',
        'How do I know if meditation is working?',
        "It's been a few weeks and I don't feel any calmer. Should I be noticing something by now?",
        "Honestly, most sits feel like I'm just sitting there thinking about my to-do list. I don't feel any different afterwards. Am I missing something?",
      ],
      opens: ['That doubt is very common a few weeks in.', 'The changes tend to be quieter than people expect.'],
      points: [
        "Most people notice it outside the sit first: a pause before snapping at someone, or noticing they're tense a bit sooner.",
        "A sit full of to-do lists is still a sit; each time you notice and come back, you're training the thing that matters.",
        'It helps to let go of feeling calm as the goal; the aim is noticing, and calm sometimes comes along with that.',
        'Try jotting one line after each sit for a couple of weeks — not a score, just what you noticed — and look back at it later.',
        'Some days will feel like nothing happened, and those days count as much as the good ones.',
        "If you'd like, we can try a different kind of practice for a week, like a body scan, and see if it lands differently.",
        'Keep going for another few weeks before deciding; this kind of change is slow and real.',
      ],
    },
    {
      asks: [
        'Missed a couple of days.',
        "I haven't sat since the weekend. Do I start over?",
        "Life got busy and I've skipped most of this week. How do I get back into it without feeling like I've failed?",
        "I was doing well and then the kids were off sick and I haven't sat in over a week. I feel like I've lost all the progress. Have I?",
      ],
      opens: ["You don't start over; you just sit again.", 'Nothing is lost — the practice is still there.'],
      points: [
        "Missed days are part of any real practice; what you built over the past weeks doesn't vanish.",
        'The easiest way back is a short sit today, even a couple of minutes, to get the habit moving again.',
        "Count the sits you've done, not the ones you missed — there are a lot of them now.",
        "Weeks like this are when the practice is useful, even if it's just three breaths while the kettle boils.",
        'If the same thing keeps knocking it out, we can look at whether the time or the length needs a rethink.',
        "Be kind to yourself about it; that's part of the practice too.",
        "Let me know when you're back and we'll pick up wherever you are.",
      ],
    },
    {
      asks: [
        'Fingers are stiff.',
        'Should I warm up before practising?',
        'My fingers feel really stiff at the start of practice. Is there a good way to warm up?',
        'It takes me ages to get going at the piano because my hands feel clumsy for the first while. Anything I can do before I start the actual practice?',
      ],
      opens: [
        'Stiff fingers at the start are normal, especially after a long break from playing.',
        'A short warm-up makes the rest of practice much more pleasant.',
      ],
      points: [
        'Run your hands under warm water for a minute or two before you sit down; it makes a surprising difference.',
        'Start with something slow and simple — a five-finger pattern or a gentle scale — rather than the hard passage.',
        "Shake out your hands and roll your shoulders between exercises, so tension doesn't build.",
        "A few minutes of easy playing is enough; the warm-up shouldn't tire you before the real work.",
        'Clumsy at first is fine; most people find their hands catch up after the first few minutes.',
        'Keep your wrists loose and level, not dipped or raised, as you warm up.',
        "If stiffness stays for most of the session, or comes with pain, it's worth mentioning to your doctor.",
      ],
    },
    {
      asks: [
        'Scales are so boring.',
        'Do I really need to practise scales?',
        "Which scales should I be working on? I've been doing C major over and over.",
        'I know scales are good for me but I dread them every session. Is there a way to make them less of a chore, or can I skip them?',
      ],
      opens: [
        'Scales are dull for most people, and still worth a few minutes.',
        "They're useful, and they don't have to be a chore.",
      ],
      points: [
        "Scales build evenness and finger patterns that turn up in nearly every piece you'll play.",
        'Add the scales of the key your piece is in, so they feel connected to something you care about.',
        'Play them at different speeds and volumes — very quiet, then loud, then a little faster — to keep your ears involved.',
        'Hands separately first, then together once each hand is comfortable.',
        "Five minutes is plenty; it's better to do a little often than a lot occasionally.",
        'If scales are the hardest part to start, put them second, after something you enjoy.',
        "We can add one new key a week so there's always something fresh.",
      ],
    },
    {
      asks: [
        'Metronome question.',
        'Should I be using a metronome?',
        'I keep speeding up in the easy bits and slowing down in the hard bits. How do I fix that?',
        'Practising slowly feels like it takes forever, and I keep wanting to play at full speed to hear how it should sound. Is slow practice really necessary?',
      ],
      opens: [
        'Slow practice is where the real learning happens.',
        'A metronome is one of the most useful tools at the piano.',
      ],
      points: [
        'Set the metronome slow enough that the hardest bar is easy, and play the whole passage at that speed.',
        "When it's comfortable three times in a row, nudge it up a few clicks.",
        'Speeding up in easy bits is natural; the metronome shows you where it happens so you can even it out.',
        'Playing at full speed now and then to hear the music is fine, as long as most of the work is slow.',
        'Mistakes made at speed get learned too, which is why slow practice saves time in the end.',
        'Without a metronome, try playing at half speed and counting aloud.',
        "If you'd like, tell me which bar is giving you trouble and we'll work on just that.",
      ],
    },
    {
      asks: [
        'Sight-reading is rusty.',
        'How do I get better at sight-reading?',
        'I used to be able to read music fairly quickly and now it takes me ages to work out each bar. Will that come back?',
        'Reading the notes is slowing everything down — I spend more time working out the notes than actually playing. Should I practise reading separately?',
      ],
      opens: [
        "Reading comes back faster than you'd think with a little regular practice.",
        'Reading improves quickly with a little each day.',
      ],
      points: [
        'A few minutes a day of very easy music — easier than you think you need — builds reading speed.',
        'Keep going when you make a mistake; the point of sight-reading is to keep moving, not to get every note.',
        "Look ahead a little rather than at the note you're playing, so your eyes are always slightly in front.",
        'Learn the landmarks — middle C, the G and F lines — and read from those rather than counting up each time.',
        "Simple hymn books or beginner collections are good material because they're plentiful and easy.",
        'Clapping the rhythm before playing helps with the parts where timing is tricky.',
        'It will come back; your hands remember more than your eyes right now.',
      ],
    },
    {
      asks: [
        'Wrist aches after playing.',
        'My hands get tense when I play. Is that normal?',
        'After about twenty minutes at the piano my forearms feel tight. Am I gripping too hard?',
        'I noticed my shoulders creeping up towards my ears while I was playing today, and my wrists ached afterwards. How do I stop tensing up like that?',
      ],
      opens: [
        'Tension is one of the most common things to catch at the piano, and catching it is half the work.',
        'Aches after playing usually mean the hands are working harder than they need to.',
      ],
      points: [
        "Use only as much effort as each note needs; most passages need less weight than you're giving them.",
        'Check in every few minutes: shoulders soft, elbows loose, wrists level, then carry on.',
        'Short breaks help, even just a minute to shake out your hands and stretch your arms.',
        'Sit at a height where your forearms are roughly level with the keys, which takes strain off the wrists.',
        'Tension often creeps in on the hard bars, so play those slower and notice where it starts.',
        'If aches last into the next day, or you get tingling or numbness, take a few days off and let me know.',
        'This is a place where your sitting practice helps: the same noticing works at the keyboard.',
      ],
    },
    {
      asks: [
        'Should I memorise pieces?',
        'How do people memorise music?',
        'I can play the first page from memory now but I lose it completely if I make a mistake. How do I make it stick?',
        "I'm trying to memorise what I'm learning but I always blank in the same place. Is there a better way than just playing it over and over?",
      ],
      opens: [
        'Memorising is optional, but it can make a piece feel more yours.',
        'Memory at the piano is built in layers, and each one helps.',
      ],
      points: [
        'Learn it in small sections, and practise starting from the beginning of any section, not just from the top.',
        'Know the hands separately; if one hand can carry on alone, you can always find your way back.',
        'The place you blank is usually where two passages look alike, so notice exactly what is different there.',
        'Say the chords or the shape of the passage out loud; naming it gives your memory something extra to hold onto.',
        'Play it away from the piano in your head, slowly, and notice where it gets fuzzy.',
        "Playing over and over builds finger memory, which is useful but fragile when you're nervous.",
        "Let me know which section keeps slipping and we'll break it into smaller pieces.",
      ],
    },
    {
      asks: [
        'Played for my partner!',
        'How do I play in front of people without falling apart?',
        "My sister asked me to play something when she visits. I'm nervous even thinking about it. Any tips?",
        'Played for my partner today and my hands were shaking — I made mistakes I never make when I am alone. Why does that happen?',
      ],
      opens: [
        'Nerves when playing for someone are almost universal.',
        'Playing for other people is a skill of its own.',
      ],
      points: [
        'Adrenaline makes hands shaky and memory patchy, so mistakes you never make alone are completely normal.',
        'Practise playing for someone in small doses: one short piece, for one person, often.',
        "Pick something well within your ability for an audience, not the piece you're still learning.",
        "Decide beforehand that you'll keep going through mistakes, and practise doing that at home.",
        'A few slow breaths before you start — the kind you take when sitting — help settle the hands.',
        'Recording yourself is a gentle middle step; it creates a bit of pressure without anyone in the room.',
        'Each time you play for someone, it gets a little easier.',
      ],
    },
    {
      asks: [
        'How long should I practise?',
        'Is it better to practise every day or longer sessions a few times a week?',
        "I've been practising for an hour at a time but I'm exhausted afterwards and not sure the second half does much. Should I cut it down?",
        "Some days I have twenty minutes, some days an hour. How should I split the time so it doesn't turn into just playing the bits I already know?",
      ],
      opens: [
        'Short and regular beats long and occasional for most people.',
        'A simple structure helps the time go where it is needed.',
      ],
      points: [
        'Twenty to forty minutes most days is plenty when you are coming back to playing.',
        'Split it roughly: a few minutes warming up, most of the time on the hard parts, and the last few minutes playing for enjoyment.',
        "If you're exhausted, you're probably pushing too hard; two shorter sessions in a day work better than one long one.",
        "Start with the bit you find hardest while you're fresh, and leave the bits you know for the end as a reward.",
        "Write down what you'll work on before you start, so the time doesn't drift into playing what's easy.",
        'On short days, pick one thing and do it well rather than rushing through everything.',
        "Stop while it's still going well; ending on a good note makes it easier to come back.",
      ],
    },
  ],
  asides: [
    'Quick one.',
    'Kids are out, so I have a moment.',
    'Bit of a strange day.',
    'This might be a silly question.',
    'Quiet house for once.',
    'Cup of tea in hand.',
    'Long day.',
    "Something I've been wondering.",
    'Not urgent.',
    'Small thing.',
    'Good week so far.',
    'On my phone, sorry for typos.',
    "Sorry if I've asked this before, it keeps coming back to me.",
    'Been reading conflicting things online about this and wanted your take.',
    "A friend asked me about this too and I didn't know what to say.",
  ],
  followUps: [
    'How did that feel?',
    'Does that sound worth trying this week?',
    'What did you notice?',
    'Want me to add that to the plan?',
    'Let me know how the next one goes.',
    'Anything else coming up for you?',
    'Shall we try that and see?',
    'How has the rest of the week been?',
  ],
  wider: [
    "Looking at the week as a whole, you've shown up to the practice more often than not, and that steadiness is what matters.",
    'None of this needs to be perfect; the practice is in coming back, and you keep coming back.',
    "It's worth jotting a line after each session — what went well, what felt stuck — because patterns show up faster than you'd expect.",
    "If something here doesn't suit how your days actually run, tell me and we'll change it rather than you bending around it.",
    'The piano and the sitting help each other more than it seems: both are about noticing and returning, one with the breath and one with the hands.',
    "Give it a week and then tell me what you noticed, and we'll keep whatever is working.",
    "There's no rush on any of this; slow and regular is how both of these grow.",
    "You're asking the right questions, and they're the kind that keep small problems small.",
  ],
};
