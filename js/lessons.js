// Tutor lesson library: one entry per tag. Rule-based, no LLM needed.
// kind: 'mistake' | 'good' | 'habit'. theme: the puzzle theme to drill.

export const TAGS = {
  allowed_mate: {
    kind: 'mistake', label: 'Allowed mate', theme: 'mate defence', severity: 6,
    lesson: 'Your move let the opponent force checkmate. Before every move, look at every check your opponent could give next. Checks that land near your king with support are the dangerous ones.',
    habit: 'Before you move: what checks does my opponent have?',
    drill: 'Mate-in-1 and mate-in-2 puzzles, solved from the defender\'s side: find the move that stops it.',
  },
  missed_mate: {
    kind: 'mistake', label: 'Missed mate', theme: 'mate', severity: 5,
    lesson: 'You had a forced checkmate and played something else. When the enemy king is exposed, list every check first. Mate ends the game, so it beats any material gain.',
    habit: 'Checks first, then captures, then threats.',
    drill: '10 mate-in-1 and mate-in-2 puzzles a day until you see them instantly.',
  },
  hung_piece: {
    kind: 'mistake', label: 'Hung a piece', theme: 'hanging piece', severity: 5,
    lesson: 'A piece was left where it could be taken for free. After choosing a move, look at the square it lands on and the squares it stops guarding. Ask: can anything of mine be captured for free now?',
    habit: 'Blunder check: what does my move leave undefended?',
    drill: 'Hanging-piece puzzles. Then in games, touch nothing until you have done the blunder check.',
  },
  hung_pawn: {
    kind: 'mistake', label: 'Dropped a pawn', theme: 'hanging pawn', severity: 2,
    lesson: 'A pawn went for free. Pawns are small, but at your level the player with more material usually wins the endgame. Keep pawns defended, especially the ones next to your king.',
    habit: 'Count attackers and defenders on anything you leave behind.',
    drill: 'Counting exercises: for each capture on a square, count attackers vs defenders.',
  },
  allowed_fork: {
    kind: 'mistake', label: 'Allowed a fork', theme: 'fork', severity: 4,
    lesson: 'Your opponent got one piece attacking two of yours at once. Knights fork from squares like e6, f7, c7 (and e3, f2, c2). Before moving, check every square an enemy knight can jump to and what it would hit there.',
    habit: 'Where can their knight land, and what does it hit?',
    drill: 'Fork puzzles, then "spot the fork square" drills.',
  },
  forked_king_and_queen: {
    kind: 'mistake', label: 'King and queen forked', theme: 'fork', severity: 5,
    lesson: 'Your king and queen were attacked together. Keep the queen off squares a knight or checking piece can hit along with your king, and castle early so the king is not in the middle.',
    habit: 'Never line up king and queen where one move hits both.',
    drill: 'Royal fork puzzles.',
  },
  bad_exchange: {
    kind: 'mistake', label: 'Losing trade', theme: 'exchange', severity: 3,
    lesson: 'A capture that lost material once the recaptures finished. Before capturing, count: how many of mine attack the square, how many of theirs defend it, and what each piece is worth.',
    habit: 'Count the whole sequence before you capture.',
    drill: 'Exchange-counting puzzles.',
  },
  missed_capture: {
    kind: 'mistake', label: 'Missed a free capture', theme: 'hanging piece', severity: 3,
    lesson: 'Material was there for the taking and you played something else. After every opponent move, ask what they just left undefended.',
    habit: 'What did their last move leave hanging?',
    drill: 'Puzzles where the answer is a simple capture.',
  },
  missed_check_idea: {
    kind: 'mistake', label: 'Missed a strong check', theme: 'attack', severity: 3,
    lesson: 'A forcing check was the best move. Checks limit what your opponent can do, which makes them easy to calculate. Look at all of them every move.',
    habit: 'Name every check before choosing a quiet move.',
    drill: 'Attack puzzles that start with a check.',
  },
  missed_punish: {
    kind: 'mistake', label: 'Didn\'t punish their mistake', theme: 'punish', severity: 4,
    lesson: 'Your opponent made a big mistake and your reply let them off. When their move looks odd, stop and look for what it allows: a capture, a check, a fork.',
    habit: 'Odd move from them? Slow down and look for the punishment.',
    drill: 'Puzzles from your own games where the opponent blundered.',
  },
  opened_line: {
    kind: 'mistake', label: 'Opened a line', theme: 'discovered attack', severity: 4,
    lesson: 'Your move cleared a line (a file, rank or diagonal) and an enemy bishop, rook or queen now hits something behind it. Pieces block lines; moving them unblocks those lines.',
    habit: 'When a piece moves, what line does it open?',
    drill: 'Discovered-attack and x-ray puzzles.',
  },
  check_that_loses_tempo: {
    kind: 'mistake', label: 'Check that backfired', theme: 'tempo', severity: 2,
    lesson: 'You gave a check that helped your opponent: they blocked or moved with a gain of time. A check is only good if it leads somewhere. Ask what their best answer to the check is.',
    habit: 'Check only when you know the follow-up.',
    drill: 'Compare: forcing check vs. quiet best move puzzles.',
  },
  quiet_mistake: {
    kind: 'mistake', label: 'Positional slip', theme: 'positional', severity: 2,
    lesson: 'No piece was dropped, but the move let the opponent improve a lot. Usually this means a better plan was available: develop, castle, take the centre, or improve your worst piece.',
    habit: 'No tactics? Improve your worst piece.',
    drill: 'Review the engine\'s suggested move and say why it is better in one sentence.',
  },
  threw_winning_position: {
    kind: 'mistake', label: 'Let a win slip', theme: 'conversion', severity: 5,
    lesson: 'You reached a winning position and didn\'t win. When ahead: take forcing moves first, trade pieces (not pawns), keep the king safe, and don\'t start new adventures.',
    habit: 'Ahead? Simplify. Trade pieces, keep the king home.',
    drill: 'Conversion practice: start up material and win it against the engine.',
  },
  time_trouble: {
    kind: 'mistake', label: 'Time trouble', theme: 'clock', severity: 2,
    lesson: 'Mistakes came while your clock was low. In 10-minute games, spend time early on the critical moves and play the obvious recaptures quickly.',
    habit: 'Fast on obvious moves, slow on critical ones.',
    drill: 'Play a few 15|10 games to build the thinking habit with time to spare.',
  },
  // Good-move tags
  only_move_found: { kind: 'good', label: 'Found the only move', lesson: 'This was the one move that held the position, and you found it.' },
  double_check: { kind: 'good', label: 'Double check', lesson: 'Two pieces giving check at once. The king must move, nothing can block or capture both. Remember this pattern.' },
  checkmate_delivered: { kind: 'good', label: 'Checkmate', lesson: 'You finished the game. Notice which pieces worked together.' },
  punished_blunder: { kind: 'good', label: 'Punished a blunder', lesson: 'They erred, you saw it, you cashed in. This is the skill that wins games at every level.' },
  strong_move: { kind: 'good', label: 'Best move in a sharp spot', lesson: 'You found the engine\'s top move when other moves were clearly worse.' },
};

