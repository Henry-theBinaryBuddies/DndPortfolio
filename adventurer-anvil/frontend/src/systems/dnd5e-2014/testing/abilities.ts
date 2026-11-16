// Choices that set ability scores with each method, for tests.
import { METHOD_KEY, POINT_BUY_KEY, STANDARD_KEY } from "../steps/abilities";

type Scores = Record<string, number>;

export const standardArray = (scores: Scores) => ({ [METHOD_KEY]: "standard-array", [STANDARD_KEY]: scores });
export const pointBuy = (scores: Scores) => ({ [METHOD_KEY]: "point-buy", [POINT_BUY_KEY]: scores });
