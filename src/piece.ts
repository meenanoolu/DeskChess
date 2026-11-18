import { createComponent, Types } from '@iwsdk/core';

export const Piece = createComponent('Piece', {
  square: { type: Types.String, default: 'a1' },
  isSelected: { type: Types.Boolean, default: false },
});
