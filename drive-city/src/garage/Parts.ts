/** What the garage sells and what it does (garage/index.ts applies it to `Vehicle.tune`). */

/** Engine stages: torque and top speed. Tyres: grip. Nitro: seconds a full bottle burns. */
export const ENGINE = [{ torque: 1, top: 1 }, { torque: 1.15, top: 1.05 }, { torque: 1.3, top: 1.1 }, { torque: 1.45, top: 1.15 }];
export const TYRES = [1, 1.08, 1.16];
export const NITRO = [0, 3, 4.5, 6];
/** Price of the next stage (index = stage you have). */
export const PRICE = { engine: [600, 1500, 3000], tyres: [500, 1200], nitro: [800, 1600, 2800], paint: 150, impound: 300, repairPerPoint: 4, dashcam: 400, call: 200 };
/** The fine when the police get you: a base and so much per star. */
export const FINE = { base: 100, perStar: 150 };
export const PAINTS = ['#1c1d20', '#f2f2ef', '#b9bcbf', '#8c1d1d', '#1d49b5', '#1f5e3c', '#e0a019', '#6b2fa0'];


/**
 * 车行 (2026-10-18, 「车太次了 没有豪车」): the luxury cars sold new, stock, in a paint of their own. Bought here, one rolls
 * into the garage and is your car. One taken off the street is not yours until it has been through the books here:
 * 过户 costs `TRANSFER` of the new price, and until then the garage will not work on it. 豪华轿车 taken out (2026-10-21,
 * 「车行里面把豪华轿车去掉，只留两辆」): a limo off the street is an ordinary car again, made yours by any upgrade.
 */
export const DEALER = [
  // AE86 (2026-10-22, 「把AE86放到商店里，名字叫AE86」): the cheap one, white over black as 藤原's
  { body: 'ae86', price: 12000, paint: '#f2f2ef', kmh: 200, to100: 6.9 },
  { body: 'coupe', price: 30000, paint: '#8c1d1d', kmh: 320, to100: 2.3 },
  { body: 'super', price: 80000, paint: '#9bd21c', kmh: 340, to100: 2.2 },
] as const;
export const TRANSFER = 0.5;
export type LuxuryBody = (typeof DEALER)[number]['body'];
export const isLuxury = (b: string): b is LuxuryBody => DEALER.some((d) => d.body === b);
