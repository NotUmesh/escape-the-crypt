/**
 * Strings for the four lock panels (bone ordering, bound threads, combination dial, cursed
 * object). Covered by the banned-words test in `copy-lock-panels.test.ts`.
 */
export const LOCK_PANEL_LABELS = {
  /** Shown instead of a panel body when the question's data is missing or the wrong shape. */
  payloadMissing: "This question can't be shown right now. You can skip it.",
  itemTextMissing: 'Text missing',
  // Bone ordering
  boneListLabel: 'Put the bones in order',
  boneShortcutLine: 'With a bone selected, hold Alt and press the up or down arrow to move it.',
  moveUp: 'Move up',
  moveDown: 'Move down',
  boneFixed: 'Fixed by the hint',
  boneHinted: (text: string): string => `Hint: ${text} is fixed in place.`,
  boneMoved: (text: string, position: number, total: number): string => `${text}, now ${position} of ${total}`,
  boneBlocked: (text: string): string => `${text} can't move that way.`,
  // Bound threads
  threadsLeftLabel: 'Left column',
  threadsRightLabel: 'Right column',
  threadsTiedLabel: 'Tied pairs',
  threadsNoneTied: 'No pairs tied yet.',
  undo: 'Undo',
  tiedByHint: 'Tied by the hint',
  threadHinted: (left: string, right: string): string => `Hint: ${left} is tied to ${right}.`,
  chooseLeftFirst: 'Choose an item on the left first.',
  tieEveryLeft: 'Tie every item on the left before you submit.',
  rightAlreadyTied: 'That item is already tied. Undo its pair first.',
  leftSelected: (text: string): string => `${text} selected. Now choose a partner on the right.`,
  leftCleared: (text: string): string => `${text} no longer selected.`,
  tied: (left: string, right: string): string => `Tied ${left} to ${right}.`,
  untied: (left: string, right: string): string => `Undid ${left} and ${right}.`,
  // Combination dial
  wheelsLabel: 'Wheels',
  typedEntryLabel: 'Or type the number',
  increase: 'Increase',
  decrease: 'Decrease',
  typeNumberFirst: 'Turn a wheel or type a number first.',
  invalidNumber: 'Use digits only, with at most one decimal place.',
  unitLine: (unit: string): string => `Unit: ${unit}`,
  wheelNow: (name: string, digit: number): string => `${name}, now ${digit}`,
  // Cursed object
  itemHinted: (text: string): string => `Hint: ${text} is removed.`,
  cursedGroupLabel: 'Choose the one that does not belong',
} as const;
