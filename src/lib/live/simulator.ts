// The demo path for live coaching: two scripted, realistic holiday-lighting
// calls with timing offsets, always available (no Twilio/Deepgram account
// needed). /call/[leadId]/live feeds these to the client on a timer and
// posts each line to POST /api/live/segment as it "happens" -- the cards
// that come back are real (the real engine + the real Claude call in
// ./card.ts), only the audio is fake. Exported as plain data, per the brief.

export type SimulatedExchange = {
  speaker: 'rep' | 'customer';
  text: string;
  // Milliseconds after the simulated call starts when this line fires.
  atMs: number;
  // A caller-side dead-air gap immediately before this line, for exercising
  // the SILENCE trigger from inside the simulator too.
  silenceMs?: number;
};

export type SimulatorScript = {
  id: string;
  label: string;
  exchanges: SimulatedExchange[];
};

// Warm inbound-quote-followup call: open, price pushback, spouse objection,
// a competitor mention, a timing/closing question, and a clean booked close.
export const STANDARD_CALL: SimulatorScript = {
  id: 'standard',
  label: 'Warm holiday lighting call',
  exchanges: [
    { speaker: 'rep', atMs: 0, text: 'Hi, is this Sarah? This is Mike over at Yule Love Lights.' },
    { speaker: 'customer', atMs: 4000, text: 'Oh hi, yeah this is Sarah.' },
    { speaker: 'rep', atMs: 9000, text: 'Great, you requested a quote for holiday lighting on our website and I wanted to follow up.' },
    { speaker: 'customer', atMs: 15000, text: 'Yes we did. We saw the display our neighbors had last year and wanted something like it.' },
    { speaker: 'rep', atMs: 21000, text: 'We can definitely do that. Is it just the roofline you are picturing, or the whole property?' },
    { speaker: 'customer', atMs: 28000, text: 'Probably the roofline, and maybe around the front door.' },
    { speaker: 'rep', atMs: 35000, text: 'Got it. We will walk the whole property first so nothing is a surprise on the quote.' },
    {
      speaker: 'customer',
      atMs: 42000,
      text: 'Okay, so how much does something like that usually cost?',
      silenceMs: 5000,
    },
    {
      speaker: 'rep',
      atMs: 50000,
      text: 'For a roofline plus an entry accent on a home your size, most customers land around eight hundred to twelve hundred dollars for the season, fully installed and removed.',
    },
    { speaker: 'customer', atMs: 58000, text: 'Hmm, that sounds kind of expensive for a few weeks of lights.' },
    {
      speaker: 'rep',
      atMs: 66000,
      text: 'A lot of folks think that at first. It includes the commercial grade lights, all the install and takedown labor, and storage until next year, so nothing sits in your garage.',
    },
    { speaker: 'customer', atMs: 74000, text: 'That part is nice, I really do not love storing bins in the garage all year.' },
    { speaker: 'rep', atMs: 82000, text: 'Exactly, and if you ever want it permanent you can just change the color from your phone.' },
    { speaker: 'customer', atMs: 90000, text: 'I like that, but let me talk to my spouse before we commit to anything.' },
    {
      speaker: 'rep',
      atMs: 98000,
      text: 'Totally understand, this is usually a two person decision. Want me to send a one page summary you two can look at tonight?',
    },
    { speaker: 'customer', atMs: 106000, text: 'Yes, that would help a lot.' },
    { speaker: 'rep', atMs: 114000, text: 'I will get that over today. Are you working with anyone else on this, or just us so far?' },
    { speaker: 'customer', atMs: 122000, text: 'We actually already got a quote from another company, but nothing signed yet.' },
    {
      speaker: 'rep',
      atMs: 130000,
      text: 'Good to compare. I will make sure our quote spells out exactly what is included so it is apples to apples.',
    },
    { speaker: 'customer', atMs: 138000, text: 'Their cheaper quote did not seem to include takedown, so I am not sure it is a fair comparison.' },
    {
      speaker: 'rep',
      atMs: 146000,
      text: 'Good question to ask them directly. Ours always includes full teardown and storage, so nothing lingers on your roof past January.',
    },
    { speaker: 'customer', atMs: 154000, text: 'That is good to know. When can you actually get out here to give us a real number?' },
    {
      speaker: 'rep',
      atMs: 162000,
      text: 'I can have someone out this week to measure, usually about fifteen minutes, and you would have a firm quote same day.',
    },
    { speaker: 'customer', atMs: 170000, text: 'Could we do this weekend? Saturday works best for us.' },
    { speaker: 'rep', atMs: 178000, text: 'Saturday works. Does morning or afternoon work better for you?' },
    { speaker: 'customer', atMs: 186000, text: 'Morning is better for us.' },
    { speaker: 'rep', atMs: 194000, text: 'Perfect, I will get you on the schedule for Saturday morning and text a confirmation.' },
    { speaker: 'customer', atMs: 202000, text: 'Sounds great, thank you!' },
    { speaker: 'rep', atMs: 210000, text: 'Thank you, Sarah, we will see you Saturday. Have a good night.' },
    { speaker: 'customer', atMs: 214000, text: 'You too, bye!' },
  ],
};

