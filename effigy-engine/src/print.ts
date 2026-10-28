// The print the sculpt is made for: a bust 75-90 mm tall on an FDM printer with a 0.2 mm nozzle. The bust is
// about 2.6 head units tall, so at about 82 mm one unit is 32 mm. Surface detail is sized in print
// millimetres with this, so it survives printing: a groove narrower than about two nozzle widths fills in,
// and a ridge thinner than about three is lost.

export const MM = 1 / 32; // one print millimetre, in head units

export const MIN_GROOVE = 0.4 * MM; // the narrowest groove that prints
export const MIN_FEATURE = 0.6 * MM; // the thinnest raised feature that prints
