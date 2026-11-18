import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { ChessSystem } from './chess.js';

const container = document.getElementById('scene-container') as HTMLDivElement;

World.create(container, projectOptions).then((world) => {
  world.registerSystem(ChessSystem);
});
