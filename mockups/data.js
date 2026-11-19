// Invented sample data shared by the three mockups. Nothing here comes from a real forecast.
window.MOCK = (() => {
  const M = {
    month: 'November', year: 2026, days: 30, today: 18, sign: 'Scorpio', glyph: '\u264F\uFE0E',
    theme:
      'A month for finishing what you started in autumn. The first half favours quiet groundwork at work; after the 17th the attention moves to money and agreements. Keep the last days of the month free of big decisions.',
    typeLabel: { good: 'Good time to', care: 'Be careful', key: 'Key date' },
    topics: ['Career', 'Money', 'Love', 'Health', 'Contracts'],
    events: [
      { from: 3, to: 6, type: 'good', topics: ['Career'], title: 'Send the applications', insight: 'Several sources call these days favourable for reaching out.', action: 'Send the messages you have been drafting, and keep them short and direct.', sources: ['Cafe Astrology', 'Astrostyle'] },
      { from: 9, type: 'key', moon: 'new', topics: ['Love', 'Health'], title: 'New Moon in your sign', insight: 'The reset point of your year.', action: 'Pick one thing to begin rather than five.', sources: ['Written in the Stars', 'Astrology Zone'] },
      { from: 11, to: 13, type: 'care', topics: ['Contracts'], title: 'Read the fine print', insight: 'Details are easy to miss in these days.', action: 'If you have to sign, ask for one more day to read it.', sources: ['Sally Kirkman'] },
      { from: 14, type: 'good', topics: ['Love'], title: 'An easy evening for an honest talk', insight: 'A conversation you have been putting off goes more gently than expected.', action: 'Choose the evening and start the talk yourself.', sources: ['Astrostyle'] },
      { from: 17, to: 20, type: 'good', topics: ['Money'], title: 'Review the budget', insight: 'A clear-headed stretch for numbers.', action: 'Plan the big purchase now, buy later.', sources: ['Astrology Zone', 'Cafe Astrology'] },
      { from: 19, type: 'care', topics: ['Health'], title: 'Keep the schedule light', insight: 'Energy dips mid-week.', action: 'Move the hard workout and the late night.', sources: ['Written in the Stars'] },
      { from: 24, type: 'key', moon: 'full', topics: ['Career'], title: 'Full Moon: a work matter comes to a head', insight: 'Something that has been building since spring gets an answer.', action: 'Let it arrive rather than forcing it.', sources: ['Cafe Astrology', 'Sally Kirkman'] },
      { from: 26, to: 28, type: 'good', topics: ['Contracts'], title: 'Negotiations go more smoothly', insight: 'The better window of the month for terms, offers and difficult emails.', action: 'Schedule the negotiation or send the offer in these days.', sources: ['Astrostyle'] },
      { from: 30, type: 'care', topics: ['Money'], title: 'Hold off on impulse spending', insight: 'What looks like a bargain today looks different next week.', action: 'Wait a week before any unplanned purchase.', sources: ['Astrology Zone'] },
    ],
    sources: [
      { name: 'Written in the Stars by Rux', status: 'used' },
      { name: 'Cafe Astrology', status: 'used' },
      { name: 'Astrology Zone', status: 'used' },
      { name: 'Astrostyle', status: 'used' },
      { name: 'Sally Kirkman', status: 'no forecast yet' },
    ],
  };
  // The older mockups show insight and action as one paragraph.
  M.events.forEach((e) => (e.summary = `${e.insight} ${e.action}`));
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  M.dow = (d) => new Date(M.year, 10, d).getDay();
  M.wd = (d) => WD[M.dow(d)];
  M.end = (e) => e.to || e.from;
  M.range = (e) => (e.to ? `${e.from}\u2013${e.to} Nov` : `${M.wd(e.from)} ${e.from} Nov`);
  M.on = (d) => M.events.filter((e) => d >= e.from && d <= M.end(e));
  M.usedCount = M.sources.filter((s) => s.status === 'used').length;
  return M;
})();
