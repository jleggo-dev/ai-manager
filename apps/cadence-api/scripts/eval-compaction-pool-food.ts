/**
 * Ordinary talk for the new-parent food fixture (`eval-compaction-fixtures.ts`). Stays OFF every
 * planted topic: no weekend prep of lunches, no meat or fish or what they eat in general, no nuts or
 * allergies, no feeds in the small hours, no supplements, no meal kits or deliveries. Watch the
 * hidden substrings too — "cook" (cookie), "pots" (spots), "iron" (environment), "box" (lunchbox) —
 * `eval-compaction-fixtures.test.ts` checks every string here against every planted fact's terms.
 */
import type { FillerPool } from './eval-compaction-fixtures.ts';

export const foodPool: FillerPool = {
  topics: [
    {
      asks: [
        'Always thirsty lately.',
        "How much water should I be drinking while I'm feeding?",
        "I keep forgetting to drink anything until I've got a headache. Any tricks for remembering?",
        "I'm feeding about every two to three hours and I'm constantly thirsty, but I hate plain water. What else counts?",
      ],
      opens: [
        "Feeling thirsty all the time is really common while you're feeding.",
        "Plain water isn't the only option, which is good news.",
      ],
      points: [
        "Drink to thirst, and keep a full glass or bottle wherever you usually feed so it's there when the thirst hits.",
        'Milk, herbal tea, diluted juice, soup and watery fruit like melon all count towards what you need.',
        'A big bottle you refill twice a day is easier to keep track of than counting glasses.',
        "Headaches and dark pee are both signs you're running behind, so treat them as a nudge rather than a failure.",
        'If plain water is boring, a slice of lemon, a few frozen berries or a splash of squash makes it easier to keep going.',
        'Tie a drink to something you already do — every time you sit down to feed, every time you put the kettle on.',
        "You don't need to force down huge amounts; little and often works better and sits easier.",
      ],
    },
    {
      asks: [
        'Breakfast ideas? One hand only.',
        'What can I eat for breakfast with a baby in one arm?',
        "Breakfast keeps not happening because by the time I've got a hand free it's lunchtime. What's quick?",
        "Most days I get to eleven and realise I haven't eaten a thing. I need something I can grab and eat with one hand while I'm rocking her.",
      ],
      opens: [
        'One-handed breakfasts are a whole skill with a newborn.',
        'The trick is having it ready before you need it.',
      ],
      points: [
        'Overnight oats in a jar are made the day before and eaten with a spoon, with nothing to do in the morning.',
        'A wrap with cheese and spinach, rolled the day before and wrapped in foil, can be eaten cold with one hand.',
        'Boiled eggs keep for days in the fridge, and a peeled one with a slice of toast is a proper breakfast.',
        'A banana and a tub of yoghurt with a spoon already in it is better than nothing, and nothing is the usual alternative.',
        'Breakfast bars are fine, though check the label for sugar — some are closer to a sweet than a meal.',
        'A smoothie in a bottle with a lid is one-handed, drinkable and keeps in the fridge until you need it.',
        "If breakfast keeps slipping, it's fine for it to happen at eleven; it still counts.",
      ],
    },
    {
      asks: [
        'Snack ideas?',
        'What are good snacks to keep by the sofa?',
        "I'm hungry every couple of hours but I don't want to just live on biscuits. What can I keep within reach?",
        "I've been grazing all day instead of eating meals and I'm not sure if that's okay, or whether I should be trying to sit down to proper meals.",
      ],
      opens: [
        'Grazing is a perfectly good way to eat with a newborn.',
        'Having good things within reach is most of the battle.',
      ],
      points: [
        'Cheese and crackers, hummus and breadsticks, yoghurt, fruit and oatcakes all keep well near the sofa or in a bag.',
        'Pair something with carbohydrate and something with protein — crackers and cheese, apple and yoghurt — so it lasts longer than a biscuit.',
        "Biscuits are fine too; we're just making sure they aren't the only thing on offer.",
        "A small basket by your feeding chair with a drink and two or three snacks makes it easy to eat while you're stuck there.",
        'Proper meals will come back as she settles into a routine; for now, eating often is the goal.',
        'Roasted chickpeas, rice cakes and dried fruit are good when you want something crunchy.',
        "Restock the basket when you make a drink in the afternoon so it's ready for later.",
      ],
    },
    {
      asks: [
        'Is coffee okay?',
        'How much coffee can I have while breastfeeding?',
        'Coffee is the only thing keeping me upright at the moment. Do I need to cut back?',
        "I've been on four or five cups a day and the baby seems more unsettled in the afternoons. Could the coffee be part of it?",
      ],
      opens: [
        'Coffee is fine while feeding, in sensible amounts.',
        "It's worth looking at, but there's no need to give it up.",
      ],
      points: [
        'The usual advice is to stay under about two hundred milligrams of caffeine a day, which is roughly two mugs of instant or one strong coffee from a café.',
        'Some babies are more sensitive to caffeine than others, so if she seems unsettled, try cutting down for a few days and see if it changes.',
        'Tea, cola, energy drinks and dark chocolate all add caffeine too, so they count towards the total.',
        'Decaf for the second or third cup keeps the ritual without the caffeine.',
        'Coffee on an empty stomach can make you jittery, so have something to eat with it.',
        "When you're this tired, it makes sense that coffee is doing a lot of work — it's a sign you need rest, not a lack of willpower.",
        "Have your last one by early afternoon if you can, so it's not in the way when you do get a chance to rest.",
      ],
    },
    {
      asks: [
        'Always starving by ten.',
        'How do I stay full for longer after breakfast?',
        "Toast keeps me going for about an hour and then I'm ravenous again. What should I add?",
        "Breakfast is usually toast and jam and I'm climbing the walls by mid-morning. Is there something more filling I could switch to without much effort?",
      ],
      opens: [
        'Toast on its own burns off quickly; adding protein makes it last.',
        'A bit more protein at breakfast usually fixes the mid-morning crash.',
      ],
      points: [
        'Eggs, Greek yoghurt, cottage cheese and beans on toast all keep you full far longer than jam.',
        'Swapping white toast for a seeded or wholemeal loaf adds fibre, which slows things down too.',
        'A spoon of seeds on yoghurt or porridge adds a bit of protein and crunch without any work.',
        'A glass of milk with breakfast is an easy extra that most people forget counts.',
        "You don't need to overhaul everything; one change to what you already eat is enough to try first.",
        "If you're feeding a lot, you're genuinely hungrier than before, so a bigger breakfast is your body asking, not overdoing it.",
        'Let me know which of these sounds easiest and we can make it the default for a week.',
      ],
    },
    {
      asks: [
        'Not eating enough veg.',
        'How can I get more fruit and veg in without much effort?',
        'I keep buying vegetables with good intentions and then throwing them out a week later. Any ideas?',
        "I feel like I've eaten nothing green in days. What's the laziest way to get some fruit and vegetables back into the week?",
      ],
      opens: ['The laziest way is the right way at the moment.', 'Frozen and pre-cut are your friends right now.'],
      points: [
        "Frozen veg is just as good as fresh, keeps for months and goes straight into whatever you're heating up.",
        'Bagged salad, cherry tomatoes, baby carrots and cucumber need no chopping at all.',
        'Fruit that needs no peeling — grapes, berries, apples — gets eaten; fruit that needs work tends to sit.',
        'A handful of spinach stirred into pasta, soup or eggs at the end wilts in seconds and nobody notices.',
        'Tinned tomatoes, sweetcorn and beans count, and they last for ages in the cupboard.',
        'Buy less, more often, or ask whoever does the shopping to pick up just a few things at a time.',
        'A smoothie with a banana, frozen berries and a handful of spinach is two or three portions in one glass.',
      ],
    },
    {
      asks: [
        'Dinner ideas? Quick.',
        'What can we have for dinner that takes ten minutes?',
        "We're both too tired to do anything complicated by dinner time. What are some dinners that are basically just assembling things?",
        "My partner has gone back to work so dinners are on me now, with the baby, and I've got about fifteen minutes before she needs me again. Help.",
      ],
      opens: [
        "Assembling counts as making dinner, and it's what this stage calls for.",
        'A quick dinner is mostly about having the parts ready.',
      ],
      points: [
        "Wraps with hummus, cheese, salad and whatever's in the fridge take five minutes and need no heat at all.",
        'Pasta with a jar of pesto, frozen peas and a bit of cheese is done in the time the pasta takes.',
        'Jacket potatoes in the microwave with beans and cheese are filling and need almost no attention.',
        'Eggs are the fastest proper dinner there is: an omelette with whatever veg is around takes under ten minutes.',
        'A tray of veg and halloumi in the oven looks after itself while you feed her.',
        'Ready-made soup or a good loaf with cheese and salad is a perfectly respectable dinner on a hard day.',
        'Keep a short list of five easy dinners on the fridge so neither of you has to think when you are tired.',
      ],
    },
    {
      asks: [
        'So hungry all the time.',
        'Is it normal to be this hungry?',
        "I'm eating more than I did when I was pregnant and still feel hungry. Is something wrong?",
        "Some days I'm ravenous and other days I barely want anything at all. Is that swinging back and forth normal at this stage?",
      ],
      opens: [
        "Being very hungry is normal, especially while you're feeding.",
        'Swings in appetite are really common in these first months.',
      ],
      points: [
        'Making milk takes a lot of energy, so feeling hungrier than you did when pregnant makes sense.',
        "Tiredness also turns hunger up, because your body looks for quick energy when it's short on rest.",
        'On low-appetite days, small and often is easier than trying to face a full plate.',
        'On ravenous days, lean on filling things — bread, potatoes, eggs, beans, cheese — rather than fighting it.',
        'Your appetite will settle as feeding and rest find a rhythm; for now, follow it.',
        'If you go most of a day without wanting anything at all, a smoothie or a glass of milk can be easier than food.',
        "If low appetite comes with feeling very low or flat in mood, that's worth mentioning to your health visitor or doctor.",
      ],
    },
    {
      asks: [
        'Afternoon slump is brutal.',
        'Why do I crave sugar so much in the afternoons?',
        'Every afternoon around three I end up eating half a packet of biscuits. How do I stop that?',
        "I've noticed I'm reaching for chocolate and sweets every afternoon, and then I feel worse an hour later. Is there something better to have at that point?",
      ],
      opens: [
        'The afternoon dip is real, and tired bodies go looking for sugar.',
        'That craving is your body asking for energy, which makes sense right now.',
      ],
      points: [
        'A proper lunch with some protein in it makes the afternoon dip smaller.',
        "Have a planned afternoon snack — toast with cheese, yoghurt and fruit — before the craving hits, so it isn't the biscuits deciding.",
        'Some sweet things are fine; a couple of biscuits with a cup of tea is a nice part of the day, not a problem to solve.',
        'A glass of water and a few minutes outside can take the edge off, since tiredness and thirst both feel like hunger.',
        'Keep the biscuits in a cupboard rather than on the counter; out of sight genuinely helps.',
        'Dark chocolate gives you the hit with less sugar, if you like it.',
        "We're not counting anything here, just making sure the afternoon has something in it that keeps you going.",
      ],
    },
    {
      asks: [
        'We never eat together anymore.',
        'How do we get back to sitting down for meals together?',
        'My partner and I eat in shifts now, one holding the baby while the other eats. Is that just how it is for a while?',
        "We used to have dinner together every day and now it's whoever has a free hand eating standing up. I miss it. Any ideas?",
      ],
      opens: [
        'Eating in shifts is how a lot of couples get through this stage.',
        "It's a real loss, and it's worth trying to get some of it back.",
      ],
      points: [
        'A sling or a bouncer next to the table can sometimes buy you twenty minutes together.',
        'Aim for one shared meal a week rather than every day, so it feels possible.',
        "It doesn't have to be dinner; a weekend breakfast or lunch when she's most settled can work better.",
        'Eating in shifts still beats skipping, so whoever is holding her should get a plate made up for later.',
        'Keeping the meal simple makes it easier to sit down together; the point is the company, not the food.',
        'A takeaway on the floor with the baby between you still counts as eating together.',
        'It will come back as she settles into longer stretches; this is a season, not the new normal.',
      ],
    },
    {
      asks: [
        'Visitors keep bringing cake.',
        'People keep offering to help. What should I ask for?',
        'Friends keep asking what they can bring when they visit. What would actually be useful food-wise?',
        "My mum wants to bring food every time she comes round but it's always huge trays of pasta bake we can't finish. How do I ask for something else without upsetting her?",
      ],
      opens: ['Say yes to the help, and be specific.', 'People love having a clear job when they offer.'],
      points: [
        'Things that keep in the fridge and are eaten cold — salads, wraps, quiche, fruit — are often more useful than one big hot dish.',
        'Ask for smaller portions, so nothing goes to waste before you get to it.',
        'A bag of shopping is a great gift: bread, milk, fruit, yoghurt and something nice.',
        'You can say the big dishes are lovely but too much for two, and suggest something smaller next time.',
        "Cake is fine — it's a celebration — but you can mention that something savoury would be welcome too.",
        "Keep a short list on your phone of what you'd like, so when someone asks you can just read it out.",
        "It's also fine to ask visitors to make you a drink and a sandwich while they're there; most will be glad to.",
      ],
    },
    {
      asks: [
        'Got out for a walk today!',
        "Should I take snacks when I'm out with the pram?",
        'Went for my first long walk with the pram and was starving by the end. What should I bring next time?',
        "I'm trying to get out every day with the pram for some fresh air, but I end up buying a pastry every single time I pass the café. Is that a problem?",
      ],
      opens: [
        'Getting out with the pram is good for both of you.',
        'Walks with the pram count for more than people think.',
      ],
      points: [
        "A small bag with a drink, a piece of fruit and a cereal bar means you're not caught out halfway round.",
        "If the walk has become a café trip, that's not a problem to fix; a pastry and some air is a good part of the day.",
        "If you'd like something more filling, a sandwich or a cheese scone from the same café will keep you going longer.",
        "Pair the walk with lunch — go out after eating, or plan to eat when you get back — so it doesn't eat into a meal.",
        'Fresh air and daylight help your mood and your rhythm, which helps appetite settle too.',
        "Keep the bag packed by the door so it's one less thing to think about.",
        "Bring water even on cooler days; you're still feeding and walking, which adds up.",
      ],
    },
    {
      asks: [
        "Stomach's been off.",
        'Any tips for constipation after birth? Asking for me.',
        'Things have been a bit slow, digestion-wise, since the birth. Is there anything food-wise that helps?',
        "My stomach has been bloated and uncomfortable most days since the birth. I'm not sure if it's what I'm eating or just everything else. Where do I start?",
      ],
      opens: [
        'Digestion takes a while to settle after birth, and food can help.',
        "That's really common, and worth a gentle look.",
      ],
      points: [
        'Fibre helps most: oats, wholemeal bread, beans, lentils, fruit with the skin on, and plenty of veg.',
        'Fibre needs fluid to work, so it goes hand in hand with drinking more.',
        'Prunes, kiwi and pears are known for helping things along, and they make easy snacks.',
        'Gentle walking gets things moving too, which is another reason the pram walks are worth it.',
        "If bloating is new and comes with pain, or things don't improve in a week or two, check in with your GP.",
        'Big changes all at once can make bloating worse, so add one fibre-rich food at a time.',
        'Pain medicine after birth can slow digestion, so it may ease as you need it less.',
      ],
    },
    {
      asks: [
        'Fridge is a disaster.',
        'How long do leftovers keep?',
        'I keep finding things at the back of the fridge that have gone off. How do I keep track of what is in there?',
        'We make too much and then forget about it, and I hate throwing food away. Is there a simple system for using things up?',
      ],
      opens: [
        'A simple system beats a perfect one at this stage.',
        "Wasted food is frustrating, and it's easy to lose track right now.",
      ],
      points: [
        'Most leftovers keep for two to three days in the fridge; rice is the one to eat within a day.',
        'Put new things at the back and older things at the front, so the next thing you grab is the one that needs eating.',
        'A strip of masking tape and a pen on each container, with the day you made it, saves a lot of guessing.',
        "One shelf for 'eat first' makes it obvious what to reach for.",
        "Making a bit less is fine too; there's no need to make enough for four when there are two of you and one is tiny.",
        'A quick look in the fridge before shopping stops doubling up on things you already have.',
        "If something goes off now and then, that's normal; we're aiming for less waste, not none.",
      ],
    },
    {
      asks: [
        'Forgot lunch again.',
        'How do I stop forgetting to eat?',
        "By the time I notice I'm hungry I'm shaky and grumpy. How do I get ahead of it?",
        "Realised at four that I'd had nothing but coffee since I got up. I'm not doing it on purpose, I just forget I exist. Any tips?",
      ],
      opens: [
        "Forgetting to eat is really common when you're looking after someone this small.",
        "You're not doing anything wrong; your attention is just somewhere else right now.",
      ],
      points: [
        'Tie eating to feeds: every time she feeds, you have a drink and a snack.',
        'Set a gentle alarm on your phone for lunch, just for the next few weeks.',
        'Make eating the easy choice by having something ready in the fridge that needs no thought.',
        "Shaky and grumpy is a sign you've gone too long; a quick snack with some protein settles it faster than more coffee.",
        'Ask your partner or whoever is around to hand you a plate when they make their own.',
        'Even something small — a slice of toast, a banana, a glass of milk — counts as not skipping.',
        'You exist too, and eating is part of looking after her.',
      ],
    },
    {
      asks: [
        'Takeaway again today.',
        "Is it bad that we've had takeaway three times this week?",
        "We keep ordering in because we're exhausted, and I feel guilty about it. Should I be trying harder?",
        "Takeaways have become a bit of a habit since the baby arrived. They're easy, but I don't feel great after them. Is there a middle ground?",
      ],
      opens: [
        "Takeaway when you're exhausted is a sensible choice, not a failure.",
        "There's a middle ground, and it doesn't need much effort.",
      ],
      points: [
        'Pick dishes with some veg in them, or add a bag of salad or some frozen peas on the side.',
        'Order a bit less and fill out the plate with bread, rice or a quick salad from home.',
        "Keep two or three almost-ready meals in for the days you'd usually order, so there's another easy option.",
        "Notice which takeaways leave you feeling fine and which don't, and lean towards the first kind.",
        'Nobody needs to feel guilty about getting fed; this stage is about getting through the week.',
        'A takeaway with your partner on the sofa can be a nice bit of the week too.',
        "If it's every day and you'd like that to change, let's pick one day to try something simple instead.",
      ],
    },
  ],
  asides: [
    "She's finally settled.",
    'Typing one-handed, sorry.',
    "Kettle's on.",
    'Quick question while she naps.',
    'Partner says hi.',
    'Been meaning to ask this.',
    'Long day, but okay.',
    'Random one.',
    'Feeling a bit more human this week.',
    'Not sure if this is a silly question.',
    'On my phone, so ignore typos.',
    'Small win today.',
    "Sorry if I've asked this before, my memory is like a sieve at the moment.",
    'Been reading conflicting things online about this and wanted your take.',
    'My mum keeps telling me different things, so I wanted to check with you.',
  ],
  followUps: [
    'Does that sound manageable?',
    'Which of those feels easiest to try?',
    'How has the rest of the week been?',
    'Want me to add that to the plan?',
    'Let me know how it goes.',
    "Anything you'd want to swap out?",
    'Is there anything that has made it harder this week?',
    'Shall we try that for a few days and see?',
  ],
  wider: [
    "Looking at the week as a whole, you've been eating more regularly than you think, even if it doesn't feel like it from the inside.",
    "None of this needs to be perfect; we're looking for what makes the days easier, and the rest can wait.",
    "It's worth noticing which days felt better food-wise and what was different, because that tells us more than any rule.",
    "If something here doesn't fit how your days actually go, tell me and we'll change it rather than you trying to fit it.",
    'Small, repeatable things win at this stage — the same easy breakfast every day is a success, not a rut.',
    "You're feeding someone else around the clock, so looking after your own eating is part of that job, not separate from it.",
    "Give it a few days and then let me know what stuck and what didn't.",
    'We can keep it light and come back to it whenever you have the headspace.',
  ],
};