// Shorter, harder call: skeptical from the start, a flat "not interested",
// a competitor already in the picture, and a soft, noncommittal close
// instead of a booking -- the coach keeps working even when the call does
// not end cleanly.
export const DIFFICULT_CUSTOMER_CALL: SimulatorScript = {
  id: 'difficult',
  label: 'Difficult customer',
  exchanges: [
    { speaker: 'rep', atMs: 0, text: 'Hi, this is Mike with Yule Love Lights, is this Dave?' },
    { speaker: 'customer', atMs: 3000, text: 'Yeah, who gave you this number?' },
    { speaker: 'rep', atMs: 7000, text: 'You requested a quote through our website a couple weeks back for holiday lighting.' },
    {
      speaker: 'customer',
      atMs: 12000,
      text: 'I do not remember doing that, but fine, how much does it cost?',
      silenceMs: 6000,
    },
    {
      speaker: 'rep',
      atMs: 20000,
      text: 'It depends on the size of the job, but most homes like yours run around a thousand dollars for the season.',
    },
    { speaker: 'customer', atMs: 27000, text: 'A thousand dollars? That is way too expensive for lights you take down in a month.' },
    {
      speaker: 'rep',
      atMs: 35000,
      text: 'I hear you. That price covers the lights, the install, the takedown, and storage, so there is nothing else to buy.',
    },
    { speaker: 'customer', atMs: 43000, text: 'Honestly, we are not interested. We already have a guy who does it for way less.' },
    {
      speaker: 'rep',
      atMs: 51000,
      text: 'Understood. Can I ask what he is charging, just so I know if we are even quoting the same scope?',
    },
    { speaker: 'customer', atMs: 59000, text: 'He gave us a cheaper quote, I do not remember exactly how much.' },
    {
      speaker: 'rep',
      atMs: 67000,
      text: 'Fair enough. A lot of what he charges less for is because he skips takedown or storage, so it is worth double checking what is actually included.',
    },
    { speaker: 'customer', atMs: 75000, text: 'Maybe. I am also just really busy right now, this is not a good time.' },
    { speaker: 'rep', atMs: 83000, text: 'No problem at all. Would it help if I called back next week instead?' },
    { speaker: 'customer', atMs: 91000, text: 'I guess. Do not call every day though.' },
    {
      speaker: 'rep',
      atMs: 99000,
      text: 'Understood, one call next week, that is it. When can you actually talk, evenings or weekends?',
    },
    { speaker: 'customer', atMs: 107000, text: 'Weekends, I guess. Saturday afternoon.' },
    { speaker: 'rep', atMs: 115000, text: 'Got it, I will call Saturday afternoon. Thanks for your time, Dave.' },
    { speaker: 'customer', atMs: 120000, text: 'Yeah, okay, bye.' },
  ],
};

export const SIMULATOR_SCRIPTS: SimulatorScript[] = [STANDARD_CALL, DIFFICULT_CUSTOMER_CALL];

export function getSimulatorScript(id: string): SimulatorScript | undefined {
  return SIMULATOR_SCRIPTS.find(s => s.id === id);
}
