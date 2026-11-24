/** What happened, never how it looks or sounds (Req 24.6). */
export type Outcome_Notice =
  | {
      readonly kind: 'candleLit';
      readonly target:
        | { readonly type: 'slot'; readonly slotId: string }
        | { readonly type: 'spirit'; readonly roomId: string };
    }
  | { readonly kind: 'ghostSpawned'; readonly conceptId: string }
  | { readonly kind: 'ghostLaidToRest'; readonly conceptId: string }
  | { readonly kind: 'sealCracked'; readonly slotId: string }
  | { readonly kind: 'roomCleared'; readonly roomId: string }
  | { readonly kind: 'escaped' };
