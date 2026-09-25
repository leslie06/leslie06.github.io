/** What the garage sells and what it does (garage/index.ts applies it to `Vehicle.tune`). */

/** Engine stages: torque and top speed. Tyres: grip. Nitro: seconds a full bottle burns. */
export const ENGINE = [{ torque: 1, top: 1 }, { torque: 1.15, top: 1.05 }, { torque: 1.3, top: 1.1 }, { torque: 1.45, top: 1.15 }];
export const TYRES = [1, 1.08, 1.16];
export const NITRO = [0, 3, 4.5, 6];
/** Price of the next stage (index = stage you have). */
export const PRICE = { engine: [600, 1500, 3000], tyres: [500, 1200], nitro: [800, 1600, 2800], paint: 150, impound: 300, repairPerPoint: 4 };
/** The fine when the police get you: a base and so much per star. */
export const FINE = { base: 100, perStar: 150 };
export const PAINTS = ['#1c1d20', '#f2f2ef', '#b9bcbf', '#8c1d1d', '#1d49b5', '#1f5e3c', '#e0a019', '#6b2fa0'];