export const HABIT_CARDS = [
  { id: 'cct', title: 'Checks, captures, threats', body: 'Every move: my checks and captures first, then theirs. Ten seconds, every time, even when it feels obvious.' },
  { id: 'castle', title: 'Castle by move 10', body: 'Knights and bishops out, king castled, rooks to the centre. In the London: Nf3, Bd3 or Be2, then O-O.' },
  { id: 'ahead', title: 'When ahead', body: 'Forcing moves first. Then trade pieces, keep pawns, keep your king home. No new adventures.' },
  { id: 'blunder', title: 'Blunder check', body: 'Before you let go of the piece: what does this move stop defending, and what line does it open?' },
  { id: 'odd', title: 'Their odd move', body: 'If their move looks strange, it is either a trap or a mistake. Either way, stop and look.' },
];

// Habits (from opening hygiene) that point at specific cards.
export const HABIT_TAGS = {
  no_castle: { label: 'Never castled', card: 'castle', lesson: 'Your king stayed in the centre. Open centres get kings killed. Aim to castle by move 10.' },
  late_castle: { label: 'Castled late', card: 'castle', lesson: 'You castled, but late. Earlier castling keeps your rook connected and your king safe.' },
  king_walk: { label: 'King walk', card: 'castle', lesson: 'Your king moved several times outside the endgame. Every king move in the middlegame is a step toward danger.' },
  slow_development: { label: 'Slow development', card: 'castle', lesson: 'By move 10 some knights and bishops were still at home. Undeveloped pieces can\'t help attack or defend.' },
  early_queen: { label: 'Early queen moves', card: 'castle', lesson: 'Moving the queen early lets the opponent develop with tempo by attacking it.' },
  flank_pawns: { label: 'Many flank pawn moves', card: 'castle', lesson: 'Several a/b/g/h pawn moves in the opening. Each one is permanent and often loosens your king.' },
  repeat_mover: { label: 'Same piece moved repeatedly', card: 'castle', lesson: 'One piece moved three or more times in the opening while others stayed home.' },
};

export function tagLabel(tag) {
  return (TAGS[tag] || HABIT_TAGS[tag] || { label: tag.replace(/_/g, ' ') }).label;
}

// Sentence template for a key-moment caption (rule-based narrator).
export function caption(m, userColor) {
  const mine = m.color === userColor;
  if (mine && m.goodTags && m.goodTags.length && !m.primaryTag) return TAGS[m.goodTags[0]].lesson;
  if (!mine) {
    const sev = m.cls === 'blunder' || m.cls === 'mistake';
    return sev ? `Your opponent's ${m.cls}. The punishment was ${m.punishSan || m.bestSan}.` : `Engine preferred ${m.bestSan}.`;
  }
  const best = m.bestSan ? ` Engine wanted ${m.bestSan}.` : '';
  const refute = m.refutationSan ? ` Their best answer: ${m.refutationSan}.` : '';
  return `Win chance ${Math.round(m.wpBefore)}% → ${Math.round(m.wpAfter)}%.${best}${refute}`;
}
